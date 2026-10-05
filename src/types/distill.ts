import type { ISODate, UUID } from './common';

export type RawSourceKind = 'wechat' | 'imessage' | 'sms' | 'photo' | 'social' | 'file' | 'paste';

/** 解析器归一化后的原材料片段 */
export interface RawChunk {
  id: string;
  kind: RawSourceKind;
  time?: ISODate;
  speaker?: string;
  text: string;
  /** likes/comments/platform/date/exif 等 */
  meta?: Record<string, unknown>;
}

export interface DistillSource {
  id: UUID;
  kind: RawSourceKind;
  fileName?: string;
  chunkCount: number;
  /** 原材料原文归档 → blobs（逻辑路径 distill/{slug}/knowledge/...） */
  rawAssetId?: UUID;
}

export type DistillStatus =
  | 'intake'
  | 'importing'
  | 'analyzing'
  | 'preview'
  | 'writing'
  | 'done'
  | 'failed';

export interface DistillJob {
  id: UUID;
  /** exes/{slug} */
  slug: string;
  name: string;
  profile: {
    duration?: string;
    howMet?: string;
    timeSinceBreakup?: string;
    occupation?: string;
    mbti?: string;
    gender?: string;
  };
  tags: { personality: string[]; attachment?: string };
  impression?: string;
  status: DistillStatus;
  sources: DistillSource[];
  createdAt: ISODate;
  updatedAt: ISODate;
  /** v1 / v2 ... */
  version: string;
  correctionsCount: number;
  errorInfo?: { code: string; message: string };
}

export interface ArtifactVersion {
  /** v1 / v2 / v3_before_rollback */
  version: string;
  createdAt: ISODate;
  snapshot: { memoriesMd: string; personaMd: string };
  note?: string;
}

export interface ExSkillArtifact {
  jobId: UUID;
  slug: string;
  memoriesMd: string;
  /** 5 层结构 */
  personaMd: string;
  metaJson: string;
  skillMd: string;
  /** 上限 10（constants/limits.MAX_VERSIONS） */
  versions: ArtifactVersion[];
  /** 转为可聊天角色后的关联 */
  personaCardId?: UUID;
  updatedAt: ISODate;
}

/** 蒸馏提示词模板 ID（对应 src/distill/prompts/*） */
export type DistillTemplateId =
  | 'intake'
  | 'memories_analyzer'
  | 'persona_analyzer'
  | 'memories_builder'
  | 'persona_builder'
  | 'merger'
  | 'correction_handler';
