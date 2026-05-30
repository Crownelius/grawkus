/**
 * MemPalace recall + promode diary for ProMode cycles.
 */

import * as mempalace from '../mempalace/index.js';

export interface MemoryContextOpts {
  cwd: string;
  query: string;
  memoryEnabled: boolean;
  retrievalLimit?: number;
  diaryLastN?: number;
  maxChars?: number;
}

export function buildPromodeMemoryContext(opts: MemoryContextOpts): string {
  if (!opts.memoryEnabled) return '';

  const limit = opts.retrievalLimit ?? 12;
  const maxChars = opts.maxChars ?? 1500;
  const parts: string[] = [];

  try {
    const hits = mempalace.search(opts.query, opts.cwd, { limit });
    if (hits.length > 0) {
      const lines: string[] = ['## Recalled memory (MemPalace)'];
      let total = 0;
      for (const h of hits) {
        const trimmed = h.drawer.content.length > 400
          ? h.drawer.content.slice(0, 400) + '…'
          : h.drawer.content;
        const tagPart = h.drawer.tags.length > 0 ? ` [${h.drawer.tags.slice(0, 4).join(', ')}]` : '';
        const line = `- (${h.drawer.scope} · ${h.drawer.wing}/${h.drawer.room}${tagPart}) ${trimmed}`;
        if (total + line.length > maxChars) break;
        lines.push(line);
        total += line.length;
      }
      if (lines.length > 1) parts.push(lines.join('\n'));
    }
  } catch { /* memory must not break promode */ }

  try {
    const entries = mempalace.diaryRead({
      agentName: 'promode',
      lastN: opts.diaryLastN ?? 12,
      cwd: opts.cwd,
    });
    if (entries.length > 0) {
      const lines = ['## Diary (promode agent, recent)'];
      const cutoff = Date.now() - 8 * 60 * 60 * 1000;
      for (const e of entries) {
        const t = new Date(e.createdAt).getTime();
        if (t < cutoff) continue;
        const snippet = e.content.length > 300 ? e.content.slice(0, 300) + '…' : e.content;
        lines.push(`- ${e.createdAt}: ${snippet}`);
      }
      if (lines.length > 1) parts.push(lines.join('\n'));
    }
  } catch { /* diary optional */ }

  return parts.length > 0 ? parts.join('\n\n') + '\n' : '';
}

export function recordPromodeReflection(
  cwd: string,
  entry: string,
  sourceSessionId?: string,
): void {
  try {
    mempalace.diaryWrite({
      agentName: 'promode',
      entry,
      topic: 'reflection',
      cwd,
      sourceSessionId,
    });
  } catch { /* best effort */ }
}

export function recordPromodeObservation(
  cwd: string,
  entry: string,
  sourceSessionId?: string,
): void {
  try {
    mempalace.diaryWrite({
      agentName: 'promode',
      entry,
      topic: 'observation',
      cwd,
      sourceSessionId,
    });
  } catch { /* best effort */ }
}

export function persistDurableTilwFact(
  priority: 'I' | 'L' | 'W',
  text: string,
  cwd: string,
  sourceSessionId?: string,
): void {
  const room = priority === 'I' ? 'ideas' : priority === 'L' ? 'likes' : 'wants';
  try {
    mempalace.addDrawer({
      wing: 'promode',
      room,
      content: text,
      tags: [`tilw:${priority}`, 'promode'],
      importance: 0.6,
      scope: 'auto',
      cwd,
      sourceSessionId,
    });
  } catch { /* optional */ }
}
