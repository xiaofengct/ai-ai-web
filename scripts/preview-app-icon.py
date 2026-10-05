#!/usr/bin/env python3
"""
图标预览 —— 把「自适应图标最终长什么样」画出来，用眼睛验收。

★ 为什么必须有这个脚本：
  Android 自适应图标是「背景层 + 前景层 + 启动器遮罩」叠加的产物，
  最终观感**不等于**任何单个源图，而且链路里有两层独立缩放：
    ① `gen-app-icon.py` 把主体缩进安全区（SAFE_RATIO）
    ② `@capacitor/assets` 生成的 `ic_launcher.xml` 又给前后景各加 16.7% inset
  两层相乘 ⇒ 主体可能小得离谱。**这只能看出来，算不出来**。
  （首版就是这样翻车的：0.60 × 0.833 ≈ 50%，狐狸在图标里成了个小点。）

★ 本脚本并列渲染**两套前景策略**，直接把取舍摆在眼前：
  A. `fit`（主体缩进安全区）：适合"主体 + 留白"式源图
  B. `fill`（整图铺满，靠系统遮罩裁边）：适合"整幅插画即图标"式源图 ← 我们的狐狸月亮属这类
  每套都渲染「圆形遮罩 / 圆角方遮罩 / 不裁切」三种，共 6 格。

用法：python scripts/preview-app-icon.py
输出：assets/preview-icon.png
"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
OUT = os.path.join(ASSETS, "preview-icon.png")

PANEL = 360           # 单格边长
GAP = 28
HEADER = 34
LABEL_H = 34
INSET = 0.167         # 与 @capacitor/assets 生成的 ic_launcher.xml 保持一致


def load(name: str) -> Image.Image:
    p = os.path.join(ASSETS, name)
    if not os.path.isfile(p):
        raise SystemExit(f"缺少素材：{p}（先跑 scripts/gen-app-icon.py）")
    return Image.open(p).convert("RGBA")


def circle_mask(size: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
    return m


def rounded_mask(size: int, r: float = 0.22) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * r), fill=255)
    return m


def compose(bg: Image.Image, fg: Image.Image) -> Image.Image:
    """
    按 ic_launcher.xml 的语义合成自适应图标：两层各按 INSET 内缩后叠加。
    用 `paste(..., mask=)` 显式贴 alpha，比 Image.composite 在 RGBA 上的双通道行为更好预测。
    """
    canvas = Image.new("RGBA", (PANEL, PANEL), (0, 0, 0, 0))
    inner = max(1, int(PANEL * (1 - INSET * 2)))
    off = (PANEL - inner) // 2
    b = bg.resize((inner, inner), Image.LANCZOS)
    canvas.paste(b, (off, off), b)
    f = fg.resize((inner, inner), Image.LANCZOS)
    canvas.paste(f, (off, off), f)
    return canvas


def apply_mask(layer: Image.Image, mask: Image.Image | None) -> Image.Image:
    if mask is None:
        return layer
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    out.paste(layer, (0, 0), mask)   # ★ 用 mask 贴：mask 决定哪些像素留下
    return out


def checker(draw: ImageDraw.ImageDraw, x: int, y: int, size: int, tile: int = 12) -> None:
    for ty in range(0, size, tile):
        for tx in range(0, size, tile):
            c = (232, 232, 236) if ((tx // tile + ty // tile) % 2 == 0) else (212, 212, 218)
            draw.rectangle((x + tx, y + ty, x + tx + tile - 1, y + ty + tile - 1), fill=c)


def main() -> int:
    # fill 策略：整图直接铺满（前景不再缩）；fit 策略：直接用已有的 icon-foreground.png（60% 安全区）
    full = load("icon.png")
    bg = load("icon-background.png")
    fg_fit = load("icon-foreground.png")

    strategies = [
        ("A. fit（主体缩进安全区）", load("icon-foreground.png"), 60),
        ("B. fill（整图铺满，靠遮罩裁边）", full, 100),
    ]
    masks = [("circle", circle_mask(PANEL)), ("rounded", rounded_mask(PANEL)), ("none", None)]

    cols = len(masks)
    W = GAP + cols * (PANEL + GAP)
    H = HEADER + len(strategies) * (PANEL + LABEL_H + GAP) + GAP
    img = Image.new("RGB", (W, H), (247, 247, 250))
    d = ImageDraw.Draw(img)
    d.text((GAP, 10), "icon preview - pick one strategy (magenta = current source SAFE_RATIO)", fill=(30, 30, 36))

    for si, (sname, fg, ratio) in enumerate(strategies):
        y = HEADER + si * (PANEL + LABEL_H + GAP)
        d.text((GAP, y - 16), f"{sname}  [foreground {ratio}%]", fill=(60, 60, 70))
        for mi, (mname, mask) in enumerate(masks):
            x = GAP + mi * (PANEL + GAP)
            checker(d, x, y, PANEL)
            layer = apply_mask(compose(bg, fg), mask)
            img.paste(layer, (x, y), layer)
            d.rectangle((x, y, x + PANEL - 1, y + PANEL - 1), outline=(190, 190, 198))
            d.text((x, y + PANEL + 8), mname, fill=(70, 70, 80))

    # 正方形参考：标出「主体占图标宽度」的目测比例，便于判断是否偏小
    img.save(OUT, "PNG")
    print(f"预览已生成：{OUT}  ({W}x{H})")
    print("对照看：A 与 B 哪个主体比例更像一个正常 App 图标；圆形遮罩下四角是否被裁到主体")
    return 0


if __name__ == "__main__":
    sys.exit(main())
