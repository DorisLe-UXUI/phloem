import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import type { Brand, BrandToken, Color } from '../model/types';
import { resolveColor } from '../model/types';
import { Icon, type IconName } from './icons';
import { useStore } from '../store';

export function Btn(p: { kind?: 'primary' | 'ghost' | 'danger'; sm?: boolean; xs?: boolean; block?: boolean; on?: boolean; icon?: IconName; title?: string; onClick?: (e: MouseEvent) => void; disabled?: boolean; children?: ComponentChildren; class?: string; type?: string }) {
  const cls = ['btn', p.kind, p.sm && 'sm', p.xs && 'xs', p.block && 'block', p.on && 'on', p.icon && !p.children && 'icon', p.class].filter(Boolean).join(' ');
  return <button class={cls} title={p.title} onClick={p.onClick} disabled={p.disabled} type={(p.type as any) || 'button'}>{p.icon && <Icon name={p.icon} />}{p.children}</button>;
}

export function Field(p: { label: string; hint?: string; children: ComponentChildren; for?: string }) {
  return <div class="field"><label for={p.for}>{p.label}{p.hint && <span class="hint">{p.hint}</span>}</label>{p.children}</div>;
}

export function Eyebrow(p: { children: ComponentChildren; action?: { label: string; onClick: () => void } }) {
  return <div class="eyebrow">{p.children}{p.action && <span class="act" onClick={p.action.onClick}>{p.action.label}</span>}</div>;
}

export function TextInput(p: { value: string; onCommit: (v: string) => void; onInput?: (v: string) => void; placeholder?: string; id?: string; type?: string; mono?: boolean; disabled?: boolean }) {
  const [v, setV] = useState(p.value);
  useEffect(() => setV(p.value), [p.value]);
  return (
    <input id={p.id} class={`in ${p.mono ? 'mono' : ''}`} type={p.type || 'text'} value={v} placeholder={p.placeholder} disabled={p.disabled}
      onInput={(e) => { const nv = (e.target as HTMLInputElement).value; setV(nv); p.onInput?.(nv); }}
      onChange={(e) => p.onCommit((e.target as HTMLInputElement).value)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(p.value); (e.target as HTMLInputElement).blur(); } e.stopPropagation(); }} />
  );
}

export function TextArea(p: { value: string; onCommit: (v: string) => void; onInput?: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean; class?: string }) {
  const [v, setV] = useState(p.value);
  useEffect(() => setV(p.value), [p.value]);
  return <textarea class={`in ${p.mono ? 'mono' : ''} ${p.class || ''}`} rows={p.rows || 3} value={v} placeholder={p.placeholder}
    onInput={(e) => { const nv = (e.target as HTMLTextAreaElement).value; setV(nv); p.onInput?.(nv); }}
    onChange={(e) => p.onCommit((e.target as HTMLTextAreaElement).value)} onKeyDown={(e) => e.stopPropagation()} />;
}

/** Numeric input with a drag-to-scrub label (like Figma). */
export function Num(p: { label?: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string; title?: string; disabled?: boolean }) {
  const [v, setV] = useState(String(round(p.value)));
  useEffect(() => setV(String(round(p.value))), [p.value]);
  const clamp = (n: number) => Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, n));
  const commit = (raw: string) => { const n = parseFloat(raw.replace(',', '.')); if (!isNaN(n)) p.onChange(clamp(n)); else setV(String(round(p.value))); };
  const scrub = (e: PointerEvent) => {
    const start = e.clientX, base = p.value;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => { const d = (ev.clientX - start) * (ev.shiftKey ? 10 : 1) * (p.step || 1); p.onChange(clamp(round(base + d))); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  return (
    <div class="num" title={p.title}>
      {p.label && <span class="lb" onPointerDown={scrub}>{p.label}</span>}
      <input value={v} disabled={p.disabled} onInput={(e) => setV((e.target as HTMLInputElement).value)} onChange={(e) => commit((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * (p.step || 1); p.onChange(clamp(round(p.value + d))); } }} />
      {p.suffix && <span class="sfx">{p.suffix}</span>}
    </div>
  );
}
const round = (n: number) => Math.round(n * 100) / 100;

export function Seg<T extends string | number>(p: { value: T; options: { v: T; label?: string; icon?: IconName; title?: string }[]; onChange: (v: T) => void; block?: boolean }) {
  return <div class={`seg ${p.block ? 'block' : ''}`}>{p.options.map((o) => <button key={String(o.v)} class={o.v === p.value ? 'on' : ''} title={o.title || o.label} onClick={() => p.onChange(o.v)}>{o.icon && <Icon name={o.icon} />}{o.label}</button>)}</div>;
}

export function Toggle(p: { checked: boolean; onChange: (v: boolean) => void; label: ComponentChildren; sub?: string }) {
  return <div class={`toggle ${p.checked ? 'on' : ''}`} onClick={() => p.onChange(!p.checked)}><span><div>{p.label}</div>{p.sub && <div class="dim small">{p.sub}</div>}</span><span class="sw" /></div>;
}

export function Select<T extends string>(p: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; placeholder?: string }) {
  return <select class="in" value={p.value} onChange={(e) => p.onChange((e.target as HTMLSelectElement).value as T)}>{p.placeholder && <option value="">{p.placeholder}</option>}{p.options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>;
}

const TOKENS: BrandToken[] = ['primary', 'onPrimary', 'ink', 'muted', 'bg', 'soft', 'line'];

export function ColorInput(p: { value: Color | null; brand: Brand; onChange: (c: Color | null) => void; allowNone?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hex = resolveColor(p.value, p.brand);
  const isTok = p.value && typeof p.value === 'object';
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <div class="swatch" onClick={() => setOpen(!open)} title={p.label}>
        <span class="sq"><i style={{ background: hex || 'transparent' }} /></span>
        <span class="v">{hex ? hex.toUpperCase() : 'Không'}</span>
        {isTok && <span class="tk">{(p.value as { token: string }).token}</span>}
      </div>
      {open && (
        <div class="colorpop">
          <div class="eyebrow">Brand</div>
          <div class="tokens">{TOKENS.map((t) => <button key={t} class={isTok && (p.value as { token: string }).token === t ? 'on' : ''} onClick={() => { p.onChange({ token: t }); }}><i style={{ background: p.brand[t] }} />{t}</button>)}</div>
          <div class="eyebrow">Tuỳ chỉnh</div>
          <div class="row">
            <input type="color" class="in" style={{ width: 40, padding: 2 }} value={hex || '#000000'} onInput={(e) => p.onChange((e.target as HTMLInputElement).value)} />
            <input class="in mono" value={hex || ''} placeholder="#RRGGBB" onChange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) p.onChange(v.startsWith('#') ? v : `#${v}`); }} onKeyDown={(e) => e.stopPropagation()} />
            {p.allowNone && <Btn sm kind="ghost" onClick={() => { p.onChange(null); setOpen(false); }}>Không</Btn>}
          </div>
        </div>
      )}
    </div>
  );
}

export function Modal(p: { title: ComponentChildren; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren; wide?: boolean; narrow?: boolean; icon?: IconName }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); p.onClose(); } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true); }, []);
  return (
    <div class="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class={`modal ${p.wide ? 'wide' : ''} ${p.narrow ? 'narrow' : ''}`} onKeyDown={(e) => e.stopPropagation()}>
        <div class="modal-h">{p.icon && <Icon name={p.icon} size={18} style={{ color: 'var(--neon)' }} />}<h2>{p.title}</h2><Btn kind="ghost" icon="close" sm onClick={p.onClose} title="Đóng (Esc)" /></div>
        <div class="modal-b">{p.children}</div>
        {p.footer && <div class="modal-f">{p.footer}</div>}
      </div>
    </div>
  );
}

export function Toasts() {
  const s = useStore();
  return <div class="toasts">{s.toasts.map((t) => <div key={t.id} class={`toast ${t.kind}`}>{t.text}</div>)}</div>;
}

export function Ring({ score, size = 58 }: { score: number; size?: number }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  return (
    <div class="ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a2a1e" stroke-width="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#39ff14" stroke-width="5" stroke-linecap="round" stroke-dasharray={c} stroke-dashoffset={c * (1 - score / 100)} style={{ filter: 'drop-shadow(0 0 6px rgba(57,255,20,.6))' }} />
      </svg>
      <div class="v">{score}</div>
    </div>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  return <div class="progress"><i class={total ? '' : 'indet'} style={{ width: total ? `${Math.round((done / total) * 100)}%` : '30%' }} /></div>;
}

export function Kbd({ k }: { k: string }) { return <span class="kbd">{k}</span>; }

export function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : init; } catch { return init; } });
  return [v, (nv: T) => { setV(nv); try { localStorage.setItem(key, JSON.stringify(nv)); } catch { /* ignore */ } }];
}

export type Style = JSX.CSSProperties;
