/**
 * EX 验证的「落库核对」补丁（§8.2：别只看 UI 显示，回库里核对）。
 * 复用 tmp-ex-verify.mjs 留下的同一个 `--user-data-dir`，所以数据还在。
 * 之前的探针 `indexedDB.open('ai-ai')` 是**错的 DB 名**（真名 `ai-ai-web`），返回空 store 不是"没写进去"。
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = path.join(os.tmpdir(), 'ai-ai-ex-verify-profile');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--remote-debugging-port=9223',
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--disable-gpu',
    '--no-proxy-server',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

try {
  let wsUrl = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* 未就绪 */
    }
    await sleep(400);
  }
  if (!wsUrl) throw new Error('CDP 未就绪');
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, bad) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', bad, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  const send = (method, params = {}) => {
    const mid = (id += 1);
    ws.send(JSON.stringify({ id: mid, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(mid, { resolve, reject });
      setTimeout(() => reject(new Error(`超时 ${method}`)), 20000);
    });
  };
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Page.enable');
  // 必须落到应用 origin，IndexedDB 才是同一个库
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/distill' });
  await sleep(3000);

  const probe = await evalJs(
    `(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('ai-ai-web');
      open.onsuccess = () => {
        const db = open.result;
        const out = { stores: [...db.objectStoreNames], jobs: null, artifacts: null };
        const getJobs = db.transaction('distillJobs').objectStore('distillJobs').getAll();
        getJobs.onsuccess = () => {
          out.jobs = (getJobs.result ?? []).map((j) => ({
            id: j.id, name: j.name, status: j.status, createdAt: j.createdAt,
            chunkCount: Array.isArray(j.chunks) ? j.chunks.length : undefined,
          }));
          const arts = db.transaction('distillArtifacts').objectStore('distillArtifacts').getAll();
          arts.onsuccess = () => {
            out.artifacts = (arts.result ?? []).map((a) => ({
              jobId: a.jobId, kind: a.kind ?? a.type, keys: Object.keys(a).slice(0, 8),
            }));
            db.close();
            resolve(out);
          };
          arts.onerror = () => { db.close(); reject(new Error('读 distillArtifacts 失败')); };
        };
        getJobs.onerror = () => { db.close(); reject(new Error('读 distillJobs 失败')); };
      };
      open.onerror = () => reject(new Error('open ai-ai-web 失败'));
    }))()`,
  );
  console.log(JSON.stringify(probe, null, 2));
} finally {
  try {
    edge.kill();
  } catch {
    /* 忽略 */
  }
}
