/**
 * ★ 构建期模式开关（双版本打包的唯一真源）。
 *
 * 背景：本应用要出**两个 APK**——
 *   ① **内置欣然版**：首次启动预置内置人设卡「欣然」（`isBuiltin=1`、`privacy.noImage=true`）
 *      与一个默认会话，开箱即聊（这是实现「原应用」的原始形态）。
 *   ② **不内置欣然版**：**不预置任何人设卡**，首次启动是空态，
 *      由用户自行「导入任务设定文件（人设 JSON）」或「导入微信聊天记录 → 蒸馏生成角色卡」。
 *
 * ★ 为什么用**构建期**变量而不是运行期开关：
 *   `import.meta.env.VITE_*` 在构建时被**静态替换**，因此两个版本的产物是**真正不同的两份**
 *   （常量折叠 + 死代码消除：实测 standalone 版里 `bootstrap()` 的欣然卡 / 默认会话分支
 *   连同其内部的文案字符串一起被整段删除），而不是"同一份代码里藏一个运行期 if"——
 *   后者很容易被用户在控制台改掉，也会让"这个包到底含不含欣然"变成不可从产物判定的事。
 *
 * ★ **怎么验证两个包确实不同**（**别用 `grep 欣然`**）：
 *   文案表 `xinran.ts` 在**两个包里都在**——本方案只跳过"种子"层，不动"文案"层
 *   （为的是用户导入人设后所有功能照常可用）。所以 `grep 欣然` 两版都能命中，
 *   **它区分不了版本**。正确判据是找**种子分支内部的独特字符串**：
 *
 *     grep -c "创建内置欣然卡失败" dist/assets/*.js   # 内置版 1 / standalone 0
 *     grep -c "创建默认会话失败"   dist/assets/*.js   # 内置版 1 / standalone 0
 *     grep -c "和欣然"             dist/assets/*.js   # 内置版 1 / standalone 0（默认会话标题）
 *
 *   （本条是**实测修正**：最初写的判据就是错的 `grep 欣然`，两版都命中 7~8 个文件，
 *     什么也说明不了。留在这里当"判据本身也要验"的反面样本。）
 *
 * ★ 默认值取「内置」：不写任何 env 时（`npm run dev` / `npm run verify`）
 *   保持与既有开发、验收流程完全一致的形态，避免"本地开发与线上产物不同"。
 *   （与 `VITE_ENABLE_SW` 同风格：`!== 'false'` 之类的"默认开"写法。）
 *
 * ★ 归类说明（`docs/07 §6.5`）：本文件是**开发者面向**（B 档），
 *   不含任何用户可见文案，故不需要 `@copy-tier` 标记、也不登记文案表。
 */

/** 环境变量名（构建期注入） */
export const BUILTIN_XINRAN_ENV_KEY = 'VITE_BUILTIN_XINRAN';

/**
 * 是否内置「欣然」人设卡。
 *
 * - `true`（默认）→ 内置欣然版
 * - `false` → 不内置欣然版（首启为空态，等用户导入）
 */
export const BUILTIN_XINRAN: boolean = (import.meta.env?.VITE_BUILTIN_XINRAN ?? '1') !== '0';

/**
 * 版本标识 —— 用于：
 *   ① 备份导出/导入的元信息（避免两个版本的数据被误判为同一份）；
 *   ② 关于页 / 开发者页展示，便于用户与支持人员确认"装的是哪一个包"；
 *   ③ 排查问题时一眼看出问题出在哪个产物。
 */
export const BUILD_FLAVOR: 'builtin-xinran' | 'standalone' = BUILTIN_XINRAN
  ? 'builtin-xinran'
  : 'standalone';

/** 面向开发者的可读标签（**不是用户文案**，不进文案表） */
export const BUILD_FLAVOR_LABEL: string = BUILTIN_XINRAN
  ? '内置欣然（builtin-xinran）'
  : '不内置欣然（standalone）';
