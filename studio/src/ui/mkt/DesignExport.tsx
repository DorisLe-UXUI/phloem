// Right panel "Xuất ảnh" for Phloem Design: download PNG/JPG, Đổi cỡ thần kỳ, and hand the design to the plan row.
import { useState } from 'preact/hooks';
import { get, toast, useStore } from '../../store';
import * as A from '../../pipeline/actions';
import { SIZES, exportDesign, magicResize } from '../../mkt/designs';
import { cachedItems, putItem } from '../../mkt/data';
import type { Plan } from '../../mkt/types';
import { Btn, Eyebrow } from '../components';
import { Icon } from '../icons';

export function DesignExport() {
  const s = useStore();
  const p = s.project!;
  const [scale, setScale] = useState(1);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => { const n = new Set(pick); n.has(id) ? n.delete(id) : n.add(id); setPick(n); };
  const row = p.rowRef && p.clientId ? (cachedItems(p.clientId)?.find((i) => i.kind === 'plan' && i.id === p.rowRef!.planId)?.data as Plan | undefined)?.rows.find((r) => r.id === p.rowRef!.rowId) : undefined;

  const markDone = async () => {
    if (!p.rowRef || !p.clientId) return;
    const it = cachedItems(p.clientId)?.find((i) => i.kind === 'plan' && i.id === p.rowRef!.planId); if (!it) { toast('Không tìm thấy kế hoạch của bài này.', 'err'); return; }
    const plan = it.data as Plan; const version = (plan.version || 1) + 1;
    if (get().dirty) await A.saveProject();
    await putItem(p.clientId, 'plan', it.id, { ...plan, rows: plan.rows.map((r) => (r.id === p.rowRef!.rowId ? { ...r, designId: p.id, status: r.status === 'approved' ? 'scheduled' : r.status } : r)), version, versions: [...(plan.versions || []), { version, at: new Date().toISOString(), by: get().user?.name || 'Bạn', note: `Thiết kế xong: ${row?.topic || p.name}` }].slice(-40) });
    toast('Đã gắn thiết kế vào bài và chuyển sang Lịch đăng.', 'ok');
  };

  return (
    <div class="section">
      <Eyebrow>Tải ảnh</Eyebrow>
      <div class="seg block">{[1, 2].map((k) => <button key={k} class={scale === k ? 'on' : ''} onClick={() => setScale(k)}>{k}× · {p.desktop.width * k}×{p.desktop.height * k}</button>)}</div>
      <div class="grid2">
        <Btn icon="download" onClick={() => void exportDesign('png', scale)}>PNG</Btn>
        <Btn icon="download" onClick={() => void exportDesign('jpg', scale)}>JPG</Btn>
      </div>
      <div class="dim small">PNG giữ nét chữ và nền trong; JPG nhẹ hơn cho ảnh chụp.</div>

      <Eyebrow>Đổi cỡ thần kỳ</Eyebrow>
      <div class="dim small">Tạo bản sao ở các khổ khác. Nền giãn theo khung, chữ và hình giữ tỉ lệ; chỉnh lại vài chỗ nếu cần.</div>
      <div class="mk-sizes">
        {SIZES.filter((z) => z.id !== p.size?.id).map((z) => (
          <label key={z.id} class={pick.has(z.id) ? 'on' : ''}><input type="checkbox" checked={pick.has(z.id)} onChange={() => toggle(z.id)} /><span class="grow">{z.label}<em>{z.group}</em></span><span class="mono dim">{z.w}×{z.h}</span></label>
        ))}
      </div>
      <Btn block icon="copy" disabled={!pick.size || busy} onClick={async () => { setBusy(true); try { await magicResize([...pick]); setPick(new Set()); } finally { setBusy(false); } }}>Tạo {pick.size || ''} bản</Btn>

      {p.rowRef && <>
        <Eyebrow>Bài trong kế hoạch</Eyebrow>
        {row ? <div class="mk-rowref"><b>{row.topic}</b><span class="dim small">{row.date.split('-').reverse().join('/')} {row.time} · {row.channel}</span>{row.caption && <p class="small muted">{row.caption.slice(0, 160)}{row.caption.length > 160 ? '…' : ''}</p>}</div> : <div class="dim small">Bài gốc không còn trong kế hoạch.</div>}
        {row && <Btn block kind="primary" icon="check" onClick={() => void markDone()}>Duyệt ảnh · chuyển sang Lịch đăng</Btn>}
      </>}
      <div class="dim small"><Icon name="info" size={12} /> Phloem không tự đăng. Ở Lịch đăng: tải ảnh, copy caption, đăng trên nền tảng.</div>
    </div>
  );
}
