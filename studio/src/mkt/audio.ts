// Sound for Phloem Video: background music and sound effects, all synthesized in the browser (Web Audio), so every track is
// original, free to publish and needs no download or licence. The user can also bring their own music file (kept in this
// browser like the clips). One Mixer plays the timeline's sound in the preview and, pointed at a MediaStream, in the export.

export type SfxId = 'none' | 'whoosh' | 'swoosh' | 'pop' | 'click' | 'ding' | 'notify' | 'cash' | 'camera' | 'boom' | 'drop' | 'riser' | 'glitch' | 'swipe';
export const SFX: { id: SfxId; label: string; emoji: string }[] = [
  { id: 'whoosh', label: 'Whoosh', emoji: '💨' }, { id: 'swoosh', label: 'Lướt ngược', emoji: '🌀' }, { id: 'swipe', label: 'Vuốt', emoji: '👆' },
  { id: 'pop', label: 'Pop chữ', emoji: '🫧' }, { id: 'click', label: 'Click', emoji: '🖱️' }, { id: 'ding', label: 'Ding', emoji: '🔔' },
  { id: 'notify', label: 'Thông báo', emoji: '📱' }, { id: 'cash', label: 'Ka-ching', emoji: '💰' }, { id: 'camera', label: 'Chụp ảnh', emoji: '📸' },
  { id: 'boom', label: 'Boom', emoji: '💥' }, { id: 'drop', label: 'Bass drop', emoji: '🔊' }, { id: 'riser', label: 'Riser', emoji: '📈' }, { id: 'glitch', label: 'Glitch', emoji: '⚡' },
];
export type MusicId = 'upbeat' | 'lofi' | 'trap' | 'cinematic' | 'chill' | 'funk';
export const MUSIC: { id: MusicId; label: string; mood: string; bpm: number }[] = [
  { id: 'upbeat', label: 'Upbeat Pop', mood: 'Vui, năng lượng · review, khuyến mãi', bpm: 120 },
  { id: 'trap', label: 'TikTok Trap', mood: 'Bắt tai, 808 nặng · trend, biến hình', bpm: 140 },
  { id: 'funk', label: 'Phonk / Funk', mood: 'Ngầu, nhịp nảy · thời trang, xe, gym', bpm: 128 },
  { id: 'lofi', label: 'Lo-fi', mood: 'Thư giãn · cà phê, đời thường, vlog', bpm: 80 },
  { id: 'chill', label: 'Chill Pluck', mood: 'Nhẹ nhàng, sạch · sản phẩm, hướng dẫn', bpm: 100 },
  { id: 'cinematic', label: 'Cinematic', mood: 'Hùng tráng · kể chuyện, ra mắt', bpm: 90 },
];
/** A track from the free library (Openverse: Jamendo, Freesound, Wikimedia; CC0, public domain or CC BY, all usable commercially). */
export interface WebAudio { id: string; title: string; url: string; creator: string; license: string; source: string; landing: string; dur: number }
export interface VAudio { music: { kind: 'synth'; id: MusicId } | { kind: 'file'; id: string; name: string } | { kind: 'web'; id: string; name: string; track: WebAudio } | null; musicVol: number; clipVol: number; sfxVol: number }
export const MUSIC_TAGS = ['vui tươi', 'chill', 'lofi', 'epic', 'hip hop', 'EDM', 'piano', 'acoustic', 'corporate', 'jazz', 'funk', 'cinematic', 'ambient', 'summer', 'happy', 'phonk'];
export const SFX_TAGS = ['whoosh', 'swoosh', 'pop', 'click', 'transition', 'notification', 'cash register', 'camera shutter', 'applause', 'laugh', 'boom', 'glitch', 'ding', 'typing', 'swipe', 'magic', 'coffee', 'door', 'crowd'];
const VI: Record<string, string> = { 'vui tươi': 'upbeat happy', chill: 'chill', lofi: 'lofi', epic: 'epic', piano: 'piano', acoustic: 'acoustic guitar', corporate: 'corporate', cinematic: 'cinematic' };
/** Search free music or sound effects. */
export async function searchAudio(q: string, kind: 'music' | 'sfx', page = 1): Promise<WebAudio[]> {
  const u = new URL('https://api.openverse.org/v1/audio/');
  u.searchParams.set('q', VI[q] || q); u.searchParams.set('license', 'cc0,pdm,by'); u.searchParams.set('page_size', '20'); u.searchParams.set('page', String(page));
  // Freesound (the sound-effect source) leaves the category empty, so effects are searched there by length instead
  if (kind === 'music') u.searchParams.set('category', 'music'); else { u.searchParams.set('source', 'freesound'); u.searchParams.set('length', 'short'); }
  const r = await fetch(u); if (!r.ok) throw new Error(`Thư viện âm thanh lỗi (HTTP ${r.status}).`);
  const j = await r.json() as { results: { id: string; title: string; url: string; creator?: string; license: string; source: string; foreign_landing_url: string; duration?: number }[] };
  return j.results.filter((x) => x.url).map((x) => ({ id: x.id, title: (x.title || 'Không tên').replace(/\.(mp3|wav|ogg|flac)$/i, ''), url: x.url, creator: x.creator || '', license: x.license, source: x.source, landing: x.foreign_landing_url, dur: (x.duration || 0) / 1000 }));
}
export function webBuffer(t: WebAudio): Promise<AudioBuffer | null> {
  const k = `web:${t.id}`;
  if (!bufs.has(k)) bufs.set(k, (async () => { const r = await fetch(t.url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return new AudioContext().decodeAudioData(await r.arrayBuffer()); })().catch(() => { bufs.delete(k); return null; }));
  return bufs.get(k)!;
}
/** The credit line CC BY asks for. */
export const creditOf = (t: WebAudio) => `"${t.title}"${t.creator ? ` - ${t.creator}` : ''} (${t.source}, ${t.license === 'cc0' || t.license === 'pdm' ? 'CC0' : `CC ${t.license.toUpperCase()}`})`;
export const defaultAudio = (): VAudio => ({ music: { kind: 'synth', id: 'upbeat' }, musicVol: 0.55, clipVol: 0.8, sfxVol: 0.8 });

const SR = 44100;
const noise = (c: BaseAudioContext, sec: number) => { const b = c.createBuffer(1, Math.ceil(sec * SR), SR); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
const env = (c: BaseAudioContext, t: number, a: number, peak: number, d: number, out: AudioNode) => { const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + Math.max(0.002, a)); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); g.connect(out); return g; };
function osc(c: BaseAudioContext, type: OscillatorType, f0: number, f1: number | null, t: number, a: number, peak: number, d: number, out: AudioNode, detune = 0) {
  const o = c.createOscillator(); o.type = type; o.detune.value = detune; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + a + d * 0.6);
  o.connect(env(c, t, a, peak, d, out)); o.start(t); o.stop(t + a + d + 0.05);
}
function noiseHit(c: BaseAudioContext, t: number, type: BiquadFilterType, f: number, peak: number, d: number, out: AudioNode, f1?: number, a = 0.002) {
  const s = c.createBufferSource(); s.buffer = noise(c, a + d + 0.1); const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + a + d); fl.Q.value = type === 'bandpass' ? 1.2 : 0.7;
  s.connect(fl); fl.connect(env(c, t, a, peak, d, out)); s.start(t); s.stop(t + a + d + 0.1);
}
const kick = (c: BaseAudioContext, t: number, o: AudioNode, v = 1) => osc(c, 'sine', 160, 42, t, 0.003, 0.95 * v, 0.38, o);
const k808 = (c: BaseAudioContext, t: number, o: AudioNode, f = 55, len = 0.9) => { osc(c, 'sine', f * 2.2, f, t, 0.003, 0.9, len, o); osc(c, 'triangle', f * 2, f, t, 0.003, 0.25, len * 0.7, o); };
const snare = (c: BaseAudioContext, t: number, o: AudioNode, v = 1) => { noiseHit(c, t, 'highpass', 1400, 0.5 * v, 0.17, o); osc(c, 'triangle', 220, 160, t, 0.002, 0.3 * v, 0.09, o); };
const clap = (c: BaseAudioContext, t: number, o: AudioNode, v = 1) => { for (const k of [0, 0.011, 0.023]) noiseHit(c, t + k, 'bandpass', 1500, 0.45 * v, k === 0.023 ? 0.16 : 0.02, o); };
const hat = (c: BaseAudioContext, t: number, o: AudioNode, v = 1, open = false) => noiseHit(c, t, 'highpass', 7500, 0.16 * v, open ? 0.22 : 0.045, o);
const N = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
function bass(c: BaseAudioContext, t: number, m: number, len: number, o: AudioNode, v = 1) {
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 3; f.connect(o);
  osc(c, 'sawtooth', N(m), null, t, 0.005, 0.32 * v, len, f); osc(c, 'sine', N(m - 12), null, t, 0.005, 0.35 * v, len, o);
}
function pad(c: BaseAudioContext, t: number, notes: number[], len: number, o: AudioNode, v = 1, cutoff = 1500) {
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.connect(o);
  for (const m of notes) for (const dt of [-9, 9]) { const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = N(m); x.detune.value = dt; const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.045 * v, t + len * 0.25); g.gain.linearRampToValueAtTime(0.03 * v, t + len * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + len); x.connect(g); g.connect(f); x.start(t); x.stop(t + len + 0.05); }
}
const pluck = (c: BaseAudioContext, t: number, m: number, o: AudioNode, v = 1) => { osc(c, 'triangle', N(m), null, t, 0.003, 0.22 * v, 0.35, o); osc(c, 'sine', N(m + 12), null, t, 0.002, 0.08 * v, 0.2, o); };

/** Chord progressions as MIDI notes (root, then the chord tones). */
const PROG = {
  pop: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],   // Am F C G
  minor: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]],   // Am F G E
  lofi: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]], // Fmaj7 Em7 Dm7 Cmaj7
};

/** Eight bars of a style, rendered offline into a loopable buffer. */
async function renderMusic(id: MusicId): Promise<AudioBuffer> {
  const bpm = MUSIC.find((m) => m.id === id)!.bpm; const beat = 60 / bpm; const bars = 8; const len = bars * 4 * beat;
  const c = new OfflineAudioContext(2, Math.ceil(len * SR), SR);
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(c.destination);
  const o = c.createGain(); o.gain.value = 0.8; o.connect(comp);
  for (let b = 0; b < bars; b++) {
    const t0 = b * 4 * beat;
    if (id === 'upbeat') {
      const ch = PROG.pop[b % 4];
      for (let q = 0; q < 4; q++) { kick(c, t0 + q * beat, o); hat(c, t0 + q * beat + beat / 2, o, 1, q % 2 === 1); if (q % 2 === 1) clap(c, t0 + q * beat, o, 0.9); }
      for (let e = 0; e < 8; e++) bass(c, t0 + e * beat / 2, ch[0] - 12, beat / 2 * 0.8, o, e % 2 ? 0.7 : 1);
      pad(c, t0, ch.map((m) => m + 12), 4 * beat, o, 0.8, 2200);
      for (let s = 0; s < 8; s++) pluck(c, t0 + s * beat / 2, ch[s % 3] + 24, o, 0.6);
    } else if (id === 'trap') {
      const ch = PROG.minor[b % 4];
      k808(c, t0, o, N(ch[0] - 24), 1.2); k808(c, t0 + 2.5 * beat, o, N(ch[0] - 24), 0.8);
      clap(c, t0 + 2 * beat, o);
      for (let s = 0; s < 16; s++) hat(c, t0 + s * beat / 4, o, s % 4 === 0 ? 1 : 0.6);
      if (b % 2 === 1) for (let r = 0; r < 6; r++) hat(c, t0 + 3.5 * beat + r * beat / 12, o, 0.7);
      pad(c, t0, ch.map((m) => m + 12), 4 * beat, o, 0.6, 1400);
    } else if (id === 'funk') {
      const ch = PROG.minor[b % 4];
      for (let q = 0; q < 4; q++) { kick(c, t0 + q * beat, o, 1); if (q % 2 === 1) snare(c, t0 + q * beat, o, 0.9); }
      for (let s = 0; s < 8; s++) hat(c, t0 + s * beat / 2, o, 0.8);
      for (const [p, m] of [[0, 0], [0.75, 0], [1.5, 3], [2, 0], [2.75, 7], [3.5, 5]] as const) { const x = c.createOscillator(); x.type = 'square'; x.frequency.value = N(ch[0] + m); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; x.connect(f); f.connect(env(c, t0 + p * beat, 0.003, 0.12, 0.18, o)); x.start(t0 + p * beat); x.stop(t0 + p * beat + 0.25); }
      k808(c, t0, o, N(ch[0] - 24), 0.6);
    } else if (id === 'lofi') {
      const ch = PROG.lofi[b % 4]; const sw = beat * 0.08;
      kick(c, t0, o, 0.8); kick(c, t0 + 2.5 * beat, o, 0.7); snare(c, t0 + beat, o, 0.45); snare(c, t0 + 3 * beat, o, 0.45);
      for (let s = 0; s < 8; s++) hat(c, t0 + s * beat / 2 + (s % 2 ? sw : 0), o, 0.5);
      pad(c, t0, ch, 4 * beat, o, 1, 900);
      bass(c, t0, ch[0] - 12, 1.8 * beat, o, 0.6); bass(c, t0 + 2.5 * beat, ch[0] - 12, 1.2 * beat, o, 0.5);
      noiseHit(c, t0, 'bandpass', 3000, 0.012, 4 * beat, o); // vinyl hiss
    } else if (id === 'chill') {
      const ch = PROG.pop[b % 4];
      kick(c, t0, o, 0.7); kick(c, t0 + 2 * beat, o, 0.6); clap(c, t0 + beat, o, 0.4); clap(c, t0 + 3 * beat, o, 0.4);
      for (let s = 0; s < 8; s++) pluck(c, t0 + s * beat / 2, [ch[0], ch[1], ch[2], ch[1] + 12][s % 4] + 12, o, 0.8);
      pad(c, t0, ch, 4 * beat, o, 0.6, 1200);
    } else {
      const ch = PROG.minor[b % 4];
      for (let e = 0; e < 8; e++) bass(c, t0 + e * beat / 2, ch[0] - 12, beat / 2 * 0.7, o, 0.6);
      if (b % 2 === 0) { osc(c, 'sine', 70, 30, t0, 0.01, 1, 2.2, o); noiseHit(c, t0, 'lowpass', 400, 0.5, 1.5, o); }
      pad(c, t0, [...ch, ch[0] + 12], 4 * beat, o, 1.2, 1800);
      if (b >= 4) for (let q = 0; q < 4; q++) snare(c, t0 + q * beat, o, 0.25);
    }
  }
  return c.startRendering();
}

async function renderSfx(id: SfxId): Promise<AudioBuffer> {
  const len = id === 'riser' ? 1.6 : id === 'boom' || id === 'drop' ? 1.6 : id === 'ding' || id === 'cash' ? 1 : 0.6;
  const c = new OfflineAudioContext(2, Math.ceil(len * SR), SR); const o = c.destination;
  switch (id) {
    case 'whoosh': noiseHit(c, 0, 'bandpass', 250, 0.9, 0.3, o, 3500, 0.15); break;
    case 'swoosh': noiseHit(c, 0, 'bandpass', 4000, 0.9, 0.3, o, 300, 0.12); break;
    case 'swipe': noiseHit(c, 0, 'highpass', 1500, 0.6, 0.12, o, 6000, 0.03); break;
    case 'pop': osc(c, 'sine', 380, 1000, 0, 0.002, 0.9, 0.07, o); break;
    case 'click': noiseHit(c, 0, 'highpass', 3000, 0.9, 0.012, o); osc(c, 'square', 1800, null, 0, 0.001, 0.15, 0.01, o); break;
    case 'ding': osc(c, 'sine', 1318, null, 0, 0.002, 0.5, 0.9, o); osc(c, 'sine', 2637, null, 0, 0.002, 0.18, 0.5, o); break;
    case 'notify': osc(c, 'sine', 880, null, 0, 0.003, 0.45, 0.15, o); osc(c, 'sine', 1318, null, 0.12, 0.003, 0.45, 0.3, o); break;
    case 'cash': noiseHit(c, 0, 'highpass', 4000, 0.6, 0.04, o); for (const [t, f] of [[0.05, 2637], [0.05, 3520], [0.18, 3136], [0.18, 4186]]) osc(c, 'sine', f, null, t, 0.002, 0.25, 0.7, o); break;
    case 'camera': noiseHit(c, 0, 'highpass', 2500, 0.9, 0.02, o); noiseHit(c, 0.07, 'bandpass', 1800, 0.6, 0.08, o); break;
    case 'boom': osc(c, 'sine', 90, 28, 0, 0.004, 1, 1.4, o); noiseHit(c, 0, 'lowpass', 300, 0.7, 0.9, o, 80); break;
    case 'drop': osc(c, 'sine', 120, 35, 0, 0.004, 1, 1.5, o); osc(c, 'sawtooth', 60, 30, 0, 0.004, 0.15, 1.2, o); break;
    case 'riser': noiseHit(c, 0, 'bandpass', 200, 0.7, 0.05, o, 7000, 1.45); osc(c, 'sawtooth', 150, 900, 0, 1.45, 0.12, 0.05, o); break;
    case 'glitch': for (let i = 0; i < 7; i++) osc(c, 'square', 200 + Math.random() * 1800, null, i * 0.035, 0.001, 0.25, 0.025, o); break;
    default: break;
  }
  return c.startRendering();
}

const bufs = new Map<string, Promise<AudioBuffer | null>>();
export function sfxBuffer(id: SfxId) { if (id === 'none') return Promise.resolve(null); const k = `sfx:${id}`; if (!bufs.has(k)) bufs.set(k, renderSfx(id)); return bufs.get(k)!; }
export function musicBuffer(m: VAudio['music']): Promise<AudioBuffer | null> {
  if (!m) return Promise.resolve(null);
  const k = `${m.kind}:${m.id}`;
  if (m.kind === 'web') return webBuffer(m.track);
  if (!bufs.has(k)) bufs.set(k, m.kind === 'synth' ? renderMusic(m.id) : (async () => {
    const b = await (await import('../storage/idb')).db.getBlob(`vmusic:${m.id}`); if (!b) return null;
    return new AudioContext().decodeAudioData(await b.arrayBuffer());
  })().catch(() => null));
  return bufs.get(k)!;
}
/** Keep the user's own music file in this browser (like the clips). */
export async function addMusicFile(f: File): Promise<{ kind: 'file'; id: string; name: string }> {
  const id = `m_${Math.random().toString(36).slice(2, 10)}`;
  const buf = await new AudioContext().decodeAudioData(await f.arrayBuffer()).catch(() => null);
  if (!buf) throw new Error('Không đọc được file nhạc (MP3, M4A, WAV).');
  await (await import('../storage/idb')).db.putBlob(`vmusic:${id}`, f);
  bufs.set(`file:${id}`, Promise.resolve(buf));
  return { kind: 'file', id, name: f.name.replace(/\.[^.]+$/, '') };
}

/** Plays a buffer once, for auditioning in the panel. */
let audition: AudioContext | null = null; let auditionSrc: AudioBufferSourceNode | null = null;
export async function preview(buf: Promise<AudioBuffer | null>, seconds = 8) {
  auditionSrc?.stop(); auditionSrc = null;
  const b = await buf; if (!b) return;
  audition ||= new AudioContext(); void audition.resume();
  const s = audition.createBufferSource(); s.buffer = b; const g = audition.createGain(); g.gain.value = 0.8; s.connect(g); g.connect(audition.destination);
  s.start(0, 0, Math.min(seconds, b.duration)); auditionSrc = s;
}
export function stopPreview() { auditionSrc?.stop(); auditionSrc = null; }

/** The timeline's sound: music from an offset (looped, faded out at the end), each shot's sound effect, the clips' own audio. */
export class Mixer {
  private music: AudioBufferSourceNode | null = null;
  private mg: GainNode; private sg: GainNode; private cg: GainNode;
  private linked = new WeakSet<HTMLMediaElement>();
  constructor(public ctx: AudioContext, out: AudioNode) {
    this.mg = ctx.createGain(); this.sg = ctx.createGain(); this.cg = ctx.createGain();
    for (const g of [this.mg, this.sg, this.cg]) g.connect(out);
  }
  levels(a: VAudio) { this.mg.gain.value = a.musicVol; this.sg.gain.value = a.sfxVol; this.cg.gain.value = a.clipVol; }
  clip(el: HTMLMediaElement) { if (this.linked.has(el)) return; this.linked.add(el); this.ctx.createMediaElementSource(el).connect(this.cg); }
  async start(a: VAudio, at: number, total: number) {
    this.stop(); this.levels(a);
    const b = await musicBuffer(a.music); if (!b) return;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.loop = true;
    const fade = this.ctx.createGain(); const now = this.ctx.currentTime; const left = Math.max(0.1, total - at);
    fade.gain.setValueAtTime(1, now); if (left > 1.2) fade.gain.setValueAtTime(1, now + left - 1.2); fade.gain.linearRampToValueAtTime(0.0001, now + left);
    s.connect(fade); fade.connect(this.mg); s.start(now, at % b.duration); s.stop(now + left + 0.05); this.music = s;
  }
  async sfx(id: SfxId | undefined, web?: WebAudio | null) { const b = web ? await webBuffer(web) : !id || id === 'none' ? null : await sfxBuffer(id); if (!b) return; const s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.sg); s.start(); }
  stop() { try { this.music?.stop(); } catch { /* not started */ } this.music = null; }
}
