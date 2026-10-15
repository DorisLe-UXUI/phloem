// "Bài này cần ảnh thật": after the art director read the post and the library, show which of the client's pictures it will
// paint from and which real photos are still missing. The user drops / pastes / picks them, or lets the AI paint without.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { assets } from '../../storage/assets';
import { addClientImages, clientImages, type ShotPlan } from '../../mkt/designs';
import type { Client } from '../../mkt/types';
import { Btn, Modal } from '../components';
import { Icon } from '../icons';

/** Opens the dialog; resolves with the pictures to paint from (and the ones just added), or null when cancelled. */
export function askPhotos(client: Client, plan: ShotPlan): Promise<{ refs: string[]; added: string[] } | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const done = (v: { refs: string[]; added: string[] } | null) => { render(null, host); host.remove(); resolve(v); };
    render(<NeedPhotos client={client} plan={plan} onDone={done} />, host);
  });
}

function NeedPhotos({ client, plan, onDone }: { client: Client; plan: ShotPlan; onDone: (v: { refs: string[]; added: string[] } | null) => void }) {
  const [refs, setRefs] = useState<string[]>(plan.refs);
  const [slots, setSlots] = useState<(string | null)[]>(plan.needs.map(() => null));
  const [target, setTarget] = useState(0); // which need a paste or a library pick fills
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);
  useEffect(() => assets.onChange(() => bump((n) => n + 1)), []);

  const fill = (i: number, id: string) => { setSlots((s) => s.map((x, k) => (k === i ? id : x))); setTarget(Math.min(plan.needs.length - 1, i + 1)); };
  const fromFiles = async (i: number, files: File[]) => {
    const f = files.filter((x) => x.type.startsWith('image/')); if (!f.length) return;
    setBusy(true);
    try { const ids = await addClientImages(client.id, f, 'upload'); if (ids[0]) fill(i, ids[0]); } finally { setBusy(false); }
  };
  useEffect(() => {
    const h = (e: ClipboardEvent) => { const f = Array.from(e.clipboardData?.files || []); if (f.some((x) => x.type.startsWith('image/'))) { e.preventDefault(); void fromFiles(target, f); } };
    window.addEventListener('paste', h); return () => window.removeEventListener('paste', h);
  }, [target]);

  const added = slots.filter(Boolean) as string[];
  const lib = clientImages(client.id).filter((a) => !refs.includes(a.id) && !added.includes(a.id)).slice(0, 24);
  const thumb = (id: string) => assets.url(id);

  return (
    <Modal title="Bài này cần ảnh thật để AI vẽ đúng" icon="image" wide onClose={() => onDone(null)}
      footer={<>
        <Btn kind="ghost" onClick={() => onDone(null)}>Huỷ</Btn>
        <Btn onClick={() => onDone({ refs, added: [] })} title="Vẽ chỉ với những ảnh đã có, AI tự hình dung phần còn thiếu">AI tự vẽ, bỏ qua</Btn>
        <Btn kind="primary" icon="sparkle" disabled={!added.length || busy} onClick={() => onDone({ refs, added })}>Vẽ với {added.length || ''} ảnh vừa thêm</Btn>
      </>}>
      <p class="muted" style={{ margin: 0 }}>AI đã đọc nội dung bài và xem kho ảnh của {client.name}. Thêm ảnh thật vào từng mục để ảnh AI ra đúng sản phẩm, nhân vật, không gian của khách.</p>

      <div class="mk-needs">
        {plan.needs.map((n, i) => (
          <div key={i} class={`mk-need ${target === i ? 'on' : ''}`} onClick={() => setTarget(i)}>
            <label class={`mk-need-slot ${slots[i] ? 'full' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer?.getData('text/phloem-asset'); if (id) fill(i, id); else void fromFiles(i, Array.from(e.dataTransfer?.files || [])); }}>
              {slots[i] && thumb(slots[i]!) ? <img src={thumb(slots[i]!)} alt="" /> : <span><Icon name="upload" size={18} /><em>Thả, dán ⌘V<br />hoặc bấm chọn</em></span>}
              <input type="file" accept="image/*" hidden onChange={(e) => { const f = Array.from((e.target as HTMLInputElement).files || []); (e.target as HTMLInputElement).value = ''; void fromFiles(i, f); }} />
            </label>
            <div class="grow">
              <b>{i + 1}. {n.what}</b>
              {n.why && <div class="small muted">{n.why}</div>}
              {slots[i] && <button class="mk-link small" onClick={(e) => { e.stopPropagation(); setSlots((s) => s.map((x, k) => (k === i ? null : x))); }}>Bỏ ảnh này</button>}
            </div>
          </div>
        ))}
      </div>

      {refs.length > 0 && <>
        <span class="small muted">AI sẽ vẽ theo các ảnh này trong kho (bấm ✕ để bỏ):</span>
        <div class="mk-refs">{refs.map((id) => <div key={id} class="mk-ref">{thumb(id) && <img src={thumb(id)} alt={assets.get(id)?.name || ''} />}<button onClick={() => setRefs(refs.filter((x) => x !== id))} aria-label="Bỏ ảnh tham chiếu">✕</button></div>)}</div>
      </>}

      {lib.length > 0 && <>
        <span class="small muted">Hoặc chọn từ kho cho mục {target + 1}:</span>
        <div class="mk-refs pick">{lib.map((a) => <button key={a.id} class="mk-ref" title={a.name} onClick={() => fill(target, a.id)}>{thumb(a.id) && <img src={thumb(a.id)} alt={a.name} loading="lazy" />}</button>)}</div>
      </>}
    </Modal>
  );
}
