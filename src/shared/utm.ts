// UTM templating. Never touches mailto/tel/anchors/merge tags or links that already carry utm_*.
export interface UtmVars {
  provider: string;
  campaign: string;
  frame: string;
  slice: string;
  date: string;
  host?: string;
}

export function slug(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'x';
}

export function isMergeTag(url: string): boolean {
  return /\*\|[^|]+\|\*/.test(url) || /\{\{.*\}\}/.test(url) || /\{%.*%\}/.test(url);
}

export function isUtmSkippable(url: string): boolean {
  const u = url.trim();
  return (
    !u ||
    /^(mailto:|tel:|sms:|#)/i.test(u) ||
    isMergeTag(u) ||
    /[?&]utm_[a-z]+=/i.test(u)
  );
}

/** Hostname of an http(s) URL without relying on the URL global (absent in the Figma sandbox). */
export function hostOf(url: string): string | null {
  const m = /^https?:\/\/(?:[^@\/?#]+@)?([^:\/?#]+)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

export function fillTemplate(template: string, vars: UtmVars): string {
  return template.replace(/\{(provider|campaign|frame|slice|date|host)\}/g, (_, k: keyof UtmVars) => slug(String(vars[k] ?? '')));
}

export function applyUtm(url: string, template: string, vars: UtmVars): string {
  const u = url.trim();
  if (!template.trim() || isUtmSkippable(u)) return u;
  if (!/^https?:\/\//i.test(u)) return u;
  const host = hostOf(u);
  if (!host) return u;
  const qs = fillTemplate(template.replace(/^[?&]+/, ''), { ...vars, host });
  const hashIdx = u.indexOf('#');
  const base = hashIdx >= 0 ? u.slice(0, hashIdx) : u;
  const frag = hashIdx >= 0 ? u.slice(hashIdx) : '';
  const sep = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${sep}${qs}${frag}`;
}
