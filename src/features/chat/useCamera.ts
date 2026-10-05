import { useCallback, useEffect, useRef, useState } from 'react';
import { log } from '@/store/logStore';

/**
 * ★★ 相机取流与拍照（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么自建，而不是引入 `react-webcam`
 * ═══════════════════════════════════════════════════════════════════════════
 * 动手前在 GitHub 检索了现成方案（用户要求），结论写在下面 ——
 * **决定自建，但借鉴了它实现里两个容易踩错的关键点**。
 *
 * ── 检索到的候选 ───────────────────────────────────────────────────────
 *
 * | 仓库 | 星数 | 依赖 | 结论 |
 * |---|---|---|---|
 * | `mozmorris/react-webcam` | 1751 | 运行时依赖 **0**，peer 只要 react/react-dom | 唯一可考虑 |
 * | `purple-technology/react-camera-pro` | 231 | 运行时带 `detectrtc`，**peer 依赖 `styled-components`** | ❌ **排除** |
 *
 * ★ `react-camera-pro` 被排除是**硬理由**：它要求 `styled-components@^5` 作为 peer。
 *   本项目已有 MUI(emotion) + Tailwind 两套样式体系，再加第三个 CSS-in-JS 运行时
 *   只为换一个相机组件，成本远超收益（还有双 CSS-in-JS 的样式优先级冲突风险）。
 *
 * ── 为什么连 `react-webcam` 也不引入（读了它的源码之后的判断）────────────
 * 它的实现约 200 行，去掉对我们无用的部分后，真正有价值的只有两点（见下）。
 * 而我们的**核心需求全在它的能力范围之外**：
 *
 * | 我们的需求 | react-webcam 提供吗 |
 * |---|---|
 * | 错误**分类**（拒绝/无摄像头/被占用/非安全上下文） | ❌ 只把原始 error 透传给回调，分类仍要自己写 |
 * | 权限**申请时机**可控（点击才申请，不是挂载就申请） | ❌ 它 `componentDidMount` 就申请 |
 * | 预览 / 重拍 / 取消 的对话框 | ❌ 只给 `<video>` + `getScreenshot()`，UI 全自己写 |
 * | 输出 **Blob**（本项目图片存 `blobRepo`，要字节） | ❌ 它 `toDataURL()` 返回 **base64 字符串**，还得再解码回 Blob |
 * | 与 hooks-only 代码库一致 | ❌ 它是 **class 组件** + 命令式 `ref.getScreenshot()` |
 *
 * ⇒ 引入它净收益是"少写约 40 行 `<video>` 装配"，代价是多一个依赖、
 *   一个 class 组件、一次 dataURL→Blob 的额外转换，以及它的遗留 polyfill（见下）。
 *   **不划算。**
 *
 * ── ★★ 但从它源码里学到两个**必须照做**的点（这才是检索的真正价值）──────
 *
 * **① `playsInline` + `muted` + `autoPlay` 三个属性缺一不可。**
 *   移动端 WebView（尤其 iOS 与部分安卓定制 ROM）**不加 `playsInline` 会把视频
 *   切到全屏原生播放器**，表现是"一点拍照就跳出去一个黑屏界面"；
 *   不加 `muted` 则被自动播放策略拦下，视频不播（用户看到纯黑预览）。
 *   这三条是"看起来该能跑、实际在手机上不работает"的典型。
 *
 * **② 陈旧请求守卫（stale-request guard）。**
 *   `getUserMedia` 是异步的。用户在"正在打开相机"的过程中关掉对话框、
 *   或快速连点翻转摄像头，会出现：**慢的那次请求在组件卸载后才 resolve**，
 *   拿到的流没人持有、也就没人 `stop()` ⇒ **摄像头指示灯一直亮着**。
 *   它的做法是给每次请求编号，resolve 时比对编号，过期就立即停流。
 *   这里用同样的机制（`requestIdRef`）。
 *
 * ── 关于权限申请时机 ────────────────────────────────────────────────────
 * **只有用户点了相机按钮才会调 `getUserMedia`**（`enabled` 变 true 时）。
 * 不在应用启动时预申请 —— 那会在用户还没表达任何意图时弹出系统权限框，
 * 是明确的骚扰（也是浏览器厂商明确反对的做法）。
 */

/** 相机失败的**分类**（界面按它给不同的解法，而不是一句"打不开"） */
export type CameraErrorKind =
  | 'denied' // 用户拒绝权限
  | 'noCamera' // 设备没有摄像头
  | 'inUse' // 被别的应用占用
  | 'overconstrained' // 要求的摄像头规格不存在
  | 'insecure' // 非安全上下文（http 下浏览器禁用）
  | 'unsupported' // 这个环境完全不支持
  | 'unknown';

export interface CameraFailure {
  kind: CameraErrorKind;
  /** 原始错误信息（开发者页/日志用，不直接给用户看） */
  raw?: string;
}

/**
 * 把 `getUserMedia` 抛出的错误归类。
 *
 * ★ 为什么必须分类（而不是统一说"打不开相机"）：
 *   四种原因对应**四种完全不同的解法** ——
 *   拒绝权限要去系统设置里开、没有摄像头只能换设备、被占用要关掉别的应用、
 *   非安全上下文要改用本地文件。
 *   混成一句话，用户唯一能做的就是放弃。
 *
 * ★ 判据用 `DOMException.name`（标准字段），不用 message 文案 ——
 *   文案会随浏览器/语言变，name 是规范固定的。
 */
export function classifyCameraError(e: unknown): CameraFailure {
  const name = (e as { name?: string } | undefined)?.name ?? '';
  const message = (e as { message?: string } | undefined)?.message ?? '';
  const raw = `${name}${message ? `: ${message}` : ''}` || String(e);

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return { kind: 'denied', raw };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { kind: 'noCamera', raw };
    case 'NotReadableError':
    case 'TrackStartError':
      // 相机被别的应用占着（安卓上很常见：后台还开着相机/扫码应用）
      return { kind: 'inUse', raw };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return { kind: 'overconstrained', raw };
    case 'SecurityError':
      return { kind: 'insecure', raw };
    case 'TypeError':
      // 在部分浏览器里，非安全上下文或 mediaDevices 缺失会抛 TypeError
      return { kind: 'unsupported', raw };
    default:
      return { kind: 'unknown', raw };
  }
}

/** 当前环境能不能用相机（**先判这个，再决定要不要显示相机按钮的可用态**） */
export function cameraSupport(): { ok: boolean; failure?: CameraFailure } {
  if (typeof navigator === 'undefined') return { ok: false, failure: { kind: 'unsupported' } };
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    // ★ 安全上下文是硬门槛：http 页面里浏览器**直接不暴露** getUserMedia。
    //   先判它，能得到比"TypeError: undefined is not a function"有用得多的提示。
    return { ok: false, failure: { kind: 'insecure' } };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, failure: { kind: 'unsupported' } };
  }
  return { ok: true };
}

export type CameraStatus = 'idle' | 'starting' | 'live' | 'error';
export type CameraFacing = 'user' | 'environment';

export interface UseCameraResult {
  videoRef: React.RefObject<HTMLVideoElement>;
  status: CameraStatus;
  failure?: CameraFailure;
  facing: CameraFacing;
  /** 翻转前后摄像头 */
  flip: () => void;
  /** 手动重试（错误后用户点"再试一次"） */
  retry: () => void;
}

/**
 * 相机取流。
 *
 * @param enabled 是否要开着（对话框打开 = true）。变 false 会**立即停流**。
 *
 * ★ 停流不是"可选的清理"，是**必须**的：不停的话摄像头指示灯常亮、
 *   电量持续消耗，而且下一个应用想用相机会被占用。
 *   实现上 `stopTracks` 在三个地方都要调：卸载、`enabled` 变 false、出错时。
 */
export function useCamera(enabled: boolean): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /**
   * ★ 陈旧请求守卫（借鉴自 `react-webcam` 的 `requestUserMediaId`）。
   *   每次发起请求编号 +1；resolve 时编号对不上 ⇒ 说明这次请求已经过期
   *   （组件卸载了、或用户已经翻转摄像头发起了新请求）⇒ **立刻把流停掉**，
   *   否则它就成了没人持有、没人释放的孤儿流，摄像头灯会一直亮。
   */
  const requestIdRef = useRef(0);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [failure, setFailure] = useState<CameraFailure | undefined>(undefined);
  const [facing, setFacing] = useState<CameraFacing>('user');
  const [nonce, setNonce] = useState(0); // 手动 retry 用

  const stopTracks = useCallback((): void => {
    const stream = streamRef.current;
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* 已经被停了，忽略 */
      }
    }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!enabled) {
      stopTracks();
      setStatus('idle');
      setFailure(undefined);
      return;
    }

    const support = cameraSupport();
    if (!support.ok) {
      setStatus('error');
      setFailure(support.failure);
      return;
    }

    const myId = ++requestIdRef.current;
    let cancelled = false;
    setStatus('starting');
    setFailure(undefined);

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            // ★ 不写死 width/height：写死会让某些设备抛 OverconstrainedError
            //   （"你要的分辨率我没有"）。用 ideal 让浏览器自己挑最接近的。
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        // ★★ 守卫：这次请求过期了就立刻停流（理由见 requestIdRef 注释）
        if (cancelled || myId !== requestIdRef.current) {
          for (const t of stream.getTracks()) {
            try {
              t.stop();
            } catch {
              /* 忽略 */
            }
          }
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // ★ play() 返回 Promise 且**可能 reject**（自动播放策略）。
          //   不 catch 会变成未处理的 rejection，在真机上表现为"预览黑的但没报错"。
          try {
            await video.play();
          } catch (playErr) {
            log.warn('app', '相机预览播放被拒', String(playErr));
          }
        }
        setStatus('live');
      } catch (e) {
        if (cancelled || myId !== requestIdRef.current) return;
        const f = classifyCameraError(e);
        setStatus('error');
        setFailure(f);
        log.warn('app', '相机打开失败', { kind: f.kind, raw: f.raw });
      }
    })();

    return () => {
      cancelled = true;
      stopTracks();
    };
  }, [enabled, facing, nonce, stopTracks]);

  const flip = useCallback((): void => {
    // 切换 facingMode 会让上面的 effect 重跑（依赖里有 facing）：
    // 先停旧流 → 再取新流。守卫保证慢返回的旧请求不会留下孤儿流。
    setFacing((f) => (f === 'user' ? 'environment' : 'user'));
  }, []);

  const retry = useCallback((): void => {
    stopTracks();
    setNonce((n) => n + 1);
  }, [stopTracks]);

  return { videoRef, status, ...(failure ? { failure } : {}), facing, flip, retry };
}

/**
 * 从 `<video>` 抓一帧，转成 **Blob**。
 *
 * ★ 用 `canvas.toBlob()` 而不是 `toDataURL()`：
 *   本项目图片统一存进 `blobRepo`（要 `Blob`/字节），
 *   `toDataURL()` 给的是 base64 字符串 —— 还得解码回 Blob 才能入库，白绕一圈。
 *
 * ★ `mirror=true` 时把画布水平翻转，让**照片与预览所见一致**（WYSIWYG）。
 *   前置摄像头的预览是镜像的（像照镜子），如果照片不镜像，用户会觉得"拍反了"。
 *   各厂商相机 App 在这点上行为不一致，这里统一按"所见即所得"。
 */
export async function captureFrame(
  video: HTMLVideoElement,
  options: { mirror: boolean; quality?: number } = { mirror: false },
): Promise<Blob> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w === 0 || h === 0) {
    throw new Error('视频尺寸为 0（相机还没出画面）');
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('拿不到 2D 画布上下文');

  if (options.mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) => {
    // ★ JPEG + 0.9：照片体积与质量的实际平衡点。
    //   PNG 会让一张 1280×720 的照片涨到 2-4 MB，而聊天里根本看不出差别。
    canvas.toBlob(resolve, 'image/jpeg', options.quality ?? 0.9);
  });
  if (!blob) throw new Error('画布转 Blob 失败');
  return blob;
}
