import Dexie from 'dexie';
import { AiAiDB } from './db';
import { DB_NAME, TABLE } from '@/constants/storageKeys';

/**
 * ★★ 库名改名的一次性数据迁移（`aiyu-web` → `ai-ai-web`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么需要它
 * ═══════════════════════════════════════════════════════════════════════════
 * `DB_NAME` 从 `aiyu-web` 改成 `ai-ai-web` 之后，**IndexedDB 里的库名变了** ——
 * 而库里装的是**用户的全部数据**：聊天记录、记忆库、人设卡、表情包、日志。
 * 不迁移的话，老用户升级后打开应用会看到**一片空白**，
 * 且旧数据还在磁盘上、只是应用再也不去读它（比"删了"更难排查）。
 *
 * ⇒ 所以改名必须配一次**无损搬迁**：旧库存在 → 整库搬到新库 → 确认成功 → 才删旧库。
 *
 * ── 四条设计要点（顺序与判据都不能改）────────────────────────────────
 *
 * ① **幂等**：用 `bulkPut` 按主键 upsert ⇒ 即使"搬到一半崩了"，下次启动重搬
 *    会覆盖同名记录，**不产生副本、不丢记录**。不需要"迁移完成"标记位
 *    （标记位本身也会丢，反而多一个失败点）。
 *
 * ② **判定用「旧库是否存在」而不是「新库是否为空」**：
 *    只要旧库还在就重搬一轮，天然自愈中断。若按"新库为空才搬"判定，
 *    一次搬到一半崩溃就会留下"半新库 + 旧库"，而新库非空 ⇒ 永远不再搬 ⇒ 数据残缺。
 *
 * ③ **删旧库放在全部搬完之后**：中途失败时旧库**原封不动**。
 *    这是数据安全的最后一道闸 —— 宁可留着旧库占空间，也不能提前删。
 *
 * ④ **失败不抛异常**（`catch` 吞掉）：迁移失败要**降级为可用**，
 *    绝不能让"改名"变成"打不开"。最坏情况是新库为空（观感像数据没了），
 *    但旧库仍在，可人工抢救。
 *
 * ── 为什么不沿用 zustand 的 `migrate` 机制 ──────────────────────────────
 * `src/store/settingsStore.ts` 里有一段迁移事故的注释（约 L176 起），两个坑叠加：
 *   ① `migrate` **只在 version 不匹配时才被调用** —— "新增字段但忘了升版本"
 *      ⇒ 迁移静默失效；
 *   ② 传进去的是**整个持久化对象**而不是 settings 本身 ⇒ 合并时把用户数据
 *      当缺失值、**重置为默认**。
 * 本模块**不依赖 version 比对**（无条件按"旧库是否存在"决定是否搬），
 * 且**不做任何 JSON 合并**（只做整行 `bulkPut`，值原样搬）⇒ 两个坑都不存在。
 *
 * ── 一个已知且可接受的副作用 ────────────────────────────────────────
 * 用 `new AiAiDB(LEGACY_DB_NAME)` 打开旧库时，Dexie 会按**当前 schema**
 * 原地升级旧库（补建 `moments` / `feedback` 等空表）。不丢数据，
 * 只在旧库上多几张空表 —— 而旧库随后就会被删，所以无实际影响。
 */

/**
 * 改名前的库名。
 *
 * ★ 这个字面量**故意保留 `aiyu` 前缀** —— 它就是"旧名字"本身。
 *   全项目改名时它不应被替换（改了就等于不知道该去哪找旧数据）。
 */
const LEGACY_DB_NAME = 'aiyu-web';

/** 迁移是否已检查过（模块级只跑一次，避免热重载重复触发） */
let done = false;

/**
 * 把旧库的数据整体搬进新库。**幂等、可中断自愈、失败不抛。**
 *
 * 调用时机：`main.tsx` 里**在 `mount()` 之前** await 它 ——
 * 必须早于任何仓储查询，否则 Dexie 会先懒打开新库并建立连接，
 * 那时再想"确保新库还没被写过"就来不及了。
 */
export async function runLegacyDbRename(): Promise<void> {
  if (done) return;
  done = true;

  /*
   * 库名没变（或将来把旧名改回）⇒ 无需迁移。本行同时让本模块可安全重复引入。
   *
   * ★ 两侧都要 `as string` 放宽：`DB_NAME` 与 `LEGACY_DB_NAME` 都是**字面量类型**
   *   （`'ai-ai-web'` / `'aiyu-web'`），TS 会判定"这两个类型无交集"并把比较
   *   报成 `TS2367 看起来是无意的比较`。这里**故意保留**这个防御性判断 ——
   *   它是"万一有人把 `DB_NAME` 改回旧名"时的安全网，不该因为类型系统
   *   能静态看出当前为 false 就删掉。
   */
  if ((DB_NAME as string) === (LEGACY_DB_NAME as string)) return;

  try {
    // ★ 全新用户：根本没有旧库 ⇒ 直接返回，零副作用。
    const hasLegacy = await Dexie.exists(LEGACY_DB_NAME);
    if (!hasLegacy) return;

    const oldDb = new AiAiDB(LEGACY_DB_NAME); // 只读旧库
    const newDb = new AiAiDB(DB_NAME); // 新库按当前 schema 建表

    await newDb.open();

    // 逐表搬迁。表名取自 `TABLE`（单一真源），不手写列表 —— 将来加表不会漏搬。
    for (const table of Object.values(TABLE)) {
      const rows: unknown[] = await oldDb.table(table).toArray();
      if (rows.length > 0) {
        // bulkPut = 按主键 upsert ⇒ 重复执行安全
        await newDb.table(table).bulkPut(rows);
      }
    }

    oldDb.close();
    newDb.close();

    // ★ 只有全部表都搬成功，才删旧库（第 ③ 条闸门）
    await Dexie.delete(LEGACY_DB_NAME);
  } catch {
    /*
     * 第 ④ 条闸门：**故意吞掉异常**。
     *
     * 迁移失败的可能原因：隐私模式禁 IndexedDB、配额不足、旧库被别的标签页
     * 占用（`Dexie.delete` 会 `BlockedError`）、旧库结构异常。
     * 这些都不该让应用打不开 —— 新库照常可用（可能为空），
     * 而旧库因为没走到 `Dexie.delete` 而**原封保留**，可人工抢救。
     *
     * 不写 console.error 是有意的：应用里已有 `logStore` 走 IndexedDB，
     * 而此刻 IndexedDB 可能正处在异常状态；这里静默失败、把"能不能用"
     * 交给后续正常路径去体现。
     */
  }
}
