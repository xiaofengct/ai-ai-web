"""从源码抽取 141 项能力的「当前等级」，与 PRD 的功能项名称合并成一份清单。

用途：生成 `docs/11-应用功能需求列表.md` 的表格 —— 让清单反映**当前代码的真实状态**，
而不是只抄 PRD 的计划状态（两者会随时间漂移，本项目已经发生过）。

用法：
    python scripts/gen-capability-table.py            # 打印 markdown 表格
    python scripts/gen-capability-table.py --json     # 输出 JSON（给别的脚本用）
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAP_TS = ROOT / 'src' / 'constants' / 'capabilities.ts'
PRD_MD = ROOT / 'docs' / '01-PRD-功能拆解.md'

# 能力表的真源：src/constants/capabilities.ts
# 切块方式：以一个键声明 `'PG-01': {` 为界。
KEY_RE = re.compile(r"\n\s*'((?:FN|PG|SV|PL|EX|XR)-\d+)':\s*\{")

LEVEL_CN = {
    'full': '完全',
    'partial': '部分',
    'alternative': '替代',
    'unavailable': '不可',
}


def read_capabilities() -> dict[str, dict[str, str]]:
    text = CAP_TS.read_text(encoding='utf-8')
    parts = KEY_RE.split(text)
    items: dict[str, dict[str, str]] = {}
    # split 带一个捕获组 ⇒ [前置, id1, body1, id2, body2, ...]
    for i in range(1, len(parts) - 1, 2):
        fid, body = parts[i], parts[i + 1]
        lv = re.search(r"level:\s*'([a-z]+)'", body)
        gr = re.search(r"group:\s*'([^']+)'", body)
        items[fid] = {
            'level': lv.group(1) if lv else 'unknown',
            'group': gr.group(1) if gr else 'unknown',
        }
    return items


def read_names() -> dict[str, str]:
    """从 PRD 的对照表里取功能项中文名（形如 `| PG-01 | 聊天统计 | ...`）。"""
    text = PRD_MD.read_text(encoding='utf-8')
    names: dict[str, str] = {}
    for m in re.finditer(r'^\|\s*((?:FN|PG|SV|PL|EX|XR)-\d+)\s*\|\s*([^|]+?)\s*\|', text, re.M):
        names.setdefault(m.group(1), m.group(2))
    return names


def main() -> int:
    items = read_capabilities()
    names = read_names()

    order = ['PG', 'FN', 'SV', 'PL', 'EX', 'XR']
    rows = []
    for pre in order:
        ids = sorted((k for k in items if k.startswith(f'{pre}-')), key=lambda x: int(x.split('-')[1]))
        for fid in ids:
            rows.append({
                'id': fid,
                'group': items[fid]['group'],
                'name': names.get(fid, '(PRD 未命名)'),
                'level': items[fid]['level'],
                'levelCn': LEVEL_CN.get(items[fid]['level'], items[fid]['level']),
            })

    if '--json' in sys.argv:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return 0

    print(f'共 {len(rows)} 项｜等级分布：{dict(Counter(r["levelCn"] for r in rows))}\n')
    cur = None
    for r in rows:
        if r['group'] != cur:
            cur = r['group']
            # 用四级标题：这张表整体挂在 docs/11 的 §2 之下
            print(f'\n#### 2.x {cur} —— {sum(1 for x in rows if x["group"] == cur)} 项\n')
            print('| ID | 功能项 | 当前等级 |')
            print('|---|---|---|')
        print(f'| {r["id"]} | {r["name"]} | {r["levelCn"]} |')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
