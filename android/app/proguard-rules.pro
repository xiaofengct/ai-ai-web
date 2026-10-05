# ═══════════════════════════════════════════════════════════════════════════
#  project-specific ProGuard / R8 规则
#  ---------------------------------------------------------------------------
#  ★★ 先读这四句（2026-10-04 加加固时写的）
#
#  ① **这里只放"必须保留的东西"。** 每多一条 `-keep`，加固就弱一分 ——
#     被 keep 的类不会改名、不会被删，反编译出来就是可读的。
#     所以下面每条 keep 都写清了"不 keep 会怎样"，请**先读理由再改**。
#
#  ② **规则漏了的后果是运行时崩溃，且只在真机上出现。**
#     R8 的失败不是编译错误，是运行时 `ClassNotFoundException` /
#     `NoSuchMethodError` —— 构建阶段完全看不出来。
#     本项目**没有可用的安卓模拟器**（见 `docs/17`），真机启动尚未验证。
#     ⇒ 所以本文件刻意**保守**：宁可少混淆一点，也不要打出一个装得上、
#       点不开的包。
#
#  ③ **改动本文件后必须跑一次 `npm run apk`**。
#     构建流程里有 `scripts/lib/apk-hardening.mjs` 的静态断言（dex 里
#     `MainActivity` / `onBackPressed` / `window.__aiAiBack` 都必须在）。
#     它拦不住所有问题，但能拦住"把入口类连根拔掉"这一类。
#
#  ④ **上游的规则不抄过来。** Capacitor 自带的 consumer 规则
#     （`node_modules/@capacitor/android/capacitor/proguard-rules.pro`）是权威来源，
#     本文件不复制它 —— 复制 = 第二份真相，改了这边忘了那边。
# ═══════════════════════════════════════════════════════════════════════════


# ───────────────────────────── 一、WebView ↔ JS 桥 ─────────────────────────────
#
# `@JavascriptInterface` 标注的方法由 **WebView 反射按名字调用** ——
# R8 看不到这条调用边，会把它当"没人用的方法"删掉或改名。
# 删掉之后 Bridge 在 JS 侧调任何原生能力都是 `undefined is not a function`，
# 而且**只在真机上出现**（桌面浏览器没有这层桥，跑起来一切正常）。
#
# ★ 这条 `proguard-android-optimize.txt` 里其实已经有了（AGP 默认规则含它）。
#   仍然显式写下来：默认规则是**外部文件**，AGP 升级时可能变；
#   而我们依赖它才能保证 Capacitor 桥可用 —— 这种"命根子"不该只存在于
#   别人的默认值里。
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}


# ───────────────────────────── 二、应用自己的入口 ─────────────────────────────
#
# `MainActivity` 只有一件事：覆写 `onBackPressed()` 把返回键交给 Web 层
# （背景见 `android/app/src/main/java/com/aiai/builtin/MainActivity.java`）。
#
# ★ 类名**本来就被默认规则保住**（`proguard-android-optimize.txt` 里有
#   `-keep public class * extends android.app.Activity`），
#   而且 AGP 会为 manifest 里按名字引用的类自动生成 keep 规则（`aapt_rules.txt`）。
#   ⇒ 下面这条是**兜底**，防的是"将来默认规则或 AGP 行为变了"。
#
# ★ 为什么连方法一起 keep（`{ *; }`）：`onBackPressed()` 是**框架回调**，
#   没有任何一行我们自己的代码调用它。一旦它被改名，返回键就**静默失效** ——
#   不崩溃、不报错，只是按返回键直接退出应用（正是这个类当初要修的 bug）。
-keep class com.aiai.builtin.MainActivity { *; }


# ───────────────────────── 三、注解与调试信息 ─────────────────────────
#
# ★ Capacitor 会反射读取**插件类上的注解**来构造插件表。
#   本项目没有引入任何第三方插件 ⇒ 目前无命中对象；
#   但保留注解属性的成本极低，而少了它、将来一引插件就是运行时崩。
-keepattributes *Annotation*

# ★ `SourceFile` / `LineNumberTable` **不留**。
#   保留它们等于把 dex 与原源码逐行对应起来，能显著降低阅读成本。
#   代价：线上崩溃日志拿不到行号 —— 而本应用**没有崩溃上报通道**，
#   本来也拿不到，所以这个代价是零。
-keepattributes !SourceFile,!LineNumberTable

# ★ 把源文件名抹成 `SourceFile`（万一还有别处带出源文件名，
#   至少不会泄露 `MainActivity.java` 这种真名）。
-renamesourcefileattribute SourceFile


# ───────────────────────────── 四、包结构抹平 ─────────────────────────────
#
# `-repackageclasses ''` 把所有**可改名**的类塞进根包，
# 彻底毁掉 `com/getcapacitor/plugin/...` 这种一眼就能读懂的结构。
#
# ★ 实测规模（v11 未加固的 dex）：字符串 `com/getcapacitor` 出现 **132 次**。
#   开加固后这一数字应当大幅下降（`apk-hardening.mjs` 会断言 ≤ 20）。
#
# ★ 会不会把 manifest 里按名字引用的类也挪走？**不会**：
#   被 `-keep` 的类不参与 repackage。AGP 为 manifest 引用生成的 keep 规则
#   会保住 `MainActivity` 与 `androidx.core.content.FileProvider` 的原始包名。
#   ⇒ 这一点由加固断言**反向核对**：`com/aiai/builtin/MainActivity` 必须仍在 dex 里。
-repackageclasses ''

# ★ 允许放宽访问修饰符 —— R8 借此能做更多内联与类合并，同时生成
#   `Foo$$ExternalSyntheticLambda` 这类更不可读的名字。
-allowaccessmodification

# ★ 关掉"找不到可选依赖"的警告。**只关 warn、不关 keep** ——
#   把 `-dontwarn` 当成"可以少写 keep"是很常见的误读。
-dontwarn org.apache.cordova.**
-dontwarn org.jetbrains.annotations.**
-dontwarn kotlin.**
-dontwarn kotlinx.**


# ───────────────────────────── 五、资源 ─────────────────────────────
#
# 资源**改名**（`res/layout/activity_main.xml` → `res/0K.xml`）由 AGP 的
# resource optimization 负责，release 默认已开 —— 实测 v11 的 res/ 路径
# **本来就是短名**，所以这不是新增收益，这里不动它。
#
# 这里只做资源**内容**混淆，且只针对确定安全的类型：
#   ★ 刻意**不**把 `assets/capacitor.config.json` 列进来 —— 原生侧按固定路径
#     读取它，内容含 appId / webDir，被改写会导致启动失败。
#   ★ `assets/public/**`（Vite 产物）也**不列** —— 那是 web 层，R8 管不着，
#     而且里面的文件名本身就是内容哈希，已经不可读。
-adaptresourcefilenames **.properties
-adaptresourcefilecontents **.properties
