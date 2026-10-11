// Exports slice rectangles as PNG using a temporary top-level SliceNode (so auto-layout frames are never disturbed).
import type { ExportedSlice, SlicePlan } from '../shared/types';
import { fnv1a } from '../shared/hash';

export async function exportPlan(
  frame: SceneNode,
  plan: SlicePlan,
  scale: 1 | 2,
  onProgress: (done: number, total: number) => void,
): Promise<ExportedSlice[]> {
  const abs = frame.absoluteBoundingBox;
  if (!abs) throw new Error('Frame không có kích thước (ẩn hoặc rỗng).');
  const out: ExportedSlice[] = [];
  const slice = figma.createSlice();
  slice.name = '· phloem temp slice (safe to delete)';
  try {
    figma.currentPage.appendChild(slice);
    for (let i = 0; i < plan.slices.length; i++) {
      const s = plan.slices[i];
      slice.x = abs.x + s.x;
      slice.y = abs.y + s.y;
      slice.resize(Math.max(1, s.w), Math.max(1, s.h));
      const bytes = await slice.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
      out.push({ key: s.key, bytes, format: 'PNG', hash: fnv1a(bytes), w: s.w, h: s.h, scale });
      onProgress(i + 1, plan.slices.length);
    }
  } finally {
    slice.remove();
  }
  return out;
}

/** Whole-frame preview for the UI (slice outlines are drawn on top in CSS). */
export async function exportPreview(frame: SceneNode, width = 320): Promise<Uint8Array> {
  return (frame as ExportMixin).exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: width } });
}
