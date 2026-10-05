import type { ISODate, UUID } from './common';

export interface BackupMeta {
  id: UUID;
  createdAt: ISODate;
  appVersion: string;
  counts: { sessions: number; messages: number; personas: number; memories: number };
  sizeBytes: number;
  kind: 'manual' | 'auto';
}

export interface AppBackupBundle {
  meta: BackupMeta;
  files: Record<string, string | Uint8Array>;
  /**
   * 目录约定（导出 zip 时还原）：
   * settings.json
   * personas/*.json            （chara_card_v2，兼容原应用）
   * sessions/{id}.json
   * memories.json
   * stickers/{packId}/custom_stickers.json + 图片
   * distill/{slug}/{memories.md,persona.md,meta.json,SKILL.md,versions/*}
   * logs.jsonl（可选）
   */
}

export interface ImportReport {
  total: number;
  success: number;
  failed: number;
  items: { name: string; ok: boolean; reason?: string }[];
}
