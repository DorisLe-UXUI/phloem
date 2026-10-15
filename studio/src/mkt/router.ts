// Phloem MKT routes live in the URL fragment: #/  #/clients  #/library  #/c/<id>/<tab>  #/review/<token>
// (fragments never reach a server, which keeps review tokens out of logs, and GitHub Pages needs no rewrites).
import { get, set } from '../store';
import { CLIENT_TABS, type ClientTab, type MktView } from './types';

export function parse(hash: string): MktView {
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (p[0] === 'clients') return { view: 'clients' };
  if (p[0] === 'library') return { view: 'library' };
  if (p[0] === 'review' && p[1]) return { view: 'review', token: p[1] };
  if (p[0] === 'c' && p[1]) { const tab = (CLIENT_TABS.some((t) => t.id === p[2]) ? p[2] : 'overview') as ClientTab; return { view: 'client', id: p[1], tab }; }
  return { view: 'overview' };
}
export function format(v: MktView): string {
  switch (v.view) {
    case 'clients': return '#/clients';
    case 'library': return '#/library';
    case 'review': return `#/review/${encodeURIComponent(v.token)}`;
    case 'client': return `#/c/${encodeURIComponent(v.id)}/${v.tab}`;
    default: return '#/';
  }
}

/** Go somewhere in MKT (and leave the email editor if it is open). */
export function go(v: MktView) {
  const h = format(v);
  if (location.hash !== h) history.pushState(null, '', h);
  apply(v);
}
function apply(v: MktView) {
  if (get().route.name === 'editor') void import('../pipeline/actions').then((A) => A.goHome()); // back button while editing an email
  set({ mkt: v, activeClientId: v.view === 'client' ? v.id : null, ...(get().route.name !== 'home' && get().route.name !== 'editor' ? { route: { name: 'home' } } : {}) });
}

export function startRouter() {
  apply(parse(location.hash));
  window.addEventListener('popstate', () => apply(parse(location.hash)));
  window.addEventListener('hashchange', () => apply(parse(location.hash)));
}
