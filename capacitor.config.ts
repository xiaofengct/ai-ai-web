import type { CapacitorConfig } from '@capacitor/cli';

/**
 * ★ 双版本（内置欣然 / 不内置欣然）—— 上层开关见 `src/constants/buildMode.ts`。
 *
 * 这里读的是**同一个环境变量** `VITE_BUILTIN_XINRAN`，好处是：
 *   一次 `VITE_BUILTIN_XINRAN=0 npm run build && npx cap sync android`
 *   ⇒ **web 产物**（`dist/`）与 **原生标识**（本文件生成的 `capacitor.config.json`）
 *   双双切到 standalone，不可能出现"原生是 standalone 名、web 却内置了欣然"的半吊子组合。
 *
 * ★ 与 `android/app/build.gradle` 的 `productFlavors` 分工：
 *   - 本文件 → Capacitor **运行时**读的 `appId` / `appName`（打进 assets 的 json）
 *   - gradle flavor → 安装标识 `applicationId` 与桌面显示名 `app_name`
 *   两者必须**成对**，所以两处都按同一个变量取值，而不是各写一份字面量。
 */
const isStandalone = process.env.VITE_BUILTIN_XINRAN === '0';

const config: CapacitorConfig = {
  appId: isStandalone ? 'com.aiai.standalone' : 'com.aiai.builtin',
  // ★ 应用名 = 「ai爱」，**两个版本同名**（用户 2026-10-04 明确要求）。
  //   原先内置版带「·欣然」后缀以便区分；用户后来要求统一成「ai爱」⇒ 去掉后缀。
  //   两版仍可同时安装（靠 `appId` / `applicationId` 区分），
  //   但桌面会显示两个同名同图标的入口。
  appName: 'ai爱',
  webDir: 'dist',
  android: {
    // 允许混合内容：否（本地 HTTPS 方案下不需要，显式写出便于排查）
    allowMixedContent: false,
  },
};

export default config;
