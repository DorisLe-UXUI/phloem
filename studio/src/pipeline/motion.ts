// Motion in the sent email: GIF slices only when someone asked for them. An AI design comes with motion (a canvas
// preview); unless "Làm động", a layer's motion or the switch turned it on, the email goes out as sharp stills (2x).
import type { Doc, Project } from '../model/types';
import { hasAnimIn, mapNodes } from '../model/ops';

export function motionOn(p: Project | null | undefined): boolean {
  if (!p) return false;
  return p.motion ?? (!p.design && (hasAnimIn(p.desktop.nodes) || (!!p.mobile && hasAnimIn(p.mobile.nodes))));
}
/** The doc the export renders: its motion removed when the email sends still. */
export function exportDocOf(d: Doc, p: Project | null | undefined): Doc {
  return motionOn(p) || !hasAnimIn(d.nodes) ? d : mapNodes(d, (x) => (x.anim ? { ...x, anim: null } : x));
}
