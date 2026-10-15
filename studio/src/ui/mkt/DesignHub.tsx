// Tab Thiết kế của một khách (Phloem Design): việc thiết kế từ kế hoạch, các thiết kế đã làm, kho ảnh riêng của khách.
import { useEffect, useRef, useState } from 'preact/hooks';
import { toast, useStore } from '../../store';
import * as A from '../../pipeline/actions';
import { cachedItems } from '../../mkt/data';
import { SIZES, newDesign, sizeForRow, type DesignSize } from '../../mkt/designs';
import { canWrite, channelOf, FORMATS, type Client, type Item, type Plan, type PlanRow } from '../../mkt/types';
import { go } from '../../mkt/router';
import { Btn, Modal } from '../components';
import { Icon } from '../icons';
import { ask } from '../confirm';
import { Empty, PageHead, StatusChip, fmtDate } from './bits';
import { ClientLibrary } from './ClientLibrary';

type Row = PlanRow & { planId: string };

export function DesignHub({ client }: { client: Client }) {
  const s = useStore();
  const write = canWrite(client.role) && !client.shared;
  const [picker, setPicker] = useState<Row | null | 'new'>(null);
  const [busy, setBusy] = useState<{ label: string; done?: number; total?: number } | null>(null);
  const [scope, setScope] = useState<'approved' | 'all'>('approved');
  const [days, setDays] = useState(14);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { void A.refreshProjects(); }, []);
  const designs = s.projects.filter((p) => p.clientId === client.id && p.kind === 'design');
  const byId = new Map(designs.map((d) => [d.id, d]));
  const plans = (cachedItems(client.id) || []).filter((i) => i.kind === 'plan') as Item<Plan>[];
  const today = new Date().toISOString().slice(0, 10);
  const all: Row[] = plans.flatMap((p) => (p.data.rows || []).map((r) => ({ ...r, planId: p.id }))).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const shown = all.filter((r) => (scope === 'all' || ['approved', 'scheduled', 'live'].includes(r.status)) && r.date >= today);
  const dates = [...new Set(shown.map((r) => r.date))];
  const visibleDates = dates.slice(0, days);
  const week = shown.filter((r) => r.date < new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10) && !(r.designId && byId.has(r.designId)));
  const loose = designs.filter((d) => !d.rowRef || !all.some((r) => r.designId === d.id));

  const make = async (size: DesignSize, row: Row | null, ai: boolean) => {
    setPicker(null);
    abort.current = new AbortController();
    setBusy({ label: ai ? 'AI đang thiết kế…' : 'Đang dựng bố cục…' });
    try { await newDesign(client, size, row, { ai, onStage: (m) => setBusy({ label: m }), signal: abort.current.signal }); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(null); }
  };
  /** AI designs every post of the next 7 days that has no picture yet, one after another, without opening the editor. */
  const batch = async () => {
    if (!week.length) return;
    if (!(await ask(`AI thiết kế ${week.length} bài trong 7 ngày tới? Mỗi bài khoảng 1–2 phút, ảnh tự gắn vào đúng bài. Bạn vẫn xem và chỉnh từng ảnh sau.`, 'Bắt đầu', false))) return;
    abort.current = new AbortController();
    let ok = 0;
    for (let i = 0; i < week.length; i++) {
      if (abort.current.signal.aborted) break;
      const r = week[i];
      setBusy({ label: `${r.date.slice(8, 10)}/${r.date.slice(5, 7)} · ${r.topic}`, done: i, total: week.length });
      try { await newDesign(client, sizeForRow(r), r, { ai: true, open: false, signal: abort.current.signal, onStage: (m) => setBusy({ label: `${r.date.slice(8, 10)}/${r.date.slice(5, 7)} · ${r.topic} · ${m}`, done: i, total: week.length }) }); ok++; }
      catch (e) { if (abort.current.signal.aborted) break; toast(`${r.topic}: ${(e as Error).message}`, 'err'); }
    }
    setBusy(null);
    toast(`Xong ${ok}/${week.length} ảnh. Bấm vào ảnh nào chưa ưng để chỉnh.`, 'ok');
  };

  return (
    <>
      <PageHead title="Thiết kế" sub="Mỗi bài trong kế hoạch có ảnh riêng, xếp theo ngày đăng. Ảnh nào chưa đẹp: bấm Chỉnh sửa để mở trang edit (layer như Figma, kéo thả đồ hoạ như Canva)."
        actions={write ? <>{week.length > 0 && <Btn icon="sparkle" onClick={() => void batch()}>AI thiết kế cả tuần · {week.length}</Btn>}<Btn kind="primary" icon="plus" onClick={() => setPicker('new')}>Thiết kế mới</Btn></> : undefined} />

      <div class="row wrap" style={{ marginBottom: 12 }}>
        <div class="seg"><button class={scope === 'approved' ? 'on' : ''} onClick={() => setScope('approved')}>Bài đã duyệt</button><button class={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Tất cả bài</button></div>
        <span class="dim small">{shown.length} bài từ hôm nay · {shown.filter((r) => r.designId && byId.has(r.designId)).length} đã có ảnh</span>
      </div>

      {visibleDates.length ? visibleDates.map((d) => (
        <section key={d} class="mk-day-row">
          <div class="mk-day-h"><b>{new Date(`${d}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</b>{d === today && <span class="chip on">Hôm nay</span>}</div>
          <div class="mk-posts">
            {shown.filter((r) => r.date === d).map((r) => {
              const des = r.designId ? byId.get(r.designId) : undefined;
              const c = channelOf(r.channel);
              const z = des?.size || sizeForRow(r);
              return (
                <article key={r.planId + r.id} class="mk-post">
                  <header class="row"><span class="mk-chcell"><i style={{ background: c.color }} />{c.label}</span><span class="dim small">{r.time} · {FORMATS.find((f) => f.id === r.format)?.label}</span><span class="grow" /><StatusChip s={r.status} /></header>
                  <div class={`pv ${des ? '' : 'empty'}`} style={{ aspectRatio: `${z.w} / ${z.h}` }} onClick={() => (des ? void A.openProject(des.id) : write && void make(sizeForRow(r), r, true))} role="button" tabIndex={0} title={des ? 'Bấm để chỉnh sửa' : 'Bấm để AI thiết kế bài này'}>
                    {des?.thumb ? <img src={des.thumb} alt={`Ảnh bài ${r.topic}`} loading="lazy" /> : <div class="ph"><Icon name="image" size={22} /><span>{r.visual ? r.visual.slice(0, 90) : 'Chưa có ảnh'}</span></div>}
                  </div>
                  <b class="mk-clamp">{r.topic}</b>
                  {(r.hook || r.caption) && <p class="small muted mk-clamp">{r.hook || r.caption}</p>}
                  {write && <div class="row wrap">
                    {des ? <>
                      <Btn xs icon="text" onClick={() => void A.openProject(des.id)}>Chỉnh sửa</Btn>
                      <Btn xs icon="sparkle" onClick={async () => { if (await ask('AI thiết kế lại ảnh của bài này? Ảnh cũ vẫn giữ trong danh sách thiết kế.', 'Làm lại', false)) void make(sizeForRow(r), r, true); }}>Làm lại</Btn>
                    </> : <>
                      <Btn xs icon="sparkle" onClick={() => void make(sizeForRow(r), r, true)}>AI thiết kế</Btn>
                      <Btn xs icon="rect" onClick={() => void make(sizeForRow(r), r, false)}>Tự thiết kế</Btn>
                      <Btn xs kind="ghost" onClick={() => setPicker(r)}>Khổ khác…</Btn>
                    </>}
                  </div>}
                </article>
              );
            })}
          </div>
        </section>
      )) : plans.length ? <div class="mk-none">Không có bài nào từ hôm nay{scope === 'approved' ? ' đã được duyệt. Chọn "Tất cả bài" hoặc duyệt bài trong Kế hoạch.' : '.'}</div> : null}
      {dates.length > days && <div class="row" style={{ justifyContent: 'center', margin: '8px 0 16px' }}><Btn sm onClick={() => setDays(days + 14)}>Xem thêm {Math.min(14, dates.length - days)} ngày</Btn></div>}

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

      {picker && <SizePicker row={picker === 'new' ? null : picker} onClose={() => setPicker(null)} onPick={(z, ai) => void make(z, picker === 'new' ? null : picker, ai)} />}
      {busy && <Modal title="Phloem Design" icon="sparkle" narrow onClose={() => abort.current?.abort()} footer={<Btn kind="ghost" onClick={() => abort.current?.abort()}>{busy.total ? 'Dừng' : 'Huỷ'}</Btn>}>
        <div class="row"><div class="mk-spin" /><span>{busy.label}</span></div>
        {busy.total ? <div class="mk-prog-bar"><i style={{ width: `${Math.max(4, ((busy.done || 0) / busy.total) * 100)}%` }} /></div> : null}
        <span class="dim small">{busy.total ? `Bài ${(busy.done || 0) + 1}/${busy.total}. Ảnh xong tới đâu gắn vào bài tới đó; dừng lúc nào cũng được.` : 'AI thiết kế mất khoảng 30–90 giây; bố cục mẫu mất vài giây. Kết quả mở trong trang edit, mọi chữ, hình, ảnh đều là layer chỉnh được.'}</span>
      </Modal>}
    </>
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
