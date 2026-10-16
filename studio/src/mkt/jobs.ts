// Background AI jobs for the Thiết kế page: each post's picture is made in its own row while the user keeps working.
// A few run at once (image and AI limits), the rest wait in line; a job hit by a rate limit waits a minute and tries again.
// Lives at module level so jobs keep running when the user opens another tab or the editor.
import { useEffect, useState } from 'preact/hooks';
import { toast } from '../store';

export interface Job { key: string; title: string; stage: string; state: 'queued' | 'running' | 'done' | 'error'; error?: string; abort: AbortController; at: number }
type Run = (onStage: (m: string) => void, signal: AbortSignal) => Promise<unknown>;

const CONCURRENCY = 3;
const jobs = new Map<string, Job & { run: Run }>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
// the jobs run in this tab: reloading or closing it would drop them, so the browser asks first
if (typeof window !== 'undefined') window.addEventListener('beforeunload', (e) => { if (activeCount() > 0) { e.preventDefault(); e.returnValue = ''; } });

/** Queue a job (ignored when the same key is already queued or running). */
export function enqueue(key: string, title: string, run: Run) {
  const cur = jobs.get(key);
  if (cur && (cur.state === 'queued' || cur.state === 'running')) { toast(`"${title}" đang được làm rồi.`, 'info'); return; }
  jobs.set(key, { key, title, stage: 'Đang chờ lượt…', state: 'queued', abort: new AbortController(), at: Date.now(), run });
  emit(); pump();
}
export function cancelJob(key: string) { const j = jobs.get(key); if (!j) return; j.abort.abort(); if (j.state === 'queued') jobs.delete(key); emit(); }
export function cancelAll() { for (const j of jobs.values()) if (j.state === 'queued' || j.state === 'running') cancelJob(j.key); }
export const jobOf = (key: string) => jobs.get(key) || null;
export const activeCount = () => [...jobs.values()].filter((j) => j.state === 'queued' || j.state === 'running').length;

function pump() {
  const running = [...jobs.values()].filter((j) => j.state === 'running').length;
  const next = [...jobs.values()].filter((j) => j.state === 'queued').sort((a, b) => a.at - b.at).slice(0, Math.max(0, CONCURRENCY - running));
  for (const j of next) void start(j);
}
async function start(j: Job & { run: Run }) {
  j.state = 'running'; j.stage = 'Bắt đầu…'; emit();
  const onStage = (m: string) => { j.stage = m; emit(); };
  for (let attempt = 0; ; attempt++) {
    try {
      await j.run(onStage, j.abort.signal);
      j.state = 'done'; j.stage = 'Xong'; toast(`Xong ảnh: ${j.title}`, 'ok');
      setTimeout(() => { if (jobs.get(j.key) === j && j.state === 'done') { jobs.delete(j.key); emit(); } }, 12_000);
      break;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      if (j.abort.signal.aborted || /Đã huỷ/.test(msg)) { jobs.delete(j.key); break; }
      if (attempt < 3 && /quá nhiều|429|rate|overloaded|529/i.test(msg)) { onStage(`Bị giới hạn tốc độ, thử lại sau 60 giây… (lần ${attempt + 2})`); await new Promise((r) => setTimeout(r, 60_000)); continue; }
      j.state = 'error'; j.error = msg; j.stage = msg; toast(`Lỗi "${j.title}": ${msg.slice(0, 120)}`, 'err');
      break;
    }
  }
  emit(); pump();
}

/** Re-render on any job change. */
export function useJobs() {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return { jobOf, activeCount: activeCount() };
}
