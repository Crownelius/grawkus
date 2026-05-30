import { stdin, stdout } from 'node:process';
import type { Session } from './sessions.js';
import { theme, sym } from './theme.js';

export type SessionSummary = Pick<Session, 'id' | 'name' | 'cwd' | 'model' | 'createdAt' | 'updatedAt' | 'turnCount'>;

export interface SessionPickerState {
  filter: string;
  selected: number;
}

export type SessionPickerInput =
  | { type: 'accept' }
  | { type: 'cancel' }
  | { type: 'backspace' }
  | { type: 'move'; delta: number }
  | { type: 'jump'; target: 'start' | 'end' }
  | { type: 'append'; text: string }
  | { type: 'ignore' };

type DataListener = (chunk: Buffer) => void;
type TaggedListener = ((...args: unknown[]) => void) & { __grawkusHotkey__?: boolean };

export function formatSessionPickerLine(session: SessionSummary): string {
  const updated = session.updatedAt ? session.updatedAt.slice(0, 16).replace('T', ' ') : 'unknown';
  const turns = `${session.turnCount ?? 0} ${(session.turnCount ?? 0) === 1 ? 'turn' : 'turns'}`;
  return `${session.name || '(untitled)'}  ${turns}  ${session.model || 'unknown model'}  ${updated}`;
}

export function sessionPickerSearchText(session: SessionSummary): string {
  return [
    session.id,
    session.name,
    session.cwd,
    session.model,
    session.createdAt,
    session.updatedAt,
    String(session.turnCount ?? ''),
  ].join(' ').toLowerCase();
}

export function filterSessionPickerItems(
  sessions: SessionSummary[],
  filter: string,
): SessionSummary[] {
  const query = filter.trim().toLowerCase();
  if (!query) return sessions;
  const terms = query.split(/\s+/).filter(Boolean);
  return sessions.filter((session) => {
    const text = sessionPickerSearchText(session);
    return terms.every((term) => text.includes(term));
  });
}

export function maxVisibleSessionRows(termRows: number = stdout.rows || 24): number {
  const rows = Number.isFinite(termRows) ? Math.max(6, Math.floor(termRows)) : 24;
  return Math.max(3, Math.min(8, Math.floor(rows / 2) - 3));
}

export function visibleSessionPickerWindow<T>(
  items: T[],
  selected: number,
  maxRows: number,
): { items: T[]; startIdx: number; endIdx: number } {
  const rows = Math.max(1, Math.floor(maxRows));
  if (items.length <= rows) return { items, startIdx: 0, endIdx: items.length };
  const clamped = Math.max(0, Math.min(items.length - 1, selected));
  let startIdx = clamped - Math.floor(rows / 2);
  startIdx = Math.max(0, Math.min(items.length - rows, startIdx));
  const endIdx = Math.min(items.length, startIdx + rows);
  return { items: items.slice(startIdx, endIdx), startIdx, endIdx };
}

export function parseSessionPickerInput(buf: Buffer): SessionPickerInput {
  if (buf.length === 0) return { type: 'ignore' };
  if (buf.length === 1 && buf[0] === 0x03) return { type: 'cancel' };
  if (buf.length === 1 && buf[0] === 0x1B) return { type: 'cancel' };
  if (buf.length === 1 && (buf[0] === 0x0D || buf[0] === 0x0A)) return { type: 'accept' };
  if (buf.length === 1 && (buf[0] === 0x7F || buf[0] === 0x08)) return { type: 'backspace' };

  if (buf.length >= 3 && buf[0] === 0x1B && buf[1] === 0x5B) {
    const code = buf[2];
    if (code === 0x41) return { type: 'move', delta: -1 };
    if (code === 0x42) return { type: 'move', delta: 1 };
    if (code === 0x48) return { type: 'jump', target: 'start' };
    if (code === 0x46) return { type: 'jump', target: 'end' };
    if (buf.length >= 4 && (code === 0x35 || code === 0x36) && buf[3] === 0x7E) {
      return { type: 'move', delta: code === 0x35 ? -5 : 5 };
    }
    return { type: 'ignore' };
  }

  let text = '';
  for (const byte of buf) {
    if (byte >= 0x20 && byte < 0x7F) text += String.fromCharCode(byte);
  }
  return text ? { type: 'append', text } : { type: 'ignore' };
}

export function applySessionPickerInput(
  state: SessionPickerState,
  input: SessionPickerInput,
  visibleCount: number,
): { state: SessionPickerState; accepted?: boolean; cancelled?: boolean } {
  if (input.type === 'cancel') return { state, cancelled: true };
  if (input.type === 'accept') return { state, accepted: visibleCount > 0 };
  if (input.type === 'backspace') {
    return {
      state: {
        filter: state.filter.slice(0, -1),
        selected: 0,
      },
    };
  }
  if (input.type === 'append') {
    return {
      state: {
        filter: state.filter + input.text,
        selected: 0,
      },
    };
  }
  if (input.type === 'jump') {
    return {
      state: {
        filter: state.filter,
        selected: input.target === 'start' ? 0 : Math.max(0, visibleCount - 1),
      },
    };
  }
  if (input.type === 'move' && visibleCount > 0) {
    return {
      state: {
        filter: state.filter,
        selected: Math.max(0, Math.min(visibleCount - 1, state.selected + input.delta)),
      },
    };
  }
  return { state };
}

export function eraseSessionPickerRows(rowCount: number): string {
  if (rowCount <= 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    parts.push('\r\x1b[2K');
    if (i < rowCount - 1) parts.push('\x1b[1A');
  }
  return parts.join('');
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return text.slice(0, max - 1) + '…';
}

export async function pickSession(
  sessions: SessionSummary[],
  opts: { title?: string; initialFilter?: string } = {},
): Promise<string | null> {
  if (sessions.length === 0) return null;

  return new Promise<string | null>((resolve) => {
    let state: SessionPickerState = { filter: opts.initialFilter ?? '', selected: 0 };
    let renderedRows = 0;
    const wasRaw = stdin.isRaw;

    const dataListeners = stdin.listeners('data').slice() as DataListener[];
    for (const listener of dataListeners) stdin.removeListener('data', listener);
    const allKeypress = stdin.listeners('keypress').slice() as TaggedListener[];
    const togglable = allKeypress.filter((listener) => !listener.__grawkusHotkey__);
    for (const listener of togglable) stdin.removeListener('keypress', listener);

    try { stdin.setRawMode(true); } catch { /* noop */ }
    stdin.resume();

    function visible(): SessionSummary[] {
      return filterSessionPickerItems(sessions, state.filter);
    }

    function cleanup(): void {
      stdin.removeListener('data', onData);
      for (const listener of dataListeners) {
        if (!stdin.listeners('data').includes(listener)) stdin.on('data', listener);
      }
      for (const listener of togglable) stdin.on('keypress', listener);
      try { stdin.setRawMode(wasRaw); } catch { /* noop */ }
      stdout.write(eraseSessionPickerRows(renderedRows));
      renderedRows = 0;
    }

    function render(): void {
      const items = visible();
      if (state.selected >= items.length) state.selected = Math.max(0, items.length - 1);
      if (state.selected < 0) state.selected = 0;

      stdout.write(eraseSessionPickerRows(renderedRows));
      const cols = Math.max(40, stdout.columns || 100);
      const maxRows = maxVisibleSessionRows(stdout.rows || 24);
      const win = visibleSessionPickerWindow(items, state.selected, maxRows);
      const rows: string[] = [];

      rows.push(theme.header(`  ${opts.title ?? 'Resume Session'}`));
      rows.push(theme.dim(`  filter: `) + theme.primary(state.filter || '(type to narrow)'));
      if (win.items.length === 0) {
        rows.push(theme.dim('  (no matches - Backspace to clear, Esc to cancel)'));
      } else {
        for (let i = 0; i < win.items.length; i++) {
          const session = win.items[i];
          const itemIndex = win.startIdx + i;
          const selected = itemIndex === state.selected;
          const prefix = selected ? theme.selection(' > ') : theme.syntaxPunctuation('   ');
          const id = theme.syntaxCommand(clip(session.id, 18).padEnd(18));
          const line = clip(formatSessionPickerLine(session), Math.max(20, cols - 26));
          rows.push(prefix + id + '  ' + (selected ? theme.bright(line) : theme.dim(line)));
          rows.push(theme.syntaxPunctuation('   ') + theme.muted(clip(session.cwd || '', Math.max(20, cols - 6))));
        }
        if (items.length > win.items.length) {
          rows.push(theme.dim(`  ${win.startIdx + 1}-${win.endIdx}/${items.length} ${sym.arrow} PgUp/PgDn scroll`));
        }
      }
      rows.push(theme.dim(`  ${items.length}/${sessions.length} sessions • ↑↓ move • Enter resume • Esc cancel`));

      stdout.write(rows.join('\n'));
      renderedRows = rows.length;
    }

    function onData(buf: Buffer): void {
      const items = visible();
      const input = parseSessionPickerInput(buf);
      const next = applySessionPickerInput(state, input, items.length);
      state = next.state;
      if (next.cancelled) {
        cleanup();
        resolve(null);
        return;
      }
      if (next.accepted) {
        const chosen = visible()[state.selected];
        cleanup();
        resolve(chosen?.id ?? null);
        return;
      }
      render();
    }

    stdin.on('data', onData);
    render();
  });
}
