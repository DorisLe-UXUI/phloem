import type { DraftRecord, FrameFields, Profile, Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { NS } from './normalize';

const K_PROFILES = 'phloem.profiles.v1';
const K_SETTINGS = 'phloem.settings.v1';

export async function loadProfiles(): Promise<Profile[]> {
  const v = await figma.clientStorage.getAsync(K_PROFILES);
  return Array.isArray(v) ? (v as Profile[]) : [];
}
export async function saveProfiles(p: Profile[]) {
  await figma.clientStorage.setAsync(K_PROFILES, p);
}
export async function loadSettings(): Promise<Settings> {
  const v = await figma.clientStorage.getAsync(K_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...((v as Partial<Settings>) || {}) };
}
export async function saveSettings(s: Settings) {
  await figma.clientStorage.setAsync(K_SETTINGS, s);
}

function readJson<T>(node: BaseNode, key: string, fallback: T): T {
  const raw = node.getSharedPluginData(NS, key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
function writeJson(node: BaseNode, key: string, value: unknown) {
  node.setSharedPluginData(NS, key, value == null ? '' : JSON.stringify(value));
}

export function getFields(frame: SceneNode): FrameFields {
  const f = readJson<Partial<FrameFields>>(frame, 'fields', {});
  return {
    campaignName: f.campaignName ?? frame.name,
    subject: f.subject ?? '',
    preheader: f.preheader ?? '',
    mobileFrameId: f.mobileFrameId ?? null,
  };
}
export function setFields(frame: SceneNode, patch: Partial<FrameFields>): FrameFields {
  const next = { ...getFields(frame), ...patch };
  writeJson(frame, 'fields', next);
  return next;
}

export function getDrafts(frame: SceneNode): Record<string, DraftRecord> {
  return readJson<Record<string, DraftRecord>>(frame, 'drafts', {});
}
export function setDraft(frame: SceneNode, profileId: string, draft: DraftRecord | null) {
  const all = getDrafts(frame);
  if (draft) all[profileId] = draft; else delete all[profileId];
  writeJson(frame, 'drafts', all);
}

export interface SliceOverride { link?: string | null; alt?: string | null }
export function getOverrides(frame: SceneNode): Record<string, SliceOverride> {
  return readJson<Record<string, SliceOverride>>(frame, 'overrides', {});
}
export function setOverride(frame: SceneNode, key: string, patch: SliceOverride) {
  const all = getOverrides(frame);
  all[key] = { ...(all[key] || {}), ...patch };
  if (all[key].link == null && all[key].alt == null) delete all[key];
  writeJson(frame, 'overrides', all);
}
