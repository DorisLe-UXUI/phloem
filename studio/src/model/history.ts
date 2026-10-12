import type { Doc } from './types';

export class History {
  private past: Doc[] = [];
  private future: Doc[] = [];
  constructor(private limit = 100) {}
  push(doc: Doc) {
    if (this.past.length && this.past[this.past.length - 1] === doc) return;
    this.past.push(doc);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current: Doc): Doc | null {
    let prev = this.past.pop();
    while (prev === current) prev = this.past.pop(); // a checkpoint taken before an edit that never happened
    if (!prev) return null;
    this.future.push(current);
    return prev;
  }
  redo(current: Doc): Doc | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  clear() { this.past = []; this.future = []; }
}
