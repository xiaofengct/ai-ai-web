# public/sherpa — sherpa-onnx 官方 WebAssembly 产物放置目录

端侧语音（TTS / ASR）走 **sherpa-onnx 官方 WebAssembly 构建**（Apache-2.0），
与原应用 APK 内置的 `libsherpa-onnx-*.so` 是同一个引擎。

> ★★ 本目录**默认是空的**，这是故意的。
> 引擎 + 中文模型可能上百 MB，**绝不在首屏静默下载**。
> `src/features/voice/useTTS.ts` / `useASR.ts` 会先探测 `manifest.json`，
> 拿不到就**静默回退**到云端或 Web Speech，不会报错、不会弹窗。

## 怎么启用（可选）

1. 从 <https://github.com/k2-fsa/sherpa-onnx> 的发布页或 `wasm/` 目录取官方产物：

   ```
   wasm/tts/sherpa-onnx-tts.js           # TTS 胶水层
   wasm/tts/sherpa-onnx-wasm-main-tts.wasm
   wasm/tts/sherpa-onnx-wasm-main-tts.data
   wasm/asr/sherpa-onnx-asr.js           # ASR 胶水层
   wasm/asr/sherpa-onnx-wasm-main-asr.wasm
   wasm/asr/sherpa-onnx-wasm-main-asr.data
   ```

2. 放到本目录下，并下载中文模型（例：`vits-icefall-zh-aishell3`、`matcha-icefall-zh-baker`；
   ASR 例：`sherpa-onnx-paraformer-zh-2023-09-14`）。

3. 写一份 `manifest.json`（下面是格式示例，路径均为相对站点根）：

   ```json
   {
     "version": 1,
     "engine": "sherpa-onnx",
     "license": "Apache-2.0",
     "tts": {
       "glue": "/sherpa/sherpa-onnx-tts.js",
       "wasm": "/sherpa/sherpa-onnx-wasm-main-tts.wasm",
       "data": "/sherpa/sherpa-onnx-wasm-main-tts.data",
       "models": [
         {
           "id": "vits-zh-aishell3",
           "label": "中文 · VITS aishell3",
           "dir": "/sherpa/model-tts-vits-zh-aishell3",
           "model": "model.onnx",
           "tokens": "tokens.txt",
           "lexicon": "lexicon.txt",
           "speakerId": 0,
           "sampleRate": 22050
         }
       ]
     },
     "asr": {
       "glue": "/sherpa/sherpa-onnx-asr.js",
       "wasm": "/sherpa/sherpa-onnx-wasm-main-asr.wasm",
       "data": "/sherpa/sherpa-onnx-wasm-main-asr.data",
       "models": [
         {
           "id": "paraformer-zh",
           "label": "中文 · Paraformer",
           "dir": "/sherpa/model-asr-paraformer-zh",
           "model": "model.int8.onnx",
           "tokens": "tokens.txt",
           "sampleRate": 16000
         }
       ]
     }
   }
   ```

4. 刷新页面 → 「设置 → 语音 → 语音测试」里就能选到 `sherpaWasm` 通道与模型。

## 能力边界（UI 上必须如实标注，不许暗示等价）

- 端侧合成用的是模型自带的**固定 speaker id**（如 aishell3 有多个中文说话人），
  **不等价于**原 App 的硅基流动**语音克隆**；
  真正的 zero-shot 克隆需要 ZipVoice 之类的模型并自备参考音频。
- 官方胶水层的构造器名在不同版本里可能是 `createOfflineTts` / `SherpaOnnxOfflineTts`
  （ASR 对应 `createOfflineRecognizer` / `createOnlineRecognizer`）；
  加载器会依次尝试，都拿不到就静默回退。

## 许可证

sherpa-onnx 为 **Apache-2.0**，可商用。部署时请把许可证文件一并放进模型目录，
并在 `THIRD_PARTY.md` 登记。
