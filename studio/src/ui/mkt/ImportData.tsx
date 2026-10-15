// "Nhập từ link": dán link Google Sheet (kế hoạch có sẵn), thư mục Google Drive hoặc trang web (ảnh đã làm của khách);
// Phloem đọc từng link, đưa bài vào Kế hoạch và ảnh vào kho của khách, rồi AI học phong cách từ ảnh đã làm.
import { useState } from 'preact/hooks';
import { toast } from '../../store';
import { importCanva, importDrive, importFigma, importSheet, importWeb, learnStyle, linkKind, type ImportResult, type LinkKind } from '../../mkt/importer';
import { useLocal } from '../components';
import { go } from '../../mkt/router';
import type { Client } from '../../mkt/types';
import { Btn, Modal } from '../components';
import { Icon } from '../icons';

const KIND_LABEL: Record<LinkKind, string> = { sheet: 'Google Sheet → Kế hoạch', drive: 'Google Drive → Gắn ảnh vào bài', figma: 'Figma → Gắn frame vào bài', canva: 'Canva → Kho ảnh', web: 'Trang web → Kho ảnh' };

export function ImportData({ client, onClose }: { client: Client; onClose: () => void }) {
  const [text, setText] = useState('');
  const [learn, setLearn] = useState(true);
  const [figmaToken, setFigmaToken] = useLocal('phloem.figma.token', '');
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);
  const [done, setDone] = useState<{ plan?: boolean; images?: boolean } | null>(null);
  const links = text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).map((url) => ({ url, kind: linkKind(url) }));
  const add = (ok: boolean, t: string) => setLog((l) => [...l, { ok, text: t }]);

  const run = async () => {
    const good = links.filter((l) => l.kind) as { url: string; kind: LinkKind }[];
    if (!good.length) { toast('Dán ít nhất một link Google Sheet, Google Drive hoặc trang web.', 'err'); return; }
    setLog([]); setDone(null);
    let plan = false, images = 0;
    for (const l of good) {
      try {
        if (l.kind === 'sheet') { const r = await importSheet(client, l.url, setBusy); plan = true; add(true, `Kế hoạch: nhập ${r.posts} bài từ Sheet${r.ai ? ' (AI đọc bố cục)' : ''}.`); }
        else if (l.kind === 'drive' || l.kind === 'figma') {
          const src = l.kind === 'drive' ? 'Drive' : 'Figma';
          const r: ImportResult = l.kind === 'drive' ? await importDrive(client, l.url, setBusy) : await importFigma(client, l.url, setBusy);
          images += r.images; if (r.posts) plan = true;
          add(true, r.posts ? `${src}: gắn ${r.slides} ảnh vào ${r.posts} bài đã làm trong kế hoạch${r.slides > r.posts ? ' (bài nhiều ảnh thành carousel)' : ''}, thêm ${r.images} ảnh vào kho.` : `${src}: thêm ${r.images} ảnh đã làm vào kho (chưa ghép được bài nào; cần có kế hoạch trùng ngày).`);
        }
        else if (l.kind === 'canva') { const n = await importCanva(client, l.url, setBusy); images += n; add(true, `Canva: thêm ${n} ảnh vào kho.`); }
        else { const n = await importWeb(client, l.url, setBusy); images += n; add(true, `${new URL(/^https?:/.test(l.url) ? l.url : `https://${l.url}`).hostname}: thêm ${n} ảnh vào kho.`); }
      } catch (e) { add(false, `${l.url.slice(0, 60)}: ${(e as Error).message}`); }
    }
    if (learn && images > 0) {
      try { const notes = await learnStyle(client, setBusy); add(true, `AI đã học phong cách: ${notes.slice(0, 180)}${notes.length > 180 ? '…' : ''}`); }
      catch (e) { add(false, `Học phong cách: ${(e as Error).message}`); }
    }
    setBusy(''); setDone({ plan, images: images > 0 });
  };

  return (
    <Modal title="Nhập dữ liệu có sẵn của khách" icon="upload" onClose={busy ? () => {} : onClose}
      footer={done ? <>{done.images && <Btn onClick={() => { onClose(); go({ view: 'client', id: client.id, tab: 'design' }); }}>Xem kho ảnh</Btn>}{done.plan && <Btn kind="primary" onClick={() => { onClose(); go({ view: 'client', id: client.id, tab: 'plan' }); }}>Mở kế hoạch</Btn>}{!done.plan && !done.images && <Btn onClick={onClose}>Đóng</Btn>}</>
        : <><Btn kind="ghost" disabled={!!busy} onClick={onClose}>Huỷ</Btn><Btn kind="primary" icon="download" disabled={!!busy || !links.length} onClick={() => void run()}>{busy ? 'Đang nhập…' : 'Nhập'}</Btn></>}>
      <p style={{ margin: 0 }} class="muted">Dán một hoặc nhiều link, mỗi dòng một link. Link phải chia sẻ ở chế độ <b>"Bất kỳ ai có đường liên kết"</b>.</p>
      <textarea class="in" rows={4} value={text} disabled={!!busy} placeholder={'https://docs.google.com/spreadsheets/d/… (kế hoạch đã lên)\nhttps://drive.google.com/drive/folders/… (ảnh bài đã đăng, đọc cả thư mục con)\nhttps://www.figma.com/design/… (frame bài đã làm)\nhttps://website-cua-khach.com/blog'} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} aria-label="Link cần nhập" />
      {links.length > 0 && <div class="col" style={{ gap: 4 }}>{links.map((l, i) => <div key={i} class="row small"><Icon name={l.kind ? 'check' : 'warn'} size={13} /><span class="grow mk-ell">{l.url}</span><span class={`chip ${l.kind ? '' : 'err'}`}>{l.kind ? KIND_LABEL[l.kind] : 'không nhận ra'}</span></div>)}</div>}
      {links.some((l) => l.kind === 'figma') && <label class="col" style={{ gap: 4 }}><span class="small">Token Figma <span class="dim">(Figma → Settings → Security → Personal access tokens, quyền File content: Read; chỉ lưu trong trình duyệt này)</span></span><input class="in" type="password" value={figmaToken} placeholder="figd_…" onInput={(e) => setFigmaToken((e.target as HTMLInputElement).value.trim())} /></label>}
      <label class="toggle on" style={{ cursor: 'pointer' }} onClick={() => !busy && setLearn(!learn)}><span>AI học phong cách từ ảnh đã làm<div class="dim small">Thiết kế AI sau này làm theo bố cục, màu, kiểu chữ trong ảnh cũ của khách</div></span><span class="sw" style={learn ? undefined : { background: 'var(--line-2)' }} /></label>
      {busy && <div class="row"><div class="mk-spin" /><span>{busy}</span></div>}
      {log.length > 0 && <div class="mk-card" style={{ margin: 0 }}>{log.map((l, i) => <div key={i} class="mk-line static"><Icon name={l.ok ? 'check' : 'warn'} size={14} /><span class="grow small">{l.text}</span></div>)}</div>}
      <span class="dim small">Facebook, Instagram, TikTok chặn đọc tự động khi chưa kết nối tài khoản: tải ảnh bài cũ về rồi kéo thả vào kho, hoặc gom vào một thư mục Drive.</span>
    </Modal>
  );
}
