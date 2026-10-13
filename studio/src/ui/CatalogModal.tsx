// Kho hàng: import products (Google Sheet / CSV / Shopify), let the AI say what to push and why, pick products, compose.
import { useMemo, useRef, useState } from 'preact/hooks';
import { get, set, toast, useStore } from '../store';
import { analyzeSite } from '../ai/site';
import { fetchCsv, itemsFromRows, itemsFromShopify, parseCsv, sheetCsvUrl, suggestCampaigns, toProducts, type CatalogItem, type SuggestResult } from '../catalog/catalog';
import { cloud } from '../storage/sync';
import { Btn, Eyebrow, Field, Modal, TextInput } from './components';
import { Icon } from './icons';
import { ask } from './confirm';

export function saveCatalog(items: CatalogItem[]) {
  const at = new Date().toISOString();
  set({ catalog: items, catalogAt: at });
  void cloud.kvPut('catalog', items, at);
}

export function CatalogModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const items = s.catalog;
  const [sheet, setSheet] = useState('');
  const [shop, setShop] = useState('');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<'name' | 'stock' | 'sold' | 'price'>('name');
  const [res, setRes] = useState<SuggestResult | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const add = (next: CatalogItem[], label: string) => {
    if (!next.length) { setErr(`${label}: không thấy sản phẩm nào. Dòng đầu phải là tiêu đề cột (tên, giá, tồn kho…).`); return; }
    const names = new Set(next.map((i) => i.name.toLowerCase()));
    saveCatalog([...items.filter((i) => !names.has(i.name.toLowerCase())), ...next]);
    toast(`Đã nhập ${next.length} sản phẩm từ ${label}.`, 'ok');
  };
  const importSheet = async () => {
    setErr(''); const url = sheetCsvUrl(sheet.trim()) || sheet.trim();
    if (!/^https?:\/\//.test(url)) { setErr('Dán link Google Sheet (hoặc link CSV).'); return; }
    setBusy('Đang tải Sheet…');
    try { add(itemsFromRows(parseCsv(await fetchCsv(url)), 'sheet'), 'Google Sheet'); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const importCsv = async (f: File) => { setErr(''); try { add(itemsFromRows(parseCsv(await f.text()), 'csv'), f.name); } catch (e) { setErr((e as Error).message); } };
  const importShop = async () => {
    setErr(''); setBusy('Đang đọc cửa hàng…');
    try { const p = await analyzeSite(shop, (m) => setBusy(m)); if (!p.products?.length) throw new Error('Trang này không lộ danh sách sản phẩm (chỉ Shopify có /products.json). Dùng Google Sheet hoặc CSV.'); add(itemsFromShopify(p.products), p.siteName || 'Shopify'); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const suggest = async () => {
    setErr(''); setBusy('AI đang phân tích kho…');
    try { setRes(await suggestCampaigns(items, goal)); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const compose = (ids: string[], seed?: { goal?: string; brief?: string }) => {
    const chosen = items.filter((i) => ids.includes(i.id));
    if (!chosen.length) { toast('Chọn ít nhất một sản phẩm.', 'err'); return; }
    set({ aiSeed: { products: toProducts(chosen), goal: seed?.goal, brief: seed?.brief }, modal: 'ai' });
  };
  const sorted = useMemo(() => [...items].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'price' ? (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0) : ((b[sort] ?? -1) as number) - ((a[sort] ?? -1) as number)), [items, sort]);
  const toggle = (id: string) => setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const byId = (id: string) => items.find((i) => i.id === id);

  return (
    <Modal title={`Kho hàng · ${items.length} sản phẩm`} icon="blocks" onClose={onClose} wide
      footer={<>
        <span class="grow small muted">{busy || (sel.size ? `${sel.size} đã chọn` : 'Tick sản phẩm rồi dựng email, hoặc để AI gợi ý.')}</span>
        {items.length > 0 && <Btn kind="ghost" onClick={async () => { if (await ask('Xoá toàn bộ kho hàng?', 'Xoá', true)) { saveCatalog([]); setRes(null); setSel(new Set()); } }}>Xoá kho</Btn>}
        <Btn kind="primary" icon="sparkle" disabled={!sel.size} onClick={() => compose([...sel])}>Dựng email với {sel.size || ''} sản phẩm</Btn>
      </>}>
      <div class="small muted">Nhập kho từ Google Sheet (share "Anyone with the link"), file CSV (xuất từ Excel/Sheets) hoặc cửa hàng Shopify. Cột nhận tự động: tên, giá, giá cũ, giá vốn, tồn kho, đã bán, danh mục, ảnh (URL), link, mô tả — tiếng Việt hay tiếng Anh đều được.</div>
      <div class="grid3">
        <Field label="Google Sheet / link CSV"><div class="row"><div class="grow"><TextInput value={sheet} mono placeholder="https://docs.google.com/spreadsheets/d/…" onInput={setSheet} onCommit={setSheet} /></div><Btn sm kind="primary" disabled={!!busy || !sheet.trim()} onClick={importSheet}>Nhập</Btn></div></Field>
        <Field label="File CSV"><Btn sm icon="upload" onClick={() => file.current?.click()}>Chọn file .csv</Btn><input ref={file} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" style={{ display: 'none' }} onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void importCsv(f); (e.target as HTMLInputElement).value = ''; }} /></Field>
        <Field label="Shopify (link cửa hàng)"><div class="row"><div class="grow"><TextInput value={shop} mono placeholder="https://shop.cua-ban.com" onInput={setShop} onCommit={setShop} /></div><Btn sm kind="primary" disabled={!!busy || !shop.trim()} onClick={importShop}>Nhập</Btn></div></Field>
      </div>
      {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span></div>}

      {items.length > 0 && (
        <>
          <Eyebrow>AI gợi ý nên đẩy gì</Eyebrow>
          <div class="row">
            <div class="grow"><TextInput value={goal} placeholder="Mục tiêu (tuỳ chọn): xả tồn trước Tết, tăng đơn tuần này, ra mắt dòng mới…" onInput={setGoal} onCommit={setGoal} /></div>
            <Btn kind="primary" icon="sparkle" disabled={!!busy} onClick={suggest}>{busy && busy.includes('AI') ? 'Đang phân tích…' : 'AI gợi ý'}</Btn>
          </div>
          {res && (
            <div class="props" style={{ gap: 10 }}>
              {res.insights.length > 0 && <div class="card"><div class="row"><Icon name="info" style={{ color: 'var(--neon)' }} /><b class="grow">Nhận xét về kho</b></div><ul class="small muted" style={{ margin: '6px 0 0 18px', padding: 0 }}>{res.insights.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
              {res.suggestions.map((sg, i) => (
                <div key={i} class="card glow">
                  <div class="row"><b class="grow">{sg.title}</b><span class={`chip ${sg.urgency === 'high' ? 'err' : sg.urgency === 'medium' ? 'warn' : ''}`}>{sg.urgency === 'high' ? 'làm ngay' : sg.urgency === 'medium' ? 'tuần này' : 'khi rảnh'}</span><span class="chip">{sg.campaign}</span></div>
                  <div class="small">{sg.why}</div>
                  <div class="row wrap" style={{ gap: 4 }}>{sg.itemIds.map((id) => byId(id)).filter(Boolean).map((it) => <span key={it!.id} class="chip on">{it!.name}{it!.price ? ` · ${it!.price}` : ''}</span>)}</div>
                  {sg.subject && <div class="small muted">Subject: <b>{sg.subject}</b>{sg.preheader ? ` · ${sg.preheader}` : ''}</div>}
                  <div class="row"><Btn sm kind="primary" icon="sparkle" onClick={() => compose(sg.itemIds, { goal: sg.campaign, brief: `${sg.title}. ${sg.why} Subject gợi ý: ${sg.subject}` })}>Dựng email từ gợi ý này</Btn><Btn sm onClick={() => setSel(new Set(sg.itemIds))}>Chọn các sản phẩm này</Btn></div>
                </div>
              ))}
            </div>
          )}

          <Eyebrow action={{ label: sel.size === items.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả', onClick: () => setSel(sel.size === items.length ? new Set() : new Set(items.map((i) => i.id))) }}>Sản phẩm</Eyebrow>
          <div class="row small muted" style={{ gap: 8 }}>Sắp xếp:{(['name', 'stock', 'sold', 'price'] as const).map((k) => <button key={k} class={`chip ${sort === k ? 'on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setSort(k)}>{{ name: 'tên', stock: 'tồn kho', sold: 'đã bán', price: 'giá' }[k]}</button>)}</div>
          <div class="catalog">
            {sorted.map((it) => (
              <label key={it.id} class={`crow ${sel.has(it.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} />
                <div class="cimg">{it.image ? <img src={it.image} alt="" loading="lazy" referrerpolicy="no-referrer" /> : <Icon name="image" />}</div>
                <div class="cname"><b>{it.name}</b><span class="dim small">{[it.category, it.tags].filter(Boolean).join(' · ')}</span></div>
                <div class="cnum"><b>{it.price || '—'}</b>{it.oldPrice && <s class="dim small">{it.oldPrice}</s>}</div>
                <div class="cnum" title="tồn kho">{it.stock ?? '—'}</div>
                <div class="cnum" title="đã bán">{it.sold ?? '—'}</div>
                <button class="del" title="Bỏ khỏi kho" onClick={(e) => { e.preventDefault(); saveCatalog(items.filter((x) => x.id !== it.id)); }}>✕</button>
              </label>
            ))}
          </div>
        </>
      )}
      {items.length === 0 && <div class="dropzone" onClick={() => file.current?.click()}><Icon name="upload" /><div>Kho trống. Nhập Google Sheet, chọn file CSV hoặc dán link Shopify ở trên.</div></div>}
    </Modal>
  );
}
