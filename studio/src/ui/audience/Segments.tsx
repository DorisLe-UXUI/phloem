// Phân nhóm: saved rule sets over a list (tags, fields, activity), with a live count.
import { useEffect, useState } from 'preact/hooks';
import { toast } from '../../store';
import { deleteSegment, listTags, previewRules, saveSegment, segments as fetchSegments, type AudList, type Rule, type Segment } from '../../pipeline/audience';
import { Btn, Field, Seg, TextInput } from '../components';
import { ask } from '../confirm';
import type { AudCtx } from './AudiencePage';

type Kind = 'tag' | 'text' | 'number';
const FIELDS: { v: string; label: string; kind: Kind }[] = [
  { v: 'tag', label: 'Tag', kind: 'tag' },
  { v: 'email', label: 'Email', kind: 'text' }, { v: 'email_domain', label: 'Tên miền email', kind: 'text' },
  { v: 'first_name', label: 'Tên', kind: 'text' }, { v: 'last_name', label: 'Họ', kind: 'text' }, { v: 'source', label: 'Nguồn (form / nhập / thêm tay)', kind: 'text' },
  { v: 'opens', label: 'Số lần mở', kind: 'number' }, { v: 'clicks', label: 'Số lần click', kind: 'number' },
  { v: 'days_since_open', label: 'Số ngày chưa mở email', kind: 'number' }, { v: 'days_since_click', label: 'Số ngày chưa click', kind: 'number' }, { v: 'days_since_signup', label: 'Số ngày từ khi đăng ký', kind: 'number' },
];
const OPS: Record<Kind, { v: string; label: string }[]> = {
  tag: [{ v: 'has', label: 'có' }, { v: 'not_has', label: 'không có' }],
  text: [{ v: 'eq', label: 'là' }, { v: 'neq', label: 'không là' }, { v: 'contains', label: 'chứa' }, { v: 'not_contains', label: 'không chứa' }, { v: 'empty', label: 'trống' }, { v: 'not_empty', label: 'có giá trị' }],
  number: [{ v: 'gt', label: 'lớn hơn' }, { v: 'lt', label: 'nhỏ hơn' }, { v: 'eq', label: 'bằng' }],
};
/** Ready-made segments every shop asks for. */
const PRESETS: { name: string; match: 'all' | 'any'; rules: Rule[] }[] = [
  { name: 'Hay mở mail (mở ≥ 3 lần)', match: 'all', rules: [{ field: 'opens', op: 'gt', value: '2' }] },
  { name: 'Đã click', match: 'all', rules: [{ field: 'clicks', op: 'gt', value: '0' }] },
  { name: 'Ngủ đông (90 ngày chưa mở)', match: 'all', rules: [{ field: 'days_since_open', op: 'gt', value: '90' }] },
  { name: 'Người mới (7 ngày)', match: 'all', rules: [{ field: 'days_since_signup', op: 'lt', value: '8' }] },
  { name: 'Dùng Gmail', match: 'all', rules: [{ field: 'email_domain', op: 'eq', value: 'gmail.com' }] },
];

export function SegmentsTab({ ctx, list }: { ctx: AudCtx; list: AudList }) {
  const [segs, setSegs] = useState<Segment[] | null>(null);
  const [edit, setEdit] = useState<Partial<Segment> | null>(null);
  const load = async () => { try { setSegs((await fetchSegments(ctx.client)).segments.filter((s) => s.list === list.id)); } catch (e) { toast((e as Error).message, 'err'); setSegs([]); } };
  useEffect(() => { void load(); }, [list.id]);
  if (edit) return <SegmentEditor ctx={ctx} list={list} seg={edit} onClose={() => { setEdit(null); void load(); }} />;
  return (
    <div class="col" style={{ gap: 12 }}>
      <div class="row"><div class="small muted grow">Phân nhóm chọn ra một phần danh sách theo tag, thông tin hoặc hành vi (mở, click). Dùng khi gửi chiến dịch: chỉ người trong nhóm nhận.</div>{ctx.canWrite && <Btn sm kind="primary" icon="plus" onClick={() => setEdit({ name: '', list: list.id, match: 'all', rules: [{ field: 'tag', op: 'has', value: '' }] })}>Phân nhóm mới</Btn>}</div>
      <div class="aud-cards">
        {segs === null ? <div class="dim small">Đang tải…</div> : segs.map((s) => <SegCard key={s.id} ctx={ctx} list={list} s={s} onOpen={() => setEdit(s)} />)}
        {segs && !segs.length && <div class="dim small">Chưa có phân nhóm nào. Bắt đầu từ mẫu:</div>}
      </div>
      {ctx.canWrite && <div class="row wrap" style={{ gap: 6 }}>{PRESETS.map((p) => <Btn key={p.name} xs onClick={() => setEdit({ name: p.name, list: list.id, match: p.match, rules: p.rules })}>+ {p.name}</Btn>)}</div>}
    </div>
  );
}

function SegCard({ ctx, list, s, onOpen }: { ctx: AudCtx; list: AudList; s: Segment; onOpen: () => void }) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => { void previewRules(ctx.client, list.id, s.match, s.rules).then((r) => setN(r.count)).catch(() => setN(null)); }, [s.id]);
  return (
    <div class="card aud-card" onClick={onOpen} style={{ cursor: 'pointer' }}>
      <div class="row"><b class="grow">{s.name}</b><span class="chip on">{n === null ? '…' : n.toLocaleString('vi-VN')} người</span></div>
      <div class="dim small">{s.rules.map((r) => `${FIELDS.find((f) => f.v === r.field)?.label || r.field.replace('fields.', '')} ${Object.values(OPS).flat().find((o) => o.v === r.op)?.label || r.op} ${r.value}`).join(s.match === 'any' ? ' · hoặc · ' : ' · và · ')}</div>
    </div>
  );
}

function SegmentEditor({ ctx, list, seg, onClose }: { ctx: AudCtx; list: AudList; seg: Partial<Segment>; onClose: () => void }) {
  const [name, setName] = useState(seg.name || '');
  const [match, setMatch] = useState<'all' | 'any'>(seg.match || 'all');
  const [rules, setRules] = useState<Rule[]>(seg.rules?.length ? seg.rules : [{ field: 'tag', op: 'has', value: '' }]);
  const [count, setCount] = useState<{ count: number; of: number; sample: string[] } | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const fields = [...FIELDS, ...list.fields.map((f) => ({ v: `fields.${f.key}`, label: f.label || f.key, kind: (f.type === 'number' ? 'number' : 'text') as Kind }))];
  useEffect(() => { void listTags(ctx.client, list.id).then((r) => setTags(r.tags.map((t) => t.tag))).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => void previewRules(ctx.client, list.id, match, rules.filter((r) => r.field && r.op)).then(setCount).catch(() => setCount(null)), 350); return () => clearTimeout(t); }, [JSON.stringify(rules), match]);
  const up = (i: number, patch: Partial<Rule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const kindOf = (f: string): Kind => fields.find((x) => x.v === f)?.kind || 'text';
  const save = async () => { try { await saveSegment(ctx.client, { id: seg.id, name: name.trim() || 'Phân nhóm', list: list.id, match, rules }); toast('Đã lưu phân nhóm.', 'ok'); onClose(); } catch (e) { toast((e as Error).message, 'err'); } };
  return (
    <div class="card col" style={{ gap: 12 }}>
      <div class="row"><b class="grow">{seg.id ? 'Sửa phân nhóm' : 'Phân nhóm mới'}</b><Btn xs kind="ghost" onClick={onClose}>Đóng</Btn></div>
      <Field label="Tên"><TextInput value={name} onCommit={setName} onInput={setName} placeholder="Khách VIP ở HCM" /></Field>
      <div class="row small"><span class="dim">Khớp</span><Seg value={match} options={[{ v: 'all', label: 'tất cả điều kiện' }, { v: 'any', label: 'bất kỳ điều kiện nào' }]} onChange={setMatch} /></div>
      {rules.map((r, i) => {
        const k = kindOf(r.field); const ops = OPS[k];
        return (
          <div key={i} class="row wrap aud-rule">
            <select class="in" style={{ maxWidth: 230 }} value={r.field} onChange={(e) => { const f = (e.target as HTMLSelectElement).value; up(i, { field: f, op: OPS[kindOf(f)][0].v, value: '' }); }}>{fields.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}</select>
            <select class="in" style={{ maxWidth: 150 }} value={r.op} onChange={(e) => up(i, { op: (e.target as HTMLSelectElement).value })}>{ops.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
            {!['empty', 'not_empty'].includes(r.op) && (k === 'tag' && tags.length
              ? <select class="in" style={{ maxWidth: 200 }} value={r.value} onChange={(e) => up(i, { value: (e.target as HTMLSelectElement).value })}><option value="">chọn tag…</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</select>
              : <input class="in" style={{ maxWidth: 200 }} type={k === 'number' ? 'number' : 'text'} value={r.value} onInput={(e) => up(i, { value: (e.target as HTMLInputElement).value })} />)}
            {rules.length > 1 && <Btn xs kind="ghost" onClick={() => setRules(rules.filter((_, j) => j !== i))}>×</Btn>}
          </div>
        );
      })}
      <div><Btn xs icon="plus" onClick={() => setRules([...rules, { field: 'tag', op: 'has', value: '' }])}>Thêm điều kiện</Btn></div>
      <div class="aud-count">{count ? <><b>{count.count.toLocaleString('vi-VN')}</b> / {count.of.toLocaleString('vi-VN')} người đang nhận khớp{count.sample.length ? <span class="dim"> · {count.sample.join(', ')}</span> : ''}</> : <span class="dim">Đang đếm…</span>}</div>
      <div class="row">
        {seg.id && ctx.canWrite && <Btn kind="danger" sm onClick={async () => { if (await ask(`Xoá phân nhóm "${seg.name}"? Danh bạ không bị ảnh hưởng.`, 'Xoá', true)) { await deleteSegment(ctx.client, seg.id!).catch(() => {}); onClose(); } }}>Xoá</Btn>}
        <span class="grow" />
        <Btn sm onClick={onClose}>Huỷ</Btn>
        {ctx.canWrite && <Btn sm kind="primary" onClick={() => void save()}>Lưu phân nhóm</Btn>}
      </div>
    </div>
  );
}
