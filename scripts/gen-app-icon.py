#!/usr/bin/env python3
"""
从一张 1024x1024 的方形源图生成 Capacitor / Android 所需的图标素材。

输出到 `assets/`（`@capacitor/assets` 约定的输入目录）：
  - icon.png                 完整方形图标（legacy，Android 7 及以下 / 部分桌面）
  - icon-foreground.png      自适应图标前景：主体缩进安全区、四周透明
  - icon-background.png      自适应图标背景：取源图四角色（纯净底色）
  - splash.png              启动图（深色底 + 居中图标，2732x2732 供 Capacitor 缩放）

为什么必须单独出 foreground/background：
  Android 8+ 的自适应图标会被启动器按厂商形状**裁切**（圆 / 方 / 水滴…）。
  如果只给完整方图，裁切会切掉狐狸的耳朵和月亮边缘。
  正确做法是把主体缩到**安全区**（中心 66% 直径）内，四周留透明，再由背景层填底色。

用法：
  python scripts/gen-app-icon.py <源图路径>
"""
import os
import statistics
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets")

# ★ 自适应图标前景层缩放比 —— **实测修正，别凭规范直觉改回 0.6**。
#
# Android 官方的规范是「前景内容放在中心 66% 直径内」，但**那条规范的前提是前景层是透明底的**
# （只有主体、没有背景）。本项目的源图是「1024×1024 纯色底 + 居中主体（约占画面 55~60%）」，
# 属于"整幅插画即图标"，不满足那个前提。
#
# 首版照规范取 0.60，再叠加 `@capacitor/assets` 在 `ic_launcher.xml` 里加的 16.7% inset
# ⇒ 0.60 × 0.833 ≈ 50% ⇒ **主体在图标里只剩约 30%**，狐狸成了一个小点（已用预览图确认）。
#
# 改成 1.0（前景直接用整图）之后：
#   - 前景自带与背景层**同色**的底，两层无缝，视觉上等于一张图；
#   - 圆形/圆角遮罩裁掉的只是四周纯色背景，**主体不受损**；
#   - 主体占比回到源图本身的比例，是正常的 App 图标观感。
# 取舍：代价是"前景层不是纯主体"（规范意义上不规范），换来的是**看起来对**。
#
# 验收方式：`python scripts/preview-app-icon.py` 生成对比图，肉眼确认主体大小与遮罩裁切。
SAFE_RATIO = 1.0
SIZE = 1024


def corner_bg(im: Image.Image) -> tuple[int, int, int]:
    """四角采样求背景色（源图为纯色底，四角必是底色）。"""
    w, h = im.size
    pts = [(4, 4), (w - 5, 4), (4, h - 5), (w - 5, h - 5)]
    cs = [im.getpixel(p) for p in pts]
    return tuple(int(statistics.mean(c[i] for c in cs)) for i in range(3))  # type: ignore[return-value]


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python scripts/gen-app-icon.py <源图路径>", file=sys.stderr)
        return 2

    src_path = sys.argv[1]
    if not os.path.isfile(src_path):
        print(f"找不到源图: {src_path}", file=sys.stderr)
        return 2

    os.makedirs(OUT_DIR, exist_ok=True)

    src = Image.open(src_path).convert("RGB")
    # 统一到 1024 见方（源图已是 1024，这里只做保底）
    src = src.resize((SIZE, SIZE), Image.LANCZOS)
    bg = corner_bg(src)
    print(f"源图 {src_path}")
    print(f"  尺寸 {src.size} / 背景色 {bg} (#{bg[0]:02X}{bg[1]:02X}{bg[2]:02X})")

    # ① legacy 图标：完整方形（不裁切主体的场景用它）
    icon_path = os.path.join(OUT_DIR, "icon.png")
    src.save(icon_path, "PNG")
    print(f"  → icon.png {os.path.getsize(icon_path)} B")

    # ② 自适应图标背景：纯底色
    bg_img = Image.new("RGB", (SIZE, SIZE), bg)
    bg_path = os.path.join(OUT_DIR, "icon-background.png")
    bg_img.save(bg_path, "PNG")
    print(f"  → icon-background.png {os.path.getsize(bg_path)} B")

    # ③ 自适应图标前景：把整张源图缩到安全区、居中、四周透明
    #     （源图自带同色底，缩进同色背景层上视觉无接缝）
    inner = int(SIZE * SAFE_RATIO)
    shrunk = src.resize((inner, inner), Image.LANCZOS)
    fg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    off = (SIZE - inner) // 2
    fg.paste(shrunk, (off, off))
    fg_path = os.path.join(OUT_DIR, "icon-foreground.png")
    fg.save(fg_path, "PNG")
    print(f"  → icon-foreground.png {os.path.getsize(fg_path)} B "
          f"(安全区 {inner}px / 偏移 {off}px)")

    # ④ 启动图：深色底 + 居中图标（与浅色底形成对比，启动时有"出现"的感觉）
    SPLASH = 2732
    splash_bg = Image.new("RGB", (SPLASH, SPLASH), (22, 26, 34))  # #161A22，与 manifest 背景色一致
    logo = src.resize((SPLASH // 3, SPLASH // 3), Image.LANCZOS)
    splash_bg.paste(logo, ((SPLASH - logo.width) // 2, (SPLASH - logo.height) // 2))
    splash_path = os.path.join(OUT_DIR, "splash.png")
    splash_bg.save(splash_path, "PNG")
    print(f"  → splash.png {os.path.getsize(splash_path)} B ({SPLASH}x{SPLASH})")

    print(f"完成：素材已写入 {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
