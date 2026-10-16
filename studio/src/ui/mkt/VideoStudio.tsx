// Dựng video: the client's real footage (plus AI shots from Veo) cut into a 9:16 Reel/TikTok the way viral videos are edited.
// Laid out like a pro mobile-video editor: media / viral / AI tabs on the left, the phone preview in the middle, the selected
// shot's inspector on the right, and a real timeline (ruler, filmstrip track, caption track, playhead) along the bottom.
import { render, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { toast } from '../../store';
import { cachedItems, newId, putItem } from '../../mkt/data';
import type { Client, Item, PlanRow } from '../../mkt/types';
import { FX, TEMPLATES, TEXT_STYLES, addClip, aiEditPlan, applyTemplate, audioOf, blankVideo, creditsOf, clipUrl, drawFrame, exportVideo, nextFrame, segAt, veoShot, videoTotal, type VideoDoc, type VSeg } from '../../mkt/video';
import { MUSIC, MUSIC_TAGS, Mixer, SFX, SFX_TAGS, addMusicFile, creditOf, musicBuffer, preview, searchAudio, sfxBuffer, stopPreview, webBuffer, type VAudio, type WebAudio } from '../../mkt/audio';
import { Btn } from '../components';
import { Icon } from '../icons';
import { ask } from '../confirm';

type Row = PlanRow & { planId: string };
/** The saved edit for a post, if any. */
export const videoOf = (clientId: string, r: Row) => ((cachedItems(clientId) || []).find((i) => i.kind === 'video' && (i.data as VideoDoc).rowRef?.planId === r.planId && (i.data as VideoDoc).rowRef?.rowId === r.id) as Item<VideoDoc> | undefined) || null;
export const isVideoRow = (r: PlanRow) => r.format === 'reel' || r.format === 'video' || r.format === 'story';

const RECIPES: { id: string; label: string; emoji: string; note: string }[] = [
  { id: 'hook', label: 'Hook câu hỏi', emoji: '❓', note: 'Mở bằng một câu hỏi gây tò mò ở 1 giây đầu, cắt nhanh 1–2 s, chữ to giữa màn hình, chốt CTA.' },
  { id: 'pov', label: 'POV', emoji: '👀', note: 'Kiểu "POV: …" theo góc nhìn người xem, nhịp chậm hơn ở cảnh cảm xúc, chữ trên cùng kiểu TikTok nền trắng.' },
  { id: 'list', label: 'Top 3 lý do', emoji: '🔢', note: 'Cấu trúc liệt kê: hook "3 lý do…", mỗi lý do 1 cảnh có số thứ tự, giật zoom mỗi lần sang lý do mới, cảnh cuối là payoff + CTA.' },
  { id: 'before', label: 'Trước / Sau', emoji: '✨', note: 'Hook bằng kết quả "sau", quay lại "trước", quá trình tua nhanh, loé sáng ở cảnh lộ kết quả, kết bằng CTA.' },
  { id: 'asmr', label: 'Cận cảnh sản phẩm', emoji: '🎯', note: 'Cận cảnh chi tiết sản phẩm, push-in chậm, rất ít chữ, nhịp theo nhạc, CTA ngắn.' },
  { id: 'story', label: 'Kể chuyện 1 phút', emoji: '🎬', note: 'Mở bằng xung đột, 3 nhịp: vấn đề, bước ngoặt, kết quả; chữ viền phía dưới như phụ đề, CTA mềm.' },
];
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** Full-screen, mounted on <body> so no transformed parent can clip it. */
function OnBody({ children }: { children: ComponentChildren }) {
  const host = useRef<HTMLDivElement | null>(null);
  if (!host.current && typeof document !== 'undefined') { host.current = document.createElement('div'); document.body.appendChild(host.current); }
  useEffect(() => { render(<>{children}</>, host.current!); });
  useEffect(() => () => { render(null, host.current!); host.current!.remove(); }, []);
  return null;
}
type Props = { client: Client; row: Row | null; openId?: string; onClose: () => void };
export function VideoStudio(p: Props) { return <OnBody><Studio {...p} /></OnBody>; }

function Studio({ client, row, openId, onClose }: Props) {
  const saved = row ? videoOf(client.id, row) : openId ? ((cachedItems(client.id) || []).find((i) => i.kind === 'video' && i.id === openId) as Item<VideoDoc> | undefined) || null : null;
  const [id] = useState(() => saved?.id || newId('vid'));
  const [v, setV0] = useState<VideoDoc>(() => saved?.data || blankVideo(client, row));
  const [tab, setTab] = useState<'media' | 'tpl' | 'viral' | 'audio' | 'ai'>('media');
  const [busy, setBusy] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [safe, setSafe] = useState(true);
  const [pps, setPps] = useState(70); // timeline pixels per second
  const [veo, setVeo] = useState({ prompt: '', seconds: 6 as 4 | 6 | 8 });
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const canvas = useRef<HTMLCanvasElement>(null);
  const els = useRef(new Map<string, HTMLVideoElement>());
  const abort = useRef<AbortController | null>(null);
  const save = useRef<number>(0);
  const mixer = useRef<Mixer | null>(null);
  const au = audioOf(v);
  const setAu = (p: Partial<VAudio>) => setV((d) => ({ ...d, audio: { ...audioOf(d), ...p } }));
  const total = videoTotal(v);
  const clipById = new Map(v.clips.map((c) => [c.id, c]));
  const seg = v.segs.find((s) => s.id === sel) || null;

  const setV = (f: (d: VideoDoc) => VideoDoc) => setV0((d) => {
    const n = f(d);
    clearTimeout(save.current);
    save.current = window.setTimeout(() => void putItem(client.id, 'video', id, { ...n, thumb: n.clips[0]?.thumb || '' }).catch((e) => toast(`Chưa lưu được video: ${(e as Error).message}`, 'err')), 600);
    return n;
  });
  useEffect(() => () => { clearTimeout(save.current); stopPreview(); mixer.current?.stop(); void mixer.current?.ctx.close(); }, []);
  useEffect(() => { mixer.current?.levels(au); }, [au.musicVol, au.clipVol, au.sfxVol]);
  // which clip files are on this computer (they are not synced)
  useEffect(() => { void Promise.all(v.clips.map(async (c) => [c.id, !!(await clipUrl(c.id))] as const)).then((a) => setReady(Object.fromEntries(a))); }, [v.clips.length]);

  const el = async (clip: string) => {
    let e = els.current.get(clip); if (e) return e;
    const u = await clipUrl(clip); if (!u) return null;
    e = document.createElement('video'); e.src = u; e.playsInline = true; e.preload = 'auto';
    await new Promise((r) => { e!.onloadeddata = r; e!.onerror = r; });
    els.current.set(clip, e); return e;
  };
  /** Draw the still frame at timeline time `at` (paused: text shown fully popped in). */
  const still = async (at: number) => {
    const c = canvas.current?.getContext('2d'); if (!c) return;
    const { seg: s, local } = segAt(v, at);
    const e = s ? await el(s.clip) : null;
    if (e && s) { e.currentTime = s.from + local; await new Promise((r) => { e.onseeked = r; setTimeout(r, 400); }); }
    drawFrame(c, v, s, e, s ? Math.max(local, 0.3) / (s.to - s.from) : 0, at);
  };
  useEffect(() => { if (!playing) void still(t); }, [v, t, playing]);

  // playback: walk the cut list in real time
  useEffect(() => {
    if (!playing) return;
    let stop = false; let cur: HTMLVideoElement | null = null;
    const c = canvas.current!.getContext('2d')!;
    if (!mixer.current) { const ac = new AudioContext(); mixer.current = new Mixer(ac, ac.destination); }
    const mx = mixer.current; void mx.ctx.resume(); stopPreview();
    void (async () => {
      let { i, local } = segAt(v, t); if (i < 0) { i = 0; local = 0; }
      for (const s of v.segs) { const e = await el(s.clip); if (e) mx.clip(e); }
      if (stop) return;
      void mx.start(au, segAt(v, t).i < 0 ? 0 : t, total);
      for (; i < v.segs.length && !stop; i++, local = 0) {
        const s = v.segs[i]; const e = await el(s.clip); if (!e) continue;
        cur = e; e.currentTime = s.from + local; await new Promise((r) => { e.onseeked = r; setTimeout(r, 400); });
        await e.play().catch(() => null);
        if (local < 0.05) void mx.sfx(s.sfx, s.sfxWeb);
        const start = v.segs.slice(0, i).reduce((a, x) => a + (x.to - x.from), 0);
        await new Promise<void>((r) => {
          const tick = () => {
            if (stop) { r(); return; }
            const p = Math.min(1, (e.currentTime - s.from) / (s.to - s.from));
            const at = start + p * (s.to - s.from);
            drawFrame(c, v, s, e, p, at); setT(at);
            if (e.currentTime >= s.to || e.ended) r(); else nextFrame(tick);
          };
          nextFrame(tick);
        });
        e.pause();
      }
      if (!stop) { setPlaying(false); setT(0); }
    })();
    return () => { stop = true; cur?.pause(); mx.stop(); };
  }, [playing]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === ' ') { e.preventDefault(); if (v.segs.length) setPlaying((p) => !p); }
      else if (e.key === 'Escape') { setPlaying(false); onClose(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { setV((d) => ({ ...d, segs: d.segs.filter((x) => x.id !== sel) })); setSel(null); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [v.segs.length, sel]);

  const addFiles = async (files: File[]) => {
    const vids = files.filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
    if (!vids.length) { toast('Chỉ nhận file video (MP4, MOV, WebM).', 'err'); return; }
    for (const [k, f] of vids.entries()) {
      setBusy(`Đang nạp clip ${k + 1}/${vids.length}: ${f.name}`);
      try { const c = await addClip(f, f.name.replace(/\.[^.]+$/, '')); setV((d) => ({ ...d, clips: [...d.clips, c] })); }
      catch (e) { toast(`${f.name}: ${(e as Error).message}`, 'err'); }
    }
    setBusy(null);
  };
  const aiCut = async () => {
    if (v.segs.length && !(await ask('AI dựng lại toàn bộ timeline? Các cảnh đang có sẽ bị thay.', 'Dựng lại', false))) return;
    setPlaying(false);
    try { const { segs, music } = await aiEditPlan(client, row, v, setBusy); setV((d) => { const a = audioOf(d); const n = { ...d, segs, audio: { ...a, music: a.music?.kind === 'file' || !music ? a.music : { kind: 'synth' as const, id: music } } }; return d.template ? applyTemplate(n, d.template) : n; }); setT(0); setSel(segs[0]?.id || null); toast(`AI đã cắt ${segs.length} cảnh · ${segs.reduce((a, s) => a + s.to - s.from, 0).toFixed(1)} s. Bấm Space để xem.`, 'ok'); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(null); }
  };
  const genShot = async () => {
    const prompt = veo.prompt.trim() || (row ? `${row.visual || row.topic}. Vertical 9:16 social video shot, cinematic, natural light, for the brand ${client.name}.` : '');
    if (!prompt) { toast('Gõ mô tả cảnh cần tạo.', 'err'); return; }
    if (!(await ask(`Tạo 1 cảnh ${veo.seconds} giây bằng Google Veo (bản rẻ nhất)? Tốn khoảng ${(veo.seconds * 0.05).toFixed(2)} USD, mất 1–3 phút.`, 'Tạo cảnh', false))) return;
    abort.current = new AbortController();
    try {
      const b = await veoShot(prompt, veo.seconds, setBusy, abort.current.signal);
      setBusy('Đang nạp cảnh vào kho clip…');
      const c = await addClip(b, `AI · ${prompt.slice(0, 40)}`, 'ai');
      setV((d) => ({ ...d, clips: [...d.clips, c] })); setTab('media'); toast('Xong cảnh AI, đã thêm vào kho clip.', 'ok');
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(null); }
  };
  const doExport = async () => {
    setPlaying(false);
    abort.current = new AbortController();
    try {
      setBusy('Đang xuất video…');
      const b = await exportVideo(v, (p) => setBusy(`Đang xuất video ${Math.round(p * 100)}% · chạy theo thời gian thật, đừng đóng tab`), abort.current.signal);
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${(v.title || 'video').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60)}.${b.type.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      toast(b.type.includes('mp4') ? 'Đã tải video MP4 1080×1920.' : 'Đã tải video WebM (trình duyệt này không xuất được MP4; dùng Chrome hoặc Safari mới).', 'ok');
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(null); }
  };
  const patchSeg = (sid: string, p: Partial<VSeg>) => setV((d) => ({ ...d, segs: d.segs.map((s) => (s.id === sid ? { ...s, ...p } : s)) }));
  const moveSeg = (sid: string, k: number) => setV((d) => { const a = [...d.segs]; const i = a.findIndex((s) => s.id === sid); const j = i + k; if (j < 0 || j >= a.length) return d; [a[i], a[j]] = [a[j], a[i]]; return { ...d, segs: a }; });
  const appendClip = (cid: string) => { const c = clipById.get(cid); if (!c) return; const s: VSeg = { id: newId('sg'), clip: c.id, from: 0, to: Math.min(c.dur, 2.5), text: '', style: 'body', pos: 'middle', zoom: 1, fx: 'none' }; setV((d) => ({ ...d, segs: [...d.segs, s] })); setSel(s.id); };
  const split = () => {
    const { seg: s, local } = segAt(v, t); if (!s || local < 0.2 || s.to - s.from - local < 0.2) { toast('Đưa đầu phát vào giữa một cảnh để cắt đôi.', 'info'); return; }
    const b: VSeg = { ...s, id: newId('sg'), from: s.from + local, text: '' };
    setV((d) => { const a = [...d.segs]; const i = a.findIndex((x) => x.id === s.id); a.splice(i, 1, { ...s, to: s.from + local }, b); return { ...d, segs: a }; }); setSel(b.id);
  };
  const startOf = (sid: string) => { let a = 0; for (const s of v.segs) { if (s.id === sid) return a; a += s.to - s.from; } return 0; };
  const missing = v.clips.filter((c) => ready[c.id] === false).length;
  const ticks = Math.ceil(total) + 1;

  return (
    <div class="vs" role="dialog" aria-label="Dựng video">
      <header class="vs-top">
        <button class="vs-back" onClick={() => { setPlaying(false); onClose(); }} title="Đóng (Esc) · đã tự lưu"><Icon name="chevron" size={14} style={{ transform: 'rotate(90deg)' }} /></button>
        <div class="vs-brand"><span class="vs-logo"><Icon name="play" size={12} /></span>Phloem Video</div>
        <input class="vs-title" value={v.title} onInput={(e) => { const x = (e.target as HTMLInputElement).value; setV((d) => ({ ...d, title: x })); }} aria-label="Tên video" />
        <span class="grow" />
        <span class="vs-pill">{v.segs.length} cảnh</span>
        <span class="vs-pill mono">{fmt(total)}</span>
        <span class="vs-pill">1080×1920 · 9:16</span>
        <button class="vs-export" disabled={!v.segs.length || !!busy} onClick={() => void doExport()}><Icon name="download" size={14} />Xuất video</button>
      </header>

      <div class="vs-body">
        <aside class="vs-left">
          <nav class="vs-tabs">
            <button class={tab === 'media' ? 'on' : ''} onClick={() => setTab('media')}><Icon name="film" size={15} /><span>Footage</span></button>
            <button class={tab === 'tpl' ? 'on' : ''} onClick={() => setTab('tpl')}><Icon name="wand" size={15} /><span>Mẫu</span></button>
            <button class={tab === 'viral' ? 'on' : ''} onClick={() => setTab('viral')}><Icon name="bolt" size={15} /><span>Viral</span></button>
            <button class={tab === 'audio' ? 'on' : ''} onClick={() => setTab('audio')}><Icon name="music" size={15} /><span>Âm thanh</span></button>
            <button class={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}><Icon name="sparkle" size={15} /><span>AI cảnh</span></button>
          </nav>
          <div class="vs-pane">
            {tab === 'media' && <>
              <label class="vs-drop" onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('over'); }} onDragLeave={(e) => (e.currentTarget as HTMLElement).classList.remove('over')} onDrop={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.remove('over'); void addFiles(Array.from(e.dataTransfer?.files || [])); }}>
                <span class="vs-drop-ic"><Icon name="upload" size={18} /></span>
                <b>Thả footage thật vào đây</b>
                <span>MP4, MOV, WebM · nhiều file một lần · chỉ lưu trên máy này</span>
                <input type="file" accept="video/*" multiple hidden onChange={(e) => { const f = Array.from((e.target as HTMLInputElement).files || []); (e.target as HTMLInputElement).value = ''; void addFiles(f); }} />
              </label>
              {missing > 0 && <p class="vs-warn"><Icon name="warn" size={13} />{missing} clip nằm trên máy khác. Thả lại các file đó để dựng tiếp.</p>}
              <div class="vs-clips">
                {v.clips.map((c) => (
                  <div key={c.id} class={`vs-clip ${ready[c.id] === false ? 'gone' : ''}`} title={`${c.name} · ${c.dur.toFixed(1)} s · ${c.w}×${c.h}`} onDblClick={() => appendClip(c.id)}>
                    <img src={c.thumb} alt="" />
                    <span class="vs-dur">{c.dur.toFixed(1)}s</span>
                    {c.src === 'ai' && <span class="vs-ai">AI</span>}
                    <div class="vs-clip-acts">
                      <button title="Thêm vào cuối timeline" onClick={() => appendClip(c.id)}><Icon name="plus" size={13} /></button>
                      <button title="Bỏ clip" onClick={() => setV((d) => ({ ...d, clips: d.clips.filter((x) => x.id !== c.id), segs: d.segs.filter((s) => s.clip !== c.id) }))}><Icon name="trash" size={12} /></button>
                    </div>
                    <em>{c.name}</em>
                  </div>
                ))}
              </div>
              {v.clips.length > 0 && <button class="vs-cta" disabled={!!busy} onClick={() => void aiCut()}><Icon name="sparkle" size={15} />AI dựng theo công thức viral</button>}
            </>}
            {tab === 'tpl' && <>
              <p class="vs-lead">Một chạm đổi cả video: kiểu chữ, chuyển cảnh, hiệu ứng âm thanh và nhạc nền. Giữ nguyên các cú cắt và nội dung chữ.</p>
              <div class="vs-tpls">
                {TEMPLATES.map((tp) => (
                  <button key={tp.id} class={v.template === tp.id ? 'on' : ''} onClick={() => { setV((d) => applyTemplate({ ...d, template: tp.id }, tp.id)); if (!v.segs.length) toast('Đã chọn mẫu. Khi AI dựng hoặc bạn thêm cảnh, mẫu sẽ được áp.', 'info'); else toast(`Đã áp mẫu "${tp.label}" cho ${v.segs.length} cảnh.`, 'ok'); }}>
                    <div class={`vs-tpl-pv tp-${tp.id}`} style={{ ['--a' as string]: v.colors.accent, ['--p' as string]: v.colors.primary }}><span class="l1">HOOK</span><span class="l2">chữ</span><span class="l3">CTA</span></div>
                    <b>{tp.label}</b><em>{tp.note}</em>
                    <i><Icon name="music" size={11} />{MUSIC.find((m) => m.id === tp.music)?.label}</i>
                  </button>
                ))}
              </div>
            </>}
            {tab === 'audio' && <>
              <section class="vs-sec"><h5>Mức âm lượng</h5>
                <label class="vs-slider"><span>Nhạc nền</span><input type="range" min={0} max={1} step={0.01} value={au.musicVol} onInput={(e) => setAu({ musicVol: Number((e.target as HTMLInputElement).value) })} /><b class="mono">{Math.round(au.musicVol * 100)}</b></label>
                <label class="vs-slider"><span>Tiếng gốc clip</span><input type="range" min={0} max={1} step={0.01} value={au.clipVol} onInput={(e) => setAu({ clipVol: Number((e.target as HTMLInputElement).value) })} /><b class="mono">{Math.round(au.clipVol * 100)}</b></label>
                <label class="vs-slider"><span>Hiệu ứng</span><input type="range" min={0} max={1} step={0.01} value={au.sfxVol} onInput={(e) => setAu({ sfxVol: Number((e.target as HTMLInputElement).value) })} /><b class="mono">{Math.round(au.sfxVol * 100)}</b></label>
              </section>
              <section class="vs-sec"><h5>Nhạc nền <span class="dim small">· tự tạo, không lo bản quyền</span></h5>
                <div class="vs-tracks">
                  {MUSIC.map((m) => { const on = au.music?.kind === 'synth' && au.music.id === m.id; return (
                    <div key={m.id} class={`vs-track-i ${on ? 'on' : ''}`} onClick={() => setAu({ music: { kind: 'synth', id: m.id } })} role="button" tabIndex={0}>
                      <button class="vs-aud" title="Nghe thử" onClick={(e) => { e.stopPropagation(); void preview(musicBuffer({ kind: 'synth', id: m.id }), 10); }}><Icon name="play" size={11} /></button>
                      <div><b>{m.label}</b><em>{m.mood} · {m.bpm} BPM</em></div>{on && <Icon name="check" size={14} />}
                    </div>
                  ); })}
                  {au.music?.kind === 'file' && <div class="vs-track-i on"><button class="vs-aud" onClick={() => void preview(musicBuffer(au.music), 10)}><Icon name="play" size={11} /></button><div><b>{au.music.name}</b><em>Nhạc của bạn</em></div><Icon name="check" size={14} /></div>}
                  <div class="row" style={{ gap: 6 }}>
                    <label class="vs-mini"><Icon name="upload" size={12} />Nhạc của bạn<input type="file" accept="audio/*" hidden onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (!f) return; try { const m = await addMusicFile(f); setAu({ music: m }); toast(`Đã thêm nhạc "${m.name}".`, 'ok'); } catch (er) { toast((er as Error).message, 'err'); } }} /></label>
                    <button class={`vs-mini ${!au.music ? 'on' : ''}`} onClick={() => setAu({ music: null })}>Không nhạc</button>
                    <button class="vs-mini" onClick={() => stopPreview()}>Dừng nghe</button>
                  </div>
                  {au.music?.kind === 'web' && <div class="vs-track-i on"><button class="vs-aud" onClick={() => void preview(musicBuffer(au.music), 12)}><Icon name="play" size={11} /></button><div><b>{au.music.name}</b><em>{creditOf(au.music.track)}</em></div><Icon name="check" size={14} /></div>}
                  <span class="dim small">Nhạc trend trên TikTok/Reels: xuất video không nhạc rồi chọn nhạc trong app khi đăng, để có bản quyền.</span>
                </div>
              </section>
              <section class="vs-sec"><h5>Kho nhạc miễn phí <span class="dim small">· Jamendo, Freesound · dùng thương mại được</span></h5>
                <AudioLib kind="music" onUse={(tr) => { setAu({ music: { kind: 'web', id: tr.id, name: tr.title, track: tr } }); toast(`Nhạc nền: ${tr.title}`, 'ok'); }} current={au.music?.kind === 'web' ? au.music.id : null} />
              </section>
              <section class="vs-sec"><h5>Hiệu ứng âm thanh {seg ? <span class="dim small">· bấm để gán cho cảnh {v.segs.indexOf(seg) + 1}</span> : <span class="dim small">· chọn 1 cảnh để gán</span>}</h5>
                <div class="vs-sfx">
                  {SFX.map((x) => <button key={x.id} class={seg?.sfx === x.id && !seg.sfxWeb ? 'on' : ''} onClick={() => { void preview(sfxBuffer(x.id), 2); if (seg) patchSeg(seg.id, { sfx: seg.sfx === x.id ? 'none' : x.id, sfxWeb: null }); }}><span>{x.emoji}</span>{x.label}</button>)}
                </div>
              </section>
              <section class="vs-sec"><h5>Kho hiệu ứng âm thanh <span class="dim small">· Freesound</span></h5>
                <AudioLib kind="sfx" current={seg?.sfxWeb?.id || null} onUse={(tr) => { if (!seg) { toast('Chọn 1 cảnh trên timeline trước, rồi bấm Dùng.', 'info'); return; } patchSeg(seg.id, { sfxWeb: tr, sfx: 'none' }); toast(`Cảnh ${v.segs.indexOf(seg) + 1}: ${tr.title}`, 'ok'); }} />
              </section>
              {creditsOf(v).length > 0 && <section class="vs-sec"><h5>Ghi công (bắt buộc với CC BY)</h5>
                <textarea rows={3} readOnly value={`Nhạc/âm thanh: ${creditsOf(v).join('; ')}`} />
                <button class="vs-mini" onClick={() => { void navigator.clipboard.writeText(`Nhạc/âm thanh: ${creditsOf(v).join('; ')}`); toast('Đã chép ghi công, dán vào caption khi đăng.', 'ok'); }}><Icon name="copy" size={12} />Chép vào caption</button>
              </section>}
            </>}
            {tab === 'viral' && <>
              <p class="vs-lead">Chọn công thức hoặc dán video triệu view làm mẫu. AI giữ cấu trúc, nhịp cắt và kiểu chữ, thay bằng footage của {client.name}.</p>
              <div class="vs-recipes">
                {RECIPES.map((r) => <button key={r.id} class={v.reference === r.note ? 'on' : ''} onClick={() => setV((d) => ({ ...d, reference: r.note }))}><span>{r.emoji}</span><b>{r.label}</b><em>{r.note}</em></button>)}
              </div>
              <label class="vs-field"><span>Video mẫu của bạn</span>
                <textarea rows={5} placeholder="Dán link TikTok / Reels triệu view và tả nó: 1 giây đầu có gì, nhịp cắt nhanh hay chậm, chữ đặt đâu, kết thúc thế nào." value={v.reference} onInput={(e) => { const x = (e.target as HTMLTextAreaElement).value; setV((d) => ({ ...d, reference: x })); }} />
              </label>
              <div class="vs-formula">
                <div><b>0–1,5s</b><span>Hook: cảnh mạnh nhất + câu gây tò mò</span></div>
                <div><b>1–2,5s/cảnh</b><span>Cắt nhanh, đổi góc mỗi 2–3 giây</span></div>
                <div><b>Chữ</b><span>Kể chuyện không cần bật tiếng, tối đa 7 chữ/dòng</span></div>
                <div><b>2–3s cuối</b><span>Payoff + CTA rõ ràng</span></div>
              </div>
              <button class="vs-cta" disabled={!v.clips.length || !!busy} onClick={() => void aiCut()}><Icon name="sparkle" size={15} />{v.clips.length ? 'AI dựng theo công thức này' : 'Thả footage trước (tab Footage)'}</button>
            </>}
            {tab === 'ai' && <>
              <p class="vs-lead">Thiếu cảnh? Tạo một cảnh dọc 9:16 từ mô tả rồi dùng như footage.</p>
              <label class="vs-field"><span>Mô tả cảnh</span>
                <textarea rows={5} placeholder={row ? `Để trống = theo ý tưởng ảnh của bài: ${(row.visual || row.topic).slice(0, 90)}` : 'Chủ thể, hành động, góc máy, ánh sáng, không khí…'} value={veo.prompt} onInput={(e) => setVeo({ ...veo, prompt: (e.target as HTMLTextAreaElement).value })} />
              </label>
              <div class="vs-field"><span>Độ dài</span><div class="vs-seg3">{([4, 6, 8] as const).map((n) => <button key={n} class={veo.seconds === n ? 'on' : ''} onClick={() => setVeo({ ...veo, seconds: n })}>{n} giây</button>)}</div></div>
              <button class="vs-cta" disabled={!!busy} onClick={() => void genShot()}><Icon name="sparkle" size={15} />Tạo cảnh · ~{(veo.seconds * 0.05).toFixed(2)} USD</button>
              <div class="vs-note"><b>Google Veo 3.1 Lite</b> (bản rẻ nhất): 720p dọc, khoảng 0,05 USD/giây, 1–3 phút mỗi cảnh, tối đa 6 cảnh/giờ.</div>
              <div class="vs-note"><b>Miễn phí:</b> tạo cảnh trên máy Mac bằng LTX-2 (chậm, vài phút đến vài chục phút mỗi cảnh) rồi thả file vào tab Footage.</div>
            </>}
          </div>
        </aside>

        <main class="vs-stage">
          <div class="vs-phone">
            <canvas ref={canvas} width={v.w} height={v.h} onClick={() => v.segs.length && setPlaying(!playing)} />
            {safe && <div class="vs-safe" aria-hidden="true"><i class="r" /><i class="b" /><span>Vùng nút TikTok / Reels</span></div>}
            {!playing && v.segs.length > 0 && <button class="vs-bigplay" onClick={() => setPlaying(true)} aria-label="Phát"><Icon name="play" size={26} /></button>}
            {!v.segs.length && <div class="vs-empty"><Icon name="play" size={30} /><b>Chưa có cảnh nào</b><span>Thả footage, rồi bấm "AI dựng theo công thức viral"</span></div>}
          </div>
          <div class="vs-transport">
            <button onClick={() => { setPlaying(false); setT(0); }} title="Về đầu"><Icon name="undo" size={14} /></button>
            <button class="main" disabled={!v.segs.length} onClick={() => setPlaying(!playing)} title="Phát / dừng (Space)">{playing ? <span class="vs-pause" /> : <Icon name="play" size={16} />}</button>
            <span class="mono">{fmt(t)} <i>/ {fmt(total)}</i></span>
            <span class="grow" />
            <label class="vs-toggle"><input type="checkbox" checked={safe} onChange={(e) => setSafe((e.target as HTMLInputElement).checked)} />Vùng an toàn</label>
            <label class="vs-toggle"><input type="checkbox" checked={!!v.progressBar} onChange={(e) => { const x = (e.target as HTMLInputElement).checked; setV((d) => ({ ...d, progressBar: x })); }} />Thanh tiến trình</label>
          </div>
        </main>

        <aside class="vs-right">
          {seg ? (() => { const c = clipById.get(seg.clip); const i = v.segs.indexOf(seg); return <>
            <div class="vs-insp-h"><span class="vs-num">{i + 1}</span><b>Cảnh {i + 1}</b><span class="dim small">{(seg.to - seg.from).toFixed(1)} s</span><span class="grow" />
              <button title="Lên trước" onClick={() => moveSeg(seg.id, -1)}><Icon name="up" size={13} /></button>
              <button title="Ra sau" onClick={() => moveSeg(seg.id, 1)}><Icon name="down" size={13} /></button>
              <button title="Nhân đôi" onClick={() => { const n = { ...seg, id: newId('sg') }; setV((d) => { const a = [...d.segs]; a.splice(i + 1, 0, n); return { ...d, segs: a }; }); setSel(n.id); }}><Icon name="copy" size={13} /></button>
              <button title="Xoá cảnh (Delete)" onClick={() => { setV((d) => ({ ...d, segs: d.segs.filter((x) => x.id !== seg.id) })); setSel(null); }}><Icon name="trash" size={13} /></button>
            </div>
            <section class="vs-sec"><h5>Chữ trên màn hình</h5>
              <textarea rows={2} value={seg.text} placeholder="Câu ngắn, tối đa 7 chữ" onInput={(e) => patchSeg(seg.id, { text: (e.target as HTMLTextAreaElement).value })} />
              <div class="vs-styles">{TEXT_STYLES.map((x) => <button key={x.id} class={`st-${x.id} ${seg.style === x.id ? 'on' : ''}`} style={{ ['--a' as string]: v.colors.accent, ['--p' as string]: v.colors.primary }} onClick={() => patchSeg(seg.id, { style: x.id })} title={x.label}><span>Aa</span><em>{x.label}</em></button>)}</div>
              <div class="vs-seg3">{(['top', 'middle', 'bottom'] as const).map((p) => <button key={p} class={seg.pos === p ? 'on' : ''} onClick={() => patchSeg(seg.id, { pos: p })}>{p === 'top' ? 'Trên' : p === 'middle' ? 'Giữa' : 'Dưới'}</button>)}</div>
            </section>
            <section class="vs-sec"><h5>Đoạn cắt từ clip</h5>
              <div class="vs-trim">
                <div class="vs-trim-bar" style={{ backgroundImage: c?.thumb ? `url(${c.thumb})` : undefined }}>
                  <i style={{ left: `${(seg.from / (c?.dur || 1)) * 100}%`, width: `${((seg.to - seg.from) / (c?.dur || 1)) * 100}%` }} />
                </div>
                <input type="range" min={0} max={c?.dur || 1} step={0.05} value={seg.from} onInput={(e) => patchSeg(seg.id, { from: Math.min(seg.to - 0.3, Number((e.target as HTMLInputElement).value)) })} aria-label="Điểm vào" />
                <input type="range" min={0} max={c?.dur || 1} step={0.05} value={seg.to} onInput={(e) => patchSeg(seg.id, { to: Math.max(seg.from + 0.3, Number((e.target as HTMLInputElement).value)) })} aria-label="Điểm ra" />
                <div class="row small dim"><span>Vào {seg.from.toFixed(2)}s</span><span class="grow" /><span>Ra {seg.to.toFixed(2)}s</span></div>
              </div>
              <span class="dim small mk-ell">{c?.name || 'Clip đã bỏ'}</span>
            </section>
            <section class="vs-sec"><h5>Chuyển động</h5>
              <div class="vs-seg3">{FX.map((x) => <button key={x.id} class={(seg.fx || 'none') === x.id ? 'on' : ''} onClick={() => patchSeg(seg.id, { fx: x.id })}>{x.label}</button>)}</div>
              <label class="vs-slider"><span>Zoom chậm</span><input type="range" min={1} max={1.3} step={0.01} value={seg.zoom} onInput={(e) => patchSeg(seg.id, { zoom: Number((e.target as HTMLInputElement).value) })} /><b class="mono">{Math.round((seg.zoom - 1) * 100)}%</b></label>
            </section>
            <section class="vs-sec"><h5>Âm thanh khi vào cảnh</h5>
              <div class="vs-sfx sm">
                {seg.sfxWeb && <button class="on" title={creditOf(seg.sfxWeb)} onClick={() => void preview(webBuffer(seg.sfxWeb!), 3)}><span>🎧</span>{seg.sfxWeb.title.slice(0, 18)}</button>}
                <button class={(!seg.sfx || seg.sfx === 'none') && !seg.sfxWeb ? 'on' : ''} onClick={() => patchSeg(seg.id, { sfx: 'none', sfxWeb: null })}>Không</button>
                {SFX.map((x) => <button key={x.id} class={seg.sfx === x.id ? 'on' : ''} title={x.label} onClick={() => { void preview(sfxBuffer(x.id), 2); patchSeg(seg.id, { sfx: x.id, sfxWeb: null }); }}><span>{x.emoji}</span>{x.label}</button>)}
              </div>
            </section>
          </>; })() : <>
            <div class="vs-insp-h"><b>Cả video</b></div>
            <section class="vs-sec"><h5>Màu thương hiệu</h5>
              <div class="vs-colors">
                <label><input type="color" value={v.colors.accent} onInput={(e) => { const x = (e.target as HTMLInputElement).value; setV((d) => ({ ...d, colors: { ...d.colors, accent: x } })); }} />Hook</label>
                <label><input type="color" value={v.colors.primary} onInput={(e) => { const x = (e.target as HTMLInputElement).value; setV((d) => ({ ...d, colors: { ...d.colors, primary: x } })); }} />CTA</label>
                <label><input type="color" value={v.colors.ink} onInput={(e) => { const x = (e.target as HTMLInputElement).value; setV((d) => ({ ...d, colors: { ...d.colors, ink: x } })); }} />Chữ</label>
              </div>
            </section>
            <section class="vs-sec"><h5>Font chữ</h5><input value={v.font} onChange={(e) => { const x = (e.target as HTMLInputElement).value; setV((d) => ({ ...d, font: x })); }} /><span class="dim small">Mặc định theo bộ nhận diện của khách.</span></section>
            <section class="vs-sec"><h5>Mẹo</h5><ul class="vs-tips"><li>Bấm một cảnh trên timeline để chỉnh chữ, đoạn cắt, chuyển động.</li><li><kbd>Space</kbd> phát / dừng · <kbd>Delete</kbd> xoá cảnh · nút kéo cắt đôi cảnh tại đầu phát.</li><li>Nhấp đúp clip để thêm vào cuối.</li></ul></section>
          </>}
        </aside>
      </div>

      <footer class="vs-tl">
        <div class="vs-tl-bar">
          <button onClick={split} title="Cắt đôi cảnh tại đầu phát"><Icon name="scissors" size={13} />Cắt đôi</button>
          <button onClick={() => setTab('tpl')}><Icon name="wand" size={13} />Mẫu</button>
          <button onClick={() => setTab('audio')}><Icon name="music" size={13} />Âm thanh</button>
          <span class="grow" />
          <button onClick={() => setPps(Math.max(25, pps - 15))} title="Thu nhỏ timeline"><Icon name="minus" size={13} /></button>
          <button onClick={() => setPps(Math.min(200, pps + 15))} title="Phóng to timeline"><Icon name="plus" size={13} /></button>
        </div>
        <div class="vs-tl-scroll">
          <div class="vs-tl-in" style={{ width: `${Math.max(total * pps + 120, 300)}px` }} onMouseDown={(e) => { if ((e.target as HTMLElement).closest('.vs-tl-clip')) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPlaying(false); setT(Math.max(0, Math.min(total, (e.clientX - r.left - 12) / pps))); }}>
            <div class="vs-ruler">{Array.from({ length: ticks }, (_, k) => <span key={k} style={{ left: `${12 + k * pps}px` }}>{k % (pps < 50 ? 2 : 1) === 0 ? `${k}s` : ''}</span>)}</div>
            <div class="vs-track cap">
              {v.segs.map((s) => s.text.trim() && s.style !== 'none' ? <button key={s.id} class={`vs-tl-cap st-${s.style} ${sel === s.id ? 'on' : ''}`} style={{ left: `${12 + startOf(s.id) * pps}px`, width: `${(s.to - s.from) * pps - 2}px` }} onClick={() => setSel(s.id)}>{s.text}</button> : null)}
            </div>
            <div class="vs-track vid">
              {v.segs.map((s) => { const c = clipById.get(s.clip); const w = (s.to - s.from) * pps; return (
                <button key={s.id} class={`vs-tl-clip ${sel === s.id ? 'on' : ''}`} style={{ left: `${12 + startOf(s.id) * pps}px`, width: `${w - 2}px`, backgroundImage: c?.thumb ? `url(${c.thumb})` : undefined }} onClick={() => { setSel(s.id); setPlaying(false); setT(startOf(s.id) + 0.01); }} title={`${(s.to - s.from).toFixed(1)} s · ${c?.name || ''}`}>
                  <span>{(s.to - s.from).toFixed(1)}s</span>{s.fx && s.fx !== 'none' && <i>{s.fx === 'punch' ? '⚡' : '✦'}</i>}
                </button>
              ); })}
              {!v.segs.length && <span class="vs-tl-empty">Timeline trống: thả footage rồi để AI dựng, hoặc bấm + trên một clip.</span>}
            </div>
            <div class="vs-track mus">
              {au.music && total > 0 ? <div class="vs-tl-mus" style={{ left: '12px', width: `${total * pps - 2}px` }}><Icon name="music" size={11} />{au.music.kind !== 'synth' ? au.music.name : MUSIC.find((m) => m.id === (au.music as { id: string }).id)?.label}<span class="vs-wave" /></div> : <span class="vs-tl-empty">Không nhạc nền · chọn ở tab Âm thanh</span>}
              {v.segs.map((s) => s.sfxWeb || (s.sfx && s.sfx !== 'none') ? <span key={s.id} class="vs-sfxmark" style={{ left: `${12 + startOf(s.id) * pps}px` }} title={s.sfxWeb ? s.sfxWeb.title : SFX.find((x) => x.id === s.sfx)?.label}>{s.sfxWeb ? '🎧' : SFX.find((x) => x.id === s.sfx)?.emoji}</span> : null)}
            </div>
            <div class="vs-head" style={{ left: `${12 + t * pps}px` }}><i /></div>
          </div>
        </div>
      </footer>
      {busy && <div class="vs-busy"><div class="mk-spin" /><span>{busy}</span><button onClick={() => abort.current?.abort()}>Huỷ</button></div>}
    </div>
  );
}

/** Search the free library (Openverse) and audition / use a track. */
function AudioLib({ kind, onUse, current }: { kind: 'music' | 'sfx'; onUse: (t: WebAudio) => void; current: string | null }) {
  const tags = kind === 'music' ? MUSIC_TAGS : SFX_TAGS;
  const [q, setQ] = useState(tags[0]);
  const [res, setRes] = useState<WebAudio[] | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const run = async (query: string, pg = 1) => {
    setQ(query); setBusy(true);
    try { const r = await searchAudio(query, kind, pg); setRes(pg === 1 ? r : [...(res || []), ...r]); setPage(pg); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void run(q); }, []);
  const fmtD = (d: number) => (d >= 60 ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}` : `${d.toFixed(1)}s`);
  return (
    <div class="vs-lib">
      <form class="vs-lib-q" onSubmit={(e) => { e.preventDefault(); void run(q); }}>
        <Icon name="search" size={13} /><input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder={kind === 'music' ? 'Tìm nhạc: chill, epic, piano…' : 'Tìm âm thanh: whoosh, pop, tiếng mưa…'} />
      </form>
      <div class="vs-lib-tags">{tags.map((t) => <button key={t} class={q === t ? 'on' : ''} onClick={() => void run(t)}>{t}</button>)}</div>
      <div class="vs-lib-list">
        {res?.map((t) => (
          <div key={t.id} class={`vs-lib-i ${current === t.id ? 'on' : ''}`}>
            <button class="vs-aud" title="Nghe thử" onClick={() => { if (playing === t.id) { stopPreview(); setPlaying(null); } else { setPlaying(t.id); void preview(webBuffer(t), kind === 'music' ? 20 : 4).then(() => null); } }}>{playing === t.id ? <span class="vs-pause sm" /> : <Icon name="play" size={10} />}</button>
            <div class="grow"><b>{t.title}</b><em>{t.creator ? `${t.creator} · ` : ''}{fmtD(t.dur)} · {t.license === 'by' ? 'CC BY (ghi công)' : 'CC0'}</em></div>
            <button class="vs-use" onClick={() => onUse(t)}>{current === t.id ? <Icon name="check" size={12} /> : 'Dùng'}</button>
          </div>
        ))}
        {busy && <div class="row dim small"><div class="mk-spin" />Đang tìm…</div>}
        {res && !res.length && !busy && <span class="dim small">Không thấy kết quả, thử từ khoá tiếng Anh.</span>}
        {res && res.length >= 20 * page && !busy && <button class="vs-mini" onClick={() => void run(q, page + 1)}>Xem thêm</button>}
      </div>
    </div>
  );
}
