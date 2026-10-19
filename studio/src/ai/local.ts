// Free AI that runs on the user's own Mac, through the Phloem local bridge (tools/local-ai/server.mjs on localhost:8790):
// FLUX images, LTX-2 video shots and text-to-speech. Nothing is uploaded and nothing is billed; it is slower.
export const LOCAL_AI = 'http://localhost:8790';
export interface LocalHealth { image: boolean; tts: boolean; ttsModel: boolean; video: boolean }
export interface LocalVoice { id: string; lang: string; label: string; engine: string }

let cache: { at: number; h: LocalHealth | null } | null = null;
/** What the bridge offers, or null when it is not running (checked at most every 20 s). */
export async function localHealth(force = false): Promise<LocalHealth | null> {
  if (!force && cache && Date.now() - cache.at < 20_000) return cache.h;
  let h: LocalHealth | null = null;
  try { const r = await fetch(`${LOCAL_AI}/health`, { signal: AbortSignal.timeout(2500) }); if (r.ok) h = await r.json(); } catch { /* not running */ }
  cache = { at: Date.now(), h }; return h;
}
/** On a public https page the browser may refuse to talk to localhost even when the bridge runs: say both fixes. */
const NOT_RUNNING = () => (typeof location !== 'undefined' && location.protocol === 'https:'
  ? 'Không kết nối được AI trên máy. 1) Bật nó: mở Terminal trong thư mục phloem-mkt, chạy npm run ai-may. 2) Nếu đã bật: Chrome có hỏi "truy cập thiết bị trong mạng" thì bấm Cho phép, hoặc mở Phloem tại http://localhost:8790/mkt/ (luôn dùng được AI trên máy).'
  : 'Chưa bật AI trên máy. Mở Terminal trong thư mục phloem-mkt và chạy: npm run ai-may');
async function need(k: keyof LocalHealth, what: string) {
  const h = await localHealth(true);
  if (!h) throw new Error(NOT_RUNNING());
  if (!h[k]) throw new Error(`AI trên máy chưa cài phần ${what}.`);
}
async function fail(r: Response) { const j = await r.json().catch(() => ({})); return new Error(j.error || `AI trên máy lỗi (HTTP ${r.status}).`); }

export async function localImage(prompt: string, aspect: string, signal?: AbortSignal): Promise<{ b64: string; mime: string }> {
  await need('image', 'tạo ảnh');
  const r = await fetch(`${LOCAL_AI}/image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, aspect }), signal });
  if (!r.ok) throw await fail(r);
  return r.json();
}
export async function localVoices(): Promise<LocalVoice[]> {
  try { const r = await fetch(`${LOCAL_AI}/voices`, { signal: AbortSignal.timeout(30_000) }); if (r.ok) return (await r.json()).voices || []; } catch { /* not running */ }
  return [];
}
export async function localTts(text: string, lang: 'vi' | 'en', voice: string, signal?: AbortSignal): Promise<Blob> {
  await need('tts', 'giọng đọc');
  const r = await fetch(`${LOCAL_AI}/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang, voice }), signal });
  if (!r.ok) throw await fail(r);
  return r.blob();
}
/** One video shot made by LTX-2 on this Mac: slow (minutes). */
export async function localShot(prompt: string, seconds: number, onStage: (m: string) => void, signal?: AbortSignal, image?: { b64: string; mime: string }): Promise<Blob> {
  await need('video', 'tạo video');
  const r = await fetch(`${LOCAL_AI}/video`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, seconds, image }), signal });
  if (!r.ok) throw await fail(r);
  const { op } = await r.json();
  for (;;) {
    if (signal?.aborted) throw new Error('Đã huỷ.');
    await new Promise((res) => setTimeout(res, 5000));
    const j = await (await fetch(`${LOCAL_AI}/video/${op}`, { signal })).json();
    onStage(`LTX-2 trên máy đang dựng cảnh… ${Math.floor((j.seconds || 0) / 60)}:${String((j.seconds || 0) % 60).padStart(2, '0')} (miễn phí, chậm)`);
    if (j.done) {
      if (j.error) throw new Error(`LTX-2: ${j.error}`);
      const f = await fetch(`${LOCAL_AI}/video/${op}/file`, { signal }); if (!f.ok) throw await fail(f);
      return f.blob();
    }
  }
}

// ---- opening Phloem from the bridge (http://localhost:8790/mkt/) without signing in again ----
// The public page asks the relay for a one-time code (2 minutes, single use) and opens the local copy with it in the URL
// fragment (never sent to any server); the local copy trades it with the relay for its own session. Google sign-in can't
// run on localhost, and no password is typed.
const SESSION_KEY = 'phloem.session';
export const isLocalCopy = () => typeof location !== 'undefined' && location.origin === LOCAL_AI;
export async function openOnThisMac(): Promise<boolean> {
  const { getSession, readStudioRelay } = await import('../auth/core');
  const ses = getSession(); const base = readStudioRelay().relayUrl;
  const w = window.open('about:blank', '_blank'); // opened now, inside the click, so the pop-up blocker allows it
  let code = '';
  if (ses?.mode === 'relay' && base) {
    try { const r = await fetch(`${base}/auth/handoff`, { method: 'POST', headers: { Authorization: `Bearer ${ses.token}` } }); if (r.ok) code = (await r.json()).code || ''; } catch { /* sign in there instead */ }
  }
  const url = `${LOCAL_AI}/mkt/#${code ? `handoff=${code}&go=${encodeURIComponent(location.hash.slice(1))}` : location.hash.slice(1)}`;
  if (w) w.location.href = url; else location.href = url;
  return true;
}
/** On the local copy: trade a hand-off code from the URL for a session. Resolves true when signed in by it. */
export async function receiveSession(): Promise<boolean> {
  if (!isLocalCopy()) return false;
  const m = /^#handoff=([0-9a-f]+)(?:&go=(.*))?$/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, '', `${location.pathname}#${decodeURIComponent(m[2] || '')}`); // the code leaves the address bar at once
  const { readStudioRelay } = await import('../auth/core');
  const base = readStudioRelay().relayUrl; if (!base) return false;
  try {
    const r = await fetch(`${base}/auth/handoff-redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: m[1] }) });
    if (!r.ok) return false;
    const j = await r.json();
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...j, mode: 'relay', relayUrl: base }));
    return true;
  } catch { return false; }
}
