#!/usr/bin/env node
// Phloem local AI bridge: lets the Phloem web app use free AI that runs on THIS Mac (no API cost, no upload).
// It only listens on 127.0.0.1 and only answers the Phloem pages, and runs one heavy job at a time (32 GB of memory).
//
//   node tools/local-ai/server.mjs            (PORT=8790 by default)
//
// It calls the scripts set up in ~/ai (override with env vars):
//   image  LOCAL_IMAGE_CMD  ~/ai/bin/tao-anh.sh  "<prompt>" <width> <height> <out.png>
//   voice  LOCAL_TTS_CMD    ~/ai/bin/doc-giong.sh "<text>" <vi|en> <voice> <out.wav>   (--voices lists them)
//   video  LOCAL_VIDEO_CMD  ~/ai/ltx-video/tao-canh.sh "<prompt>" <seconds> <out.mp4> [first-frame.png]
// Without a voice script it still speaks through macOS `say` (Vietnamese voice Linh, English Samantha).
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 8790);
const HOME = homedir();
const CMD = {
  image: process.env.LOCAL_IMAGE_CMD || join(HOME, 'ai/bin/tao-anh.sh'),
  tts: process.env.LOCAL_TTS_CMD || join(HOME, 'ai/bin/doc-giong.sh'),
  video: process.env.LOCAL_VIDEO_CMD || join(HOME, 'ai/ltx-video/tao-canh.sh'),
};
const ORIGINS = [/^https:\/\/dorisle-uxui\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, ...(process.env.LOCAL_AI_ORIGINS || '').split(',').filter(Boolean).map((o) => new RegExp(`^${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))];
const has = (k) => existsSync(CMD[k]);
const hasSay = process.platform === 'darwin';

const SIZES = { '1:1': [1024, 1024], '3:4': [896, 1152], '4:3': [1152, 896], '9:16': [768, 1344], '16:9': [1344, 768] };

/** One heavy model at a time: jobs wait their turn. */
let chain = Promise.resolve();
const queued = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
function run(cmd, args, timeoutMs) {
  return new Promise((ok, bad) => {
    const ch = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; let out = '';
    ch.stdout.on('data', (d) => { out += d; if (out.length > 1e5) out = out.slice(-5e4); });
    ch.stderr.on('data', (d) => { err += d; if (err.length > 1e5) err = err.slice(-5e4); });
    const t = setTimeout(() => { ch.kill('SIGKILL'); bad(new Error(`quá ${Math.round(timeoutMs / 60000)} phút`)); }, timeoutMs);
    ch.on('error', (e) => { clearTimeout(t); bad(e); });
    ch.on('close', (code) => { clearTimeout(t); code === 0 ? ok(out) : bad(new Error((err || out).trim().split('\n').slice(-3).join(' ').slice(0, 400) || `exit ${code}`)); });
  });
}
const tmp = () => mkdtempSync(join(tmpdir(), 'phloem-ai-'));

async function voices() {
  const list = [];
  if (has('tts')) {
    try { for (const ln of (await run(CMD.tts, ['--voices'], 30_000)).split('\n')) { const [id, lang, label] = ln.split('\t'); if (id && lang) list.push({ id: id.trim(), lang: lang.trim(), label: (label || id).trim(), engine: 'local' }); } } catch { /* script without --voices */ }
  }
  if (hasSay) list.push({ id: 'say:Linh', lang: 'vi', label: 'Linh (macOS, nữ)', engine: 'say' }, { id: 'say:Samantha', lang: 'en', label: 'Samantha (macOS)', engine: 'say' }, { id: 'say:Daniel', lang: 'en', label: 'Daniel (macOS, UK)', engine: 'say' });
  return list;
}

const videoJobs = new Map(); // id → { done, error, file, dir, at }

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const allowed = !origin || ORIGINS.some((r) => r.test(origin));
  if (!allowed) { res.writeHead(403); return res.end('origin not allowed'); }
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true'); // Chrome: a public page talking to localhost
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const body = async () => { let b = ''; for await (const c of req) { b += c; if (b.length > 25e6) throw new Error('too large'); } return b ? JSON.parse(b) : {}; };
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/health') return json(200, { ok: true, service: 'phloem-local-ai', image: has('image'), tts: has('tts') || hasSay, ttsModel: has('tts'), video: has('video') });
    if (url.pathname === '/voices') return json(200, { voices: await voices() });

    if (url.pathname === '/image' && req.method === 'POST') {
      if (!has('image')) return json(503, { error: `Chưa cài tạo ảnh trên máy (${CMD.image}).` });
      const p = await body(); const prompt = String(p.prompt || '').slice(0, 2000); if (!prompt) return json(400, { error: 'Thiếu mô tả ảnh.' });
      const [w, h] = SIZES[p.aspect] || SIZES['1:1'];
      const b64 = await queued(async () => { const d = tmp(); try { const out = join(d, 'out.png'); await run(CMD.image, [prompt, String(w), String(h), out], 20 * 60_000); return readFileSync(out).toString('base64'); } finally { rmSync(d, { recursive: true, force: true }); } });
      return json(200, { b64, mime: 'image/png', provider: 'local' });
    }

    if (url.pathname === '/tts' && req.method === 'POST') {
      const p = await body(); const text = String(p.text || '').slice(0, 3000).trim(); if (!text) return json(400, { error: 'Thiếu chữ để đọc.' });
      const lang = p.lang === 'en' ? 'en' : 'vi'; const voice = String(p.voice || '');
      const wav = await queued(async () => {
        const d = tmp();
        try {
          const out = join(d, 'out.wav');
          if (voice.startsWith('say:') || !has('tts')) {
            if (!hasSay) throw new Error('Chưa cài giọng đọc trên máy.');
            const v = voice.startsWith('say:') ? voice.slice(4) : lang === 'vi' ? 'Linh' : 'Samantha';
            const aiff = join(d, 'out.aiff');
            await run('say', ['-v', v, '-o', aiff, text], 2 * 60_000);
            await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@44100', aiff, out], 60_000);
          } else await run(CMD.tts, [text, lang, voice || 'default', out], 10 * 60_000);
          return readFileSync(out);
        } finally { rmSync(d, { recursive: true, force: true }); }
      });
      res.writeHead(200, { 'Content-Type': 'audio/wav' }); return res.end(wav);
    }

    if (url.pathname === '/video' && req.method === 'POST') {
      if (!has('video')) return json(503, { error: `Chưa cài tạo video trên máy (${CMD.video}).` });
      const p = await body(); const prompt = String(p.prompt || '').slice(0, 2000); if (!prompt) return json(400, { error: 'Thiếu mô tả video.' });
      const seconds = String(Math.max(2, Math.min(10, Number(p.seconds) || 5)));
      const id = randomUUID(); const dir = tmp(); const file = join(dir, 'out.mp4');
      const args = [prompt, seconds, file];
      if (p.image?.b64) { const f = join(dir, 'first.png'); writeFileSync(f, Buffer.from(String(p.image.b64).replace(/^data:[^,]+,/, ''), 'base64')); args.push(f); }
      const job = { done: false, error: '', file, dir, at: Date.now() }; videoJobs.set(id, job);
      void queued(() => run(CMD.video, args, 90 * 60_000)).then(() => { job.done = true; }, (e) => { job.done = true; job.error = String(e?.message || e); });
      return json(200, { op: id, model: 'LTX-2 (trên máy)' });
    }
    const vm = /^\/video\/([\w-]+)(\/file)?$/.exec(url.pathname);
    if (vm) {
      const job = videoJobs.get(vm[1]); if (!job) return json(404, { error: 'Không thấy việc này (bridge đã khởi động lại?).' });
      if (!vm[2]) return json(200, { done: job.done, error: job.error || undefined, seconds: Math.round((Date.now() - job.at) / 1000) });
      if (!job.done || job.error || !existsSync(job.file)) return json(409, { error: job.error || 'Chưa xong.' });
      res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end(readFileSync(job.file));
      setTimeout(() => { rmSync(job.dir, { recursive: true, force: true }); videoJobs.delete(vm[1]); }, 10 * 60_000);
      return;
    }
    return json(404, { error: 'not found' });
  } catch (e) { return json(500, { error: String(e?.message || e) }); }
});
server.on('error', async (e) => {
  if (e?.code !== 'EADDRINUSE') throw e;
  // already running (another Terminal tab, or started earlier): say so instead of a stack trace
  const ok = await fetch(`http://localhost:${PORT}/health`).then((r) => r.json()).then((j) => j?.service === 'phloem-local-ai').catch(() => false);
  console.log(ok ? `AI trên máy ĐANG CHẠY sẵn ở http://localhost:${PORT}, không cần bật thêm. Mở Phloem là dùng được.` : `Cổng ${PORT} đang bị chương trình khác dùng. Chạy với cổng khác: PORT=8791 npm run ai-may`);
  process.exit(ok ? 0 : 1);
});
server.listen(PORT, '127.0.0.1', () => console.log(`Phloem local AI on http://localhost:${PORT}  image=${has('image')} voice=${has('tts') ? 'model' : hasSay ? 'macOS say' : 'none'} video=${has('video')}`));
