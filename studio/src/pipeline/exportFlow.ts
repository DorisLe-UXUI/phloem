// Export pipeline for Studio: draft (Mailchimp/Klaviyo) · copy HTML · zip. Mirrors the plugin flow, minus Figma.
import { cloud } from '../storage/sync';
import type { DraftFile, DraftRecord, ExportedSlice, Profile, Provider, SlicePlan } from '../../../src/shared/types';
import { buildEmailHtml, htmlSizeBytes } from '../../../src/shared/html';
import { GMAIL_CLIP_BYTES, WEIGHT_ERROR, WEIGHT_WARN } from '../../../src/shared/checks';
import { planSlices } from '../../../src/shared/slicer';
import { slug } from '../../../src/shared/utm';
import { makeZip } from '../../../src/shared/zip';
import { utf8Bytes } from '../../../src/shared/hash';
import { ApiError, makeCaller, oauthPoll, oauthRefresh, oauthStart, relayHealth, type RelayHealth } from '../../../src/ui/api/relay';
import { Mailchimp, type McTemplate } from '../../../src/ui/api/mailchimp';
import { Klaviyo } from '../../../src/ui/api/klaviyo';
import { extOf, finalizeSlices, mimeOf } from '../../../src/ui/imageops';
import { copyText, downloadBytes } from '../../../src/ui/clipboard';
import type { Brand, Doc, Project } from '../model/types';
import { resolveColor } from '../model/types';
import { docToNNode } from '../model/toNNode';
import { exportDocSlices } from '../render/exportSlices';
import { get, log, set, toast } from '../store';
import { patchProject } from './actions';

export const providerName = (p: Provider) => (p === 'mailchimp' ? 'Mailchimp' : 'Klaviyo');

/** Per-profile caches for the clients UI. */
export const cache: { lists: Record<string, { id: string; name: string }[]>; templates: Record<string, McTemplate[]>; sections: Record<string, string[]>; relay: RelayHealth | null; relayError: string } = { lists: {}, templates: {}, sections: {}, relay: null, relayError: '' };

export function activeProfile(): Profile | null { const s = get(); return s.profiles.find((p) => p.id === s.settings.activeProfileId) ?? null; }

export async function checkRelay(loud = false) {
  const s = get();
  if (!s.settings.relayUrl) { cache.relay = null; cache.relayError = ''; set({}); return; }
  try { cache.relay = await relayHealth(s.settings); cache.relayError = ''; if (loud) toast('Relay hoạt động.', 'ok'); }
  catch (e) { cache.relay = null; cache.relayError = `Không kết nối được ${s.settings.relayUrl}: ${(e as Error).message}`; if (loud) toast(cache.relayError, 'err'); }
  set({});
}

async function freshProfile(p: Profile): Promise<Profile> {
  const s = get();
  if (p.auth.type === 'oauth' && p.provider === 'klaviyo' && p.auth.refreshToken && p.auth.expiresAt && p.auth.expiresAt < Date.now() + 60_000) {
    const t = await oauthRefresh(s.settings, 'klaviyo', p.auth.refreshToken);
    p.auth = { ...p.auth, accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt };
    saveProfile(p);
  }
  return p;
}

export function saveProfile(p: Profile) {
  const s = get();
  const i = s.profiles.findIndex((x) => x.id === p.id);
  const profiles = s.profiles.slice();
  if (i >= 0) profiles[i] = p; else profiles.push(p);
  set({ profiles, settings: !s.settings.activeProfileId ? { ...s.settings, activeProfileId: p.id } : s.settings });
  void cloud.pushProfiles(profiles);
}
export function removeProfile(id: string) { const s = get(); const profiles = s.profiles.filter((p) => p.id !== id); set({ profiles, settings: s.settings.activeProfileId === id ? { ...s.settings, activeProfileId: null } : s.settings }); void cloud.pushProfiles(profiles); }

function clientFor(p: Profile) {
  const call = makeCaller(get().settings, p.provider, p.auth);
  return p.provider === 'mailchimp' ? new Mailchimp(call, p.auth.dc || (p.auth.type === 'apikey' ? p.auth.apiKey.split('-').pop() || '' : '')) : new Klaviyo(call);
}

export async function testConnection(p: Profile): Promise<Profile> {
  await freshProfile(p);
  const c = clientFor(p);
  if (c instanceof Mailchimp) {
    const acc = await c.account();
    p.accountLabel = `${acc.name} (${acc.email})`;
    p.permissions = await c.permissions();
    try { cache.lists[p.id] = await c.lists(); } catch (e) { toast(`Không tải được audiences: ${(e as Error).message}`, 'err'); }
    try { cache.templates[p.id] = await c.templates(); if (p.templateId) await loadSections(p); } catch { /* optional */ }
  } else {
    const acc = await c.account();
    p.accountLabel = acc.name + (acc.test ? ' (test)' : '');
    p.permissions = await c.permissions(p.auth.type === 'oauth' ? (p.auth as { scopes?: string }).scopes : undefined);
    try { cache.lists[p.id] = await c.lists(); } catch (e) { toast(`Không tải được lists: ${(e as Error).message}`, 'err'); }
  }
  if (!p.name.trim()) p.name = p.accountLabel.split(' (')[0];
  return p;
}

export async function loadSections(p: Profile) {
  const c = clientFor(p);
  if (c instanceof Mailchimp && p.templateId) {
    try { cache.sections[p.id] = await c.templateSections(p.templateId); if (cache.sections[p.id].length && !cache.sections[p.id].includes(p.templateSection)) p.templateSection = cache.sections[p.id][0]; } catch { cache.sections[p.id] = []; }
  }
}

export async function connectOAuth(p: Profile, onDone: (p: Profile) => void) {
  const s = get();
  const { sessionId, url } = await oauthStart(s.settings, p.provider);
  window.open(url, '_blank', 'noopener');
  toast(`Đã mở tab đăng nhập ${providerName(p.provider)}. Xong thì quay lại đây.`, 'info');
  const started = Date.now();
  while (Date.now() - started < 5 * 60_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await oauthPoll(s.settings, sessionId);
    if (r.status === 'pending') continue;
    if (r.status === 'done' && r.auth) { p.auth = r.auth; p.accountLabel = (r.auth.type === 'oauth' && r.auth.accountName) || providerName(p.provider); onDone(await testConnection(p)); return; }
    throw new Error(r.error || (r.status === 'expired' ? 'Phiên đăng nhập hết hạn.' : 'Đăng nhập thất bại.'));
  }
  throw new Error('Quá 5 phút chưa thấy đăng nhập.');
}

// ---------- pipeline ----------
interface Exported { plan: SlicePlan; slices: ExportedSlice[]; mobile: { plan: SlicePlan; slices: ExportedSlice[] } | null }

function busy(label: string, done = 0, total = 0) { set({ busy: { label, done, total } }); }

async function exportProject(p: Project, prof: Profile | null): Promise<Exported> {
  const format = prof?.imageFormat ?? 'PNG', scale = prof?.scale ?? 2, q = prof?.jpgQuality ?? 85;
  const s = get().settings;
  const planFor = (d: Doc) => planSlices(docToNNode(d, p.brand), { maxSliceHeight: s.maxSliceHeight, mergeRows: s.mergeRows });
  busy('Cắt & xuất ảnh…');
  const plan = planFor(p.desktop);
  const raw = await exportDocSlices(p.desktop, p.brand, plan, scale, (d, t) => busy('Cắt & xuất ảnh…', d, t));
  busy('Nén ảnh…');
  const slices = await finalizeSlices(raw, format, q);
  let mobile: Exported['mobile'] = null;
  if (p.mobile) {
    const mp = planFor(p.mobile);
    const mr = await exportDocSlices(p.mobile, p.brand, mp, scale, (d, t) => busy('Xuất bản mobile…', d, t));
    mobile = { plan: mp, slices: await finalizeSlices(mr, format, q) };
  }
  const bytes = slices.reduce((a, x) => a + x.bytes.length, 0) + (mobile ? mobile.slices.reduce((a, x) => a + x.bytes.length, 0) : 0);
  log(`${slices.length}${mobile ? ` + ${mobile.slices.length} mobile` : ''} lát · ${(bytes / 1024).toFixed(0)} KB (${format} ${scale}x)`);
  if (bytes > WEIGHT_ERROR) log(`Tổng ảnh ${(bytes / 1024 / 1024).toFixed(1)} MB — quá nặng. Đổi sang JPG hoặc 1x.`, 'er');
  else if (bytes > WEIGHT_WARN) log(`Tổng ảnh ${(bytes / 1024).toFixed(0)} KB — nặng, cân nhắc JPG.`);
  return { plan, slices, mobile };
}

async function uploadAll(prof: Profile, p: Project, ex: Exported, prev: DraftRecord | null) {
  const c = clientFor(prof);
  const files: Record<string, DraftFile> = {};
  const images: Record<string, string> = {}, mobileImages: Record<string, string> = {};
  const all = [...ex.slices.map((s) => ({ key: s.key, s, target: images })), ...(ex.mobile ? ex.mobile.slices.map((s) => ({ key: `m:${s.key}`, s, target: mobileImages })) : [])];
  let reused = 0, uploaded = 0;
  const base = slug(p.fields.campaignName || p.name);
  for (let i = 0; i < all.length; i++) {
    const { key, s, target } = all[i];
    busy(`Upload ảnh lên ${providerName(prof.provider)}…`, i, all.length);
    const old = prev?.files[key];
    if (old && old.hash === s.hash && old.url) { files[key] = old; target[s.key] = old.url; reused++; continue; }
    const name = `${base}-${key.replace(':', '-')}-${s.hash.slice(0, 6)}`;
    const up = c instanceof Mailchimp ? await c.uploadFile(`${name}.${extOf(s.format)}`, s.bytes) : await c.uploadImage(name, s.bytes, mimeOf(s.format));
    if (!up.url) throw new Error(`${providerName(prof.provider)} không trả về URL ảnh.`);
    files[key] = { id: up.id != null ? String(up.id) : null, url: up.url, hash: s.hash };
    target[s.key] = up.url; uploaded++;
    if (old?.id) { if (c instanceof Mailchimp) void c.deleteFile(old.id); else void c.hideImage(old.id); }
  }
  if (prev) for (const [k, old] of Object.entries(prev.files)) if (!files[k] && old.id) { if (c instanceof Mailchimp) void c.deleteFile(old.id); else void c.hideImage(old.id); }
  log(`Ảnh: ${uploaded} upload mới, ${reused} dùng lại.`, 'ok');
  return { images, mobileImages, files };
}

export function htmlFor(p: Project, prof: Profile | null, ex: Exported, images: Record<string, string>, mobileImages: Record<string, string>, mode: 'fragment' | 'full'): string {
  const today = new Date().toISOString().slice(0, 10);
  return buildEmailHtml({
    plan: ex.plan, images,
    mobile: ex.mobile ? { plan: ex.mobile.plan, images: mobileImages } : null,
    title: p.fields.subject || p.fields.campaignName || p.name,
    preheader: p.fields.preheader,
    includePreheader: mode === 'full', fullDocument: mode === 'full',
    footerHtml: prof?.footerHtml || '',
    bgColor: resolveColor(p.desktop.bg, p.brand),
    provider: prof?.provider ?? null,
    utm: prof?.utmTemplate ? { template: prof.utmTemplate, vars: { provider: prof.provider, campaign: p.fields.campaignName || p.name, frame: p.name, date: today } } : null,
  });
}

function drafts(p: Project): Record<string, DraftRecord> { return (p.drafts || {}) as Record<string, DraftRecord>; }

function requireDraftFields(p: Project, prof: Profile) {
  const miss: string[] = [];
  if (!p.fields.subject.trim()) miss.push('Subject');
  if (!prof.audienceId) miss.push(`Audience (Client → ${prof.name})`);
  if (prof.provider === 'klaviyo') { if (!prof.fromEmail.trim()) miss.push('From email'); if (!prof.fromName.trim()) miss.push('From name'); }
  if (prof.provider === 'mailchimp') { if (!prof.fromName.trim()) miss.push('From name'); if (!prof.replyTo.trim()) miss.push('Reply-to'); }
  if (miss.length) throw new Error(`Thiếu: ${miss.join(', ')}.`);
}

async function createDraft(p: Project, prof: Profile) {
  requireDraftFields(p, prof);
  await freshProfile(prof);
  const c = clientFor(prof);
  const prev = drafts(p)[prof.id] ?? null;
  let existing = prev;
  if (existing?.campaignId) {
    busy('Kiểm tra draft cũ…');
    if (c instanceof Mailchimp) {
      const camp = await c.getCampaign(existing.campaignId);
      if (!camp || camp.status !== 'save') { log(camp ? `Draft cũ đã ${camp.status} — tạo mới.` : 'Draft cũ đã bị xoá — tạo mới.'); existing = { ...existing, campaignId: '' }; }
    } else {
      const camp = await c.getCampaign(existing.campaignId);
      if (!camp || !/draft/i.test(camp.status)) { log(camp ? `Campaign cũ ở trạng thái ${camp.status} — tạo mới.` : 'Draft cũ đã bị xoá — tạo mới.'); existing = { ...existing, campaignId: '', messageId: undefined }; }
      else if (!existing.messageId && camp.messageId) existing = { ...existing, messageId: camp.messageId };
    }
  }
  const ex = await exportProject(p, prof);
  const { images, mobileImages, files } = await uploadAll(prof, p, ex, prev);
  busy(existing?.campaignId ? 'Cập nhật draft…' : 'Tạo draft…');
  const draft: DraftRecord = { provider: prof.provider, profileId: prof.id, campaignId: existing?.campaignId || '', templateId: existing?.templateId, messageId: existing?.messageId, webUrl: existing?.webUrl, files, updatedAt: new Date().toISOString() };
  if (c instanceof Mailchimp) {
    const st = { listId: prof.audienceId, subject: p.fields.subject, previewText: p.fields.preheader, title: p.fields.campaignName || p.name, fromName: prof.fromName, replyTo: prof.replyTo };
    const camp = draft.campaignId ? await c.updateCampaign(draft.campaignId, st) : await c.createCampaign(st);
    draft.campaignId = camp.id;
    if (prof.templateId) { await c.setContent(camp.id, { templateId: Number(prof.templateId), section: prof.templateSection || 'body', html: htmlFor(p, prof, ex, images, mobileImages, 'fragment') }); log(`Chèn vào template ${prof.templateId} / "${prof.templateSection || 'body'}" — header/footer giữ nguyên.`); }
    else { const html = htmlFor(p, prof, ex, images, mobileImages, 'full'); await c.setContent(camp.id, { html }); if (htmlSizeBytes(html) > GMAIL_CLIP_BYTES) log('HTML > 102KB — Gmail có thể cắt.', 'er'); }
    draft.webUrl = c.editUrl(camp);
  } else {
    const html = htmlFor(p, prof, ex, images, mobileImages, 'full');
    const tplName = `Phloem · ${p.fields.campaignName || p.name}`;
    if (draft.templateId && (await c.getTemplate(draft.templateId))) await c.updateTemplate(draft.templateId, tplName, html); else draft.templateId = await c.createTemplate(tplName, html);
    const msg = { name: p.fields.campaignName || p.name, listId: prof.audienceId, subject: p.fields.subject, previewText: p.fields.preheader, fromEmail: prof.fromEmail, fromLabel: prof.fromName, replyTo: prof.replyTo };
    if (draft.campaignId && draft.messageId) { await c.updateCampaign(draft.campaignId, msg.name, prof.audienceId); await c.updateMessage(draft.messageId, msg); }
    else { const created = await c.createCampaign(msg); draft.campaignId = created.id; draft.messageId = created.messageId; }
    await c.assignTemplate(draft.messageId!, draft.templateId);
    draft.webUrl = c.editUrl(draft.campaignId);
    if (htmlSizeBytes(html) > GMAIL_CLIP_BYTES) log('HTML > 102KB — Gmail có thể cắt.', 'er');
  }
  patchProject({ drafts: { ...drafts(p), [prof.id]: draft } });
  log(`${existing?.campaignId ? 'Đã cập nhật' : 'Đã tạo'} draft trong ${providerName(prof.provider)}.`, 'ok');
  set({ result: { text: `${existing?.campaignId ? 'Draft đã cập nhật' : 'Draft đã tạo'} trong ${providerName(prof.provider)} — duyệt rồi gửi ở đó.`, url: draft.webUrl } });
}

async function copyHtml(p: Project, prof: Profile | null, mode: 'fragment' | 'full') {
  if (!prof) throw new Error('Copy HTML cần một client để host ảnh (hoặc dùng Tải .zip).');
  await freshProfile(prof);
  const ex = await exportProject(p, prof);
  const prev = drafts(p)[prof.id] ?? null;
  const { images, mobileImages, files } = await uploadAll(prof, p, ex, prev);
  const html = htmlFor(p, prof, ex, images, mobileImages, mode);
  const ok = await copyText(html);
  if (!ok) { downloadBytes(`${slug(p.fields.campaignName || p.name)}.html`, utf8Bytes(html), 'text/html'); throw new Error('Không ghi được clipboard — đã tải file .html thay thế.'); }
  patchProject({ drafts: { ...drafts(p), [prof.id]: { ...(prev ?? { provider: prof.provider, profileId: prof.id, campaignId: '' }), files, updatedAt: new Date().toISOString() } } });
  const kb = (htmlSizeBytes(html) / 1024).toFixed(1);
  log(`HTML ${mode === 'fragment' ? 'nội dung' : 'đầy đủ'} ${kb} KB đã vào clipboard.`, 'ok');
  set({ result: { text: mode === 'fragment' ? `Đã copy HTML nội dung (${kb} KB). Dán vào khối Code/HTML của template có brand.` : `Đã copy trang HTML đầy đủ (${kb} KB).` } });
}

async function downloadZip(p: Project, prof: Profile | null) {
  const ex = await exportProject(p, prof);
  const images: Record<string, string> = {}, mobileImages: Record<string, string> = {};
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const s of ex.slices) { const n = `images/${s.key}.${extOf(s.format)}`; images[s.key] = n; entries.push({ name: n, data: s.bytes }); }
  if (ex.mobile) for (const s of ex.mobile.slices) { const n = `images/mobile-${s.key}.${extOf(s.format)}`; mobileImages[s.key] = n; entries.push({ name: n, data: s.bytes }); }
  const html = htmlFor(p, prof, ex, images, mobileImages, 'full');
  entries.unshift({ name: 'index.html', data: utf8Bytes(html) });
  entries.push({ name: 'README.txt', data: utf8Bytes(`Phloem Studio export — ${p.name}\n\nindex.html dùng ảnh tương đối trong images/. Upload images/ lên host rồi thay "images/" bằng URL tuyệt đối, hoặc dùng Tạo draft để Phloem upload tự động.\nKhông bao giờ tự gửi: bạn duyệt và bấm gửi.\n`) });
  const zip = makeZip(entries);
  downloadBytes(`${slug(p.fields.campaignName || p.name)}.zip`, zip, 'application/zip');
  log(`Đã tải ${(zip.length / 1024).toFixed(0)} KB (.zip).`, 'ok');
  set({ result: { text: `Đã tải ${slug(p.fields.campaignName || p.name)}.zip — index.html + ${entries.length - 2} ảnh.` } });
}

/** Build a preview HTML document with blob: image URLs (no upload). */
export async function previewHtml(p: Project): Promise<{ html: string; revoke: () => void }> {
  const ex = await exportProject(p, activeProfile());
  const urls: string[] = [];
  const toUrl = (s: ExportedSlice) => { const u = URL.createObjectURL(new Blob([s.bytes.buffer.slice(s.bytes.byteOffset, s.bytes.byteOffset + s.bytes.byteLength) as ArrayBuffer], { type: mimeOf(s.format) })); urls.push(u); return u; };
  const images = Object.fromEntries(ex.slices.map((s) => [s.key, toUrl(s)]));
  const mobileImages = ex.mobile ? Object.fromEntries(ex.mobile.slices.map((s) => [s.key, toUrl(s)])) : {};
  set({ busy: null });
  return { html: htmlFor(p, activeProfile(), ex, images, mobileImages, 'full'), revoke: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}

export async function runExport(kind: 'draft' | 'html' | 'zip', mode: 'fragment' | 'full' = 'fragment') {
  const s = get();
  if (s.busy || !s.project) return;
  const p = s.project, prof = activeProfile();
  set({ log: [], result: null });
  try {
    if (kind === 'draft') { if (!prof) throw new Error('Chọn client trước (góc trên bên phải).'); await createDraft(p, prof); }
    else if (kind === 'html') await copyHtml(p, prof, mode);
    else await downloadZip(p, prof);
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : (e as Error).message || String(e);
    log(msg, 'er'); toast(msg, 'err');
  } finally { set({ busy: null }); }
}
