"""核对某个 release 构建的 APK 内是否含「启动兜底」修复（白屏 P0 的交付验收）。

用法：
    python scripts/qa/check-apk-boot-fix.py                       # 检查最新构建
    python scripts/qa/check-apk-boot-fix.py v1.0-b20261004-163800

为什么单独写这个脚本而不并入 check-boot-compat.mjs：
    后者检查的是**构建前的 dist/**（快速、能在编译前拦住问题）；
    本脚本检查的是**已经打进 APK 的东西**（慢一点，但证明"交付物真的带了修复"）。
    两者是"过程防线"与"交付验收"的分工，不能互相替代 ——
    白屏事故的教训正是"本地产物没问题"不等于"用户拿到的包没问题"。
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
RELEASE = ROOT / 'release'

# 修复必须体现在交付物里的四件东西（缺任何一件，白屏就还可能复现）
HTML_MARKERS = {
    'ES5 兜底 structuredClone': 'structuredClone',
    '启动失败上报钩子': '__aiAiBootFail',
    '静态启动页 #boot': 'id="boot"',
    '启动失败面板 #boot-error': 'id="boot-error"',
    '内联浅色底 #f7f7f8': '#f7f7f8',
    '内联深色底 #161a22': '#161a22',
    '10s 看门狗': '10000',
}

# 入口 chunk 里**不允许**出现的东西（出现即白屏风险）
ENTRY_FORBIDDEN = {
    'structuredClone': 'WebView 98+，老设备上会让入口模块求值失败',
    'Object.hasOwn': 'WebView 93+',
    '?.': '可选链语法，es2017 目标下应已转译',
    '??': '空值合并语法，es2017 目标下应已转译',
}


def latest_build() -> str | None:
    if not RELEASE.exists():
        return None
    dirs = sorted(p.name for p in RELEASE.iterdir() if p.is_dir() and p.name.startswith('v'))
    return dirs[-1] if dirs else None


def check(build_id: str) -> int:
    build_dir = RELEASE / build_id
    apks = sorted(build_dir.glob('*.apk'))
    if not apks:
        print(f'✗ {build_dir} 下没有 APK')
        return 1

    failed = 0
    print(f'\n═══ 核对构建 {build_id} 的启动兜底 ═══')
    print(f'目录：{build_dir}\n')

    for apk in apks:
        print(f'── {apk.name}')
        with zipfile.ZipFile(apk) as z:
            names = z.namelist()
            if 'assets/public/index.html' not in names:
                print('  ✗ 包内没有 assets/public/index.html')
                failed += 1
                continue

            html = z.read('assets/public/index.html').decode('utf-8')

            for label, needle in HTML_MARKERS.items():
                mark = '✓' if needle in html else '✗'
                if needle not in html:
                    failed += 1
                print(f'  {mark} {label}')

            m = re.search(r'assets/index-[A-Za-z0-9_-]+\.js', html)
            if not m:
                print('  ✗ 解析不出入口 chunk')
                failed += 1
                continue
            entry = m.group(0)
            js = z.read('assets/public/' + entry).decode('utf-8')
            print(f'  入口 chunk：{entry}')
            for needle, why in ENTRY_FORBIDDEN.items():
                n = js.count(needle)
                mark = '✓' if n == 0 else '✗'
                if n:
                    failed += 1
                print(f'  {mark} 入口不含 {needle!r}（{n} 次）— {why}')
        print()

    # ★ f-string 里放条件表达式要注意语法：`{x if cond else y}` 的 `if` 不能省。
    #   （我第一版写成 `{failed == 0 else ...}`，直接语法错 —— 踩过一次。）
    verdict = '全部通过 ✓' if failed == 0 else f'{failed} 项失败'
    print(f'═══ {verdict} ═══\n')
    return 0 if failed == 0 else 1


def main() -> int:
    build_id = sys.argv[1] if len(sys.argv) > 1 else latest_build()
    if not build_id:
        # ★ 发布副本里 `release/` 下**必然没有** vN 构建（`release/*` 被 .gitignore 忽略，只留 INDEX/README）
        #   ⇒ 这里必须**优雅降级**（打印说明 + 退出 0），而不是"一跑脚本就报错"。
        #   判据沿用本项目已确立的：**「跳过 ≠ 失败，但必须打印」**。
        #   （本脚本核对的是**本地构建产物**，需先跑 `npm run apk` 生成 `release/vN/`。）
        print('\n═══ 核对构建的启动兜底 ═══\n')
        print('  ⚠️ 跳过：未找到可核对的构建（release/ 下没有 vN 目录）')
        print(f'     查找位置：{RELEASE}')
        print('  （release/* 被 .gitignore 忽略（只留 INDEX/README）⇒ 发布副本里必然没有 vN 目录；')
        print('    本脚本核对的是**本地构建产物**，需先跑 `npm run apk` 生成 release/vN/）\n')
        print('  → 本次**未执行任何检查**，"通过"不代表已验证。\n')
        return 0
    return check(build_id)


if __name__ == '__main__':
    raise SystemExit(main())
