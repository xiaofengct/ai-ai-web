import { DEFAULT_PERSONA_PRIVACY } from '@/constants/defaults';
import { downloadJSON, downloadText } from '@/lib/download';
import { nowISO } from '@/lib/time';
import { layersOfCard } from './xinranLayers';
import { XINRAN_TAGS } from './xinranCard';
import type { PersonaCard, PersonaCardData } from '@/types/persona';

/**
 * 人设导出（架构文档 §2 `src/persona/exporter.ts`）。
 *
 * 两种目标格式：
 * 1. **原应用格式**（`chara_card_v2`，变体 B）——导出的文件能**直接拖回原应用 App**；
 * 2. **Web 备份格式**——额外带上 `extensions.aiyu`（5 层原文、隐私设置、音色/立绘引用），
 *    导回本应用时不丢信息。
 *
 * 另提供 `toPersonaMarkdown()`：把卡片转成 5 层 markdown，
 * 与蒸馏产物的 `persona.md` 同构，方便「导出 → 手改 → 再导入」。
 */

/** 原应用变体 B 的导出壳（见 docs/00-逆向取证.md §5.1） */
export interface AiAiExportBundle {
  version: string;
  timestamp: number;
  exportDate: string;
  data: {
    prompts: Record<string, { spec: string; spec_version: string; data: PersonaCardData }>;
  };
}

/** 单卡 → 原应用变体 B JSON 对象 */
export function toAiAiBundle(card: PersonaCard): AiAiExportBundle {
  const now = nowISO();
  return {
    version: '1.0.0',
    timestamp: Date.now(),
    exportDate: now,
    data: {
      prompts: {
        "shuoshuo's prompt": {
          spec: card.spec,
          spec_version: card.specVersion,
          data: card.data,
        },
      },
    },
  };
}

/** 多卡 → 原应用变体 B JSON 对象（key 用卡 ID，避免重名互相覆盖） */
export function toAiAiBundleMany(cards: readonly PersonaCard[]): AiAiExportBundle {
  const prompts: AiAiExportBundle['data']['prompts'] = {};
  for (const card of cards) {
    prompts[card.id] = {
      spec: card.spec,
      spec_version: card.specVersion,
      data: card.data,
    };
  }
  return {
    version: '1.0.0',
    timestamp: Date.now(),
    exportDate: nowISO(),
    data: { prompts },
  };
}

/** Web 备份格式：在原应用格式基础上补 `extensions.aiyu` */
export function toWebBackup(card: PersonaCard): PersonaCard {
  const layers = card.origin === 'xinran' ? [...layersOfCard(card)] : [];
  return {
    ...card,
    data: {
      ...card.data,
      extensions: {
        ...(card.data.extensions ?? {}),
        aiyuLayers: layers,
        aiyu: {
          origin: card.origin,
          // ★ 缺 privacy 时取单一真源（保守默认 true），与新建 / 导入 / 迁移保持一致。
          //   导出后再导入才不会因为「一路都是 undefined」而悄悄放开生图。
          privacy: card.privacy ?? { ...DEFAULT_PERSONA_PRIVACY },
          modelId: card.modelId,
          timbreId: card.timbreId,
          portrait: card.portrait,
          distillJobId: card.distillJobId,
          exportedAt: nowISO(),
        },
      },
    },
  };
}

/** 序列化（原应用格式） */
export function exportPersonaJson(card: PersonaCard, pretty = true): string {
  return JSON.stringify(toAiAiBundle(card), null, pretty ? 2 : 0);
}

/** 序列化（Web 备份格式） */
export function exportWebBackupJson(card: PersonaCard, pretty = true): string {
  return JSON.stringify(toWebBackup(card), null, pretty ? 2 : 0);
}

/** 直接下载（原应用格式） */
export function downloadPersona(card: PersonaCard): void {
  downloadJSON(toAiAiBundle(card), `persona_${safeFileName(card.data.name)}_${Date.now()}.json`);
}

/** 直接下载（Web 备份格式） */
export function downloadWebBackup(card: PersonaCard): void {
  downloadJSON(toWebBackup(card), `persona_web_${safeFileName(card.data.name)}_${Date.now()}.json`);
}

/** 批量下载 */
export function downloadPersonas(cards: readonly PersonaCard[]): void {
  if (cards.length === 1 && cards[0]) {
    downloadPersona(cards[0]);
    return;
  }
  downloadJSON(toAiAiBundleMany(cards), `personas_${Date.now()}.json`);
}

/**
 * 卡片 → 5 层 markdown（与蒸馏产物 persona.md 同构）。
 * 欣然：直接用 5 层原文；外部角色：尝试按 `## Layer n` 切分 `extensions.aiyu.personaMd`，
 * 切不出来就整体放进 Layer1，并保留原始文本（不丢内容）。
 */
export function toPersonaMarkdown(card: PersonaCard): string {
  const title = `# ${card.data.name || '未命名角色'}`;
  if (card.origin === 'xinran') {
    const layers = layersOfCard(card);
    const body = layers
      .map((layer, index) => `## Layer ${index}\n\n${layer}`)
      .join('\n\n');
    return `${title}\n\n${body}\n`;
  }

  const ext = card.data.extensions as { aiyu?: { personaMd?: unknown } } | undefined;
  const md = typeof ext?.aiyu?.personaMd === 'string' ? ext.aiyu.personaMd.trim() : '';
  if (md) {
    return md.startsWith('#') ? md : `${title}\n\n${md}\n`;
  }

  // 没有 persona.md：用卡片字段拼一份「够用的」5 层，避免导出空文件
  const sections = [
    '## Layer 0\n\n' + (card.data.system_prompt?.trim() || card.data.creator_notes?.trim() || '（未设定核心约束）'),
    '## Layer 1\n\n' + (card.data.personality?.trim() || '（未设定性格）'),
    '## Layer 2\n\n' + (card.data.mes_example?.trim() || '（未设定表达风格）'),
    '## Layer 3\n\n' + (card.data.scenario?.trim() || '（未设定情感逻辑）'),
    '## Layer 4\n\n' + ((card.data.tags ?? []).join('、') || '（未设定偏好）'),
  ];
  return `${title}\n\n${sections.join('\n\n')}\n`;
}

/** 导出 5 层 markdown 文件 */
export function downloadPersonaMarkdown(card: PersonaCard): void {
  downloadText(toPersonaMarkdown(card), `persona_${safeFileName(card.data.name)}.md`, 'text/markdown;charset=utf-8');
}

/** 文件名安全化（去掉 Windows/Unix 都不友好的字符） */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 40) : 'persona';
}

/** 导出时是否带标签（供 UI 预览展示） */
export function defaultTags(): readonly string[] {
  return XINRAN_TAGS;
}
