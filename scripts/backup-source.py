#!/usr/bin/env python
"""把项目源码打包成一份自描述的备份 zip。

★★ 为什么要有脚本，而不是手敲一条 zip 命令：
   排除清单里有一半条目**不是"体积大"那么简单**，而是"打进去会出事"：

   1. `android/keystore/` 与 `android/keystore.properties` —— **签名私钥**。
      它一旦随源码包流出去就等于公开了应用签名。
      （代价：丢了就无法覆盖升级，必须单独备份 —— 脚本会在结尾**显式提醒**，
        而不是默默跳过让人以为备份完整了。）
   2. `android/app/src/*/assets/public/` —— 由 `npm run build` 生成、且每个 flavor 一份。
      打进备份毫无意义（可重新生成），还会让包变大 7 MB。
   3. `node_modules/`、`dist/`、`scripts/qa/out|tmp/` —— 还原品 / 测试产物。
      `scripts/qa/tmp/` 里是浏览器 profile，实测 69 MB，占了 scripts 目录的 99%。

   ⇒ 把这些写成代码里的显式清单，比记在脑子里可靠。

★ 备份内会写一份 `BACKUP-MANIFEST.txt`，记录 git HEAD、是否含未提交改动、
  以及**排除项清单** —— 让这份 zip 自己能说清"我包含什么、不包含什么"，
  将来拿到它的人（包括几个月后的自己）不必猜。

用法：
    python scripts/backup-source.py                     # 输出到 apk-out/ai爱-源码-<日期>.zip
    python scripts/backup-source.py --out-dir .         # 换输出目录
    python scripts/backup-source.py --name 我的备份       # 换文件名（自动加日期与 .zip）
    python scripts/backup-source.py --include-keystore  # 明确要连私钥一起备份（见下方警告）
"""
from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ★ 排除清单用「相对项目根的精确路径」，不用「目录名」。
#   踩过的坑：最初写成按目录名排除（遇到叫 `build` / `out` / `tmp` 的目录就整棵跳过），
#   看着更简洁，但会**误伤** —— `src/` 下任何同名目录都会被一起排掉，
#   而且我当时还定义了一个常量却忘了在判定函数里用它（等于没排除），
#   结果是 `node_modules` 与 `dist` 会被打进备份。精确路径不会出这类问题。
EXCLUDE_DIRS = [
    'node_modules',                                     # 依赖，还原品（npm install 可重建）
    'dist',                                             # web 构建产物
    '.qa-tmp',
    '.workbuddy',                                       # 助手内部记忆/日志，不是产品源码
    'android/app/build', 'android/build',               # gradle 产物
    'android/.gradle', 'android/.idea',                 # gradle 缓存 / IDE 配置
    # 生成的 web assets（每个 flavor 一份，共约 7 MB，由 npm run build 重建）
    'android/app/src/builtin/assets/public',
    'android/app/src/standalone/assets/public',
    'android/app/src/main/assets',
    # 测试产物：out/ 报告与截图，tmp/ 浏览器 profile（实测占 scripts 的 99%，69 MB）
    'scripts/qa/out', 'scripts/qa/tmp',
    'apk-out',                                          # 交付物，不由源码备份承载
    # ★★ `release/`：版本归档根目录（2026-10-04 起的一版一目录）。
    #   它是**交付物仓库**，里面每个 buildId 目录都躺着 2 个 APK + 1 份源码 zip。
    #   不排除的后果是**爆炸式增长**：第 N 次打包会把前 N-1 次的所有产物再压一遍
    #   （每次约 6+6+8 = 20 MB），备份体积随构建次数平方级膨胀。
    #   而且逻辑上也不该收：源码备份要的是"能重建出 APK 的输入"，
    #   release/ 里全是输出 —— 输出装进备份，备份就不再是"输入快照"了。
    'release',
]

EXCLUDE_FILES = [
    'android/local.properties',                         # 含本机 SDK 绝对路径，换机无效
    'android/app/src/main/assets/capacitor.config.json',
    'android/app/src/main/assets/capacitor.plugins.json',
    'scripts/qa/last-run.log',
]

# 签名私钥：默认排除，`--include-keystore` 才纳入
KEYSTORE_PATHS = ['android/keystore', 'android/keystore.properties']

# 打包时跳过的时间戳缓存（vite 每次启动都会生成一批，无价值）
SKIP_SUFFIXES = ('.log', '.timestamp')

# ★ `.git` **刻意纳入**：它只有 2.2 MB，却让备份具备完整还原历史的能力
#   （能 `git log`、能看出"这份备份对应哪个提交"）。不想要历史时自行删掉即可。


def is_excluded(rel: str, include_keystore: bool) -> bool:
    """rel 用 `/` 分隔、相对项目根。"""
    if any(rel == p or rel.startswith(p + '/') for p in EXCLUDE_DIRS):
        return True
    if rel in EXCLUDE_FILES:
        return True
    if not include_keystore:
        if any(rel == p or rel.startswith(p + '/') for p in KEYSTORE_PATHS):
            return True
    if rel.endswith(SKIP_SUFFIXES):
        return True
    return False


def git(*args: str) -> str:
    try:
        return subprocess.run(
            ['git', *args], cwd=ROOT, capture_output=True, text=True, timeout=30
        ).stdout.strip()
    except Exception:
        return ''


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out-dir', default='apk-out', help='输出目录（相对项目根，默认 apk-out）')
    ap.add_argument('--name', default='ai爱-源码', help='文件名前缀')
    ap.add_argument('--include-keystore', action='store_true',
                    help='把签名私钥一起打进备份（默认不打！）')
    args = ap.parse_args()

    date = datetime.now().strftime('%Y-%m-%d')
    out_dir = (ROOT / args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_zip = out_dir / f'{args.name}-{date}.zip'

    # 先收集清单，再写 zip（这样才能把统计写进 MANIFEST）
    files: list[tuple[Path, str]] = []
    skipped: list[str] = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        rel_dir_posix = '' if rel_dir == '.' else rel_dir.replace(os.sep, '/')

        # 先把该跳的目录整个剪掉，避免白走进 node_modules
        keep = []
        for d in dirnames:
            rel_child = f'{rel_dir_posix}/{d}' if rel_dir_posix else d
            if is_excluded(rel_child, args.include_keystore):
                skipped.append(rel_child + '/')
            else:
                keep.append(d)
        dirnames[:] = keep

        for f in filenames:
            rel = f'{rel_dir_posix}/{f}' if rel_dir_posix else f
            if is_excluded(rel, args.include_keystore):
                skipped.append(rel)
                continue
            # 避免"备份把上一次的备份再打进来"（当 --out-dir 指向项目内时会发生）
            if f.startswith(args.name) and f.endswith('.zip'):
                skipped.append(rel)
                continue
            files.append((Path(dirpath) / f, rel))

    if not files:
        print('没有可打包的文件 —— 排除清单是不是写错了？', file=sys.stderr)
        return 1

    git_head = git('rev-parse', 'HEAD') or '(非 git 仓库或无提交)'
    git_dirty = git('status', '--porcelain')
    dirty_n = len(git_dirty.splitlines()) if git_dirty else 0

    total_src = sum(p.stat().st_size for p, _ in files)

    # 先算出来再用 —— 避免在 f-string 里嵌套同种引号（我第一版就漏了个收尾单引号，
    # 导致整个脚本语法都过不去）。f-string 里放表达式时，独立变量最不容易出错。
    keystore_note = '已纳入（--include-keystore）' if args.include_keystore else '★ 未纳入（需单独备份）'

    # 写 zip：ZIP_DEFLATED 压缩；中文文件名走 UTF-8 标志位（zipfile 自动处理）
    with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path, rel in files:
            z.write(path, rel)

        manifest = [
            '源 码 备 份 清 单',
            '=' * 60,
            f'打包时间     : {datetime.now().isoformat(timespec="seconds")}',
            f'项目根       : {ROOT}',
            f'git HEAD     : {git_head}',
            f'未提交改动   : {dirty_n} 项' + ('（工作区不干净，此备份含未提交内容）' if dirty_n else '（工作区干净）'),
            f'纳入文件     : {len(files)} 个，未压缩 {total_src / 1024 / 1024:.1f} MB',
            f'签名私钥     : {keystore_note}',
            '',
            '排除清单（相对项目根，精确路径）',
            '-' * 60,
        ]
        for p in EXCLUDE_DIRS:
            manifest.append(f'  [目录] {p}/')
        for p in EXCLUDE_FILES:
            manifest.append(f'  [文件] {p}')
        if not args.include_keystore:
            for p in KEYSTORE_PATHS:
                manifest.append(f'  [私钥] {p}  ← ★ 需单独备份')
        manifest.append('  [后缀] ' + ', '.join(SKIP_SUFFIXES))
        manifest.append('')
        manifest.append('⚠ 签名私钥不在本备份内' if not args.include_keystore
                        else '含签名私钥（--include-keystore，注意保密）')
        manifest.append('')
        manifest.append('如何从本备份还原并打出 APK')
        manifest.append('-' * 60)
        manifest.append('  1) 装依赖            npm install')
        manifest.append('  2) 构建期开关（可选） VITE_BUILTIN_XINRAN=1|0')
        manifest.append('  3) 打两个版本 APK     node scripts/build-apk.mjs')
        manifest.append('     仅复验已有包        node scripts/build-apk.mjs --verify')
        manifest.append('  4) 前置：JDK 21 + Android SDK；android/local.properties 指向 SDK')
        manifest.append('     （该文件含本机绝对路径，故未纳入备份，需自建）')
        if not args.include_keystore:
            manifest.append('')
            manifest.append('★ 注意：签名私钥不在本备份内。它丢了就无法对已装的应用做覆盖升级，')
            manifest.append('   必须单独备份 android/keystore/ai-ai-release.jks 与 keystore.properties。')
        z.writestr('BACKUP-MANIFEST.txt', '\n'.join(manifest) + '\n')

    # 自检：能读回、条目数对得上（避免打出一个损坏的包却以为成功了）
    with zipfile.ZipFile(out_zip) as z:
        bad = z.testzip()
        n = len(z.namelist())
    if bad is not None:
        print(f'✗ 备份损坏（{bad}）', file=sys.stderr)
        return 1

    size_mb = out_zip.stat().st_size / 1024 / 1024
    print(f'\n✓ 备份完成：{out_zip}')
    print(f'  大小 {size_mb:.1f} MB｜纳入 {len(files)} 个文件（未压缩 {total_src / 1024 / 1024:.1f} MB）｜zip 内条目 {n}')
    print(f'  git HEAD {git_head[:12]}｜未提交改动 {dirty_n} 项')
    print(f'  自检：zip 完整性 ✓')
    if not args.include_keystore:
        print('\n★ 提醒：签名私钥**不在**备份里。它丢了就无法覆盖升级（只能卸载重装，会清空数据）。')
        print('  keystore: android/keystore/ai-ai-release.jks')
        print('  passwd  : android/keystore.properties')
        print('  → 请单独备份这两个文件；若确实要打进源码包，加 --include-keystore。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
