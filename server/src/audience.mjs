// Phloem Email audience: lists, contacts (status, tags, custom fields, consent), segments, signup forms with double
// opt-in, automations (welcome series, tag, birthday, win-back), list sends and reports.
//
// Every list belongs to a scope: `u:<userId>` (personal) or `c:<clientId>` (a Phloem MKT client workspace, opened only by
// its owner and members: access is resolved per request with the same check as the MKT routes).
//
//   /aud/lists[/:id]                        lists with counts · create/update · delete (?confirm=<name>)
//   /aud/lists/:id/contacts[/:email]        search/filter/page · add · edit · delete
//   /aud/lists/:id/import                   rows from a CSV (consent attested) · /export.csv · /tags (counts, bulk tag)
//   /aud/segments[/:id] · /aud/preview      saved rule sets · live count
//   /aud/forms[/:id]                        signup forms;  public: GET|POST /f/:id, GET /f/:id/c/:token (confirm)
//   /aud/automations[/:id][/activate|pause] trigger + steps (email / tag, each after a delay)
//   /aud/reports                            growth, campaigns, automations
// All /aud routes take ?client=<id> for a client workspace (none = personal).
import { createHash, randomBytes } from 'node:crypto';

const now = () => new Date().toISOString();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/;
const normEmail = (e) => String(e || '').trim().toLowerCase();
const STATUSES = ['subscribed', 'pending', 'unsubscribed', 'bounced', 'complained'];
const uid = (p) => `${p}_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const cleanTags = (t) => [...new Set((Array.isArray(t) ? t : String(t || '').split(/[,;|]/)).map((x) => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 50);
const DAY = 864e5;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS aud_lists (scope TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (scope, id));
CREATE TABLE IF NOT EXISTS aud_contacts (scope TEXT NOT NULL, list_id TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL, first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', fields TEXT NOT NULL DEFAULT '{}', source TEXT NOT NULL DEFAULT '', consent TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, subscribed_at TEXT, unsubscribed_at TEXT, last_open_at TEXT, last_click_at TEXT, opens INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (scope, list_id, email));
CREATE INDEX IF NOT EXISTS aud_contacts_status ON aud_contacts(scope, list_id, status);
CREATE INDEX IF NOT EXISTS aud_contacts_email ON aud_contacts(email);
CREATE TABLE IF NOT EXISTS aud_segments (scope TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (scope, id));
CREATE TABLE IF NOT EXISTS aud_forms (id TEXT PRIMARY KEY, scope TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS aud_pending (token_hash TEXT PRIMARY KEY, scope TEXT NOT NULL, list_id TEXT NOT NULL, email TEXT NOT NULL, form_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS aud_automations (scope TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', updated_at TEXT NOT NULL, PRIMARY KEY (scope, id));
CREATE TABLE IF NOT EXISTS aud_runs (scope TEXT NOT NULL, automation_id TEXT NOT NULL, email TEXT NOT NULL, cycle TEXT NOT NULL DEFAULT '', step INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', tries INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY (scope, automation_id, email, cycle));
CREATE INDEX IF NOT EXISTS aud_runs_due ON aud_runs(status, next_at);
CREATE TABLE IF NOT EXISTS aud_auto_log (scope TEXT NOT NULL, automation_id TEXT NOT NULL, step_id TEXT NOT NULL, email TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS aud_auto_log_a ON aud_auto_log(scope, automation_id, step_id);
CREATE TABLE IF NOT EXISTS aud_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// ---------- segments ----------
const daysSince = (iso, nowMs) => (iso ? Math.floor((nowMs - Date.parse(iso)) / DAY) : null);
function valueOf(c, field, nowMs) {
  switch (field) {
    case 'tag': return c.tags;
    case 'email': case 'first_name': case 'last_name': case 'status': case 'source': return c[field];
    case 'email_domain': return (c.email.split('@')[1] || '');
    case 'opens': case 'clicks': return c[field];
    case 'days_since_open': return daysSince(c.lastOpenAt, nowMs) ?? 99999;
    case 'days_since_click': return daysSince(c.lastClickAt, nowMs) ?? 99999;
    case 'days_since_signup': return daysSince(c.subscribedAt || c.createdAt, nowMs) ?? 0;
    default: return field.startsWith('fields.') ? c.fields?.[field.slice(7)] : undefined;
  }
}
/** Does a contact match a segment's rules? (`match`: 'all' | 'any'). Exported for tests. */
export function matchContact(c, rules = [], match = 'all', nowMs = Date.now()) {
  const test = (r) => {
    const v = valueOf(c, String(r.field || ''), nowMs), want = r.value;
    const s = (x) => String(x ?? '').toLowerCase().trim();
    switch (r.op) {
      case 'has': return Array.isArray(v) && v.map(s).includes(s(want));
      case 'not_has': return !(Array.isArray(v) && v.map(s).includes(s(want)));
      case 'eq': return s(v) === s(want);
      case 'neq': return s(v) !== s(want);
      case 'contains': return s(v).includes(s(want));
      case 'not_contains': return !s(v).includes(s(want));
      case 'gt': return Number(v) > Number(want);
      case 'lt': return Number(v) < Number(want);
      case 'empty': return v == null || v === '' || (Array.isArray(v) && !v.length);
      case 'not_empty': return !(v == null || v === '' || (Array.isArray(v) && !v.length));
      default: return false;
    }
  };
  if (!Array.isArray(rules) || !rules.length) return true;
  return match === 'any' ? rules.some(test) : rules.every(test);
}

/** RFC 4180 CSV. */
export function toCsv(rows) { const cell = (v) => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }; return rows.map((r) => r.map(cell).join(',')).join('\r\n'); }

/** Month and day of a date field ("1990-10-15", "15/10/1990", "15/10", "10-15"), or null. */
export function monthDay(v) {
  const t = String(v || '').trim(); let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t))) return [+m[2], +m[3]];
  if ((m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-]\d{2,4})?$/.exec(t))) return [+m[2], +m[1]]; // dd/mm(/yyyy), Vietnamese order
  return null;
}

export function createAudience({ raw: db, secret, publicUrl, json, body, rawBody, requireUser, throttled, ipOf, access, can, mail, log = console.log, tz = 7 }) {
  db.exec(SCHEMA);
  const q = (sql) => db.prepare(sql);
  const S = {
    listPut: q('INSERT INTO aud_lists (scope, id, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at'),
    listGet: q('SELECT * FROM aud_lists WHERE scope = ? AND id = ?'),
    listAll: q('SELECT * FROM aud_lists WHERE scope = ? ORDER BY created_at'),
    listDel: q('DELETE FROM aud_lists WHERE scope = ? AND id = ?'),
    counts: q('SELECT status, COUNT(*) AS n FROM aud_contacts WHERE scope = ? AND list_id = ? GROUP BY status'),
    cGet: q('SELECT * FROM aud_contacts WHERE scope = ? AND list_id = ? AND email = ?'),
    cIns: q('INSERT INTO aud_contacts (scope, list_id, email, status, first_name, last_name, tags, fields, source, consent, created_at, updated_at, subscribed_at, unsubscribed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    cUpd: q('UPDATE aud_contacts SET status = ?, first_name = ?, last_name = ?, tags = ?, fields = ?, consent = ?, updated_at = ?, subscribed_at = ?, unsubscribed_at = ? WHERE scope = ? AND list_id = ? AND email = ?'),
    cDel: q('DELETE FROM aud_contacts WHERE scope = ? AND list_id = ? AND email = ?'),
    cDelList: q('DELETE FROM aud_contacts WHERE scope = ? AND list_id = ?'),
    cAll: q('SELECT * FROM aud_contacts WHERE scope = ? AND list_id = ? ORDER BY created_at DESC'),
    cByStatus: q('SELECT * FROM aud_contacts WHERE scope = ? AND list_id = ? AND status = ?'),
    cByEmail: q('SELECT * FROM aud_contacts WHERE scope = ? AND email = ?'),
    cOpen: q('UPDATE aud_contacts SET opens = opens + 1, last_open_at = ? WHERE scope = ? AND email = ?'),
    cClick: q('UPDATE aud_contacts SET clicks = clicks + 1, last_click_at = ? WHERE scope = ? AND email = ?'),
    cStatusAll: q("UPDATE aud_contacts SET status = ?, unsubscribed_at = ?, updated_at = ? WHERE scope = ? AND email = ? AND status IN ('subscribed', 'pending')"),
    growthSub: q('SELECT substr(subscribed_at, 1, 10) AS d, COUNT(*) AS n FROM aud_contacts WHERE scope = ? AND subscribed_at >= ? GROUP BY d'),
    growthUnsub: q('SELECT substr(unsubscribed_at, 1, 10) AS d, COUNT(*) AS n FROM aud_contacts WHERE scope = ? AND unsubscribed_at >= ? GROUP BY d'),
    scopes: q("SELECT DISTINCT scope FROM aud_lists WHERE scope LIKE 'c:%'"),
    segPut: q('INSERT INTO aud_segments (scope, id, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(scope, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at'),
    segGet: q('SELECT json FROM aud_segments WHERE scope = ? AND id = ?'),
    segAll: q('SELECT id, json FROM aud_segments WHERE scope = ? ORDER BY updated_at DESC'),
    segDel: q('DELETE FROM aud_segments WHERE scope = ? AND id = ?'),
    formPut: q('INSERT INTO aud_forms (id, scope, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at WHERE aud_forms.scope = excluded.scope'),
    formGet: q('SELECT * FROM aud_forms WHERE id = ?'),
    formAll: q('SELECT id, json FROM aud_forms WHERE scope = ? ORDER BY updated_at DESC'),
    formDel: q('DELETE FROM aud_forms WHERE id = ? AND scope = ?'),
    pendPut: q('INSERT OR REPLACE INTO aud_pending (token_hash, scope, list_id, email, form_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    pendGet: q('SELECT * FROM aud_pending WHERE token_hash = ?'),
    pendDel: q('DELETE FROM aud_pending WHERE token_hash = ?'),
    pendOld: q('DELETE FROM aud_pending WHERE created_at < ?'),
    autoPut: q('INSERT INTO aud_automations (scope, id, json, status, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope, id) DO UPDATE SET json = excluded.json, status = excluded.status, updated_at = excluded.updated_at'),
    autoGet: q('SELECT * FROM aud_automations WHERE scope = ? AND id = ?'),
    autoAll: q('SELECT * FROM aud_automations WHERE scope = ? ORDER BY updated_at DESC'),
    autoActive: q("SELECT * FROM aud_automations WHERE status = 'active'"),
    autoDel: q('DELETE FROM aud_automations WHERE scope = ? AND id = ?'),
    runIns: q("INSERT INTO aud_runs (scope, automation_id, email, cycle, step, next_at, status, updated_at) VALUES (?, ?, ?, ?, 0, ?, 'active', ?) ON CONFLICT DO NOTHING"),
    runDue: q("SELECT * FROM aud_runs WHERE status = 'active' AND next_at <= ? ORDER BY next_at LIMIT ?"),
    runSet: q('UPDATE aud_runs SET step = ?, next_at = ?, status = ?, tries = ?, error = ?, updated_at = ? WHERE scope = ? AND automation_id = ? AND email = ? AND cycle = ?'),
    runCounts: q('SELECT status, COUNT(*) AS n FROM aud_runs WHERE scope = ? AND automation_id = ? GROUP BY status'),
    runDelAuto: q('DELETE FROM aud_runs WHERE scope = ? AND automation_id = ?'),
    logAdd: q('INSERT INTO aud_auto_log (scope, automation_id, step_id, email, status, at) VALUES (?, ?, ?, ?, ?, ?)'),
    logCounts: q('SELECT step_id, status, COUNT(*) AS n FROM aud_auto_log WHERE scope = ? AND automation_id = ? GROUP BY step_id, status'),
    metaGet: q('SELECT value FROM aud_meta WHERE key = ?'),
    metaPut: q('INSERT OR REPLACE INTO aud_meta (key, value) VALUES (?, ?)'),
  };

  const contactOf = (r) => ({ email: r.email, status: r.status, first_name: r.first_name, last_name: r.last_name, tags: JSON.parse(r.tags || '[]'), fields: JSON.parse(r.fields || '{}'), source: r.source, consent: JSON.parse(r.consent || '{}'), createdAt: r.created_at, updatedAt: r.updated_at, subscribedAt: r.subscribed_at, unsubscribedAt: r.unsubscribed_at, lastOpenAt: r.last_open_at, lastClickAt: r.last_click_at, opens: r.opens, clicks: r.clicks, list: r.list_id });
  const listOf = (r) => { const j = JSON.parse(r.json); const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])); for (const c of S.counts.all(r.scope, r.id)) counts[c.status] = c.n; return { id: r.id, ...j, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), createdAt: r.created_at, updatedAt: r.updated_at }; };
  const getList = (scope, id) => { const r = S.listGet.get(scope, id); return r ? { id: r.id, ...JSON.parse(r.json) } : null; };
  const fieldsFor = (c) => ({ ...c.fields, first_name: c.first_name, last_name: c.last_name, email: c.email });

  // ---------- scope: personal, or a client workspace the caller can open ----------
  function scopeOf(u, url, res, need = 'read') {
    const client = String(url.searchParams.get('client') || '');
    if (!client) return { scope: `u:${u.id}`, role: 'owner', client: '' };
    const acc = access(u.id, client);
    if (!acc) { json(res, 404, { error: 'Không có khách hàng này, hoặc bạn không có quyền xem.' }); return null; }
    if (!can(acc, need)) { json(res, 403, { error: 'Vai trò của bạn chỉ được xem.' }); return null; }
    return { scope: `c:${client}`, role: acc.role, client };
  }
  /** Scopes a sending account's owner may touch (its own + client workspaces it can open): bounce reports stay inside. */
  function scopesOfUser(userId) {
    const out = [`u:${userId}`];
    for (const r of S.scopes.all()) { const cid = r.scope.slice(2); if (access(userId, cid)) out.push(r.scope); }
    return out;
  }

  // ---------- contacts ----------
  /** Add or update one contact. Bounced/complained addresses never come back by import; an unsubscribed one only through
   *  a confirmed opt-in (`resubscribe`). Fires subscribe/tag automations for what actually changed. */
  function upsert(scope, listId, input, o = {}) {
    const email = normEmail(input.email);
    if (!EMAIL_RE.test(email) || email.length > 254) return { invalid: true };
    const t = now();
    const prevRow = S.cGet.get(scope, listId, email);
    const tagsIn = cleanTags([...(input.tags || []), ...(o.tagsAdd || [])]);
    const fieldsIn = input.fields && typeof input.fields === 'object' ? Object.fromEntries(Object.entries(input.fields).slice(0, 40).map(([k, v]) => [String(k).slice(0, 40).replace(/[^\w]/g, '_').toLowerCase(), String(v ?? '').slice(0, 500)])) : {};
    const consent = o.consent || {};
    if (!prevRow) {
      const status = STATUSES.includes(o.status) ? o.status : 'subscribed';
      S.cIns.run(scope, listId, email, status, String(input.first_name || '').slice(0, 80), String(input.last_name || '').slice(0, 80), JSON.stringify(tagsIn), JSON.stringify(fieldsIn), String(o.source || '').slice(0, 40), JSON.stringify(consent), t, t, status === 'subscribed' ? t : null, null);
      const c = contactOf(S.cGet.get(scope, listId, email));
      if (o.trigger !== false) { if (status === 'subscribed') fire(scope, listId, 'subscribe', c); for (const tg of tagsIn) fire(scope, listId, 'tag', c, tg); }
      return { created: true, contact: c };
    }
    const prev = contactOf(prevRow);
    let status = prev.status;
    if (o.status && o.status !== prev.status) {
      if (o.status === 'subscribed' && ['bounced', 'complained'].includes(prev.status) && !o.force) { /* never by import */ }
      else if (o.status === 'subscribed' && prev.status === 'unsubscribed' && !o.resubscribe && !o.force) { /* needs a fresh opt-in */ }
      else if (o.status === 'pending' && prev.status === 'subscribed') { /* already in */ }
      else status = o.status;
    }
    const tags = cleanTags([...(o.replaceTags ? [] : prev.tags), ...tagsIn]);
    const fields = { ...prev.fields, ...fieldsIn };
    const first = o.update === false ? prev.first_name : String(input.first_name ?? '').trim() || prev.first_name;
    const last = o.update === false ? prev.last_name : String(input.last_name ?? '').trim() || prev.last_name;
    const subAt = status === 'subscribed' && prev.status !== 'subscribed' ? t : prev.subscribedAt;
    const unsubAt = status === 'unsubscribed' && prev.status !== 'unsubscribed' ? t : prev.unsubscribedAt;
    S.cUpd.run(status, first.slice(0, 80), last.slice(0, 80), JSON.stringify(tags), JSON.stringify(fields), JSON.stringify(Object.keys(consent).length ? { ...prev.consent, ...consent } : prev.consent), t, subAt, unsubAt, scope, listId, email);
    const c = contactOf(S.cGet.get(scope, listId, email));
    if (o.trigger !== false) {
      if (status === 'subscribed' && prev.status !== 'subscribed') fire(scope, listId, 'subscribe', c);
      for (const tg of tags) if (!prev.tags.includes(tg)) fire(scope, listId, 'tag', c, tg);
    }
    return { updated: true, contact: c };
  }

  // ---------- automations ----------
  const autoOf = (r) => ({ id: r.id, ...JSON.parse(r.json), status: r.status, updatedAt: r.updated_at });
  const stepDelay = (st) => Math.max(0, Number(st?.delayHours) || 0) * 3600e3;
  /** Enroll a contact in the active automations of its list that start on this event. */
  function fire(scope, listId, type, c, tag = '', cycle = '', nowMs = Date.now()) {
    if (c.status !== 'subscribed') return 0;
    let n = 0;
    for (const r of S.autoAll.all(scope)) {
      if (r.status !== 'active') continue;
      const a = autoOf(r);
      if (a.list !== listId || a.trigger?.type !== type || !a.steps?.length) continue;
      if (type === 'tag' && String(a.trigger.tag || '').toLowerCase() !== String(tag).toLowerCase()) continue;
      n += Number(S.runIns.run(scope, a.id, c.email, cycle, new Date(nowMs + stepDelay(a.steps[0])).toISOString(), now()).changes);
    }
    return n;
  }
  const campaignId = (autoId, stepId) => `a_${autoId}_${stepId}`.slice(0, 80);
  /** Register each email step as a tracked campaign of the sending account's owner (stats, unsubscribe, click redirects). */
  function registerSteps(scope, a) {
    if (!a.sender?.owner) return;
    for (const st of a.steps || []) if (st.type === 'email') mail.saveCampaign(a.sender.owner, campaignId(a.id, st.id), { ...(mail.campaign(a.sender.owner, campaignId(a.id, st.id)) || { createdAt: now() }), subject: st.subject || '', links: Array.isArray(st.links) ? st.links.slice(0, 300) : [], scope, automation: a.id, step: st.id });
  }
  /** Daily: birthdays / anniversaries (date field matches today) and win-back (no open for N days). */
  function daily(nowMs) {
    const local = new Date(nowMs + tz * 3600e3);
    const day = local.toISOString().slice(0, 10);
    if (S.metaGet.get('daily')?.value === day) return;
    S.metaPut.run('daily', day);
    S.pendOld.run(new Date(nowMs - 14 * DAY).toISOString()); // unconfirmed sign-ups expire after two weeks
    for (const r of S.autoActive.all()) {
      const a = autoOf(r);
      if (a.trigger?.type === 'date') {
        const [mm, dd] = [local.getUTCMonth() + 1, local.getUTCDate()];
        for (const c of S.cByStatus.all(r.scope, a.list, 'subscribed').map(contactOf)) {
          const md = monthDay(c.fields?.[String(a.trigger.field || 'birthday').toLowerCase()]);
          if (md && md[0] === mm && md[1] === dd) S.runIns.run(r.scope, a.id, c.email, day.slice(0, 4), new Date(nowMs + stepDelay(a.steps?.[0])).toISOString(), now());
        }
      }
      if (a.trigger?.type === 'inactive') {
        const days = Math.max(7, Number(a.trigger.days) || 60);
        for (const c of S.cByStatus.all(r.scope, a.list, 'subscribed').map(contactOf)) {
          const since = daysSince(c.lastOpenAt || c.subscribedAt || c.createdAt, nowMs);
          if (since !== null && since >= days) S.runIns.run(r.scope, a.id, c.email, '', new Date(nowMs + stepDelay(a.steps?.[0])).toISOString(), now());
        }
      }
    }
  }
  let busy = false;
  /** Advance due automation runs a little at a time. */
  async function tick(nowMs = Date.now()) {
    if (busy) return; busy = true;
    try {
      daily(nowMs);
      const cache = new Map();
      for (const run of S.runDue.all(new Date(nowMs).toISOString(), 40)) {
        const key = `${run.scope}|${run.automation_id}`;
        if (!cache.has(key)) { const r = S.autoGet.get(run.scope, run.automation_id); cache.set(key, r ? autoOf(r) : null); }
        const a = cache.get(key);
        const set = (step, next, status, tries = 0, error = '') => S.runSet.run(step, next, status, tries, error.slice(0, 300), now(), run.scope, run.automation_id, run.email, run.cycle);
        if (!a) { set(run.step, run.next_at, 'stopped', 0, 'automation removed'); continue; }
        if (a.status !== 'active') continue; // paused: picks up where it was when resumed
        const row = S.cGet.get(run.scope, a.list, run.email);
        const c = row ? contactOf(row) : null;
        if (!c || c.status !== 'subscribed' || (a.sender?.owner && mail.suppressed(a.sender.owner, c.email))) { set(run.step, run.next_at, 'stopped', 0, 'contact left'); continue; }
        const st = a.steps?.[run.step];
        if (!st) { set(run.step, run.next_at, 'done'); continue; }
        try {
          if (st.type === 'email') {
            if (!a.sender?.id) throw new Error('chưa chọn kênh gửi');
            if (!st.html) throw new Error('bước email chưa có nội dung');
            await mail.sendOne(a.sender.owner, a.sender.id, { campaign: campaignId(a.id, st.id), to: c.email, subject: st.subject || '', html: st.html, text: st.text || '', fields: fieldsFor(c) });
            S.logAdd.run(run.scope, a.id, st.id, c.email, 'sent', now());
          } else if (st.type === 'tag') {
            upsert(run.scope, a.list, { email: c.email, tags: st.add || [] }, { trigger: true, update: false });
            if (Array.isArray(st.remove) && st.remove.length) { const cur = contactOf(S.cGet.get(run.scope, a.list, c.email)); const rm = new Set(cleanTags(st.remove).map((x) => x.toLowerCase())); S.cUpd.run(cur.status, cur.first_name, cur.last_name, JSON.stringify(cur.tags.filter((x) => !rm.has(x.toLowerCase()))), JSON.stringify(cur.fields), JSON.stringify(cur.consent), now(), cur.subscribedAt, cur.unsubscribedAt, run.scope, a.list, c.email); }
            S.logAdd.run(run.scope, a.id, st.id, c.email, 'done', now());
          }
          const next = a.steps[run.step + 1];
          if (next) set(run.step + 1, new Date(nowMs + stepDelay(next)).toISOString(), 'active');
          else set(run.step + 1, run.next_at, 'done');
        } catch (e) {
          const tries = run.tries + 1, msg = String(e?.message || e);
          S.logAdd.run(run.scope, a.id, st.id, c.email, 'failed', now());
          if (tries >= 3 || /401|403|chưa chọn|chưa có nội dung/.test(msg)) set(run.step, run.next_at, 'failed', tries, msg);
          else set(run.step, new Date(nowMs + 30 * 60e3 * tries).toISOString(), 'active', tries, msg);
        }
      }
    } catch (e) { log('[aud] tick:', e?.message || e); }
    finally { busy = false; }
  }

  // ---------- public signup forms ----------
  const formOf = (r) => ({ id: r.id, ...JSON.parse(r.json), updatedAt: r.updated_at });
  const page = (f, title, msg, extra = '') => {
    const c = f?.colors || {};
    const bg = /^#[0-9a-f]{6}$/i.test(c.bg || '') ? c.bg : '#f4f5f3', accent = /^#[0-9a-f]{6}$/i.test(c.accent || '') ? c.accent : '#111111', ink = /^#[0-9a-f]{6}$/i.test(c.text || '') ? c.text : '#141714';
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:${bg};font:16px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${ink}}main{width:100%;max-width:440px;margin:24px;padding:32px;background:#fff;border-radius:18px;box-shadow:0 24px 48px -24px rgba(0,0,0,.28)}h1{font-size:24px;line-height:1.2;margin:0 0 8px}p{color:#555;margin:0 0 18px}label{display:block;font-size:13px;font-weight:600;margin:12px 0 6px}input{width:100%;font:inherit;padding:12px 14px;border:1px solid #d6d9d4;border-radius:10px;background:#fff;color:#141714}input:focus{outline:2px solid ${accent};border-color:${accent}}button{margin-top:18px;width:100%;font:inherit;font-weight:700;padding:14px 22px;border:0;border-radius:999px;background:${accent};color:#fff;cursor:pointer}.hp{position:absolute;left:-9999px}small{display:block;margin-top:14px;color:#888;font-size:12px}</style></head><body><main><h1>${esc(title)}</h1><p>${msg}</p>${extra}<small>${esc(f?.consentText || 'Bạn có thể huỷ đăng ký bất cứ lúc nào bằng link cuối mỗi email.')}</small></main></body></html>`;
  };
  const sendHtml = (res, code, s) => { res.statusCode = code; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(s); };
  const formFields = (f) => `<form method="post"><label for="e">Email</label><input id="e" type="email" name="email" required autocomplete="email" placeholder="ban@email.com">${f.fields?.first_name ? '<label for="n">Tên</label><input id="n" name="first_name" autocomplete="given-name">' : ''}${f.fields?.last_name ? '<label for="l">Họ</label><input id="l" name="last_name" autocomplete="family-name">' : ''}${f.fields?.phone ? '<label for="p">Số điện thoại</label><input id="p" name="phone" autocomplete="tel">' : ''}${f.fields?.birthday ? '<label for="b">Ngày sinh (dd/mm)</label><input id="b" name="birthday" placeholder="15/10">' : ''}<input class="hp" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true"><button type="submit">${esc(f.button || 'Đăng ký')}</button></form>`;

  async function formSubmit(f, scope, req, res) {
    const wantsJson = /json/.test(String(req.headers.accept || '')) || /json/.test(String(req.headers['content-type'] || ''));
    const reply = (code, ok, msg, extra = {}) => (wantsJson ? json(res, code, { ok, message: msg, ...extra }) : (ok && f.redirect && /^https?:\/\//i.test(f.redirect) ? (res.statusCode = 303, res.setHeader('Location', f.redirect), res.end()) : sendHtml(res, code, page(f, ok ? (extra.pending ? 'Kiểm tra hộp thư' : 'Cảm ơn bạn!') : 'Chưa đăng ký được', esc(msg)))));
    if (throttled(`form:${f.id}:${ipOf(req)}`, 20, 3600e3)) return reply(429, false, 'Bạn gửi quá nhiều lần. Thử lại sau.');
    let p = {};
    const rawText = (await rawBody(req, 64 * 1024)).toString('utf8');
    try { p = /json/.test(String(req.headers['content-type'] || '')) ? JSON.parse(rawText || '{}') : Object.fromEntries(new URLSearchParams(rawText)); } catch { return reply(400, false, 'Dữ liệu không hợp lệ.'); }
    if (p.hp) return reply(200, true, f.success || 'Đã đăng ký.'); // a bot filled the hidden field: pretend it worked
    const email = normEmail(p.email);
    if (!EMAIL_RE.test(email)) return reply(400, false, 'Email không hợp lệ.');
    const list = getList(scope, f.list);
    if (!list) return reply(410, false, 'Form này không còn hoạt động.');
    const consent = { method: 'form', form: f.id, at: now(), ip: ipOf(req), text: f.consentText || '', page: String(req.headers.referer || '').slice(0, 300) };
    const input = { email, first_name: p.first_name, last_name: p.last_name, fields: { ...(p.phone ? { phone: p.phone } : {}), ...(p.birthday ? { birthday: p.birthday } : {}) } };
    const prev = S.cGet.get(scope, f.list, email);
    if (prev && prev.status === 'subscribed') { upsert(scope, f.list, input, { tagsAdd: f.tags, source: 'form' }); return reply(200, true, f.success || 'Bạn đã có trong danh sách. Cảm ơn bạn!'); }
    if (prev && ['bounced', 'complained'].includes(prev.status)) return reply(200, true, f.success || 'Đã ghi nhận.');
    const sender = list.sender?.owner && list.sender?.id ? list.sender : null;
    if (f.doubleOptIn !== false && sender) {
      upsert(scope, f.list, input, { status: 'pending', tagsAdd: f.tags, source: 'form', consent, trigger: false });
      const token = randomBytes(24).toString('base64url');
      S.pendPut.run(sha(token), scope, f.list, email, f.id, now());
      const link = `${publicUrl}/f/${f.id}/c/${token}`;
      const from = list.company?.name || list.name || 'chúng tôi';
      try {
        await mail.sendOne(sender.owner, sender.id, { campaign: 'confirm', to: email, tracked: false, subject: `Xác nhận đăng ký nhận tin từ ${from}`, html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#141714"><h2 style="margin:0 0 12px">Xác nhận đăng ký</h2><p style="color:#444">Bấm nút dưới đây để bắt đầu nhận email từ <b>${esc(from)}</b>. Nếu không phải bạn đăng ký, bỏ qua email này.</p><p style="margin:24px 0"><a href="${esc(link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Xác nhận đăng ký</a></p><p style="color:#888;font-size:12px">${esc(list.company?.address || '')}</p></div>`, text: `Xác nhận đăng ký nhận tin từ ${from}: ${link}` });
      } catch (e) { log('[aud] confirm mail:', e?.message || e); return reply(502, false, 'Chưa gửi được email xác nhận. Thử lại sau ít phút.'); }
      return reply(200, true, 'Gần xong! Mở email chúng tôi vừa gửi và bấm Xác nhận đăng ký.', { pending: true });
    }
    upsert(scope, f.list, input, { status: 'subscribed', resubscribe: true, tagsAdd: f.tags, source: 'form', consent });
    return reply(200, true, f.success || 'Bạn đã có tên trong danh sách. Hẹn gặp bạn trong hộp thư!');
  }

  // ---------- recipients for a list send (mail /mail/send) ----------
  function resolve(u, spec, scopeInfo) {
    const list = getList(scopeInfo.scope, String(spec.list || ''));
    if (!list) return { error: 'Không có danh sách này.', status: 404 };
    let contacts = S.cByStatus.all(scopeInfo.scope, list.id, 'subscribed').map(contactOf);
    let segName = '';
    if (spec.segment) { const sg = S.segGet.get(scopeInfo.scope, String(spec.segment)); if (!sg) return { error: 'Không có phân nhóm này.', status: 404 }; const seg = JSON.parse(sg.json); segName = seg.name; contacts = contacts.filter((c) => matchContact(c, seg.rules, seg.match)); }
    const tagsAny = cleanTags(spec.tags || []), tagsNot = cleanTags(spec.excludeTags || []);
    if (tagsAny.length) contacts = contacts.filter((c) => c.tags.some((t) => tagsAny.includes(t)));
    if (tagsNot.length) contacts = contacts.filter((c) => !c.tags.some((t) => tagsNot.includes(t)));
    contacts = contacts.filter((c) => !mail.suppressed(u.id, c.email));
    const addr = [list.company?.name, list.company?.address].filter(Boolean).join(' · ');
    const footerHtml = addr ? `<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:16px;color:#999;text-align:center;padding:8px 16px 16px">Bạn nhận email này vì đã đăng ký nhận tin từ ${esc(list.company?.name || list.name)}. ${esc(list.company?.address || '')}</div>` : '';
    return { rows: contacts.map((c) => ({ email: c.email, fields: fieldsFor(c) })), info: { scope: scopeInfo.scope, list: list.id, listName: list.name, segment: spec.segment || null, segmentName: segName, footerHtml } };
  }

  const mailHooks = {
    resolveRecipients: (u, spec) => {
      const client = String(spec?.client || '');
      let scope = `u:${u.id}`;
      if (client) { const acc = access(u.id, client); if (!acc) return { error: 'Không có khách hàng này.', status: 404 }; if (!can(acc, 'write')) return { error: 'Vai trò của bạn chỉ được xem.', status: 403 }; scope = `c:${client}`; }
      return resolve(u, spec || {}, { scope });
    },
    onEvent: (t, kind, c) => {
      const scope = c?.audience?.scope || c?.scope || `u:${t.owner}`;
      if (kind === 'open') S.cOpen.run(now(), scope, t.email);
      if (kind === 'click') S.cClick.run(now(), scope, t.email);
    },
    onUnsubscribe: (t, c) => { const scope = c?.audience?.scope || c?.scope || `u:${t.owner}`; S.cStatusAll.run('unsubscribed', now(), now(), scope, t.email); },
    onBounce: (owner, email, kind) => { for (const sc of scopesOfUser(owner)) S.cStatusAll.run(kind === 'complaint' ? 'complained' : 'bounced', null, now(), sc, email); },
  };

  // ---------- routes ----------
  async function handle(url, req, res) {
    const p = url.pathname, m = req.method;
    // public form pages
    const fm = /^\/f\/([\w-]{6,40})(?:\/c\/([\w-]{20,80}))?$/.exec(p);
    if (fm) {
      const r = S.formGet.get(fm[1]); if (!r) { sendHtml(res, 404, page(null, 'Không tìm thấy form', 'Link đăng ký này không còn.')); return true; }
      const f = formOf(r);
      if (fm[2]) {
        const pend = S.pendGet.get(sha(fm[2]));
        if (!pend || pend.form_id !== f.id) { sendHtml(res, 410, page(f, 'Link đã hết hạn', 'Link xác nhận này đã dùng hoặc đã hết hạn. Đăng ký lại để nhận link mới.')); return true; }
        S.pendDel.run(sha(fm[2]));
        upsert(pend.scope, pend.list_id, { email: pend.email }, { status: 'subscribed', resubscribe: true, source: 'form', consent: { confirmedAt: now(), confirmIp: ipOf(req) } });
        if (f.redirect && /^https?:\/\//i.test(f.redirect)) { res.statusCode = 303; res.setHeader('Location', f.redirect); res.end(); return true; }
        sendHtml(res, 200, page(f, 'Đã xác nhận!', esc(f.success || 'Cảm ơn bạn. Bạn sẽ nhận email từ chúng tôi.'))); return true;
      }
      if (m === 'POST') { await formSubmit(f, r.scope, req, res); return true; }
      if (m === 'GET') { sendHtml(res, 200, page(f, f.title || 'Đăng ký nhận tin', esc(f.intro || 'Nhận ưu đãi và tin mới qua email.'), formFields(f))); return true; }
    }
    if (!p.startsWith('/aud/')) return false;
    const u = requireUser(req, res); if (!u) return true;
    const write = m !== 'GET';
    const sc = scopeOf(u, url, res, write ? 'write' : 'read'); if (!sc) return true;
    const scope = sc.scope;
    const parts = p.split('/').filter(Boolean).slice(1).map(decodeURIComponent); // after 'aud'
    try {
      // ----- lists -----
      if (parts[0] === 'lists') {
        const [, id, sub, arg] = parts;
        if (!id) {
          if (m === 'GET') { json(res, 200, { lists: S.listAll.all(scope).map(listOf), role: sc.role, senders: mail.senderIds(u.id) }); return true; }
          if (m === 'POST') { const b = await body(req); const nid = uid('l'); S.listPut.run(scope, nid, JSON.stringify(cleanList(b, {}, u)), now(), now()); json(res, 200, { list: listOf(S.listGet.get(scope, nid)) }); return true; }
        }
        const lr = S.listGet.get(scope, id); if (!lr) { json(res, 404, { error: 'Không có danh sách này.' }); return true; }
        const list = { id, ...JSON.parse(lr.json) };
        if (!sub) {
          if (m === 'GET') { json(res, 200, { list: listOf(lr) }); return true; }
          if (m === 'PUT') { const b = await body(req); S.listPut.run(scope, id, JSON.stringify(cleanList(b, list, u)), lr.created_at, now()); json(res, 200, { list: listOf(S.listGet.get(scope, id)) }); return true; }
          if (m === 'DELETE') {
            if (sc.role !== 'owner' && sc.role !== 'manager') { json(res, 403, { error: 'Chỉ chủ workspace hoặc quản lý được xoá danh sách.' }); return true; }
            if (String(url.searchParams.get('confirm') || '').trim().toLowerCase() !== String(list.name || '').trim().toLowerCase()) { json(res, 400, { error: 'Gõ đúng tên danh sách để xác nhận xoá.' }); return true; }
            S.cDelList.run(scope, id); S.listDel.run(scope, id); json(res, 200, { ok: true }); return true;
          }
        }
        if (sub === 'contacts') {
          if (!arg && m === 'GET') {
            const qy = String(url.searchParams.get('q') || '').toLowerCase().trim(), st = url.searchParams.get('status'), tag = url.searchParams.get('tag'), seg = url.searchParams.get('segment');
            const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0), limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
            let rows = S.cAll.all(scope, id).map(contactOf);
            if (st) rows = rows.filter((c) => c.status === st);
            if (tag) rows = rows.filter((c) => c.tags.includes(tag));
            if (qy) rows = rows.filter((c) => c.email.includes(qy) || `${c.first_name} ${c.last_name}`.toLowerCase().includes(qy));
            if (seg) { const sg = S.segGet.get(scope, seg); if (sg) { const s2 = JSON.parse(sg.json); rows = rows.filter((c) => matchContact(c, s2.rules, s2.match)); } }
            json(res, 200, { contacts: rows.slice(offset, offset + limit), total: rows.length }); return true;
          }
          if (!arg && m === 'POST') {
            const b = await body(req);
            const r = upsert(scope, id, b, { status: STATUSES.includes(b?.status) ? b.status : 'subscribed', force: !!b?.force, source: 'manual', consent: { method: 'manual', by: u.email, at: now() } });
            if (r.invalid) { json(res, 400, { error: 'Email không hợp lệ.' }); return true; }
            json(res, 200, r); return true;
          }
          const email = normEmail(arg);
          if (m === 'PATCH') {
            if (!S.cGet.get(scope, id, email)) { json(res, 404, { error: 'Không có liên hệ này.' }); return true; }
            const b = await body(req);
            const r = upsert(scope, id, { ...b, email }, { status: b?.status, force: b?.status === 'subscribed' && !!b?.confirmConsent, replaceTags: Array.isArray(b?.tags), source: 'manual', consent: b?.status === 'subscribed' && b?.confirmConsent ? { method: 'manual-resubscribe', by: u.email, at: now() } : {} });
            json(res, 200, r); return true;
          }
          if (m === 'DELETE') { S.cDel.run(scope, id, email); json(res, 200, { ok: true }); return true; }
          if (m === 'GET') { const r = S.cGet.get(scope, id, email); json(res, r ? 200 : 404, r ? { contact: contactOf(r) } : { error: 'Không có liên hệ này.' }); return true; }
        }
        if (sub === 'import' && m === 'POST') {
          if (throttled(`aud-import:${u.id}`, 40, 3600e3)) { json(res, 429, { error: 'Nhập quá nhiều lần trong 1 giờ.' }); return true; }
          const b = await body(req);
          if (b?.attest !== true) { json(res, 400, { error: 'Xác nhận những người này đã đồng ý nhận email trước khi nhập.' }); return true; }
          const rows = Array.isArray(b?.rows) ? b.rows.slice(0, 20000) : [];
          const out = { added: 0, updated: 0, invalid: 0, skipped: 0, suppressed: 0 };
          const consent = { method: 'import', by: u.email, at: now(), note: String(b?.note || '').slice(0, 200) };
          db.exec('BEGIN');
          try {
            for (const row of rows) {
              const email = normEmail(row?.email);
              if (mail.suppressed(u.id, email)) { out.suppressed++; continue; }
              const r = upsert(scope, id, row || {}, { status: 'subscribed', tagsAdd: b.tags, source: 'import', consent, update: b.mode !== 'add', trigger: !!b.triggerAutomations });
              if (r.invalid) out.invalid++; else if (r.created) out.added++; else if (r.updated) out.updated++; else out.skipped++;
            }
            db.exec('COMMIT');
          } catch (e) { db.exec('ROLLBACK'); throw e; }
          json(res, 200, out); return true;
        }
        if (sub === 'export.csv' && m === 'GET') {
          const rows = S.cAll.all(scope, id).map(contactOf);
          const keys = [...new Set(rows.flatMap((c) => Object.keys(c.fields)))].slice(0, 40);
          const csv = toCsv([['email', 'status', 'first_name', 'last_name', 'tags', 'source', 'created_at', 'subscribed_at', 'unsubscribed_at', 'opens', 'clicks', 'last_open_at', ...keys], ...rows.map((c) => [c.email, c.status, c.first_name, c.last_name, c.tags.join('|'), c.source, c.createdAt, c.subscribedAt || '', c.unsubscribedAt || '', c.opens, c.clicks, c.lastOpenAt || '', ...keys.map((k) => c.fields[k] ?? '')])]);
          res.statusCode = 200; res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${String(list.name || 'danh-sach').replace(/[^\w.-]+/g, '-')}.csv"`); res.end('﻿' + csv); return true;
        }
        if (sub === 'tags') {
          if (m === 'GET') { const counts = {}; for (const c of S.cAll.all(scope, id).map(contactOf)) for (const t of c.tags) counts[t] = (counts[t] || 0) + 1; json(res, 200, { tags: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([tag, n]) => ({ tag, n })) }); return true; }
          if (m === 'POST') {
            const b = await body(req); const add = cleanTags(b?.add), rm = new Set(cleanTags(b?.remove));
            let n = 0;
            db.exec('BEGIN');
            try {
              for (const e of (Array.isArray(b?.emails) ? b.emails : []).slice(0, 20000)) {
                const r = S.cGet.get(scope, id, normEmail(e)); if (!r) continue;
                const c = contactOf(r);
                upsert(scope, id, { email: c.email, tags: [...c.tags.filter((t) => !rm.has(t)), ...add] }, { replaceTags: true, update: false }); n++;
              }
              db.exec('COMMIT');
            } catch (e) { db.exec('ROLLBACK'); throw e; }
            json(res, 200, { updated: n }); return true;
          }
        }
      }
      // ----- segments -----
      if (parts[0] === 'segments') {
        const id = parts[1];
        if (!id && m === 'GET') { json(res, 200, { segments: S.segAll.all(scope).map((r) => ({ id: r.id, ...JSON.parse(r.json) })) }); return true; }
        if (m === 'PUT' || (m === 'POST' && !id)) {
          const b = await body(req); const sid = id || uid('s');
          if (!getList(scope, String(b?.list || ''))) { json(res, 400, { error: 'Chọn danh sách cho phân nhóm.' }); return true; }
          const seg = { name: String(b.name || 'Phân nhóm').slice(0, 80), list: String(b.list), match: b.match === 'any' ? 'any' : 'all', rules: (Array.isArray(b.rules) ? b.rules : []).slice(0, 20).map((r) => ({ field: String(r.field || '').slice(0, 60), op: String(r.op || ''), value: r.value === undefined ? '' : String(r.value).slice(0, 200) })) };
          S.segPut.run(scope, sid, JSON.stringify(seg), now()); json(res, 200, { segment: { id: sid, ...seg } }); return true;
        }
        if (id && m === 'DELETE') { S.segDel.run(scope, id); json(res, 200, { ok: true }); return true; }
      }
      if (parts[0] === 'preview' && m === 'POST') {
        const b = await body(req); const list = getList(scope, String(b?.list || '')); if (!list) { json(res, 404, { error: 'Không có danh sách này.' }); return true; }
        const all = S.cByStatus.all(scope, list.id, 'subscribed').map(contactOf);
        const hit = all.filter((c) => matchContact(c, b.rules, b.match));
        json(res, 200, { count: hit.length, of: all.length, sample: hit.slice(0, 5).map((c) => c.email) }); return true;
      }
      // ----- forms -----
      if (parts[0] === 'forms') {
        const id = parts[1];
        if (!id && m === 'GET') { json(res, 200, { forms: S.formAll.all(scope).map((r) => ({ id: r.id, ...JSON.parse(r.json), url: `${publicUrl}/f/${r.id}` })) }); return true; }
        if (m === 'PUT' || (m === 'POST' && !id)) {
          const b = await body(req); const fid = id || `${randomBytes(9).toString('base64url')}`;
          if (id) { const ex = S.formGet.get(id); if (!ex || ex.scope !== scope) { json(res, 404, { error: 'Không có form này.' }); return true; } }
          if (!getList(scope, String(b?.list || ''))) { json(res, 400, { error: 'Chọn danh sách nhận người đăng ký.' }); return true; }
          const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : d);
          const f = { list: String(b.list), name: String(b.name || b.title || 'Form').slice(0, 80), title: String(b.title || 'Đăng ký nhận tin').slice(0, 120), intro: String(b.intro || '').slice(0, 400), button: String(b.button || 'Đăng ký').slice(0, 40), success: String(b.success || '').slice(0, 300), redirect: /^https?:\/\//i.test(String(b.redirect || '')) ? String(b.redirect).slice(0, 500) : '', doubleOptIn: b.doubleOptIn !== false, tags: cleanTags(b.tags), consentText: String(b.consentText || '').slice(0, 300), fields: { first_name: !!b.fields?.first_name, last_name: !!b.fields?.last_name, phone: !!b.fields?.phone, birthday: !!b.fields?.birthday }, colors: { bg: hex(b.colors?.bg, '#f4f5f3'), accent: hex(b.colors?.accent, '#111111'), text: hex(b.colors?.text, '#141714') } };
          S.formPut.run(fid, scope, JSON.stringify(f), now()); json(res, 200, { form: { id: fid, ...f, url: `${publicUrl}/f/${fid}` } }); return true;
        }
        if (id && m === 'DELETE') { S.formDel.run(id, scope); json(res, 200, { ok: true }); return true; }
      }
      // ----- automations -----
      if (parts[0] === 'automations') {
        const [, id, action] = parts;
        if (!id && m === 'GET') {
          json(res, 200, { automations: S.autoAll.all(scope).map((r) => { const a = autoOf(r); const runs = Object.fromEntries(S.runCounts.all(scope, a.id).map((x) => [x.status, x.n])); const log2 = {}; for (const x of S.logCounts.all(scope, a.id)) (log2[x.step_id] ||= {})[x.status] = x.n; const steps = (a.steps || []).map((st) => { const { html: _h, text: _t, ...rest } = st; const stats = st.type === 'email' && a.sender?.owner ? mail.stats(a.sender.owner, campaignId(a.id, st.id)) : null; return { ...rest, hasHtml: !!st.html, log: log2[st.id] || {}, stats }; }); return { ...a, steps, runs }; }) });
          return true;
        }
        if (m === 'PUT' || (m === 'POST' && !id && !action)) {
          const b = await body(req); const aid = id || uid('a');
          const prevR = id ? S.autoGet.get(scope, id) : null; const prev = prevR ? autoOf(prevR) : null;
          if (!getList(scope, String(b?.list || ''))) { json(res, 400, { error: 'Chọn danh sách cho chuỗi tự động.' }); return true; }
          const types = ['subscribe', 'tag', 'date', 'inactive'];
          const trig = { type: types.includes(b?.trigger?.type) ? b.trigger.type : 'subscribe', tag: String(b?.trigger?.tag || '').slice(0, 40), field: String(b?.trigger?.field || 'birthday').toLowerCase().replace(/[^\w]/g, '_').slice(0, 40), days: Math.max(7, Math.min(365, Number(b?.trigger?.days) || 60)) };
          const steps = (Array.isArray(b?.steps) ? b.steps : []).slice(0, 20).map((st, i) => {
            const old = prev?.steps?.find((x) => x.id === st.id);
            const base = { id: String(st.id || `s${i + 1}_${randomBytes(2).toString('hex')}`).slice(0, 24), type: st.type === 'tag' ? 'tag' : 'email', delayHours: Math.max(0, Math.min(24 * 365, Number(st.delayHours) || 0)) };
            if (base.type === 'tag') return { ...base, add: cleanTags(st.add), remove: cleanTags(st.remove) };
            const html = typeof st.html === 'string' ? st.html : old?.html || '';
            if (html.length > 600_000) throw Object.assign(new Error('Nội dung một email quá lớn (ảnh phải lưu trên host).'), { status: 400 });
            if (/cid:/i.test(html)) throw Object.assign(new Error('Email còn ảnh đính kèm (cid:): bật lưu ảnh trên host.'), { status: 400 });
            return { ...base, subject: String(st.subject || '').slice(0, 300), project: String(st.project || '').slice(0, 80), projectName: String(st.projectName || '').slice(0, 120), html, text: typeof st.text === 'string' ? st.text.slice(0, 100000) : old?.text || '', links: Array.isArray(st.links) ? st.links.map((x) => String(x).slice(0, 2000)).slice(0, 300) : old?.links || [] };
          });
          const sender = b?.sender?.id ? { owner: prev?.sender?.owner && prev.sender.id === b.sender.id ? prev.sender.owner : u.id, id: String(b.sender.id) } : prev?.sender || null;
          if (sender && sender.owner === u.id && !mail.senderIds(u.id).some((x) => x.id === sender.id)) { json(res, 400, { error: 'Kênh gửi không tồn tại.' }); return true; }
          const a = { name: String(b.name || 'Chuỗi tự động').slice(0, 80), list: String(b.list), trigger: trig, steps, sender };
          S.autoPut.run(scope, aid, JSON.stringify(a), prev?.status || 'draft', now());
          if ((prev?.status || 'draft') === 'active') registerSteps(scope, { id: aid, ...a });
          json(res, 200, { automation: { id: aid, ...a, status: prev?.status || 'draft' } }); return true;
        }
        if (id && action && m === 'POST') {
          const r = S.autoGet.get(scope, id); if (!r) { json(res, 404, { error: 'Không có chuỗi này.' }); return true; }
          const a = autoOf(r);
          if (action === 'activate') {
            if (!a.sender?.id) { json(res, 400, { error: 'Chọn kênh gửi (Resend / Brevo / SES) trước khi bật.' }); return true; }
            const missing = (a.steps || []).find((st) => st.type === 'email' && (!st.html || !st.subject));
            if (!a.steps?.length || missing) { json(res, 400, { error: missing ? `Bước "${missing.subject || missing.projectName || missing.id}" chưa có nội dung hoặc tiêu đề.` : 'Thêm ít nhất một bước.' }); return true; }
            registerSteps(scope, a);
            S.autoPut.run(scope, id, r.json, 'active', now()); json(res, 200, { ok: true, status: 'active' }); return true;
          }
          if (action === 'pause') { S.autoPut.run(scope, id, r.json, 'paused', now()); json(res, 200, { ok: true, status: 'paused' }); return true; }
          if (action === 'test') {
            const b = await body(req); const to = normEmail(b?.to || u.email); const st = a.steps?.find((x) => x.id === b?.step) || a.steps?.find((x) => x.type === 'email');
            if (!st?.html || !a.sender?.id) { json(res, 400, { error: 'Bước email chưa có nội dung hoặc chưa chọn kênh gửi.' }); return true; }
            await mail.sendOne(a.sender.owner, a.sender.id, { campaign: 'test', to, tracked: false, subject: `[Thử] ${st.subject}`, html: st.html, text: st.text, fields: { email: to, first_name: b?.first_name || 'Bạn' } });
            json(res, 200, { ok: true, to }); return true;
          }
        }
        if (id && !action && m === 'DELETE') { S.autoDel.run(scope, id); S.runDelAuto.run(scope, id); json(res, 200, { ok: true }); return true; }
      }
      // ----- reports -----
      if (parts[0] === 'reports' && m === 'GET') {
        const days = Math.max(7, Math.min(365, Number(url.searchParams.get('days')) || 30));
        const since = new Date(Date.now() - days * DAY).toISOString();
        const sub = Object.fromEntries(S.growthSub.all(scope, since).map((r) => [r.d, r.n])), unsub = Object.fromEntries(S.growthUnsub.all(scope, since).map((r) => [r.d, r.n]));
        const growth = []; for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10); growth.push({ day: d, subscribed: sub[d] || 0, unsubscribed: unsub[d] || 0 }); }
        const lists = S.listAll.all(scope).map(listOf).map((l) => ({ id: l.id, name: l.name, counts: l.counts, total: l.total }));
        const campaigns = mail.campaigns(u.id).filter((c) => c.send && (c.audience?.scope === scope || (!c.audience && scope === `u:${u.id}`))).map((c) => { const st = mail.stats(u.id, c.id); const sent = st.queue.sent || 0; return { id: c.id, subject: c.send.subject || c.subject, at: c.send.sendAt || c.createdAt, status: c.send.status, list: c.audience?.listName || '', segment: c.audience?.segmentName || '', sent, opens: st.opens, clicks: st.clicks, unsubscribes: st.unsubscribes, failed: st.queue.failed || 0 }; }).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 50);
        json(res, 200, { days, growth, lists, campaigns }); return true;
      }
      json(res, 404, { error: 'không có route này' }); return true;
    } catch (e) { json(res, e.status || 500, { error: e.message }); return true; }
  }

  function cleanList(b, prev, u) {
    const sender = b?.sender?.id ? { owner: prev.sender?.id === b.sender.id ? prev.sender.owner : u.id, id: String(b.sender.id) } : b?.sender === null ? null : prev.sender || null;
    return {
      name: String(b?.name ?? prev.name ?? 'Danh sách').trim().slice(0, 80) || 'Danh sách',
      company: { name: String(b?.company?.name ?? prev.company?.name ?? '').slice(0, 120), address: String(b?.company?.address ?? prev.company?.address ?? '').slice(0, 300) },
      sender,
      fields: Array.isArray(b?.fields) ? b.fields.slice(0, 30).map((f) => ({ key: String(f.key || '').toLowerCase().replace(/[^\w]/g, '_').slice(0, 40), label: String(f.label || f.key || '').slice(0, 60), type: ['text', 'date', 'number'].includes(f.type) ? f.type : 'text' })).filter((f) => f.key) : prev.fields || [],
    };
  }

  return {
    handle, mailHooks, tick,
    start: () => { const t = setInterval(() => { void tick(); }, 30_000); t.unref?.(); },
    health: () => ({ audience: true, forms: true, automations: true }),
    upsert, // tests
  };
}
