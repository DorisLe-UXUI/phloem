// postMessage bridge to the sandbox, with awaitable requests.
import type { ToPlugin, ToUI } from '../shared/types';

type Handler = (msg: ToUI) => void;
const handlers = new Set<Handler>();

export function post(msg: ToPlugin) {
  parent.postMessage({ pluginMessage: msg }, '*');
}

export function onMessage(h: Handler): () => void {
  handlers.add(h);
  return () => handlers.delete(h);
}

window.addEventListener('message', (e) => {
  const msg = e.data?.pluginMessage as ToUI | undefined;
  if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
  for (const h of handlers) h(msg);
});

/** Wait for the first message matching `pred`. */
export function waitFor<T extends ToUI>(pred: (m: ToUI) => m is T, timeoutMs = 120_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Hết thời gian chờ Figma trả kết quả.')); }, timeoutMs);
    const off = onMessage((m) => {
      if (pred(m)) { clearTimeout(timer); off(); resolve(m); }
    });
  });
}
