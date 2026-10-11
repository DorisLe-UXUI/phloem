// Phloem — sandbox entry. Routes UI messages, never talks to the network (the UI does, via the relay).
import type { Check, FrameSummary, SlicePlan, ToPlugin, ToUI } from '../shared/types';
import { planSlices } from '../shared/slicer';
import { runChecks } from '../shared/checks';
import { suggest } from '../shared/suggestions';
import { normalize, isFrameLike, writeField } from './normalize';
import { getDrafts, getFields, getOverrides, loadProfiles, loadSettings, saveProfiles, saveSettings, setDraft, setFields, setOverride } from './storage';
import { exportPlan, exportPreview } from './exporter';
import { createMobileFrame, insertBlock, insertTemplate, optimizeFrame, roundPixels, snapWidth } from './templates';

declare const __PHLOEM_VERSION__: string;

const UI_W = 440;

function send(msg: ToUI) { figma.ui.postMessage(msg); }
function toast(text: string, kind: 'ok' | 'err' | 'info' = 'info') { send({ type: 'toast', kind, text }); }

async function nodeById(id: string): Promise<SceneNode | null> {
  const n = await figma.getNodeByIdAsync(id);
  return n && 'visible' in n ? (n as SceneNode) : null;
}

function summarize(frame: SceneNode): FrameSummary {
  return { id: frame.id, name: frame.name, width: Math.round(frame.width), height: Math.round(frame.height), fields: getFields(frame), drafts: getDrafts(frame) };
}

function pageFrames() {
  return figma.currentPage.children.filter(isFrameLike).map((f) => ({ id: f.id, name: f.name, width: Math.round(f.width) }));
}

function selectedFrames(): SceneNode[] {
  return figma.currentPage.selection.filter(isFrameLike) as SceneNode[];
}

async function buildPlan(frame: SceneNode): Promise<{ plan: SlicePlan; checks: Check[]; root: ReturnType<typeof normalize> }> {
  const settings = await loadSettings();
  const root = normalize(frame as FrameNode, { altFromLayerName: settings.altFromLayerName });
  const plan = planSlices(root, { maxSliceHeight: settings.maxSliceHeight, mergeRows: settings.mergeRows });
  // per-slice overrides saved on the frame
  const ov = getOverrides(frame);
  for (const s of plan.slices) {
    const o = ov[s.key];
    if (!o) continue;
    if (o.link !== undefined && o.link !== null) s.link = o.link || null;
    if (o.alt !== undefined && o.alt !== null) s.alt = o.alt;
  }
  const fields = getFields(frame);
  const mobile = fields.mobileFrameId ? await nodeById(fields.mobileFrameId) : null;
  const checks = runChecks({ root, plan, fields, hasMobile: !!mobile });
  return { plan, checks, root };
}

async function pushSelection() {
  send({ type: 'selection', frames: selectedFrames().map(summarize), pageFrames: pageFrames() });
}

async function sendPlan(frameId: string) {
  const frame = await nodeById(frameId);
  if (!frame || !isFrameLike(frame)) return;
  const { plan, checks } = await buildPlan(frame);
  send({ type: 'plan', frameId, plan, checks });
  try {
    const bytes = await exportPreview(frame, 320);
    send({ type: 'thumb', frameId, key: '__frame__', bytes });
  } catch { /* preview is optional */ }
}

async function sendSuggestions(frameId: string) {
  const frame = await nodeById(frameId);
  if (!frame || !isFrameLike(frame)) return;
  const { plan, root } = await buildPlan(frame);
  const fields = getFields(frame);
  const mobile = fields.mobileFrameId ? await nodeById(fields.mobileFrameId) : null;
  const r = suggest({ root, plan, fields, hasMobile: !!mobile });
  send({ type: 'suggestions', frameId, suggestions: r.suggestions, score: r.score });
}

async function doExport(frameIds: string[], scale: 1 | 2) {
  for (const frameId of frameIds) {
    const frame = await nodeById(frameId);
    if (!frame || !isFrameLike(frame)) { send({ type: 'export-error', frameId, message: 'Không tìm thấy frame.' }); continue; }
    try {
      const { plan } = await buildPlan(frame);
      const slices = await exportPlan(frame, plan, scale, (done, total) => send({ type: 'export-progress', frameId, done, total }));
      let mobile: { plan: SlicePlan; slices: Awaited<ReturnType<typeof exportPlan>> } | null = null;
      const fields = getFields(frame);
      if (fields.mobileFrameId) {
        const m = await nodeById(fields.mobileFrameId);
        if (m && isFrameLike(m)) {
          const mp = await buildPlan(m);
          const ms = await exportPlan(m, mp.plan, scale, (done, total) => send({ type: 'export-progress', frameId, done: plan.slices.length + done, total: plan.slices.length + total }));
          mobile = { plan: mp.plan, slices: ms };
        }
      }
      send({ type: 'export-done', frameId, plan, slices, mobile });
    } catch (e) {
      send({ type: 'export-error', frameId, message: (e as Error).message || String(e) });
    }
  }
}

async function handle(msg: ToPlugin) {
  switch (msg.type) {
    case 'ready': {
      const [profiles, settings] = await Promise.all([loadProfiles(), loadSettings()]);
      figma.ui.resize(UI_W, settings.uiHeight);
      send({ type: 'init', frames: selectedFrames().map(summarize), pageFrames: pageFrames(), profiles, settings, version: __PHLOEM_VERSION__ });
      return;
    }
    case 'get-plan': return sendPlan(msg.frameId);
    case 'get-suggestions': return sendSuggestions(msg.frameId);
    case 'get-thumbs': return;
    case 'export': return doExport(msg.frameIds, msg.scale);
    case 'set-node-meta': {
      const n = await nodeById(msg.nodeId);
      if (!n) return;
      if (msg.link !== undefined) writeField(n, 'link', msg.link);
      if (msg.alt !== undefined) writeField(n, 'alt', msg.alt);
      return;
    }
    case 'set-slice-override': {
      const f = await nodeById(msg.frameId);
      if (!f) return;
      setOverride(f, msg.key, { link: msg.link, alt: msg.alt });
      return;
    }
    case 'save-profiles': await saveProfiles(msg.profiles); send({ type: 'profiles', profiles: msg.profiles }); return;
    case 'save-settings': await saveSettings(msg.settings); figma.ui.resize(UI_W, msg.settings.uiHeight); send({ type: 'settings', settings: msg.settings }); return;
    case 'save-draft': {
      const f = await nodeById(msg.frameId);
      if (!f) return;
      setDraft(f, msg.profileId, msg.draft);
      send({ type: 'frame', frame: summarize(f) });
      return;
    }
    case 'set-frame-fields': {
      const f = await nodeById(msg.frameId);
      if (!f) return;
      setFields(f, msg.fields);
      send({ type: 'frame', frame: summarize(f) });
      return;
    }
    case 'focus-node': {
      const n = await nodeById(msg.nodeId);
      if (!n) { toast('Layer không còn tồn tại.', 'err'); return; }
      figma.currentPage.selection = [n];
      figma.viewport.scrollAndZoomIntoView([n]);
      return;
    }
    case 'insert-template': {
      const f = await insertTemplate(msg.kind);
      toast(`Đã chèn template "${f.name}". Thay ảnh placeholder, sửa chữ, giữ link.`, 'ok');
      await pushSelection();
      return;
    }
    case 'insert-block': {
      const target = msg.frameId ? await nodeById(msg.frameId) : null;
      const f = await insertBlock(target && target.type === 'FRAME' ? target : null, msg.block);
      figma.viewport.scrollAndZoomIntoView([f]);
      await pushSelection();
      return;
    }
    case 'optimize-frame': {
      const f = await nodeById(msg.frameId);
      if (!f || f.type !== 'FRAME') { toast('Chọn một Frame (không phải Group) để tối ưu.', 'err'); return; }
      const changes = optimizeFrame(f);
      const { checks } = await buildPlan(f);
      send({ type: 'optimize-done', frameId: f.id, changes, checks });
      send({ type: 'frame', frame: summarize(f) });
      return;
    }
    case 'create-mobile-frame': {
      const f = await nodeById(msg.frameId);
      if (!f || f.type !== 'FRAME') { toast('Chọn một Frame để tạo bản mobile.', 'err'); return; }
      const m = await createMobileFrame(f);
      figma.viewport.scrollAndZoomIntoView([f, m]);
      toast(`Đã tạo "${m.name}" (375px). Chỉnh chữ/ảnh rồi export: điện thoại sẽ nhận bản này.`, 'ok');
      send({ type: 'frame', frame: summarize(f) });
      await pushSelection();
      return;
    }
    case 'apply-suggestion': {
      const f = await nodeById(msg.frameId);
      if (!f || f.type !== 'FRAME') return;
      const a = msg.action;
      if (a.kind === 'snap-width') snapWidth(f, a.width);
      else if (a.kind === 'round-pixels') roundPixels(f);
      else if (a.kind === 'insert-block') await insertBlock(f, a.block);
      else if (a.kind === 'focus') { const n = await nodeById(a.nodeId); if (n) { figma.currentPage.selection = [n]; figma.viewport.scrollAndZoomIntoView([n]); } }
      else if (a.kind === 'create-mobile') await createMobileFrame(f);
      send({ type: 'frame', frame: summarize(f) });
      await sendSuggestions(f.id);
      await sendPlan(f.id);
      return;
    }
    case 'resize': {
      const s = await loadSettings();
      s.uiHeight = Math.max(480, Math.min(1000, msg.height));
      await saveSettings(s);
      figma.ui.resize(UI_W, s.uiHeight);
      return;
    }
    case 'notify': figma.notify(msg.text, { error: !!msg.error, timeout: msg.error ? 6000 : 3000 }); return;
    case 'open-url': figma.openExternal(msg.url); return;
  }
}

figma.showUI(__html__, { width: UI_W, height: 680, themeColors: false, title: 'Phloem' });
figma.ui.onmessage = (msg: ToPlugin) => { handle(msg).catch((e) => toast((e as Error).message || String(e), 'err')); };
figma.on('selectionchange', () => { pushSelection().catch(() => undefined); });
figma.on('currentpagechange', () => { pushSelection().catch(() => undefined); });
