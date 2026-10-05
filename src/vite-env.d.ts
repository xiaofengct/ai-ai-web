/// <reference types="vite/client" />

/**
 * 本项目自定义的环境变量（对应 .env.example）。
 * 只做接口合并扩展，不重复声明 `ImportMeta`（vite/client 已声明）。
 */
interface ImportMetaEnv {
  /** 默认模型商 BaseURL */
  readonly VITE_DEFAULT_BASEURL?: string;
  /** 默认模型名 */
  readonly VITE_DEFAULT_MODEL?: string;
  /** 应用显示版本号（用于「更新说明」弹窗的版本比对） */
  readonly VITE_APP_VERSION?: string;
  /** 是否注册 Service Worker（'false' 时不注册） */
  readonly VITE_ENABLE_SW?: string;
  /** 开发者模式默认开关 */
  readonly VITE_DEV_MODE?: string;
  /**
   * 是否内置「欣然」人设卡（双版本打包开关，见 `constants/buildMode.ts`）。
   * `'0'` = 不内置（standalone 版）；**其它值或不写 = 内置**。
   */
  readonly VITE_BUILTIN_XINRAN?: string;
}
