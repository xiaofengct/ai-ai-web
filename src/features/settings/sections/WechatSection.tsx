import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { SettingsField } from '../SettingsField';
import { renderQrDataUrl } from '@/ilink/qrcode';
import { useIlinkStore, selectIlinkStatusKey, selectIlinkStatusVars } from '@/store/ilinkStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSnack } from '@/hooks/useSnack';
import { THEME_TOKENS } from '@/theme/themeTokens';
import { t } from '@/copy';

/**
 * 微信 ClawBot 分组（iLink Bot 平台）。
 *
 * ★ 这是什么：把角色接进**微信官方**通道 —— 走 `ilinkai.weixin.qq.com`
 *   （微信团队 2026-03-22 上线的 ClawBot 官方插件所对应的 iLink Bot 平台）。
 *   扫码绑定后，她能在微信里收发消息。**不是 hook 微信**，不碰客户端。
 *   协议规格见 `src/ilink/protocol.ts` 头部注释。
 *
 * ★★ 诚实边界（**这一节的每一句都不能美化**，否则用户会以为它什么时候都能用）：
 *
 *   1. **只在手机原生 App 里可用**。浏览器里必须带 4 个自定义请求头，
 *      必然触发 CORS 预检，大概率被拒 ⇒ 本分组在非原生环境**直接置灰并说明原因**，
 *      不做"能点但点了失败"的假可用。
 *   2. **只在前台收得到消息**。长轮询在页面隐藏时停止打服务端；
 *      息屏 / 被系统杀掉都收不到 —— 这是系统限制，要常驻得另写 Android 前台服务。
 *   3. **只走文字**。图片/语音需要原生二进制 HTTP 插件 + silk 编解码，
 *      本仓库未实现 ⇒ `voiceReply` 开关**没有行为分支**（已向实现方确认），
 *      故**置灰**而不是留一个"看起来能开、开了没用"的假开关。
 *   4. **凭据是明文**。`botToken` 与 Provider 的 `apiKey` 同级，
 *      明文存在本机 localStorage，**没有加密**。
 *   5. **解绑只清本机**。服务端那边的绑定关系不会因此解除。
 *
 * ★ 为什么这些用 `Typography` caption 而不用 `Chip`：
 *   `Chip` 不换行且有胶囊底纹，塞整句话会渲染成溢出屏幕的巨型胶囊
 *   （`ModelSection` 就踩过这个坑）。说明性文字一律用可换行的 caption。
 */

/** 是否原生平台（Capacitor Android/iOS）。非原生时本分组整体不可用 */
function isNativePlatform(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
  } catch {
    return false;
  }
}

export function WechatSection(): JSX.Element {
  const ilink = useSettingsStore((s) => s.settings.ilink);
  const patch = useSettingsStore((s) => s.patch);
  const snack = useSnack();

  const login = useIlinkStore((s) => s.login);
  const connection = useIlinkStore((s) => s.connection);
  const receiving = useIlinkStore((s) => s.receiving);
  const logs = useIlinkStore((s) => s.logs);
  const startLogin = useIlinkStore((s) => s.startLogin);
  const submitVerifyCode = useIlinkStore((s) => s.submitVerifyCode);
  const sendTestMessage = useIlinkStore((s) => s.sendTestMessage);
  const unbind = useIlinkStore((s) => s.unbind);

  const [verifyCode, setVerifyCode] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  /**
   * 本机生成的二维码（dataURL）。
   *
   * ★ 必须自己生成：服务端给的 `qrContent` 是**要被编码的内容**（一个 H5 页面链接），
   *   不是图片地址 —— 当 `<img src>` 用会破图（实测确认，详见 login.ts 的 `qrContent` 注释）。
   */
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  /** 内容变化 → 重新编码。失败就清空（UI 会如实告知，而不是留一张破图）。 */
  useEffect(() => {
    const content = login.qrContent;
    if (!content) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    // 生成逻辑抽在 `@/ilink/qrcode`（可被 Node 侧脚本直接断言，见该模块注释）
    void renderQrDataUrl(content)
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        // 画不出来就清空 —— UI 会走「如实告知」那条分支，不留破图
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [login.qrContent]);

  // 环境只需判定一次；同时监听首帧后 Capacitor 是否注入（WebView 里注入晚于首帧）
  const [native, setNative] = useState<boolean>(() => isNativePlatform());
  useEffect(() => {
    if (native) return;
    const timer = window.setInterval(() => {
      if (isNativePlatform()) {
        setNative(true);
        window.clearInterval(timer);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [native]);

  const bound = ilink.botToken !== '';
  const statusKey = selectIlinkStatusKey({ login, receiving });
  const statusVars = selectIlinkStatusVars({ login });

  const handleBind = useCallback((): void => {
    if (!native) {
      // 不做假可用：非原生环境直接说清原因（文案来自主表，不硬编码）
      snack.error('ilink.err.notNative');
      return;
    }
    void startLogin();
  }, [native, snack, startLogin]);

  const handleTest = useCallback((): void => {
    setBusy(true);
    void sendTestMessage()
      .then((ok) => {
        snack[ok ? 'success' : 'error'](ok ? 'ilink.toast.testSent' : 'ilink.toast.testFailed');
      })
      .finally(() => setBusy(false));
  }, [sendTestMessage, snack]);

  const handleUnbind = useCallback((): void => {
    unbind();
    snack.success('ilink.toast.unbound');
  }, [unbind, snack]);

  const handleSubmitCode = useCallback((): void => {
    if (verifyCode.trim() === '') return;
    submitVerifyCode(verifyCode.trim());
    setVerifyCode('');
    snack.info('ilink.state.verifySubmitted');
  }, [submitVerifyCode, snack, verifyCode]);

  return (
    <Box>
      {/* ——— 总开关 ——— */}
      <SettingsField labelCopyKey="ilink.label.enabled" hintCopyKey="ilink.note.foregroundOnly">
        <Switch
          checked={ilink.enabled}
          onChange={(e) => patch({ ilink: { enabled: e.target.checked } })}
        />
      </SettingsField>

      {/* ——— 她收不收 / 主动消息也发不收 ——— */}
      <SettingsField labelCopyKey="ilink.label.receive">
        <Switch
          checked={ilink.receive}
          onChange={(e) => patch({ ilink: { receive: e.target.checked } })}
        />
      </SettingsField>

      <SettingsField labelCopyKey="ilink.label.inherit">
        {/*
          ★ 这个开关原本是**假的**（`inheritProactive` 在实现里没有任何行为分支）。
            本轮已接线到真实位置 `src/proactive/notify.ts` 的 `deliverProactiveMessage()`
            —— 那是**每一条主动消息的唯一出口**，与当前打开哪个页面无关。
            （曾考虑接 `chatStore.appendProactive()`，但它的唯一调用方是聊天页 hook、
              依赖当前会话，会导致"用户不在聊天页时不同步" ⇒ 被否决。)
            所以这里保持**可点**：它现在真的会生效。
        */}
        <Switch
          checked={ilink.inheritProactive}
          onChange={(e) => patch({ ilink: { inheritProactive: e.target.checked } })}
        />
      </SettingsField>

      {/*
        ——— 语音回复：**故意置灰** ———
        `voiceReply` 在实现里没有任何行为分支（媒体链路未实现），
        留一个可点的开关等于骗用户。所以 disabled + 用 hint 说明原因（走文案表，不硬编码）。

        ★ 这里最初挂的是 `ilink.note.mediaUnavailable`，那是**错的**：
        那句说的是「纯 Web 环境做不到」，会让原生用户以为"换个环境就能用"，
        而语音在**原生端也没实现**。已换成 `ilink.note.voiceNotImplemented`，
        它明确说明"这一版没做"且"开了也不会变成语音"。
      */}
      <SettingsField labelCopyKey="ilink.label.voice" hintCopyKey="ilink.note.voiceNotImplemented">
        <Switch checked={ilink.voiceReply} disabled />
      </SettingsField>

      {/* ——— 非原生环境的整体说明（只在需要时出现，减少噪音） ——— */}
      {!native ? (
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.7, py: 1 }}>
          {t('ilink.note.nonNative')}
        </Typography>
      ) : null}

      {/* ——— 状态行 ——— */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 1, minHeight: 44 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, flex: '1 1 auto', minWidth: 0 }}>
          {t(statusKey, statusVars)}
        </Typography>
        {receiving ? (
          <Typography variant="caption" sx={{ opacity: 0.6, flexShrink: 0 }}>
            {t('ilink.label.receive')}
          </Typography>
        ) : null}
      </Stack>

      {/*
        ——— 二维码 ———
        ★★ 这里必须**自己生成**二维码，不能把服务端给的字段当图片地址（2026-10-04 实测更正）：
          实测 `get_bot_qrcode` 返回的 `qrcode_img_content` 是一个
          **`Content-Type: text/html` 的 H5 落地页**（`liteapp.weixin.qq.com`，页面显示"正在加载"），
          且带 `X-Frame-Options: SAMEORIGIN` ⇒ **既不能当 `<img src>`（会破图）、也不能 iframe 嵌**。
          它的真实语义是「二维码图片的**内容**」= 应当被编码进二维码的载荷。
          ⇒ 用 `qrcode` 库把该字符串编码成二维码（dataURL）再显示。
        ★ 拿不到内容就**不画码**，只显示 id —— 不生成一张"内容是怪话"的假码骗用户。
      */}
      {qrDataUrl && login.phase !== 'bound' ? (
        <Box sx={{ textAlign: 'center', py: 1.5 }}>
          <Box
            component="img"
            src={qrDataUrl}
            alt={t('ilink.label.qrcodeId')}
            sx={{
              // 白底是二维码可扫性的前提（深色模式下也必须是白的，否则对比度不足扫不出）
              width: 200,
              height: 200,
              bgcolor: '#FFFFFF',
              borderRadius: 1,
              p: 1,
            }}
          />
          {/* 扫码要点（两个都是实测得来的真实约束，不是套话） */}
          <Typography variant="caption" sx={{ display: 'block', opacity: 0.7, mt: 0.5 }}>
            {t('ilink.state.scanQr')}
          </Typography>
          {login.qrcode !== '' ? (
            <Typography
              variant="caption"
              sx={{ display: 'block', opacity: 0.5, wordBreak: 'break-all' }}
            >
              {t('ilink.label.qrcodeId')}：{login.qrcode}
            </Typography>
          ) : null}
        </Box>
      ) : null}
      {/* 服务端给了内容但本机没能画出来（库异常）⇒ 如实说，不静默 */}
      {login.qrContent && !qrDataUrl && login.phase !== 'bound' ? (
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.7, py: 1 }}>
          {t('ilink.err.qrRenderFailed')}
        </Typography>
      ) : null}

      {/* ——— 配对码（只在服务端要求时出现） ——— */}
      {login.phase === 'awaitingVerifyCode' ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 1 }}>
          <TextField
            size="small"
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value)}
            placeholder={t('ilink.state.needVerifyCode')}
            inputProps={{ inputMode: 'numeric', maxLength: 8 }}
            sx={{ flex: 1 }}
          />
          <Button variant="contained" size="small" onClick={handleSubmitCode} sx={{ minHeight: 44 }}>
            {t('ilink.action.submitCode')}
          </Button>
        </Stack>
      ) : null}

      {/* ——— 操作按钮：主操作（绑定）用 contained，其余 text，视觉权重分明 ——— */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', py: 0.5, rowGap: 1 }}>
        <Button
          variant="contained"
          size="small"
          disabled={!native || connection === 'binding'}
          onClick={handleBind}
          sx={{ minHeight: 44 }}
        >
          {t(bound ? 'ilink.action.retry' : 'ilink.action.bind')}
        </Button>
        <Button
          variant="text"
          size="small"
          disabled={!bound || busy}
          onClick={handleTest}
          sx={{ minHeight: 44 }}
        >
          {t('ilink.action.test')}
        </Button>
        <Button
          variant="text"
          color="inherit"
          size="small"
          disabled={!bound}
          onClick={handleUnbind}
          sx={{ minHeight: 44 }}
        >
          {t('ilink.action.unbind')}
        </Button>
      </Stack>

      {/* ——— 凭据与解绑的诚实说明 ——— */}
      <Typography variant="caption" sx={{ display: 'block', opacity: 0.62, pt: 1 }}>
        {t('ilink.note.tokenPlaintext')}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', opacity: 0.62, pb: 1 }}>
        {t('ilink.note.unbindLocalOnly')}
      </Typography>

      {/*
        ——— 原始响应日志 ———
        ★ 走 monospace 字体令牌而不是 `fontFamily: 'monospace'`：
          后者不会命中主题的字体链（中文在等宽字体下常回退成难看的默认字体）。
          长度上限 120px + 可滚动：日志是排查手段，不该把设置页撑长。
      */}
      {logs.length > 0 ? (
        <Box
          sx={{
            mt: 1,
            maxHeight: 120,
            overflow: 'auto',
            bgcolor: 'action.hover',
            borderRadius: 2,
            p: 1,
          }}
        >
          <Typography
            variant="caption"
            component="pre"
            sx={{
              m: 0,
              fontFamily: THEME_TOKENS.font.monoFamily,
              fontSize: THEME_TOKENS.font.sizes['2xs'],
              whiteSpace: 'pre-wrap',
              opacity: 0.75,
            }}
          >
            {logs.slice(0, 30).join('\n')}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
}

export default WechatSection;
