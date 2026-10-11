export interface Rect { x: number; y: number; w: number; h: number }

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || btm <= y) return null;
  return { x, y, w: r - x, h: btm - y };
}

export function area(r: Rect | null): number {
  return r ? r.w * r.h : 0;
}

export function iou(a: Rect, b: Rect): number {
  const i = area(intersect(a, b));
  if (!i) return 0;
  return i / (area(a) + area(b) - i);
}

export function contains(outer: Rect, px: number, py: number): boolean {
  return px >= outer.x && px < outer.x + outer.w && py >= outer.y && py < outer.y + outer.h;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function uniqSorted(nums: number[]): number[] {
  return Array.from(new Set(nums.map((n) => Math.round(n)))).sort((a, b) => a - b);
}
