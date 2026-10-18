// Phloem Video: short vertical videos (Reels / TikTok / Shorts) cut from the client's real footage, the way viral videos are
// edited: a hook in the first 1.5 s, fast cuts, on-screen text on the beat, a clear CTA at the end. Clips stay in this browser
// (IndexedDB, never through the relay: video files would eat the hosting bandwidth); the edit itself is a client item
// ('video') so it syncs. AI shots come from Google Veo (cheapest model, through the relay) and land as clips.
import { askClaude, relayAuth, wakeRelay, type AiImage } from '../ai/client';
import { get } from '../store';
import { brandBookOf, styleNotesOf } from './kit';
import { audienceLine, channelOf, type Client, type PlanRow } from './types';
import { MUSIC, Mixer, SFX, creditOf, musicBuffer, sfxBuffer, webBuffer, defaultAudio, type MusicId, type SfxId, type VAudio, type WebAudio } from './audio';

export interface VClip { id: string; name: string; dur: number; w: number; h: number; thumb: string; src: 'upload' | 'ai' }
export type VTextStyle = 'hook' | 'box' | 'body' | 'cta' | 'none';
export type VFx = 'none' | 'punch' | 'flash';
export const TEXT_STYLES: { id: VTextStyle; label: string }[] = [{ id: 'hook', label: 'Hook nền màu' }, { id: 'box', label: 'TikTok nền trắng' }, { id: 'body', label: 'Chữ viền' }, { id: 'cta', label: 'Nút CTA' }, { id: 'none', label: 'Không chữ' }];
export const FX: { id: VFx; label: string }[] = [{ id: 'none', label: 'Cắt thẳng' }, { id: 'punch', label: 'Giật zoom' }, { id: 'flash', label: 'Loé sáng' }];
export interface VSeg { id: string; clip: string; from: number; to: number; text: string; style: VTextStyle; pos: 'top' | 'middle' | 'bottom'; zoom: number; fx?: VFx; sfx?: SfxId; sfxWeb?: WebAudio | null }
export interface VideoDoc {
  title: string; w: number; h: number;
  clips: VClip[]; segs: VSeg[];
  reference: string;               // the viral video the edit follows (link + what makes it work), free text
  font: string; colors: { primary: string; accent: string; ink: string };
  rowRef?: { planId: string; rowId: string } | null;
  thumb?: string;
  progressBar?: boolean;
  audio?: VAudio;
  template?: string;           // the thin retention bar along the top, as on many viral edits
}

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
export const blankVideo = (client: Client, row?: (PlanRow & { planId: string }) | null): VideoDoc => {
  const book = brandBookOf(client.id);
  const pal = book?.palette || [];
  const by = (r: string) => pal.find((c) => c.role === r)?.hex;
  return { title: row?.topic || 'Video mới', w: 1080, h: 1920, clips: [], segs: [], reference: '', font: book?.fonts.heading || 'Be Vietnam Pro', colors: { primary: by('primary') || '#1F6FEB', accent: by('accent') || '#FFC83D', ink: '#111111' }, rowRef: row ? { planId: row.planId, rowId: row.id } : null };
};
export const audioOf = (v: VideoDoc): VAudio => v.audio || defaultAudio();
/** Credit lines for the CC BY sounds this edit uses (paste into the caption). */
export function creditsOf(v: VideoDoc): string[] {
  const a = audioOf(v); const out = new Set<string>();
  if (a.music?.kind === 'web' && a.music.track.license === 'by') out.add(creditOf(a.music.track));
  for (const s of v.segs) if (s.sfxWeb && s.sfxWeb.license === 'by') out.add(creditOf(s.sfxWeb));
  return [...out];
}

/** Edit templates: one tap restyles every shot (text look, cut effects, sound effects, music) without re-cutting. */
export interface VTemplate { id: string; label: string; note: string; music: MusicId; bar: boolean; style: (i: number, n: number) => { style: VTextStyle; pos: VSeg['pos'] }; fx: (i: number, n: number) => VFx; sfx: (i: number, n: number, seg: VSeg) => SfxId; zoom: number }
const ends = (i: number, n: number) => (i === 0 ? 'first' : i === n - 1 ? 'last' : 'mid');
export const TEMPLATES: VTemplate[] = [
  { id: 'viral', label: 'Viral TikTok', note: 'Hook nền màu, chữ TikTok trắng, giật zoom + whoosh mỗi cú cắt, nhạc trap, thanh tiến trình', music: 'trap', bar: true, zoom: 1.08,
    style: (i, n) => ({ first: { style: 'hook' as const, pos: 'middle' as const }, last: { style: 'cta' as const, pos: 'bottom' as const }, mid: { style: 'box' as const, pos: 'top' as const } })[ends(i, n)],
    fx: (i) => (i === 0 || i % 3 === 0 ? 'punch' : 'none'), sfx: (i, n) => (i === 0 ? 'boom' : i === n - 1 ? 'ding' : 'whoosh') },
  { id: 'sale', label: 'Flash sale', note: 'Năng lượng cao, chữ màu thương hiệu, ka-ching ở CTA, nhạc pop', music: 'upbeat', bar: true, zoom: 1.1,
    style: (i, n) => ({ first: { style: 'hook' as const, pos: 'middle' as const }, last: { style: 'cta' as const, pos: 'middle' as const }, mid: { style: 'hook' as const, pos: 'top' as const } })[ends(i, n)],
    fx: (i, n) => (i === n - 1 ? 'flash' : 'punch'), sfx: (i, n) => (i === 0 ? 'notify' : i === n - 1 ? 'cash' : 'swipe') },
  { id: 'phonk', label: 'Phonk ngầu', note: 'Cắt gắt theo nhịp, loé sáng, glitch, chữ viền, nhạc phonk', music: 'funk', bar: false, zoom: 1.15,
    style: (i, n) => ({ first: { style: 'body' as const, pos: 'middle' as const }, last: { style: 'cta' as const, pos: 'bottom' as const }, mid: { style: 'body' as const, pos: 'middle' as const } })[ends(i, n)],
    fx: (i) => (i % 2 ? 'flash' : 'punch'), sfx: (i, n) => (i === n - 1 ? 'drop' : i % 2 ? 'glitch' : 'whoosh') },
  { id: 'story', label: 'Kể chuyện', note: 'Phụ đề dưới, zoom chậm, riser trước cảnh cuối, boom ở CTA, nhạc cinematic', music: 'cinematic', bar: false, zoom: 1.12,
    style: (i, n) => ({ first: { style: 'hook' as const, pos: 'middle' as const }, last: { style: 'cta' as const, pos: 'bottom' as const }, mid: { style: 'body' as const, pos: 'bottom' as const } })[ends(i, n)],
    fx: () => 'none', sfx: (i, n) => (i === n - 2 ? 'riser' : i === n - 1 ? 'boom' : 'none') },
  { id: 'vlog', label: 'Vlog đời thường', note: 'Chữ TikTok trên cùng, zoom nhẹ, tiếng chụp ảnh, nhạc lo-fi', music: 'lofi', bar: false, zoom: 1.06,
    style: (i, n) => ({ first: { style: 'box' as const, pos: 'top' as const }, last: { style: 'cta' as const, pos: 'bottom' as const }, mid: { style: 'box' as const, pos: 'top' as const } })[ends(i, n)],
    fx: () => 'none', sfx: (i, n) => (i === 0 ? 'camera' : i === n - 1 ? 'ding' : 'none') },
  { id: 'clean', label: 'Sạch & sang', note: 'Ít hiệu ứng, chữ viền dưới, pop nhẹ khi hiện chữ, nhạc pluck', music: 'chill', bar: false, zoom: 1.05,
    style: (i, n) => ({ first: { style: 'body' as const, pos: 'middle' as const }, last: { style: 'cta' as const, pos: 'bottom' as const }, mid: { style: 'body' as const, pos: 'bottom' as const } })[ends(i, n)],
    fx: () => 'none', sfx: (_i, _n, s) => (s.text.trim() ? 'pop' : 'none') },
];
export function applyTemplate(v: VideoDoc, id: string): VideoDoc {
  const tp = TEMPLATES.find((x) => x.id === id); if (!tp) return v;
  const n = v.segs.length; const a = audioOf(v);
  return { ...v, template: id, progressBar: tp.bar, audio: { ...a, music: a.music?.kind === 'file' ? a.music : { kind: 'synth', id: tp.music } },
    segs: v.segs.map((s, i) => ({ ...s, ...(s.style === 'none' && !s.text.trim() ? {} : tp.style(i, n)), fx: tp.fx(i, n), sfx: tp.sfx(i, n, s), zoom: tp.zoom })) };
}

export const videoTotal = (v: VideoDoc) => v.segs.reduce((a, s) => a + Math.max(0, s.to - s.from), 0);

// ---------- clips (this browser only) ----------
const urls = new Map<string, string>();
async function idb() { return (await import('../storage/idb')).db; }
export async function clipUrl(id: string): Promise<string | null> {
  if (urls.has(id)) return urls.get(id)!;
  const b = await (await idb()).getBlob(`vclip:${id}`); if (!b) return null;
  const u = URL.createObjectURL(b); urls.set(id, u); return u;
}
function loadMeta(url: string): Promise<{ dur: number; w: number; h: number; thumb: string }> {
  return new Promise((ok, bad) => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url; v.playsInline = true;
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, v.duration / 3); };
    v.onseeked = () => {
      const k = 240 / Math.max(v.videoWidth, v.videoHeight); const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      ok({ dur: v.duration, w: v.videoWidth, h: v.videoHeight, thumb: c.toDataURL('image/jpeg', 0.7) });
    };
    v.onerror = () => bad(new Error('Không đọc được video này (thử MP4 / MOV H.264).'));
  });
}
export async function addClip(blob: Blob, name: string, src: VClip['src'] = 'upload'): Promise<VClip> {
  const id = uid('vc');
  await (await idb()).putBlob(`vclip:${id}`, blob);
  const u = URL.createObjectURL(blob); urls.set(id, u);
  const m = await loadMeta(u);
  return { id, name, src, ...m };
}
/** Still frames of a clip for the AI to look at. */
async function frames(clip: VClip, n: number): Promise<AiImage[]> {
  const u = await clipUrl(clip.id); if (!u) return [];
  const v = document.createElement('video'); v.muted = true; v.src = u; v.playsInline = true;
  await new Promise((r) => { v.onloadeddata = r; v.onerror = r; });
  const out: AiImage[] = [];
  for (let i = 0; i < n; i++) {
    const t = (clip.dur * (i + 0.5)) / n;
    await new Promise((r) => { v.onseeked = r; v.currentTime = t; });
    const k = 320 / Math.max(v.videoWidth, v.videoHeight); const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    out.push({ name: `${clip.id}-${i}.jpg`, mime: 'image/jpeg', base64: c.toDataURL('image/jpeg', 0.75).split(',')[1] });
  }
  return out;
}

// ---------- AI: the edit plan ----------
const EDITOR = `You are a short-form video editor whose Reels/TikToks regularly pass a million views. You get the post brief, the brand, the client's raw clips (a few still frames each, with durations) and, optionally, a viral reference video described by the user.
Cut an edit in that proven style:
- HOOK in the first 1–1.5 s: the most striking moment + a bold on-screen hook line (a question, a surprising claim, a "POV:", a number).
- Fast pacing: most shots 0.8–2.5 s; a pattern interrupt (new angle, close-up, motion) every 2–3 s; never the same shot twice in a row.
- On-screen text carries the story without sound: short lines (max 7 words), one idea per shot, in the post's language.
- Payoff, then a clear CTA in the last 2–3 s.
- Total 12–35 s. Use only footage that exists: each segment is a [from, to] window inside one clip's duration. A clip may be used several times (different windows).
- If a reference is given, copy its structure, rhythm and text style, not its content.
Also pick background music (${MUSIC.map((m) => `${m.id} = ${m.mood}`).join('; ')}) and a sound effect on the cut into each shot (${SFX.map((x) => x.id).join(', ')}, or none; whoosh/swipe on fast cuts, pop on text, boom/drop on the hook or reveal, ding/cash on the CTA; not on every shot).
Reply with JSON only: {"title":"…","music":"<music id>","segs":[{"clip":"<clip id>","from":0.0,"to":1.4,"text":"…","style":"hook|box|body|cta|none","pos":"top|middle|bottom","zoom":1.0,"fx":"none|punch|flash","sfx":"whoosh"}]}
(style: hook = bold line on a brand-colour band, box = TikTok-native white box, body = white text with outline, cta = brand button. zoom 1.0–1.25 = slow push-in. fx on the cut into the shot: punch = quick zoom jolt on a beat, flash = white flash for a reveal; use them sparingly, mostly "none".)`;

export async function aiEditPlan(client: Client, row: PlanRow | null, v: VideoDoc, onStage: (m: string) => void): Promise<{ segs: VSeg[]; music?: MusicId }> {
  if (!v.clips.length) throw new Error('Thả ít nhất 1 clip footage trước.');
  onStage('AI đang xem footage…');
  const per = Math.max(1, Math.min(4, Math.floor(20 / v.clips.length)));
  const images: AiImage[] = []; const lines: string[] = [];
  for (const c of v.clips.slice(0, 12)) {
    const f = await frames(c, per); images.push(...f);
    lines.push(`- ${c.id}: "${c.name}", ${c.dur.toFixed(1)} s, ${c.w}×${c.h}${c.src === 'ai' ? ' (AI-generated shot)' : ''}; frames #${images.length - f.length + 1}–${images.length}`);
  }
  const book = brandBookOf(client.id);
  const brief = [
    `Brand: ${client.name}${client.industry ? ` (${client.industry})` : ''}. ${audienceLine(client)}`,
    book ? `Voice: ${book.voice.traits.join(', ')}. Tagline: "${book.tagline}".` : '',
    styleNotesOf(client.id) ? `House style: ${styleNotesOf(client.id)}` : '',
    row ? `Post (${channelOf(row.channel).label} ${row.format}, ${row.date}): topic "${row.topic}". Hook: ${row.hook}. Caption: ${(row.caption || '').slice(0, 500)}. CTA: ${row.cta}.` : `Video: ${v.title}`,
    v.reference.trim() ? `VIRAL REFERENCE to follow (from the user): ${v.reference.trim().slice(0, 1500)}` : '',
    `CLIPS (attached frames in this order):\n${lines.join('\n')}`,
  ].filter(Boolean).join('\n');
  onStage('AI đang dựng kịch bản cắt theo công thức viral…');
  const out = await askClaude({ system: EDITOR, turns: [{ role: 'user', text: brief, images }], maxTokens: 4000, effort: 'medium' });
  const j = JSON.parse((/\{[\s\S]*\}/.exec(out) || ['{}'])[0]) as { segs?: Partial<VSeg>[]; music?: string };
  const sfxIds = SFX.map((x) => x.id) as string[];
  const byId = new Map(v.clips.map((c) => [c.id, c]));
  const segs: VSeg[] = [];
  const styles = TEXT_STYLES.map((x) => x.id), fxs = FX.map((x) => x.id);
  for (const s of j.segs || []) {
    const c = byId.get(String(s.clip)); if (!c) continue;
    const from = Math.max(0, Math.min(c.dur - 0.3, Number(s.from) || 0)), to = Math.max(from + 0.3, Math.min(c.dur, Number(s.to) || from + 1.5));
    segs.push({ id: uid('sg'), clip: c.id, from, to, text: String(s.text || '').slice(0, 80), style: styles.includes(s.style as VTextStyle) ? (s.style as VTextStyle) : 'body', fx: fxs.includes(s.fx as VFx) ? (s.fx as VFx) : 'none', sfx: sfxIds.includes(String(s.sfx)) ? (s.sfx as SfxId) : 'none', pos: (['top', 'middle', 'bottom'] as const).includes(s.pos as VSeg['pos']) ? (s.pos as VSeg['pos']) : 'middle', zoom: Math.max(1, Math.min(1.3, Number(s.zoom) || 1)) });
  }
  if (!segs.length) throw new Error('AI chưa dựng được kịch bản, thử lại.');
  const music = MUSIC.find((m) => m.id === j.music)?.id;
  return { segs, music };
}

// ---------- drawing (shared by the preview and the export) ----------
/** One frame: the segment's video (cover, slow push-in) and its on-screen text in the brand's look. `p` = 0..1 within the segment. */
export function drawFrame(ctx: CanvasRenderingContext2D, v: VideoDoc, seg: VSeg | null, el: HTMLVideoElement | null, p: number, at = 0) {
  const W = v.w, H = v.h;
  const secs = seg ? p * (seg.to - seg.from) : 0; // time into the shot
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (el && el.videoWidth) {
    const punch = seg?.fx === 'punch' && secs < 0.22 ? 0.12 * (1 - secs / 0.22) : 0;
    const z = 1 + (seg ? (seg.zoom - 1) * p : 0) + punch;
    const k = Math.max(W / el.videoWidth, H / el.videoHeight) * z;
    const dw = el.videoWidth * k, dh = el.videoHeight * k;
    ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  if (seg?.fx === 'flash' && secs < 0.25) { ctx.fillStyle = `rgba(255,255,255,${(1 - secs / 0.25) * 0.9})`; ctx.fillRect(0, 0, W, H); }
  const dur = videoTotal(v);
  if (v.progressBar && dur) { ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(0, 0, W, 12); ctx.fillStyle = v.colors.accent; ctx.fillRect(0, 0, W * Math.min(1, at / dur), 12); }
  if (!seg || !seg.text.trim() || seg.style === 'none') return;
  const pop = Math.min(1, p * (seg.to - seg.from) / 0.18); // text pops in over ~0.18 s
  const size = seg.style === 'hook' ? 92 : seg.style === 'cta' ? 72 : seg.style === 'box' ? 66 : 64;
  ctx.save();
  ctx.font = `800 ${size}px "${v.font}", "Be Vietnam Pro", Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // wrap to the frame
  const words = seg.text.split(/\s+/); const lines: string[] = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > W * 0.84 && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  const lh = size * 1.15, total = lines.length * lh;
  const cy = seg.pos === 'top' ? H * 0.2 : seg.pos === 'bottom' ? H * 0.74 : H * 0.5;
  ctx.translate(W / 2, cy); ctx.scale(0.85 + 0.15 * pop, 0.85 + 0.15 * pop); ctx.globalAlpha = pop;
  lines.forEach((ln, i) => {
    const y = -total / 2 + lh * (i + 0.5);
    const tw = ctx.measureText(ln).width;
    if (seg.style === 'hook' || seg.style === 'cta' || seg.style === 'box') {
      ctx.fillStyle = seg.style === 'cta' ? v.colors.primary : seg.style === 'box' ? '#FFFFFF' : v.colors.accent;
      const pad = size * 0.28; const r = seg.style === 'cta' ? lh / 2 : size * 0.22;
      if (seg.style === 'cta') { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8; }
      ctx.beginPath(); ctx.roundRect(-tw / 2 - pad * (seg.style === 'cta' ? 1.8 : 1), y - lh / 2, tw + pad * (seg.style === 'cta' ? 3.6 : 2), lh, r); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = seg.style === 'cta' ? '#FFFFFF' : seg.style === 'box' ? '#111111' : v.colors.ink; ctx.fillText(ln, 0, y + size * 0.03);
    } else {
      ctx.lineWidth = size * 0.16; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(ln, 0, y);
      ctx.fillStyle = '#FFFFFF'; ctx.fillText(ln, 0, y);
    }
  });
  ctx.restore();
}

/** Where the timeline is at `t` seconds: the segment, its index and the progress within it. */
export function segAt(v: VideoDoc, t: number): { seg: VSeg | null; i: number; local: number } {
  let acc = 0;
  for (let i = 0; i < v.segs.length; i++) { const d = v.segs[i].to - v.segs[i].from; if (t < acc + d) return { seg: v.segs[i], i, local: t - acc }; acc += d; }
  return { seg: null, i: -1, local: 0 };
}

/** Next frame, or a timer when animation frames are not coming (hidden or covered page): the export must keep going. */
export const nextFrame = (f: () => void) => { let done = false; const go = () => { if (!done) { done = true; f(); } }; requestAnimationFrame(go); setTimeout(go, 40); };

// ---------- export: real-time render of the timeline to an MP4 (or WebM) file ----------
export async function exportVideo(v: VideoDoc, onProgress: (p: number) => void, signal?: AbortSignal): Promise<Blob> {
  if (!v.segs.length) throw new Error('Chưa có đoạn nào trên timeline.');
  const canvas = document.createElement('canvas'); canvas.width = v.w; canvas.height = v.h;
  const ctx = canvas.getContext('2d')!;
  await document.fonts.load(`800 64px "${v.font}"`).catch(() => null);
  const els = new Map<string, HTMLVideoElement>();
  for (const id of new Set(v.segs.map((s) => s.clip))) {
    const u = await clipUrl(id); if (!u) throw new Error('Thiếu file clip trên máy này (clip chỉ có trên máy đã tải lên).');
    const el = document.createElement('video'); el.src = u; el.playsInline = true; el.crossOrigin = 'anonymous'; el.preload = 'auto';
    await new Promise((r) => { el.onloadeddata = r; el.onerror = r; });
    els.set(id, el);
  }
  const ac = new AudioContext(); const dest = ac.createMediaStreamDestination();
  const mix = new Mixer(ac, dest);
  for (const el of els.values()) mix.clip(el);
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const type = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = []; rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((r) => { rec.onstop = () => r(); });
  // everything that takes time happens before recording starts: music rendered, effects loaded, first frames decoded
  onProgress(0); await musicBuffer(audioOf(v).music);
  await Promise.all(v.segs.map((s) => (s.sfxWeb ? webBuffer(s.sfxWeb) : s.sfx && s.sfx !== 'none' ? sfxBuffer(s.sfx) : null)));
  rec.start(500);
  const total = videoTotal(v);
  await mix.start(audioOf(v), 0, total);
  try {
    for (let i = 0; i < v.segs.length; i++) {
      if (signal?.aborted) throw new Error('Đã huỷ.');
      const s = v.segs[i]; const el = els.get(s.clip)!;
      if (i > 0) rec.pause(); // seeking to the next shot is not part of the video
      el.currentTime = s.from; await new Promise((r) => { el.onseeked = r; });
      if (rec.state === 'paused') rec.resume();
      await el.play().catch(() => null);
      void mix.sfx(s.sfx, s.sfxWeb);
      const before = v.segs.slice(0, i).reduce((a, x) => a + (x.to - x.from), 0);
      await new Promise<void>((r) => {
        const tick = () => {
          const p = Math.min(1, (el.currentTime - s.from) / (s.to - s.from));
          drawFrame(ctx, v, s, el, p, before + p * (s.to - s.from)); onProgress((before + p * (s.to - s.from)) / total);
          if (el.currentTime >= s.to || el.ended || signal?.aborted) { el.pause(); r(); } else nextFrame(tick);
        };
        nextFrame(tick);
      });
    }
  } finally { mix.stop(); rec.stop(); await done; void ac.close(); }
  return new Blob(chunks, { type: (type.split(';')[0] || 'video/webm') });
}

// ---------- AI shots: Google Veo through the relay (cheapest model, ~0.05 USD a second at 720p) ----------
export async function veoShot(prompt: string, seconds: 4 | 6 | 8, onStage: (m: string) => void, signal?: AbortSignal): Promise<Blob> {
  const base = (get().settings.relayUrl || '').replace(/\/$/, '');
  await wakeRelay(base, relayAuth());
  const r = await fetch(`${base}/ai/video`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...relayAuth() }, body: JSON.stringify({ prompt, aspect: '9:16', seconds }), signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Tạo video lỗi (HTTP ${r.status}).`);
  const t0 = Date.now();
  for (;;) {
    if (signal?.aborted) throw new Error('Đã huỷ.');
    onStage(`Google ${j.model} đang dựng cảnh ${seconds} s… ${Math.round((Date.now() - t0) / 1000)} s`);
    await new Promise((res) => setTimeout(res, 8000));
    const pr = await fetch(`${base}/ai/video/op?name=${encodeURIComponent(j.op)}`, { headers: relayAuth(), signal });
    const pj = await pr.json().catch(() => ({}));
    if (!pr.ok) throw new Error(pj.error || `HTTP ${pr.status}`);
    if (pj.done) {
      if (pj.error) throw new Error(pj.error);
      onStage('Đang tải cảnh về…');
      const fr = await fetch(`${base}/ai/video/file?uri=${encodeURIComponent(pj.uri)}`, { headers: relayAuth(), signal });
      if (!fr.ok) throw new Error(`Không tải được video (HTTP ${fr.status}).`);
      return await fr.blob();
    }
    if (Date.now() - t0 > 6 * 60_000) throw new Error('Google dựng quá lâu (hơn 6 phút). Thử lại sau.');
  }
}

// ---------- AI makes the whole video for a post: scene prompts, Veo shots, an edit with text, music and sound ----------
const SHOT = 'Vertical 9:16 short-form social video shot, cinematic, natural light, smooth camera motion, shallow depth of field, no text, no captions, no logos on screen.';
/** Scene prompts for a post: Claude writes them when it can; otherwise they are built from the post itself. */
async function scenePrompts(client: Client, row: PlanRow, n: number, onStage: (m: string) => void): Promise<string[]> {
  onStage('AI đang viết kịch bản cảnh…');
  try {
    const out = await askClaude({ system: `You write prompts for Google Veo (text-to-video). Each prompt describes ONE ${'continuous'} shot: subject, action, setting, camera move, light, mood. English, 40–70 words, no on-screen text, nothing copyrighted. Shot 1 is the scroll-stopping hook, the last shot supports the call to action. Reply with JSON only: {"shots":["…"]}`, turns: [{ role: 'user', text: `Brand: ${client.name}${client.industry ? ` (${client.industry})` : ''}. ${audienceLine(client)}\nPost: ${row.topic}. Hook: ${row.hook}. Visual idea: ${row.visual}. Caption: ${(row.caption || '').slice(0, 400)}. CTA: ${row.cta}.\nWrite ${n} shots.` }], maxTokens: 1500, effort: 'low' });
    const j = JSON.parse((/\{[\s\S]*\}/.exec(out) || ['{}'])[0]) as { shots?: string[] };
    const s = (j.shots || []).map(String).filter(Boolean).slice(0, n);
    if (s.length === n) return s.map((x) => `${x} ${SHOT}`);
  } catch { /* Claude unavailable (e.g. out of credit): build them from the post */ }
  const idea = (row.visual || row.topic || client.name).slice(0, 300);
  return [
    `${idea}. Opening hook shot, striking composition, quick push-in. ${SHOT}`,
    `Close-up details related to: ${row.topic}. Hands and textures, gentle slow motion. ${SHOT}`,
    `People enjoying ${row.topic}${client.industry ? ` (${client.industry})` : ''}, warm happy mood, wide shot ending on a calm frame with empty space. ${SHOT}`,
  ].slice(0, n);
}
/** Short on-screen lines from the post: hook, a few body beats from the caption, the CTA. */
function lines(row: PlanRow, n: number): string[] {
  const words = (t: string, k: number) => t.split(/\s+/).filter(Boolean).slice(0, k).join(' ');
  const body = (row.caption || '').replace(/#[^\s]+/g, '').split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 3).map((x) => words(x, 7));
  const out = [words(row.hook || row.topic, 8)];
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const seen = norm(row.hook || row.topic);
  // captions often open with the hook itself: skip lines the hook already says
  const fresh = body.filter((x) => { const k = norm(x); return k && !seen.includes(k) && !k.includes(seen); });
  for (let i = 0; out.length < n - 1; i++) out.push(fresh[i] || '');
  out.push(words(row.cta || 'Theo dõi để xem thêm', 6));
  return out;
}
export async function autoVideo(client: Client, row: PlanRow & { planId: string }, opts: { scenes: number; seconds: 4 | 6 | 8; template?: string; onStage: (m: string) => void; signal?: AbortSignal; base?: VideoDoc | null }): Promise<VideoDoc> {
  const prompts = await scenePrompts(client, row, opts.scenes, opts.onStage);
  const clips: VClip[] = [];
  for (const [i, p] of prompts.entries()) {
    if (opts.signal?.aborted) throw new Error('Đã huỷ.');
    const b = await veoShot(p, opts.seconds, (m) => opts.onStage(`Cảnh ${i + 1}/${prompts.length} · ${m}`), opts.signal);
    clips.push(await addClip(b, `AI · cảnh ${i + 1}`, 'ai'));
  }
  opts.onStage('Đang dựng video…');
  const segs: VSeg[] = [];
  const per = 2; // each shot cut in two beats
  const text = lines(row, clips.length * per);
  clips.forEach((c, i) => { const h = c.dur / per; for (let k = 0; k < per; k++) segs.push({ id: uid('sg'), clip: c.id, from: k * h, to: Math.min(c.dur, (k + 1) * h), text: text[i * per + k] || '', style: 'body', pos: 'middle', zoom: 1, fx: 'none', sfx: 'none' }); });
  const base = opts.base || blankVideo(client, row);
  return applyTemplate({ ...base, clips: [...base.clips, ...clips], segs }, opts.template || base.template || 'viral');
}
