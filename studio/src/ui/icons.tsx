// Hand-drawn 16px stroke icons. One component, keyed by name.
import type { JSX } from 'preact';

const P: Record<string, string> = {
  select: 'M4 3l12 7-5 1.5L9.5 17 4 3z',
  rect: 'M3 4h14v12H3z',
  text: 'M4 5h12M10 5v11M7 16h6',
  image: 'M3 4h14v12H3zM6 13l3-3 2 2 2-3 3 4',
  hand: 'M7 11V5a1.5 1.5 0 013 0v5M10 10V4a1.5 1.5 0 013 0v6M13 10V6a1.5 1.5 0 013 0v6c0 3-2 5-5 5H9.5c-2 0-3.5-1.4-5-3.5L3 11a1.4 1.4 0 012.3-1.6L7 11',
  group: 'M3 3h6v6H3zM11 11h6v6h-6zM9 6h2M6 9v2',
  eye: 'M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zM10 12a2 2 0 100-4 2 2 0 000 4z',
  eyeOff: 'M3 3l14 14M8.5 8.6A2 2 0 0011.4 11.5M5.6 5.7C3.4 7 2 10 2 10s3 5 8 5c1.5 0 2.8-.4 3.9-1M8.5 5.2A8 8 0 0110 5c5 0 8 5 8 5s-.8 1.3-2.2 2.6',
  lock: 'M5 9V7a5 5 0 0110 0v2M4 9h12v8H4z',
  unlock: 'M5 9V7a5 5 0 019.6-2M4 9h12v8H4z',
  chevron: 'M7 5l5 5-5 5',
  plus: 'M10 4v12M4 10h12',
  minus: 'M4 10h12',
  close: 'M5 5l10 10M15 5L5 15',
  trash: 'M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11M9 9v5M11 9v5',
  copy: 'M7 7h9v9H7zM4 13V4h9',
  undo: 'M7 5L3 9l4 4M3 9h8a5 5 0 010 10',
  redo: 'M13 5l4 4-4 4M17 9H9a5 5 0 000 10',
  zoomIn: 'M9 3a6 6 0 100 12A6 6 0 009 3zM17 17l-4-4M9 6v6M6 9h6',
  zoomOut: 'M9 3a6 6 0 100 12A6 6 0 009 3zM17 17l-4-4M6 9h6',
  fit: 'M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4',
  desktop: 'M2 4h16v10H2zM7 17h6M10 14v3',
  mobile: 'M6 2h8v16H6zM9 15h2',
  play: 'M6 4l10 6-10 6z',
  send: 'M3 10l14-7-4 14-3-5-7-2z',
  settings: 'M10 7a3 3 0 100 6 3 3 0 000-6zM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4',
  home: 'M3 9l7-6 7 6v8h-5v-5H8v5H3z',
  layers: 'M10 3l7 4-7 4-7-4zM3 11l7 4 7-4M3 14l7 4 7-4',
  blocks: 'M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z',
  alignL: 'M3 3v14M6 6h9v3H6zM6 11h6v3H6z',
  alignC: 'M10 3v14M5 6h10v3H5zM7 11h6v3H7z',
  alignR: 'M17 3v14M5 6h9v3H5zM8 11h6v3H8z',
  alignT: 'M3 3h14M6 6h3v9H6zM11 6h3v6h-3z',
  alignM: 'M3 10h14M6 5h3v10H6zM11 7h3v6h-3z',
  alignB: 'M3 17h14M6 5h3v9H6zM11 8h3v6h-3z',
  distH: 'M3 3v14M17 3v14M8 6h4v8H8z',
  distV: 'M3 3h14M3 17h14M6 8h8v4H6z',
  up: 'M10 16V4M5 9l5-5 5 5',
  down: 'M10 4v12M5 11l5 5 5-5',
  check: 'M4 10l4 4 8-8',
  warn: 'M10 3l8 14H2zM10 8v4M10 15h.01',
  info: 'M10 2a8 8 0 100 16 8 8 0 000-16zM10 9v5M10 6h.01',
  link: 'M8 12a3 3 0 004.2 0l2.4-2.4a3 3 0 10-4.2-4.2L9.6 6.2M12 8a3 3 0 00-4.2 0L5.4 10.4a3 3 0 104.2 4.2l.8-.8',
  bolt: 'M11 2L4 11h5l-1 7 8-10h-5z',
  grid: 'M3 3h14v14H3zM3 8h14M3 13h14M8 3v14M13 3v14',
  magnet: 'M5 3v7a5 5 0 0010 0V3M5 3h3v7a2 2 0 004 0V3h3',
  figma: 'M8 2h4a3 3 0 010 6H8zM8 8h4a3 3 0 010 6H8zM8 8a3 3 0 100 6M8 14a3 3 0 100 6M12 8a3 3 0 110 6 3 3 0 010-6z',
  upload: 'M10 14V4M6 8l4-4 4 4M4 17h12',
  download: 'M10 4v10M6 10l4 4 4-4M4 17h12',
  sparkle: 'M10 2l1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8zM16 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  mail: 'M2 5h16v11H2zM2 6l8 6 8-6',
  more: 'M5 10h.01M10 10h.01M15 10h.01',
  bold: 'M6 4h5a3 3 0 010 6H6zM6 10h6a3 3 0 010 6H6z',
  italic: 'M8 4h8M4 16h8M12 4l-4 12',
  underline: 'M5 3v6a5 5 0 0010 0V3M4 17h12',
  reflow: 'M4 4h12v3H4zM4 9h12v3H4zM4 14h12v3H4zM17 2v16',
  palette: 'M10 2a8 8 0 100 16c1.5 0 2-1 1.5-2s0-2 1.5-2h1a4 4 0 004-4c0-4.4-3.6-8-8-8zM6 9h.01M8 6h.01M12 6h.01M14 9h.01',
  keyboard: 'M2 5h16v10H2zM5 8h.01M8 8h.01M11 8h.01M14 8h.01M5 11h.01M8 11h6M14 11h.01',
  external: 'M11 3h6v6M17 3l-8 8M14 11v6H3V6h6',
  search: 'M8.5 3a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM17 17l-4.2-4.2',
  shapes: 'M3 3h6v6H3zM14 3.5a3 3 0 110 6 3 3 0 010-6zM6 11.5l3.5 6h-7zM11.5 12.5h6v5h-6z',
  leaf: 'M10 1.6C6.2 5.8 3.4 9.3 3.4 12.6a6.6 6.6 0 0 0 13.2 0c0-3.3-2.8-6.8-6.6-11Z M10 17V7.2 M10 11.2c-1.6 0-2.9-1.1-3.1-2.8 1.7-.1 3 1 3.1 2.8Z M10 13.6c1.6 0 2.9-1.1 3.1-2.8-1.7-.1-3 1-3.1 2.8Z',
};

export type IconName = keyof typeof P;

/** Brand mark: drop outline with a sprout, neon glow. */
export function LogoMark({ size = 22, glow = true }: { size?: number; glow?: boolean }) {
  return (
    <svg viewBox="0 0 100 120" width={size} height={size * 1.2} aria-hidden="true" style={glow ? { filter: 'drop-shadow(0 0 6px rgba(57,255,20,.55))' } : undefined}>
      <path d="M50 7C30 30 15 50 15 73a35 35 0 0 0 70 0C85 50 70 30 50 7Z" fill="none" stroke="#39ff14" stroke-width="9" stroke-linejoin="round" />
      <path d="M50 100V33" stroke="#39ff14" stroke-width="7" stroke-linecap="round" />
      <path d="M50 64C38 64 29 55 29 42c12 0 21 9 21 22Z" fill="#39ff14" />
      <path d="M50 80c12 0 21-9 21-22-12 0-21 9-21 22Z" fill="#39ff14" />
    </svg>
  );
}

/** Wordmark: "Phloem" + green "email" in Poppins ExtraBold. */
export function Logo({ size = 22, onClick, dark = false }: { size?: number; onClick?: () => void; dark?: boolean }) {
  return (
    <div class="logo" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <LogoMark size={size} />
      <span class="wordmark" style={{ fontSize: size * 0.95, color: dark ? '#111' : '#fff' }}>Phloem</span>
      <span class="wordmark studio" style={{ fontSize: size * 0.95 }}>email</span>
    </div>
  );
}

export function Icon({ name, size = 16, class: cls, style }: { name: IconName | string; size?: number; class?: string; style?: JSX.CSSProperties }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} class={cls} style={style} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={P[name] || P.info} />
    </svg>
  );
}
