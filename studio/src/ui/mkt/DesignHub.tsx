// Tab Thiết kế của một khách (Phloem Design): việc thiết kế từ kế hoạch, các thiết kế đã làm, kho ảnh riêng của khách.
import { ImportData } from './ImportData';
import { useEffect, useRef, useState } from 'preact/hooks';
import { toast, useStore } from '../../store';
import * as A from '../../pipeline/actions';
import { cachedItems, newId, putItem } from '../../mkt/data';
import { SIZES, addClientImages, clientImages, designFromImage, designPost, downloadPost, paintFullPost, pastPosts, preferredSize, preferredSizeKey, refitImported, sizeForRow, type DesignSize } from '../../mkt/designs';
import { assets } from '../../storage/assets';
import { canWrite, channelOf, FORMATS, type Client, type Item, type Plan, type PlanRow } from '../../mkt/types';
import { go } from '../../mkt/router';
import { Btn, Modal } from '../components';
import { askPhotos } from './NeedPhotos';
import { activeCount, cancelAll, cancelJob, enqueue, useJobs } from '../../mkt/jobs';
import { Icon } from '../icons';
import { ask } from '../confirm';
import { Empty, PageHead, StatusChip, fmtDate } from './bits';
import { ClientLibrary } from './ClientLibrary';
import { VideoStudio, isVideoRow, videoOf } from './VideoStudio';
import { autoVideo, videoTotal, type VideoDoc } from '../../mkt/video';

type Row = PlanRow & { planId: string };

export function DesignHub({ client }: { client: Client }) {
  const s = useStore();
  const J = useJobs();
  const write = canWrite(client.role) && !client.shared;
  const [picker, setPicker] = useState<Row | null | 'new'>(null);
  const [own, setOwn] = useState<Row | null>(null);
  const [importing, setImporting] = useState(false);
  const [video, setVideo] = useState<Row | 'new' | { id: string } | null>(null);
  const looseVideos = ((cachedItems(client.id) || []).filter((i) => i.kind === 'video' && !(i.data as VideoDoc).rowRef) as Item<VideoDoc>[]);
  const [busy, setBusy] = useState<{ label: string; done?: number; total?: number } | null>(null);
  const [scope, setScope] = useState<'approved' | 'all'>('approved');
  const [days, setDays] = useState(14);
  const [layout, setLayout] = useState<'table' | 'cards'>(() => { try { return (localStorage.getItem('phloem.mkt.designView') as 'table' | 'cards') || 'table'; } catch { return 'table'; } });
  useEffect(() => { try { localStorage.setItem('phloem.mkt.designView', layout); } catch { /* private mode */ } }, [layout]);
  const abort = useRef<AbortController | null>(null);
  const [sizeId, setSizeId0] = useState<string>(() => { try { return localStorage.getItem(preferredSizeKey(client.id)) || 'auto'; } catch { return 'auto'; } });
  const setSizeId = (v: string) => { setSizeId0(v); try { localStorage.setItem(preferredSizeKey(client.id), v); } catch { /* private mode */ } };
  /** The frame for a post: the size picked above the sheet, or by channel and format. */
  const sz = (r: Row | null) => (sizeId === 'auto' ? (r ? sizeForRow(r) : SIZES[1]) : preferredSize(client.id, r));
  useEffect(() => { void A.refreshProjects().then(() => refitImported(client.id)).then((n) => { if (n) toast(`Đã sửa khổ ${n} ảnh bài cũ cho đúng tỉ lệ ảnh gốc (không còn bị cắt).`, 'ok'); }); }, [client.id]);
  const designs = s.projects.filter((p) => p.clientId === client.id && p.kind === 'design');
  const byId = new Map(designs.map((d) => [d.id, d]));
  const plans = (cachedItems(client.id) || []).filter((i) => i.kind === 'plan') as Item<Plan>[];
  const today = new Date().toISOString().slice(0, 10);
  const all: Row[] = plans.flatMap((p) => (p.data.rows || []).map((r) => ({ ...r, planId: p.id }))).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const shown = all.filter((r) => (scope === 'all' || ['approved', 'scheduled', 'live'].includes(r.status)) && r.date >= today);
  const dates = [...new Set(shown.map((r) => r.date))];
  const visibleDates = dates.slice(0, days);
  const hasDesign = (r: Row) => (r.designId && byId.has(r.designId)) || designs.some((d) => d.rowRef?.planId === r.planId && d.rowRef.rowId === r.id);
  const week = shown.filter((r) => r.date < new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10) && !hasDesign(r));
  const designOf = (r: Row) => (r.designId ? byId.get(r.designId) : undefined) || designs.find((d) => d.rowRef?.planId === r.planId && d.rowRef.rowId === r.id);
  /** A carousel's slide designs that still exist, in order (empty for a single-picture post). */
  const slidesOf = (r: Row) => (r.slides || []).map((id) => byId.get(id)).filter(Boolean) as typeof designs;
  const loose = designs.filter((d) => !all.some((r) => r.designId === d.id || (d.rowRef?.planId === r.planId && d.rowRef.rowId === r.id)));

  const jobKey = (r: Row) => `${r.planId}:${r.id}`;
  const title = (r: Row) => `${r.date.slice(8, 10)}/${r.date.slice(5, 7)} · ${r.topic}`.slice(0, 70);
  /** AI work on a post runs in the background, in that post's own cell; the user keeps working (several at once). */
  const queueAi = (size: DesignSize, row: Row) => {
    const ask1 = activeCount() === 0; // only a lone job may stop to ask for missing photos
    enqueue(jobKey(row), title(row), (onStage, signal) => designPost(client, size, row, { ai: true, open: false, onStage, signal, askPhotos: ask1 ? (plan) => askPhotos(client, plan) : undefined }));
  };
  const make = async (size: DesignSize, row: Row | null, ai: boolean) => {
    setPicker(null);
    if (row && ai) { queueAi(size, row); return; }
    abort.current = new AbortController();
    setBusy({ label: ai ? 'AI đang thiết kế…' : 'Đang dựng bố cục…' });
    try { await designPost(client, size, row, { ai, onStage: (m) => setBusy({ label: m }), signal: abort.current.signal, askPhotos: (plan) => askPhotos(client, plan) }); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(null); }
  };
  /** AI makes the post's whole video in the background: scene prompts, Google Veo shots, then the edit (text, music, sound). */
  const aiVideo = async (row: Row) => {
    const scenes = 3, seconds = 4 as const;
    if (!(await ask(`AI tạo video ${scenes * seconds} giây cho bài này? Google Veo (bản rẻ nhất) tạo ${scenes} cảnh, rồi tự dựng chữ hook, CTA, nhạc và hiệu ứng âm thanh. Tốn khoảng ${(scenes * seconds * 0.05).toFixed(2)} USD, mất 3–8 phút, chạy nền.`, 'Tạo video', false))) return;
    enqueue(`${jobKey(row)}:v`, `Video ${title(row)}`, async (onStage, signal) => {
      const saved = videoOf(client.id, row);
      const doc = await autoVideo(client, row, { scenes, seconds, onStage, signal, base: saved?.data || null });
      await putItem(client.id, 'video', saved?.id || newId('vid'), { ...doc, thumb: doc.clips[0]?.thumb || '' });
    });
  };
  const jobFor = (r: Row) => J.jobOf(`${jobKey(r)}:v`) || J.jobOf(jobKey(r));
  /** The whole post painted as one finished picture with its text, in the style of the client's past posts. */
  const full = async (row: Row) => {
    if (!pastPosts(client.id).length && !(await ask('Kho chưa có bài cũ nào của khách (nhập từ Drive/Figma ở "Nhập từ link"). AI vẫn vẽ cả bài theo màu thương hiệu, nhưng sẽ không giống y bài cũ. Tiếp tục?', 'Vẫn vẽ', false))) return;
    enqueue(jobKey(row), title(row), (onStage, signal) => paintFullPost(client, sz(row), row, { onStage, signal }));
  };
  /** AI designs every post of the next 7 days that has no picture yet, one after another, without opening the editor. */
  const batch = async () => {
    if (!week.length) return;
    if (!(await ask(`AI thiết kế ${week.length} bài trong 7 ngày tới? Ảnh tạo ngay trong từng bài, 3 bài cùng lúc, xong bài nào báo bài đó. Bạn cứ làm việc khác.`, 'Bắt đầu', false))) return;
    for (const r of week) enqueue(jobKey(r), title(r), (onStage, signal) => designPost(client, sz(r), r, { ai: true, open: false, onStage, signal }));
  };

  return (
    <>
      <PageHead title="Thiết kế" sub="Mỗi bài trong kế hoạch có ảnh riêng, xếp theo ngày đăng. Ảnh nào chưa đẹp: bấm Chỉnh sửa để mở trang edit (layer như Figma, kéo thả đồ hoạ như Canva)."
        actions={write ? <><Btn icon="download" onClick={() => setImporting(true)} title="Nhập kế hoạch từ Google Sheet, ảnh đã làm từ Drive/web">Nhập từ link</Btn>{week.length > 0 && <Btn icon="sparkle" onClick={() => void batch()}>AI thiết kế cả tuần · {week.length}</Btn>}<Btn icon="play" onClick={() => setVideo('new')} title="Dựng video ngắn 9:16 từ footage">Video mới</Btn><Btn kind="primary" icon="plus" onClick={() => setPicker('new')}>Thiết kế mới</Btn></> : undefined} />

      <div class="row wrap" style={{ marginBottom: 12 }}>
        <div class="seg"><button class={layout === 'table' ? 'on' : ''} onClick={() => setLayout('table')}><Icon name="grid" size={13} /> Bảng</button><button class={layout === 'cards' ? 'on' : ''} onClick={() => setLayout('cards')}><Icon name="blocks" size={13} /> Thẻ</button></div>
        <div class="seg"><button class={scope === 'approved' ? 'on' : ''} onClick={() => setScope('approved')}>Bài đã duyệt</button><button class={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Tất cả bài</button></div>
        <label class="mk-sizesel" title="Khổ ảnh cho các thiết kế mới (AI thiết kế, AI vẽ cả bài, Tự thiết kế, Ảnh của bạn)"><Icon name="rect" size={13} /><span>Cỡ ảnh</span>
          <select value={sizeId} onChange={(e) => setSizeId((e.target as HTMLSelectElement).value)}>
            <option value="auto">Tự theo kênh & định dạng</option>
            {SIZES.map((z) => <option key={z.id} value={z.id}>{z.label} · {z.w}×{z.h}</option>)}
          </select>
        </label>
        <span class="dim small">{shown.length} bài từ hôm nay · {shown.filter(hasDesign).length} đã có ảnh</span>
        {J.activeCount > 0 && <span class="chip on mk-jobs-chip"><span class="mk-spin" /> Đang tạo {J.activeCount} ảnh trong nền <button onClick={() => cancelAll()} title="Huỷ tất cả">Huỷ hết</button></span>}
      </div>

      {layout === 'table' && visibleDates.length > 0 && (
        <div class="mk-sheet mk-dsheet" role="grid">
          <table>
            <thead><tr><th class="sticky-c">#</th><th>Ngày</th><th>Giờ</th><th>Kênh</th><th>Ảnh</th><th>Chủ đề</th><th>Hook</th><th>Caption</th><th>CTA</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {visibleDates.map((d) => [
                <tr key={'g' + d} class="grp"><td class="sticky-c"><Icon name="chevron" size={11} /></td><td colSpan={9}><b style={{ textTransform: 'capitalize' }}>{new Date(`${d}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</b>{d === today ? <span class="chip on" style={{ marginLeft: 8 }}>Hôm nay</span> : null}</td></tr>,
                ...shown.filter((r) => r.date === d).map((r, i) => {
                  const des = designOf(r);
                  const c = channelOf(r.channel);
                  return (
                    <tr key={r.planId + r.id} style={{ ['--ch' as string]: c.color }}>
                      <td class="sticky-c mono dim">{i + 1}</td>
                      <td class="mono"><div class="cv">{r.date.slice(8, 10)}/{r.date.slice(5, 7)}</div></td>
                      <td class="mono"><div class="cv">{r.time}</div></td>
                      <td><div class="cv"><span class="mk-chcell"><i style={{ background: c.color }} />{c.label}</span><br /><span class="dim small">{FORMATS.find((f) => f.id === r.format)?.label}</span></div></td>
                      <td class="c-img">
                        {(() => { const j = jobFor(r); return j ? <div class={`mk-job ${j.state}`}>{j.state === 'running' || j.state === 'queued' ? <div class="mk-spin" /> : <Icon name={j.state === 'done' ? 'check' : 'warn'} size={14} />}<span title={j.stage}>{j.stage}</span>{(j.state === 'running' || j.state === 'queued') && <button onClick={() => cancelJob(j.key)} title="Huỷ việc này">Huỷ</button>}</div> : null; })()}
                        <button class={`mk-thumb ${des ? '' : 'empty'}`} onClick={() => (des ? void A.openProject(des.id) : write && void make(sz(r), r, true))} title={des ? 'Bấm để chỉnh sửa ảnh' : 'Chưa có ảnh · bấm để AI thiết kế'} aria-label={des ? `Chỉnh sửa ảnh bài ${r.topic}` : `AI thiết kế ảnh cho ${r.topic}`}>
                          {des?.thumb ? <img src={des.thumb} alt="" loading="lazy" /> : <span><Icon name="sparkle" size={14} /><em>{r.format === 'carousel' ? 'Carousel · chưa có' : 'Chưa có ảnh'}</em></span>}
                          {(slidesOf(r).length > 1 || (r.slidePlan?.length || 0) > 1) && <i class="mk-slide-n" title={r.slidePlan && slidesOf(r).length < r.slidePlan.length ? `Mới có ${slidesOf(r).length}/${r.slidePlan.length} slide` : `${slidesOf(r).length} slide`}>{r.slidePlan && slidesOf(r).length < r.slidePlan.length ? `${slidesOf(r).length}/${r.slidePlan.length} slide` : `1/${slidesOf(r).length}`}</i>}
                          {des?.size && <i class="mk-size-n" title={des.size.label}>{des.size.w}×{des.size.h}</i>}
                        </button>
                        {isVideoRow(r) && (() => { const vd = videoOf(client.id, r); return vd && vd.data.segs.length ? <button class="mk-vchip" onClick={() => setVideo(r)} title="Mở video của bài">{vd.data.thumb ? <img src={vd.data.thumb} alt="" /> : null}<span><Icon name="play" size={10} />Video · {videoTotal(vd.data).toFixed(0)}s</span></button> : null; })()}
                        {slidesOf(r).length > 1 && <div class="mk-slides">{slidesOf(r).slice(1).map((d, k) => <button key={d.id} title={`Slide ${k + 2}`} onClick={() => void A.openProject(d.id)}>{d.thumb ? <img src={d.thumb} alt={`Slide ${k + 2}`} loading="lazy" /> : k + 2}</button>)}</div>}
                        {write && <div class="mk-imgacts">
                          {isVideoRow(r) && <button class="ai" onClick={() => void aiVideo(r)} title="AI tạo cả video cho bài: Google Veo tạo cảnh, tự dựng chữ, nhạc, hiệu ứng (~0,60 USD)"><Icon name="sparkle" size={12} />{videoOf(client.id, r) ? 'AI tạo lại video' : 'AI tạo video'}</button>}
                          {isVideoRow(r) && <button class="ai" onClick={() => setVideo(r)} title="Dựng video Reel/TikTok từ footage thật (và cảnh AI) theo công thức video triệu view"><Icon name="play" size={12} />{videoOf(client.id, r) ? 'Mở video' : 'Dựng video'}</button>}
                          {des
                            ? <button class="ai" onClick={async () => { if (await ask('AI thiết kế lại ảnh của bài này? Ảnh cũ vẫn giữ trong danh sách thiết kế.', 'Gen lại', false)) void make(sz(r), r, true); }} title="AI vẽ và dựng lại ảnh cho bài này"><Icon name="sparkle" size={12} />AI gen lại</button>
                            : <button class="ai" onClick={() => void make(sz(r), r, true)} title="AI vẽ ảnh và dựng bố cục theo nội dung bài"><Icon name="sparkle" size={12} />AI thiết kế</button>}
                          {r.format === 'carousel' && r.slidePlan && (r.slides?.length || 0) < r.slidePlan.length && (r.slides?.length || 0) > 0 && <button class="ai" onClick={() => enqueue(jobKey(r), title(r), (onStage, signal) => designPost(client, sz(r), r, { ai: true, open: false, onStage, signal, resume: true }))} title="Làm nốt các slide carousel còn thiếu, giữ các slide đã có"><Icon name="sparkle" size={12} />Làm tiếp {r.slidePlan.length - (r.slides?.length || 0)} slide</button>}
                          {des && <button onClick={async () => { const ids = slidesOf(r).length > 1 ? slidesOf(r).map((d) => d.id) : [des.id]; toast(ids.length > 1 ? `Đang xuất ${ids.length} slide HD…` : 'Đang xuất ảnh HD…', 'info'); try { await downloadPost(ids, title(r)); } catch (e) { toast((e as Error).message, 'err'); } }} title="Tải ảnh HD (PNG gấp đôi khung, ví dụ 2160×2700); carousel tải cả bộ slide trong 1 file ZIP"><Icon name="download" size={12} />{slidesOf(r).length > 1 ? `Tải ${slidesOf(r).length} slide HD` : 'Tải ảnh HD'}</button>}
                          <button class="ai" onClick={() => void full(r)} title="AI vẽ nguyên bài hoàn chỉnh, có sẵn toàn bộ chữ, giống phong cách các bài cũ của khách"><Icon name="image" size={12} />AI vẽ cả bài</button>
                          <button onClick={() => (des ? void A.openProject(des.id) : void make(sz(r), r, false))} title={des ? 'Mở trang chỉnh sửa (layer, chữ, đồ hoạ)' : 'Dựng bố cục trống theo thương hiệu rồi tự chỉnh'}><Icon name="text" size={12} />Tự thiết kế</button>
                          <button onClick={() => setOwn(r)} title="Dùng ảnh có sẵn: tải lên, dán, hoặc chọn từ kho"><Icon name="upload" size={12} />{des ? 'Đổi ảnh' : 'Ảnh của bạn'}</button>
                        </div>}
                      </td>
                      <td class="c-topic"><div class="cv">{r.topic}</div></td>
                      <td><div class="cv">{r.hook}</div></td>
                      <td class="c-cap"><div class="cv">{r.caption}</div></td>
                      <td><div class="cv">{r.cta}</div></td>
                      <td><div class="cv"><StatusChip s={r.status} /></div></td>
                    </tr>
                  );
                }),
              ])}
            </tbody>
          </table>
        </div>
      )}
      {layout === 'cards' && (visibleDates.length ? visibleDates.map((d) => (
        <section key={d} class="mk-day-row">
          <div class="mk-day-h"><b>{new Date(`${d}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</b>{d === today && <span class="chip on">Hôm nay</span>}</div>
          <div class="mk-posts">
            {shown.filter((r) => r.date === d).map((r) => {
              // the pinned design, else the newest design made for this post (older ones were made before pinning existed)
              const des = designOf(r);
              const c = channelOf(r.channel);
              const z = des?.size || sz(r);
              return (
                <article key={r.planId + r.id} class="mk-post">
                  <header class="row"><span class="mk-chcell"><i style={{ background: c.color }} />{c.label}</span><span class="dim small">{r.time} · {FORMATS.find((f) => f.id === r.format)?.label}</span><span class="grow" /><StatusChip s={r.status} /></header>
                  {(() => { const j = jobFor(r); return j ? <div class={`mk-job ${j.state}`}>{j.state === 'running' || j.state === 'queued' ? <div class="mk-spin" /> : <Icon name={j.state === 'done' ? 'check' : 'warn'} size={14} />}<span title={j.stage}>{j.stage}</span>{(j.state === 'running' || j.state === 'queued') && <button onClick={() => cancelJob(j.key)}>Huỷ</button>}</div> : null; })()}
                  <div class={`pv ${des ? '' : 'empty'}`} style={{ aspectRatio: `${z.w} / ${z.h}` }} onClick={() => (des ? void A.openProject(des.id) : write && void make(sz(r), r, true))} role="button" tabIndex={0} title={des ? 'Bấm để chỉnh sửa' : 'Bấm để AI thiết kế bài này'}>
                    {des?.thumb ? <img src={des.thumb} alt={`Ảnh bài ${r.topic}`} loading="lazy" /> : <div class="ph"><Icon name="image" size={22} /><span>{r.visual ? r.visual.slice(0, 90) : 'Chưa có ảnh'}</span></div>}
                  </div>
                  <b class="mk-clamp">{r.topic}</b>
                  {(r.hook || r.caption) && <p class="small muted mk-clamp">{r.hook || r.caption}</p>}
                  {write && <div class="row wrap">
                    {isVideoRow(r) && <Btn xs icon="sparkle" onClick={() => void aiVideo(r)}>AI tạo video</Btn>}
                    {isVideoRow(r) && <Btn xs icon="play" onClick={() => setVideo(r)}>{videoOf(client.id, r) ? 'Mở video' : 'Dựng video'}</Btn>}
                    {des ? <>
                      <Btn xs icon="text" onClick={() => void A.openProject(des.id)}>Chỉnh sửa</Btn>
                      <Btn xs icon="sparkle" onClick={async () => { if (await ask('AI thiết kế lại ảnh của bài này? Ảnh cũ vẫn giữ trong danh sách thiết kế.', 'Gen lại', false)) void make(sz(r), r, true); }}>AI gen lại</Btn>
                    </> : <>
                      <Btn xs icon="sparkle" onClick={() => void make(sz(r), r, true)}>AI thiết kế</Btn>
                      <Btn xs icon="rect" onClick={() => void make(sz(r), r, false)}>Tự thiết kế</Btn>
                      <Btn xs kind="ghost" icon="upload" onClick={() => setOwn(r)}>Ảnh của bạn</Btn>
                      <Btn xs kind="ghost" onClick={() => setPicker(r)}>Khổ khác…</Btn>
                    </>}
                  </div>}
                </article>
              );
            })}
          </div>
        </section>
      )) : null)}
      {!visibleDates.length && plans.length ? <div class="mk-none">Không có bài nào từ hôm nay{scope === 'approved' ? ' đã được duyệt. Chọn "Tất cả bài" hoặc duyệt bài trong Kế hoạch.' : '.'}</div> : null}
      {dates.length > days && <div class="row" style={{ justifyContent: 'center', margin: '8px 0 16px' }}><Btn sm onClick={() => setDays(days + 14)}>Xem thêm {Math.min(14, dates.length - days)} ngày</Btn></div>}

      {looseVideos.length > 0 && (
        <section class="mk-card">
          <div class="mk-card-h"><b>Video</b><span class="dim small">không gắn với bài nào · {looseVideos.length}</span></div>
          <div class="mk-designs">
            {looseVideos.map((i) => (
              <div key={i.id} class="mk-design" onClick={() => setVideo({ id: i.id })} role="button" tabIndex={0}>
                <div class="pv" style={{ aspectRatio: '9 / 16' }}>{i.data.thumb ? <img src={i.data.thumb} alt="" /> : <Icon name="play" size={24} />}</div>
                <div class="meta"><b class="mk-ell">{i.data.title}</b><span class="dim small">{i.data.segs.length} cảnh · {fmtDate(i.updatedAt)}</span></div>
              </div>
            ))}
          </div>
        </section>
      )}
      {loose.length > 0 && (
        <section class="mk-card">
          <div class="mk-card-h"><b>Thiết kế khác</b><span class="dim small">không gắn với bài nào · {loose.length}</span></div>
          <div class="mk-designs">
            {loose.map((p) => (
              <div key={p.id} class="mk-design" onClick={() => void A.openProject(p.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') void A.openProject(p.id); }}>
                <div class="pv" style={{ aspectRatio: p.size ? `${p.size.w} / ${p.size.h}` : '1' }}>{p.thumb ? <img src={p.thumb} alt="" /> : <Icon name="image" size={24} />}</div>
                <div class="meta"><b class="mk-ell">{p.name}</b><span class="dim small">{p.size ? `${p.size.w}×${p.size.h}` : ''} · {fmtDate(p.updatedAt)}</span></div>
                {write && <div class="acts">
                  <Btn xs kind="ghost" icon="copy" title="Nhân bản" onClick={(e) => { e.stopPropagation(); void A.duplicateProject(p.id); }} />
                  <Btn xs kind="ghost" icon="trash" title="Xoá thiết kế" onClick={async (e) => { e.stopPropagation(); if (await ask(`Xoá "${p.name}"?`)) void A.deleteProject(p.id); }} />
                </div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section class="mk-card">
        <div class="mk-card-h"><b>Kho ảnh của {client.name}</b><span class="dim small">riêng khách này · dùng được trong mọi thiết kế và email của khách</span></div>
        <div style={{ padding: 12 }}><ClientLibrary clientId={client.id} big /></div>
      </section>

      {!plans.length && <Empty icon="layers" title="Chưa có kế hoạch" action={<Btn onClick={() => go({ view: 'client', id: client.id, tab: 'plan' })}>Soạn kế hoạch</Btn>}>Bài trong kế hoạch tự thành ô ảnh theo ngày ở đây.</Empty>}

      {video && <VideoStudio client={client} row={video === 'new' || !('planId' in video) ? null : video} openId={typeof video === 'object' && !('planId' in video) ? video.id : undefined} onClose={() => setVideo(null)} />}
      {importing && <ImportData client={client} onClose={() => setImporting(false)} />}
      {own && <OwnImage client={client} row={own} onClose={() => setOwn(null)} />}
      {picker && <SizePicker row={picker === 'new' ? null : picker} onClose={() => setPicker(null)} onPick={(z, ai) => void make(z, picker === 'new' ? null : picker, ai)} />}
      {busy && <Modal title="Phloem Design" icon="sparkle" narrow onClose={() => abort.current?.abort()} footer={<Btn kind="ghost" onClick={() => abort.current?.abort()}>{busy.total ? 'Dừng' : 'Huỷ'}</Btn>}>
        <div class="row"><div class="mk-spin" /><span>{busy.label}</span></div>
        {busy.total ? <div class="mk-prog-bar"><i style={{ width: `${Math.max(4, ((busy.done || 0) / busy.total) * 100)}%` }} /></div> : null}
        <span class="dim small">{busy.total ? `Bài ${(busy.done || 0) + 1}/${busy.total}. Ảnh xong tới đâu gắn vào bài tới đó; dừng lúc nào cũng được.` : 'AI thiết kế mất khoảng 30–90 giây; bố cục mẫu mất vài giây. Kết quả mở trong trang edit, mọi chữ, hình, ảnh đều là layer chỉnh được.'}</span>
      </Modal>}
    </>
  );
}

/** Use the client's own picture for a post: upload, paste (⌘V) or pick from the library; it is pinned to the post. */
function OwnImage({ client, row, onClose }: { client: Client; row: Row; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const use = async (id: string) => { setBusy(true); try { await designFromImage(client, row, id); toast('Đã gắn ảnh vào bài. Bấm vào ảnh để chỉnh thêm chữ, logo, đồ hoạ.', 'ok'); onClose(); } catch (e) { toast((e as Error).message, 'err'); setBusy(false); } };
  const fromFiles = async (files: File[]) => { const ids = await addClientImages(client.id, files, 'upload'); if (ids[0]) await use(ids[0]); };
  useEffect(() => {
    const h = (e: ClipboardEvent) => { const f = Array.from(e.clipboardData?.files || []).filter((x) => x.type.startsWith('image/')); if (f.length) { e.preventDefault(); void fromFiles(f); } };
    window.addEventListener('paste', h); return () => window.removeEventListener('paste', h);
  }, []);
  const lib = clientImages(client.id);
  return (
    <Modal title={`Ảnh cho bài: ${row.topic}`} icon="image" onClose={onClose}>
      <div data-own-paste class="col" style={{ gap: 12 }}>
        <label class="mk-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void fromFiles(Array.from(e.dataTransfer?.files || [])); }}>
          <Icon name="upload" size={20} /><span>{busy ? 'Đang gắn ảnh…' : 'Kéo thả ảnh vào đây, bấm để chọn file, hoặc dán (⌘V)'}</span>
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = Array.from((e.target as HTMLInputElement).files || []); (e.target as HTMLInputElement).value = ''; void fromFiles(f); }} />
        </label>
        {lib.length > 0 && <><span class="small muted">Hoặc chọn từ kho ảnh của {client.name}</span>
          <div class="asset-grid mk-pick-grid">{lib.slice(0, 60).map((a) => <button key={a.id} class="asset" disabled={busy} onClick={() => void use(a.id)} title={`${a.name} · ${a.w}×${a.h}`}>{assets.url(a.id) ? <img src={assets.url(a.id)} alt={a.name} loading="lazy" /> : null}<div class="nm">{a.name}</div></button>)}</div></>}
        <span class="dim small">Ảnh lấp đầy khung {preferredSize(client.id, row).label} ({preferredSize(client.id, row).w}×{preferredSize(client.id, row).h}), đổi ở ô Cỡ ảnh trên bảng. Muốn thêm chữ, logo: bấm Chỉnh sửa sau khi gắn.</span>
      </div>
    </Modal>
  );
}

function SizePicker({ row, onClose, onPick }: { row: Row | null; onClose: () => void; onPick: (z: DesignSize, ai: boolean) => void }) {
  const [z, setZ] = useState<DesignSize>(row ? sizeForRow(row) : SIZES[1]);
  return (
    <Modal title={row ? `Thiết kế: ${row.topic}` : 'Thiết kế mới'} icon="shapes" onClose={onClose}
      footer={<><Btn kind="ghost" onClick={() => onPick(z, false)}>Tự thiết kế</Btn><Btn kind="primary" icon="sparkle" onClick={() => onPick(z, true)}>AI thiết kế</Btn></>}>
      <div class="mk-size-grid">
        {SIZES.map((x) => (
          <button key={x.id} class={z.id === x.id ? 'on' : ''} onClick={() => setZ(x)}>
            <span class="box" style={{ aspectRatio: `${x.w} / ${x.h}` }} />
            <b>{x.label}</b><span class="dim small">{x.group}</span><span class="mono dim small">{x.w}×{x.h}</span>
          </button>
        ))}
      </div>
      {row && <div class="dim small">Khổ gợi ý theo kênh {channelOf(row.channel).label} · {FORMATS.find((f) => f.id === row.format)?.label}. Trạng thái bài: <StatusChip s={row.status} /></div>}
    </Modal>
  );
}
