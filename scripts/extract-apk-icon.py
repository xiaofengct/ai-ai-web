"""从 APK 里取出启动器图标，合成自适应图标预览，供人工目视验收。

★ 为什么不能按文件名找（实测踩坑）：
  AGP 8 的 release 构建默认开启 resource path shortening，`res/mipmap-xxxhdpi/ic_launcher.png`
  会被改名成 `res/9D.png` 这种短名，字符串也大量挪进 `resources.arsc`。
  ⇒ 按 `ic_launcher` 这个名字在 zip 里搜，**一个都搜不到**（实测：res/ 有 405 条，命中 0 条）。
  正确做法是先读资源表拿到 名字 → 短路径 的映射，再按短路径取文件。

★ 为什么必须"从 APK 里取"而不是看源图：
  @capacitor/assets 有它自己的一套缩放/裁剪规则，源图对不代表进包的图对。
  唯一可信的证据是从最终产物里读出来，再用眼睛看。
"""
import io
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

from PIL import Image

APK = Path(sys.argv[1])
OUT = Path(sys.argv[2])
AAPT2 = sys.argv[3] if len(sys.argv) > 3 else None

if AAPT2 is None:
    sdk = Path(os.path.expanduser("~/.<dir>/android-toolchain/sdk"))
    bt = sorted((sdk / "build-tools").iterdir())[-1]
    AAPT2 = str(bt / "aapt2.exe")

DENSITY = {"ldpi": 1, "mdpi": 2, "hdpi": 3, "xhdpi": 4, "xxhdpi": 5, "xxxhdpi": 6, "nodpi": 0, "anydpi": 0, "": 0}


def resource_map():
    """解析 `aapt2 dump resources`，返回 {资源名: {密度: zip 内路径}}。"""
    out = subprocess.run([AAPT2, "dump", "resources", str(APK)], capture_output=True, text=True).stdout
    result = {}
    cur = None
    for line in out.splitlines():
        m = re.match(r"\s*resource 0x[0-9a-f]+ (\S+)", line)
        if m:
            cur = m.group(1)
            result.setdefault(cur, {})
            continue
        if cur is None:
            continue
        m = re.match(r"\s*\(([a-z0-9\-]*)\)\s*\(file\)\s+(\S+)", line)
        if m:
            result[cur][m.group(1)] = m.group(2)
        elif re.match(r"\s*\(file\)\s+(\S+)", line):
            # 无密度限定符（anydpi 等）
            result[cur]["anydpi"] = re.match(r"\s*\(file\)\s+(\S+)", line).group(1)
    return result


rmap = resource_map()
print("=== 图标资源表映射 ===")
for name in sorted(n for n in rmap if "ic_launcher" in n or "splash" in n):
    dens = {k: v for k, v in rmap[name].items() if v}
    print(f"  {name}: {dens}")


def best(name):
    """取最高密度的那一份。"""
    entries = rmap.get(name, {})
    best_d = -1
    best_v = None
    for d, v in entries.items():
        if not v:
            continue
        if DENSITY.get(d, 0) > best_d:
            best_d, best_v = DENSITY.get(d, 0), v
    return best_v


z = zipfile.ZipFile(APK)
panels = []

fg_name = best("mipmap/ic_launcher_foreground")
bg_name = best("mipmap/ic_launcher_background")
legacy_name = best("mipmap/ic_launcher")

print(f"\n前景(xxxhdpi) = {fg_name}")
print(f"背景(xxxhdpi) = {bg_name}")
print(f"legacy        = {legacy_name}")

fg_img = bg_img = None
if fg_name and fg_name in z.namelist():
    fg_img = Image.open(io.BytesIO(z.read(fg_name))).convert("RGBA")
    panels.append(("foreground", fg_img))
if bg_name and bg_name in z.namelist():
    bg_img = Image.open(io.BytesIO(z.read(bg_name))).convert("RGBA")
    panels.append(("background", bg_img))

if fg_img is not None and bg_img is not None:
    comp = bg_img.resize(fg_img.size).copy()
    comp.alpha_composite(fg_img)
    panels.append(("overlay(full)", comp.copy()))
    # 圆形遮罩下的观感：按 66.7% 安全区方形裁切
    w, h = comp.size
    side = int(min(w, h) * 0.667)
    box = ((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2)
    circle = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    circle.paste(comp.crop(box), (0, 0))
    mask = Image.new("L", (side, side), 0)
    from PIL import ImageDraw

    ImageDraw.Draw(mask).ellipse((0, 0, side - 1, side - 1), fill=255)
    circle.putalpha(mask)
    panels.append(("as-circle-launcher", circle))

if legacy_name and legacy_name in z.namelist():
    panels.append(("legacy ic_launcher", Image.open(io.BytesIO(z.read(legacy_name))).convert("RGBA")))

if not panels:
    print("\n!! 没找到任何图标")
    sys.exit(1)

H = 340
gap = 18
scaled = []
for label, im in panels:
    r = H / im.height
    scaled.append((label, im.resize((max(1, int(im.width * r)), H), Image.LANCZOS)))

W = sum(im.width for _, im in scaled) + gap * (len(scaled) + 1)
canvas = Image.new("RGBA", (W, H + gap * 2), (245, 245, 245, 255))
x = gap
for label, im in scaled:
    canvas.alpha_composite(im, (x, gap))
    x += im.width + gap

OUT.parent.mkdir(parents=True, exist_ok=True)
canvas.save(OUT)
print(f"\n已写出预览：{OUT}")
print(f"面板顺序：{' | '.join(l for l, _ in scaled)}")
