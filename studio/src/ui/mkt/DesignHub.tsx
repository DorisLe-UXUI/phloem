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
  const [busy, setBusy] = useState<{ label: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { void A.refreshProjects(); }, []);
  const designs = s.projects.filter((p) => p.clientId === client.id && p.kind === 'design');
  const plans = (cachedItems(client.id) || []).filter((i) => i.kind === 'plan') as Item<Plan>[];
  const todo: Row[] = plans.flatMap((p) => (p.data.rows || []).filter((r) => r.status === 'approved' && !r.designId).map((r) => ({ ...r, planId: p.id }))).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const make = async (size: DesignSize, row: Row | null, ai: boolean) => {
    setPicker(null);
    abort.current = new AbortController();
    setBusy({ label: ai ? 'AI đang thiết kế…' : 'Đang dựng bố cục…' });
    try { await newDesign(client, size, row, { ai, onStage: (m) => setBusy({ label: m }), signal: abort.current.signal }); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(null); }
  };

  return (
    <>
      <PageHead title="Thiết kế" sub="Phloem Design: ảnh bài đăng và quảng cáo theo đúng khổ từng kênh, chỉnh từng layer như Figma, kéo thả đồ hoạ như Canva, theo brand kit của khách."
        actions={write ? <Btn kind="primary" icon="plus" onClick={() => setPicker('new')}>Thiết kế mới</Btn> : undefined} />

      {todo.length > 0 && (
        <section class="mk-card">
          <div class="mk-card-h"><b>Cần thiết kế · từ kế hoạch</b><span class="dim small">{todo.length} bài đã duyệt chưa có ảnh</span></div>
          <div class="mk-todo">
            {todo.slice(0, 24).map((r) => (
              <div key={r.planId + r.id} class="mk-wcard" style={{ borderTopColor: channelOf(r.channel).color }}>
                <div class="row"><span class="mk-chcell"><i style={{ background: channelOf(r.channel).color }} />{channelOf(r.channel).label}</span><span class="dim small">{FORMATS.find((f) => f.id === r.format)?.label}</span><span class="grow" /><span class="mono small dim">{r.date.slice(8, 10)}/{r.date.slice(5, 7)}</span></div>
                <b>{r.topic}</b>
                {r.visual && <p class="small muted mk-clamp"><Icon name="image" size={12} /> {r.visual}</p>}
                {write && <div class="row wrap">
                  <Btn xs icon="sparkle" onClick={() => void make(sizeForRow(r), r, true)} title={`AI thiết kế ở khổ ${sizeForRow(r).label}`}>AI thiết kế</Btn>
                  <Btn xs icon="rect" onClick={() => void make(sizeForRow(r), r, false)} title="Mở bố cục mẫu rồi tự chỉnh">Tự thiết kế</Btn>
                  <Btn xs kind="ghost" onClick={() => setPicker(r)}>Khổ khác…</Btn>
                </div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section class="mk-card">
        <div class="mk-card-h"><b>Thiết kế của {client.name}</b><span class="dim small">{designs.length}</span></div>
        {designs.length ? (
          <div class="mk-designs">
            {designs.map((p) => (
              <div key={p.id} class="mk-design" onClick={() => void A.openProject(p.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') void A.openProject(p.id); }}>
                <div class="pv" style={{ aspectRatio: p.size ? `${p.size.w} / ${p.size.h}` : '1' }}>{p.thumb ? <img src={p.thumb} alt="" /> : <Icon name="image" size={24} />}</div>
                <div class="meta"><b class="mk-ell">{p.name}</b><span class="dim small">{p.size ? `${p.size.w}×${p.size.h}` : ''} · {fmtDate(p.updatedAt)}{p.rowRef ? ' · có trong kế hoạch' : ''}</span></div>
                {write && <div class="acts">
                  <Btn xs kind="ghost" icon="copy" title="Nhân bản" onClick={(e) => { e.stopPropagation(); void A.duplicateProject(p.id); }} />
                  <Btn xs kind="ghost" icon="trash" title="Xoá thiết kế" onClick={async (e) => { e.stopPropagation(); if (await ask(`Xoá "${p.name}"?`)) void A.deleteProject(p.id); }} />
                </div>}
              </div>
            ))}
          </div>
        ) : <div class="mk-none">Chưa có thiết kế nào. {todo.length ? 'Bấm AI thiết kế ở một bài phía trên,' : 'Duyệt bài trong kế hoạch, hoặc'} bấm Thiết kế mới.</div>}
      </section>

      <section class="mk-card">
        <div class="mk-card-h"><b>Kho ảnh của {client.name}</b><span class="dim small">riêng khách này · dùng được trong mọi thiết kế và email của khách</span></div>
        <div style={{ padding: 12 }}><ClientLibrary clientId={client.id} big /></div>
      </section>

      {!plans.length && <Empty icon="layers" title="Chưa có kế hoạch" action={<Btn onClick={() => go({ view: 'client', id: client.id, tab: 'plan' })}>Soạn kế hoạch</Btn>}>Bài đã duyệt trong kế hoạch tự thành việc thiết kế ở đây.</Empty>}

      {picker && <SizePicker row={picker === 'new' ? null : picker} onClose={() => setPicker(null)} onPick={(z, ai) => void make(z, picker === 'new' ? null : picker, ai)} />}
      {busy && <Modal title="Phloem Design" icon="sparkle" narrow onClose={() => abort.current?.abort()} footer={<Btn kind="ghost" onClick={() => abort.current?.abort()}>Huỷ</Btn>}>
        <div class="row"><div class="mk-spin" /><span>{busy.label}</span></div>
        <span class="dim small">AI thiết kế mất khoảng 30–90 giây; bố cục mẫu mất vài giây. Kết quả mở trong editor, mọi chữ, hình, ảnh đều là layer chỉnh được.</span>
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
