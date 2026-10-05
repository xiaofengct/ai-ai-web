import { db } from './db';
import { personaRepo } from './repo/personaRepo';
import { sessionRepo } from './repo/sessionRepo';
import { stickerRepo } from './repo/stickerRepo';
import { messageRepo } from './repo/messageRepo';
import { blobRepo } from './repo/blobRepo';
import { logRepo } from './repo/logRepo';
import { openDB } from './migrations';
import { XINRAN_GREETINGS } from '@/copy/xinran';
import { createXinranCard } from '@/persona/xinranCard';
import {
  DEFAULT_SESSION_ID,
  PLACEHOLDER_STICKER_PACK_ID,
  SETTINGS_VERSION,
  XINRAN_PERSONA_ID,
  buildDefaultAppSettings,
} from '@/constants/defaults';
import { BUILTIN_PROVIDER_IDS, presetToConfig } from '@/constants/providers';
import { BUILTIN_XINRAN } from '@/constants/buildMode';
import { SK } from '@/constants/storageKeys';
import { nowISO } from '@/lib/time';
import { AppError } from '@/lib/errors';
import type { PersonaCard } from '@/types/persona';
import type { StickerItem } from '@/types/media';
import type { AppSettings } from '@/types/settings';
import type { UUID } from '@/types/common';

/**
 * ★ 首次启动种子（架构文档 §5 T03 验收要点②③）：
 *  ① 内置欣然卡（`isBuiltin`、`privacy.noImage=true`、多条欢迎语）—— **仅内置版**
 *  ② 默认 Provider（DeepSeek / 硅基流动 / 自定义 三个预设）—— 两版都有
 *  ③ 占位表情包 —— 两版都有
 *  ④ 一个默认会话 —— **仅内置版**（不内置版没有角色，建会话没有意义）
 *
 * ★ 幂等：所有种子都按**固定 ID** 判断是否存在，重复启动不重复创建。
 *
 * ★ 双版本（`BUILTIN_XINRAN`，见 `constants/buildMode.ts`）：
 *   不内置版**跳过 ①④**，首启即为「无角色、无会话」空态，
 *   由用户导入人设文件 / 蒸馏聊天记录来产生第一个角色。
 *   注意：本文件里**不是**"把欣然的种子代码删掉"，而是**条件跳过**——
 *   代码路径与文案表保持完整，用户导入一张人设卡后所有功能照常可用
 *   （尤其 XR-06 红线由 `imageGen.assertImageAllowed` 独立把关，
 *   它是 fail-closed 的：`noImage || origin==='xinran' || isBuiltin || id===XINRAN_PERSONA_ID`，
 *   **不依赖"欣然卡一定存在"**）。
 */

const SEED_FLAG_KEY = 'ai-ai.seeded.v1';

/**
 * 内置占位表情包条目 —— 与 `public/stickers/placeholder/custom_stickers.json` 同步。
 *
 * ★★ 2026-10-04 修正：**图片现在真的存在了**（`scripts/gen-sticker-assets.mjs` 生成）。
 *
 * ── 改之前是什么状态（这是「AI 发不出表情包」的首要原因）────────────────
 *   仓库里**只有 `custom_stickers.json`，一个 PNG 都没有**，
 *   于是这 12 条全是 `{description, fileName}`、**没有 `assetId`**：
 *     · `stickerRepo.matchByDescription()` 能匹配到（按 description 查）
 *     · 但 `pickStickerForText()` 看到 `item.assetId` 为空 ⇒ 返回 `undefined` ⇒ 不配图
 *   ⇒ 表现为"表情匹配逻辑写着，实际一张都发不出来"。
 *
 * ── 为什么修复要包含"种子时把图写进 blobs"这一步 ────────────────────────
 *   把 PNG 放进 `public/` 只是让**文件存在**，`<img src="/stickers/...">` 也能显示；
 *   但角色发图走的是 `MessageAttachment.assetId → blobs 表` 这条路 ——
 *   **必须有 assetId**。所以种子时要把这 12 张图读进来、写进 `blobRepo`、
 *   再把 assetId 回填到条目上（见下方 `seedPlaceholderStickerAssets()`）。
 *
 * ★ 标签（description）与情绪线索的对应关系（`proactive/stickerPicker.ts` 的 `EMOTION_HINTS`）
 *   是刻意对齐过的：`累/困/烦/生无可恋`→「生无可恋」「垂头丧气」、
 *   `开心/哈哈/笑死`→「开心」、`想哭/呜呜/委屈`→「嘤嘤嘤」、
 *   `晚安/困`→「晚安」、`想你/抱抱/贴贴`→「抱着」「贴」。
 *   两边任何一侧改了词，另一次要跟着看一眼 —— 否则会出现"她明明该贴图却永远贴不上"。
 */
const PLACEHOLDER_STICKERS: readonly StickerItem[] = [
  { description: '喵', fileName: 'sticker_01.png' },
  { description: '惊', fileName: 'sticker_02.png' },
  { description: '咬你', fileName: 'sticker_03.png' },
  { description: '嘤嘤嘤', fileName: 'sticker_04.png' },
  { description: '抱着', fileName: 'sticker_05.png' },
  { description: '贴', fileName: 'sticker_06.png' },
  { description: '噗', fileName: 'sticker_07.png' },
  { description: '生无可恋', fileName: 'sticker_08.png' },
  { description: '躲在被子后', fileName: 'sticker_09.png' },
  { description: '晚安', fileName: 'sticker_10.png' },
  { description: '垂头丧气', fileName: 'sticker_11.png' },
  { description: '开心', fileName: 'sticker_12.png' },
];

/** 内置表情图在 web 产物里的相对路径前缀 */
const PLACEHOLDER_STICKER_DIR = 'stickers/placeholder';

/**
 * ★★ 把内置表情图读进 `blobs` 表，并回填 `assetId`（2026-10-04 加）。
 *
 * ── 为什么需要这一步 ────────────────────────────────────────────────────
 *   角色发图的链路是 `assetId → blobs 表 → objectURL → <img>`。
 *   图放在 `public/` 只是**静态资源**，没有 `assetId`，
 *   所以"能显示"和"能被她发出来"是两件事（见 `PLACEHOLDER_STICKERS` 的注释）。
 *
 * ── 为什么失败要静默降级（不抛错）──────────────────────────────────────
 *   表情包是**增强项**：拿不到图，应用照常能用（面板会退化成文字标签）。
 *   为一个可选资源中断整个启动，是把可降级问题升级成不可用问题 ——
 *   与 `bootstrap()` 里世界设定回填的取舍一致。
 *
 * ── 为什么可以重复调用（幂等）─────────────────────────────────────────
 *   `blobRepo.put()` 按 `path` 去重（同一路径覆盖写，返回同一个 id），
 *   所以重复启动不会产生 12 份副本。但**只在首次种子时调**更省事
 *   （见 `bootstrap()` 里对 `existingPack` 的判断）。
 */
async function seedPlaceholderStickerAssets(packId: UUID, items: readonly StickerItem[]): Promise<number> {
  let attached = 0;
  for (const item of items) {
    const url = `${PLACEHOLDER_STICKER_DIR}/${item.fileName}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue; // 资源不存在（老产物）⇒ 跳过，保持"仅文字表情"
      const blob = await res.blob();
      if (blob.size === 0) continue;
      const put = await blobRepo.put(`${PLACEHOLDER_STICKER_DIR}/${item.fileName}`, blob, 'image/png');
      if (!put.ok) continue;
      const ok = await stickerRepo.attachAsset(packId, item.fileName, put.value);
      if (ok.ok) attached += 1;
    } catch {
      // 单张失败不影响其余；整体失败也不影响启动（理由见上）
      continue;
    }
  }
  return attached;
}

/**
 * 内置欣然卡。
 *
 * ★ 单一真源：卡片内容**只写在 `src/persona/xinranCard.ts`**，
 *   这里只做转发——否则「种子数据」和「人格层」会各写一份，改一处漏一处。
 */
export function buildXinranCard(): PersonaCard {
  return createXinranCard();
}

/** 是否已播种（localStorage 标记 + 数据库实际内容双保险） */
function seedFlagDone(): boolean {
  try {
    return localStorage.getItem(SEED_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeeded(): void {
  try {
    localStorage.setItem(SEED_FLAG_KEY, '1');
  } catch {
    /* 隐私模式下不可写，忽略 */
  }
}

/** 首次写入默认设置到 localStorage（settingsStore 会接管后续读写） */
function seedSettings(): AppSettings {
  let settings = buildDefaultAppSettings();
  try {
    const raw = localStorage.getItem(SK.settings);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      settings = { ...settings, ...parsed, version: SETTINGS_VERSION };
    } else {
      localStorage.setItem(SK.settings, JSON.stringify(settings));
    }
  } catch {
    /* 读取失败则用默认设置，不阻塞启动 */
  }
  return settings;
}

export interface BootstrapReport {
  seeded: boolean;
  personaCreated: boolean;
  providerSeeded: boolean;
  stickerPackCreated: boolean;
  /**
   * 本次启动给内置表情包补了几张图（2026-10-04 加）。
   * ★ 只在"老用户的包还没有图"时 > 0，不是每次都写。
   */
  stickerAssetsAttached: number;
  sessionCreated: boolean;
  /**
   * 本次启动是否**回填**了内置世界设定（定义见下方 §② 的「世界设定回填」）。
   * ★ 只在「老用户的卡里还没有世界」时为 true，不是每次启动都为 true。
   */
  worldAttached: boolean;
  personaId: string;
  sessionId: string;
}

/**
 * 执行首次启动种子。
 * 幂等：重复调用只返回报告，不重复写入。
 */
export async function bootstrap(): Promise<BootstrapReport> {
  await openDB();

  const report: BootstrapReport = {
    seeded: false,
    personaCreated: false,
    providerSeeded: false,
    stickerPackCreated: false,
    stickerAssetsAttached: 0,
    sessionCreated: false,
    worldAttached: false,
    personaId: XINRAN_PERSONA_ID,
    sessionId: DEFAULT_SESSION_ID,
  };

  // ① 默认设置（localStorage）
  seedSettings();

  // ② 内置欣然卡 —— **仅内置版**（不内置版首启无角色，等用户导入）
  if (BUILTIN_XINRAN) {
    const existingPersona = await db.personas.get(XINRAN_PERSONA_ID);
    if (!existingPersona) {
      const res = await personaRepo.upsert(buildXinranCard());
      if (!res.ok) throw new AppError('DB_FAILED', '创建内置欣然卡失败', res.error);
      report.personaCreated = true;
    } else {
      if (existingPersona.isBuiltin !== 1) {
        // 历史数据被改坏了：补回内置标记与隐私红线
        // ★ 这里**故意**写字面量 `{ noImage: true }`，不取 DEFAULT_PERSONA_PRIVACY：
        //   语义是「强制修正已存在的坏数据」，不是「取新建默认值」。
        //   换成常量会把「改默认值」和「改这条修正」绑在一起——哪天默认值放开，欣然的红线就跟着破了。
        await db.personas.update(XINRAN_PERSONA_ID, { isBuiltin: 1, privacy: { noImage: true } });
      }

      /* ══════════════════════════════════════════════════════════════════════
       * ★★ 世界设定回填（2026-10-04 修，用户报告「内置版装完世界设定没有加载」）
       * ══════════════════════════════════════════════════════════════════════
       *
       * ── 现象 ──
       * 内置版 APK 里**确实带着**世界数据（可从产物搜到排班锚点与 12 条世界书条目），
       * 但装到**已经装过旧版本**的手机上，设置页「世界设定」显示空、
       * 排班/静默时段一概不生效。
       *
       * ── 根因 ──
       * 本函数是**幂等播种**：靠「固定 ID 有没有那张卡」判断要不要建卡。
       * 而世界包是 v8 才加进内置卡里的（`createXinranCard` 才带上 `XINRAN_WORLD`）。
       * 老用户的库里**早就有** `XINRAN_PERSONA_ID` 这张卡了 ⇒
       * 走的是 else 分支 ⇒ **永远不会重新创建卡** ⇒ 世界**永远不会被写进去**。
       *
       * ★ 这类 bug 的普遍形状：**「一次性播种」+「后来给种子加了新内容」= 老用户永远拿不到**。
       *   干净的装机测不出来（没有旧卡，走的是建卡分支），
       *   只有「先装旧版再覆盖升级」才会暴露 —— 而升级恰恰是真实用户的主路径。
       *   同理的坑已在本项目出现过一次（`SETTINGS_VERSION` 没递增 ⇒ 老设置不迁移）。
       *
       * ── 修法 ──
       * 卡存在时，检查它**有没有可用的世界**：
       *   - 没有 → 补上内置世界；
       *   - 有   → 什么都不做。
       *
       * ★ 第二条是关键：用户可能已经**自己导入过世界**（设置页的导入窗口）。
       *   那种情况必须尊重用户的选择，不能拿内置世界把它盖掉 ——
       *   否则「导入的世界每次重启都变回内置的」，是个更糟的 bug。
       *   判据用 `hasWorld()`（读卡里 `extensions.aiyu.world` 并校验可用性），
       *   而不是「有没有这个字段」—— 一个空的/坏掉的包不该阻止回填。
       *
       * ★ 用 `await import()` 而不是顶层 import：
       *   `world/builtinWorlds.ts` 装的是**只该给内置版**的世界数据。
       *   顶层 import 会让它被静态拉进 `standalone` 产物（这正是
       *   `docs/17 §6` 记录的那个「世界数据串味」缺陷的一部分）。
       *   放在 `BUILTIN_XINRAN` 分支内 ⇒ 不内置版里这段不可达，
       *   动态 import 才有机会被摇掉。
       */
      const { applyWorldToCard, hasWorld } = await import('@/world/cardWorld');
      // ★ 用 `personaRepo.getXinran()` 而不是 `db.personas.get()`：
      //   后者返回的是**数据库行**（`DBPersonaRow`，`data` 是 `Record<string, unknown>`），
      //   而 `applyWorldToCard` 要的是**领域对象** `PersonaCard`。
      //   走仓储的 `toDomain` 转换，不在这里手写一遍映射（那会是第二份真相）。
      const currentRes = await personaRepo.getXinran();
      const current = currentRes.ok ? currentRes.value : undefined;
      if (current && !hasWorld(current)) {
        const { XINRAN_WORLD } = await import('@/world/builtinWorlds');
        const res = await personaRepo.upsert(applyWorldToCard(current, XINRAN_WORLD));
        if (!res.ok) {
          // ★ 回填失败**不抛**：世界设定是增强项，缺了它应用照常能用
          //   （主动消息按「无世界约束」放行，与改动前行为一致）。
          //   为它中断整个启动，是把一个可降级问题升级成不可用问题。
          await logRepo.push({
            level: 'warn',
            scope: 'app',
            featureId: 'XR-08',
            message: '内置世界设定回填失败（可在设置 → 世界设定手动导入）',
            detail: { error: String(res.error) },
          });
        } else {
          report.worldAttached = true;
        }
      }
    }
  }

  // ③ 默认 Provider（三个预设，apiKey 留空由用户填写）
  const providerCount = await db.settings.get('providers');
  if (!providerCount) {
    await db.settings.put({
      key: 'providers',
      value: {
        activeProviderId: BUILTIN_PROVIDER_IDS.deepseek,
        presets: [
          presetToConfig('deepseek'),
          presetToConfig('siliconflow'),
          presetToConfig('custom'),
        ],
      },
      updatedAt: nowISO(),
    });
    report.providerSeeded = true;
  }

  // ④ 占位表情包
  const existingPack = await db.stickers.get(PLACEHOLDER_STICKER_PACK_ID);
  if (!existingPack) {
    const res = await stickerRepo.createPack('占位表情包', PLACEHOLDER_STICKERS, {
      id: PLACEHOLDER_STICKER_PACK_ID,
      builtin: true,
    });
    if (!res.ok) throw new AppError('DB_FAILED', '创建占位表情包失败', res.error);
    report.stickerPackCreated = true;
    // ★ 顺手把 12 张内置图读进 blobs 并回填 assetId
    //   （没有这一步，她匹配到标签也拿不到图可发，见函数注释）
    await seedPlaceholderStickerAssets(PLACEHOLDER_STICKER_PACK_ID, PLACEHOLDER_STICKERS);
  } else {
    /**
     * ★★ 老用户补图（2026-10-04，与"世界设定回填"同一个形状的坑）。
     *
     * 幂等播种只判断"包在不在"。而这 12 张图是**安装后才加进来的**——
     * 老用户的库里**早就有** `PLACEHOLDER_STICKER_PACK_ID` 这个包了，
     * 于是走不到上面的建包分支 ⇒ 图永远不回填 ⇒
     * 对老用户而言"AI 发不出表情包"这个问题**修了等于没修**。
     *
     * ★ 判据用「有没有任一条目带着 assetId」，而不是"包存在与否"：
     *   包存在是必然的（老用户都有），要看的是**图到位了没有**。
     *   这样已回填过的用户不会每次都重复写 12 次 blob。
     */
    const needAssets = (existingPack.items ?? []).every((it) => !it.assetId);
    if (needAssets && (existingPack.items ?? []).length > 0) {
      const n = await seedPlaceholderStickerAssets(PLACEHOLDER_STICKER_PACK_ID, PLACEHOLDER_STICKERS);
      if (n > 0) report.stickerAssetsAttached = n;
    }
  }

  // ⑤ 默认会话（含一条欣然的欢迎语，避免首屏空空如也）—— **仅内置版**
  //    ★ 不内置版跳过：没有角色时建会话没有意义，首页应停在「无角色」空态，
  //      由用户先导入人设 / 蒸馏出角色，再新建会话。
  if (BUILTIN_XINRAN) {
    const existingSession = await db.sessions.get(DEFAULT_SESSION_ID);
    if (!existingSession) {
      const session = await sessionRepo.create({
        id: DEFAULT_SESSION_ID,
        title: '和欣然',
        personaId: XINRAN_PERSONA_ID,
        proactive: { enabled: false, inheritFromPrev: true },
      });
      if (!session.ok) throw new AppError('DB_FAILED', '创建默认会话失败', session.error);

      const greeting = XINRAN_GREETINGS[Math.floor(Math.random() * XINRAN_GREETINGS.length)];
      const msg = await messageRepo.append({
        sessionId: DEFAULT_SESSION_ID,
        role: 'assistant',
        content: greeting,
        status: 'done',
      });
      if (!msg.ok) throw new AppError('DB_FAILED', '写入欢迎语失败', msg.error);

      await sessionRepo.updateStats(DEFAULT_SESSION_ID, {
        messageCount: 1,
        charCount: Array.from(greeting).length,
        tokenEstimate: msg.value.tokenEstimate ?? 0,
      });
      await sessionRepo.refreshPreview(DEFAULT_SESSION_ID, msg.value);
      report.sessionCreated = true;
    }
  }

  // ⑥ 孤立的 blobs 不做清理（避免误删用户资产）；只记录一次启动日志
  if (!seedFlagDone()) {
    await logRepo.push({
      level: 'info',
      scope: 'app',
      featureId: 'XR-07',
      message: '首次启动种子完成',
      detail: report,
    });
  }

  markSeeded();
  report.seeded = true;
  return report;
}

/** 强制重建种子（开发者页「重置内置数据」用；**不删除用户会话**） */
export async function reseedBuiltins(): Promise<BootstrapReport> {
  try {
    localStorage.removeItem(SEED_FLAG_KEY);
  } catch {
    /* 忽略 */
  }
  // ★ 同上：重置流程里强制把欣然的红线改回 true，是「修正」而非「取默认值」，故保留字面量。
  //   ★ 不内置版跳过这一步——那张卡本来就不存在，`update` 一个不存在的 ID 是无意义写入
  //     （Dexie 的 `update` 对不存在的键为 no-op，不会报错，但语义上不该发生）。
  if (BUILTIN_XINRAN) {
    await db.personas.update(XINRAN_PERSONA_ID, { isBuiltin: 1, privacy: { noImage: true } });
  }
  return bootstrap();
}

/** 清理占位表情包（用户导入完整 zip 后可调用） */
export async function removePlaceholderStickers(): Promise<void> {
  await db.stickers.delete(PLACEHOLDER_STICKER_PACK_ID);
  await blobRepo.removeByPrefix('stickers/placeholder/');
}

export default bootstrap;
