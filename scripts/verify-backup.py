#!/usr/bin/env python
"""校验一份源码备份 zip 是否「完整且干净」—— 逐条给结论，而不是只看它能不能打开。

★ 为什么需要专门校验备份（而不是"打出来了就算完"）：
  一个**静默漏文件**的备份比没有备份更危险 —— 你以为有退路，出事时才发现没有。
  所以这里做的是**双向**核对：
    正向：该在的必须在（关键源码逐字节比对哈希）
    反向：不该在的必须不在（依赖/产物/私钥）

用法：python scripts/verify-backup.py apk-out/ai爱-源码-2026-10-04.zip
"""
from __future__ import annotations

import hashlib
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

if len(sys.argv) < 2:
    print('用法：python scripts/verify-backup.py <备份.zip>', file=sys.stderr)
    raise SystemExit(2)

zip_path = Path(sys.argv[1]).resolve()
if not zip_path.exists():
    print(f'✗ 备份不存在：{zip_path}', file=sys.stderr)
    raise SystemExit(1)

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = '') -> None:
    results.append((name, ok, detail))
    print(f'  {"PASS" if ok else "FAIL"}  {name}{"  — " + detail if detail else ""}')


with zipfile.ZipFile(zip_path) as z:
    names = z.namelist()
    name_set = set(names)

    print(f'\n═══ 备份校验：{zip_path.name} ═══')
    print(f'条目 {len(names)} 个，压缩包 {zip_path.stat().st_size / 1024 / 1024:.1f} MB\n')

    # ---------- 1) 完整性 ----------
    bad = z.testzip()
    check('zip 结构完整（testzip）', bad is None, '' if bad is None else f'损坏条目 {bad}')

    # ---------- 2) 自描述清单 ----------
    check('含 BACKUP-MANIFEST.txt（备份能自己说明包含/排除了什么）', 'BACKUP-MANIFEST.txt' in name_set)
    if 'BACKUP-MANIFEST.txt' in name_set:
        mf = z.read('BACKUP-MANIFEST.txt').decode('utf-8', 'replace')
        check('  清单记录了 git HEAD', 'git HEAD' in mf)
        check('  清单记录了排除项', '排除清单' in mf)

    # ---------- 3) 正向：关键源码必须在 ----------
    must_have = [
        'package.json',
        'package-lock.json',
        'index.html',
        'capacitor.config.ts',
        'vite.config.ts',
        'tsconfig.json',
        'tailwind.config.ts',
        'src/App.tsx',
        'src/main.tsx',
        'src/db/bootstrap.ts',
        'src/store/personaStore.ts',
        'src/features/home/HomePage.tsx',
        'src/features/home/PersonaRail.tsx',
        'src/llm/httpTransport.ts',
        'android/app/build.gradle',
        'android/build.gradle',
        'android/gradlew',
        'android/app/src/main/AndroidManifest.xml',
        'android/app/src/main/res/xml/network_security_config.xml',
        'scripts/build-apk.mjs',
        'scripts/backup-source.py',
        'docs/07-交付说明.md',
        'README.md',
    ]
    missing = [p for p in must_have if p not in name_set]
    check(f'关键源码齐全（{len(must_have)} 个必含项）', not missing,
          '' if not missing else f'缺 {missing}')

    # ---------- 4) 反向：这些绝不能在里面 ----------
    forbidden_prefixes = [
        'node_modules/', 'dist/', 'apk-out/', '.workbuddy/', '.qa-tmp/',
        'android/app/build/', 'android/build/', 'android/.gradle/',
        'scripts/qa/out/', 'scripts/qa/tmp/',
        'android/keystore/', 'android/keystore.properties',
    ]
    leaked = []
    for n in names:
        for p in forbidden_prefixes:
            if n == p.rstrip('/') or n.startswith(p):
                leaked.append(n)
                break
    check('不含依赖/产物/测试输出/私钥', not leaked,
          '' if not leaked else f'泄漏 {len(leaked)} 项，例如 {leaked[:3]}')

    check('私钥确实不在（keystore 关键词全包扫描）',
          not any('keystore' in n.lower() and n.lower().endswith(('.jks', '.keystore')) for n in names))
    check('私钥口令文件确实不在', 'android/keystore.properties' not in name_set)

    # ---------- 5) 正向哈希比对：src/ 与磁盘逐字节一致 ----------
    src_entries = [n for n in names if n.startswith('src/') and not n.endswith('/')]
    disk_src = [p for p in (ROOT / 'src').rglob('*') if p.is_file()]
    mismatched = []
    for rel in src_entries:
        disk = ROOT / rel
        if not disk.exists():
            mismatched.append(f'{rel}（磁盘上已不存在）')
            continue
        h_zip = hashlib.sha256(z.read(rel)).hexdigest()
        h_disk = hashlib.sha256(disk.read_bytes()).hexdigest()
        if h_zip != h_disk:
            mismatched.append(rel)
    check(f'src/ 逐字节一致（zip 内 {len(src_entries)} 个）',
          not mismatched, '' if not mismatched else f'{len(mismatched)} 个不一致：{mismatched[:3]}')

    # 数量核对：zip 里的 src/ 文件数应等于磁盘上的（排除不该有的）
    check('src/ 文件数量与磁盘一致', len(src_entries) == len(disk_src),
          f'zip {len(src_entries)} vs 磁盘 {len(disk_src)}')

    # ---------- 6) 顶层结构概览 ----------
    from collections import Counter
    top = Counter(n.split('/')[0] for n in names if '/' in n)
    print('\n  顶层构成：' + '｜'.join(f'{k} {v}' for k, v in top.most_common(12)))

failed = [r for r in results if not r[1]]
print(f'\n═══ {len(results) - len(failed)}/{len(results)} 通过 ═══')
for n, _, d in failed:
    print(f'  ✗ {n} — {d}')
raise SystemExit(0 if not failed else 1)
