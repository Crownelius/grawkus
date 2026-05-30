/**
 * Inline command-suggest dropdown — renders directly below the prompt
 * cursor without taking over the screen.
 *
 * Mental model: Claude Code's `/` autocomplete. The dropdown sits
 * inline beneath the live prompt, showing matching slash commands in
 * two columns (command + one-line description), narrowing as the user
 * types. Unlike picker.ts (which uses the alt-screen buffer for a
 * full-screen list), this widget stays in the normal screen buffer
 * and only paints a few rows of dropdown below the cursor — the
 * surrounding chat output stays visible.
 *
 * Render strategy — RELATIVE cursor positioning only
 * ──────────────────────────────────────────────────
 * The first cut of this module used DECSC/DECRC (`\x1b7`/`\x1b8`) to
 * pin an anchor at the start of the filter, then restored to it on
 * every render. That fails on Windows PowerShell legacy ConHost as
 * soon as the dropdown content scrolls the terminal — the saved
 * position is stored in *visible* coordinates, so after a scroll it
 * lands on the wrong row and renders pile up below the previous one.
 *
 * The fix: track our own row count and use relative cursor moves
 * (`\x1b[<N>A` go up, `\r` col 0, `\x1b[<N>C` advance N cols). Every
 * render writes the FULL prompt line — prompt prefix + filter — so
 * we don't need to "skip over" the prefix to reach the filter cell.
 * The caller hands us the prompt prefix (ANSI-styled string + the
 * visible char count) so we can repaint it each frame.
 *
 * Per-frame sequence:
 *   1. Up `_dropdownRows` lines     → back to the filter row
 *   2. `\r`                          → col 0 of that row
 *   3. clear prompt/dropdown rows     → erase only rows previously painted
 *   4. promptPrefix + filter         → repaint the prompt line
 *   5. `\r\n` + each dropdown row    → fill the rows below
 *   6. Up `rowsDrawn` + `\r` + right (promptVisLen + filter.length)
 *                                   → cursor settles at end of filter
 *
 * Steps 1–3 only refer to rows we previously printed (which are still
 * on screen, because they came AFTER the prompt). Even if the screen
 * scrolled between renders, relative up-moves still target our own
 * rows correctly because they're contiguous with the cursor.
 *
 * Key handling
 * ────────────
 * While suggest is active, we detach readline's `data` listener and
 * all non-hotkey `keypress` listeners so readline's line editor stops
 * processing input. A raw `data` listener parses bytes directly:
 *
 *   Ctrl+C / Esc          cancel
 *   Enter (CR or LF)      accept current selection
 *   Up / Down             move selection
 *   Backspace             delete last filter char; dismiss if empty
 *   Tab / Shift+Tab       move selection down/up
 *   Printable ASCII       append to filter, reset selection to 0
 */
import { stdin, stdout } from 'node:process';
import type { Interface as RLInterface } from 'node:readline';
import { theme } from './theme.js';

const ANSI = {
  clearLine: '\x1b[2K',
  reverse: '\x1b[7m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

/** Cap visible dropdown rows. Trades discoverability for keeping the
 * surrounding chat output visible. Matches Claude Code's behavior. */
const MAX_ROWS = 6;

/**
 * Keep the selector compact even in short terminals. The footer may add one
 * extra row, so this intentionally uses roughly half of the terminal height
 * instead of every available row.
 */
export function maxVisibleSuggestRows(termRows: number = stdout.rows || 24): number {
  const rows = Number.isFinite(termRows) ? Math.max(1, Math.floor(termRows)) : 24;
  // The prompt row plus the optional scroll footer count against the visual
  // budget. Keep the whole widget below roughly half the viewport so it reads
  // as an inline helper instead of a screen-covering picker.
  const ownedRowsBudget = Math.max(3, Math.floor(rows * 0.45));
  return Math.max(1, Math.min(MAX_ROWS, ownedRowsBudget - 2));
}

export function buildInlineSuggestEraseSequence(dropdownRows: number): string {
  const rows = Math.max(0, Math.floor(dropdownRows));
  let seq = `\r${ANSI.clearLine}`;
  for (let i = 0; i < rows; i++) {
    seq += `\x1b[1B\r${ANSI.clearLine}`;
  }
  if (rows > 0) seq += `\x1b[${rows}A\r`;
  return seq;
}

export function buildInlineSuggestDropdownEraseSequence(dropdownRows: number): string {
  const rows = Math.max(0, Math.floor(dropdownRows));
  let seq = '';
  for (let i = 0; i < rows; i++) {
    seq += `\x1b[1B\r${ANSI.clearLine}`;
  }
  if (rows > 0) seq += `\x1b[${rows}A\r`;
  return seq;
}

export interface SuggestItem {
  /** The slash command, e.g. "/help". */
  command: string;
  /** Alternate slash command names that dispatch to the same handler. */
  aliases?: string[];
  /** Short syntax/category label, e.g. "Git" or "Model". */
  hint?: string;
  /** One-line description shown in the second column. */
  description: string;
}

export interface InlineSuggestOptions {
  /**
   * The styled prompt prefix to repaint at the start of every render
   * (includes any chalk codes). Defaults to "  ❯ " (no decorative).
   */
  promptPrefix?: string;
  /**
   * Visible character width of `promptPrefix` (i.e. its length minus
   * any ANSI escape sequences). Used to position the cursor at the
   * end of the filter after a render. Defaults to counting the
   * stripped prefix when omitted.
   */
  promptVisibleLen?: number;
}

export interface InlineSuggestResult {
  /** True if the user picked an item (Enter); false on Esc / Ctrl+C / Backspace-to-empty. */
  accepted: boolean;
  /** The chosen command, only set when accepted=true. */
  command?: string;
  /** The filter string at exit. Caller restores rl.line to this on
   * cancel so the user can keep typing the partial command. */
  filter: string;
}

export interface InlineSuggestAcceptedCommand {
  command: string;
  acceptedAtMs: number;
}

export type InlineSuggestQuestionOutcome =
  | { kind: 'prefill'; command: string }
  | { kind: 'submit'; clearAccepted: boolean };

type TaggedListener = ((...args: unknown[]) => void) & { __grawkusHotkey__?: boolean };
type DataListener = (chunk: Buffer) => void;

/** Strip ANSI SGR escape sequences for visible-width math. */
function ansiVisibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

export function filterSuggestItems(items: SuggestItem[], filter: string): SuggestItem[] {
  const trimmed = filter.trimStart();
  const commandMode = trimmed.startsWith('/');
  const cleaned = trimmed.replace(/^\//, '').toLowerCase();
  const spaceIdx = cleaned.indexOf(' ');
  const hasArgs = spaceIdx >= 0;
  const query = (hasArgs ? cleaned.slice(0, spaceIdx) : cleaned).trim();
  if (!query) return items.slice();

  if (commandMode) {
    return rankCommandMatches(items, query)
      .filter((entry) => entry.score > 0)
      .map((entry) => entry.item);
  }

  return items.filter((it) => {
    const cmdMatch = it.command.toLowerCase().includes(query);
    const aliasMatch = (it.aliases ?? []).some((alias) => alias.toLowerCase().includes(query));
    const hintMatch = !hasArgs && (it.hint ?? '').toLowerCase().includes(query);
    const descMatch = !hasArgs && it.description.toLowerCase().includes(query);
    return cmdMatch || aliasMatch || hintMatch || descMatch;
  });
}

export function visibleSuggestWindow<T>(
  items: T[],
  selected: number,
  maxRows: number = MAX_ROWS,
): { startIdx: number; endIdx: number; items: T[] } {
  if (items.length === 0) return { startIdx: 0, endIdx: 0, items: [] };
  const safeSelected = Math.max(0, Math.min(items.length - 1, selected));
  const size = Math.max(1, Math.min(maxRows, items.length));
  const maxStart = Math.max(0, items.length - size);
  const startIdx = Math.min(maxStart, Math.max(0, safeSelected - Math.floor(size / 2)));
  const endIdx = Math.min(items.length, startIdx + size);
  return { startIdx, endIdx, items: items.slice(startIdx, endIdx) };
}

type InlineSuggestInput =
  | { type: 'accept' }
  | { type: 'append'; text: string }
  | { type: 'backspace' }
  | { type: 'cancel' }
  | { type: 'ignore' }
  | { type: 'jump'; target: 'start' | 'end' }
  | { type: 'move'; delta: number };

export function parseInlineSuggestInput(buf: Buffer): InlineSuggestInput {
  // Ctrl+C / bare Esc cancel the selector.
  if (buf.length === 1 && (buf[0] === 0x03 || buf[0] === 0x1B)) return { type: 'cancel' };
  if (buf.length === 1 && (buf[0] === 0x0D || buf[0] === 0x0A)) return { type: 'accept' };
  if (buf.length === 1 && (buf[0] === 0x7F || buf[0] === 0x08)) return { type: 'backspace' };
  if (buf.length === 1 && buf[0] === 0x09) return { type: 'move', delta: 1 };
  if (buf.length === 3 && buf[0] === 0x1B && buf[1] === 0x5B && buf[2] === 0x5A) {
    return { type: 'move', delta: -1 };
  }
  if (buf.length >= 3 && buf[0] === 0x1B && buf[1] === 0x5B) {
    const code = buf[2];
    if (code === 0x41) return { type: 'move', delta: -1 };
    if (code === 0x42) return { type: 'move', delta: 1 };
    if (code === 0x48) return { type: 'jump', target: 'start' };
    if (code === 0x46) return { type: 'jump', target: 'end' };
    if (buf.length >= 4 && (code === 0x35 || code === 0x36) && buf[3] === 0x7E) {
      return { type: 'move', delta: code === 0x35 ? -5 : 5 };
    }
    if (buf.length >= 4 && (code === 0x31 || code === 0x34) && buf[3] === 0x7E) {
      return { type: 'jump', target: code === 0x31 ? 'start' : 'end' };
    }
    return { type: 'ignore' };
  }
  if (buf.length === 1 && buf[0] < 0x20) return { type: 'ignore' };

  const printable = buf.toString('utf-8').replace(/[\x00-\x1F\x7F]/g, '');
  return printable.length > 0 ? { type: 'append', text: printable } : { type: 'ignore' };
}

export function resolveInlineSuggestAccept(
  filter: string,
  visibleItems: SuggestItem[],
  selected: number,
): string | null {
  const rawFilter = filter.startsWith('/') ? filter : `/${filter}`;
  if (filter.includes(' ')) {
    const commandToken = rawFilter.split(/\s+/, 1)[0];
    const args = rawFilter.slice(commandToken.length);
    const query = commandToken.replace(/^\//, '').toLowerCase();
    const ranked = rankCommandMatches(visibleItems, query);
    if (ranked.length > 0 && ranked[0].score > 0) {
      return `${ranked[0].item.command}${args}`;
    }
    return rawFilter;
  }
  if (visibleItems.length > 0) {
    const safeSelected = Math.max(0, Math.min(visibleItems.length - 1, selected));
    return visibleItems[safeSelected].command;
  }
  if (rawFilter.length > 1) {
    return rawFilter;
  }
  return null;
}

function rankCommandMatches(
  items: SuggestItem[],
  query: string,
): Array<{ item: SuggestItem; score: number }> {
  const q = query.trim().toLowerCase();
  if (!q) return items.map((item) => ({ item, score: 1 }));
  return items
    .map((item) => ({ item, score: bestCommandScore(item, q) }))
    .sort((a, b) => b.score - a.score || a.item.command.localeCompare(b.item.command));
}

function bestCommandScore(item: SuggestItem, query: string): number {
  const command = normalizeCommandToken(item.command);
  let best = scoreCommandCandidate(query, command);
  for (const alias of item.aliases ?? []) {
    const aliasScore = scoreCommandCandidate(query, normalizeCommandToken(alias));
    // Keep aliases competitive but prefer canonical command when tied.
    best = Math.max(best, aliasScore - 1);
  }
  return best;
}

function normalizeCommandToken(value: string): string {
  return value.trim().replace(/^\//, '').toLowerCase();
}

function scoreCommandCandidate(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  if (candidate === query) return 5_000 + query.length;
  if (candidate.startsWith(query)) return 4_000 + query.length * 4 - (candidate.length - query.length);

  const idx = candidate.indexOf(query);
  if (idx >= 0) {
    return 3_000 + query.length * 3 - idx;
  }

  const contiguous = longestCommonSubstringLength(query, candidate);
  let score = 0;
  if (isSubsequence(query, candidate)) {
    score = 2_000 + contiguous * 12 - (candidate.length - query.length);
  }

  const maxDist = Math.max(1, Math.floor(query.length / 3));
  const dist = boundedLevenshtein(query, candidate, maxDist);
  if (dist <= maxDist) {
    score = Math.max(score, 1_500 + contiguous * 16 - dist * 80);
  }
  return score;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let pos = 0;
  for (const ch of haystack) {
    if (ch === needle[pos]) pos++;
    if (pos === needle.length) return true;
  }
  return false;
}

function longestCommonSubstringLength(a: string, b: string): number {
  if (!a || !b) return 0;
  const width = b.length + 1;
  const dp = new Array<number>(width).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const hold = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev + 1;
        if (dp[j] > best) best = dp[j];
      } else {
        dp[j] = 0;
      }
      prev = hold;
    }
  }
  return best;
}

function boundedLevenshtein(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const prev: number[] = new Array(b.length + 1);
  const curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      const next = Math.min(del, ins, sub);
      curr[j] = next;
      if (next < rowMin) rowMin = next;
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function resolveInlineSuggestQuestionInput(
  input: string,
  accepted: InlineSuggestAcceptedCommand | null | undefined,
  nowMs: number = Date.now(),
  staleWindowMs: number = 2000,
): InlineSuggestQuestionOutcome {
  if (!accepted?.command) return { kind: 'submit', clearAccepted: false };

  const ageMs = Math.max(0, nowMs - accepted.acceptedAtMs);
  const trimmed = input.trim();
  if (ageMs <= staleWindowMs && (trimmed === '' || trimmed === '/')) {
    return { kind: 'prefill', command: accepted.command };
  }

  return { kind: 'submit', clearAccepted: true };
}

function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return text.slice(0, max - 1) + '…';
}

export function formatInlineSuggestFilterForPrompt(
  filter: string,
  promptVisibleLen: number,
  termCols: number = stdout.columns || 80,
): { text: string; visibleLen: number } {
  const cols = Number.isFinite(termCols) ? Math.max(20, Math.floor(termCols)) : 80;
  const promptCols = Number.isFinite(promptVisibleLen) ? Math.max(0, Math.floor(promptVisibleLen)) : 0;
  // Leave one spare column so the cursor never lands at the wrap boundary.
  const room = Math.max(1, cols - promptCols - 1);
  if (filter.length <= room) return { text: filter, visibleLen: filter.length };
  if (room <= 1) return { text: filter.slice(-1), visibleLen: 1 };
  return { text: '…' + filter.slice(-(room - 1)), visibleLen: room };
}

function colorCommand(command: string, filter: string): string {
  const slash = command.startsWith('/') ? theme.syntaxPunctuation('/') : '';
  const body = command.startsWith('/') ? command.slice(1) : command;
  const query = filter.replace(/^\//, '').split(/\s+/, 1)[0].toLowerCase();
  if (!query) return slash + theme.syntaxCommand(body);
  const idx = body.toLowerCase().indexOf(query);
  if (idx < 0) return slash + theme.syntaxCommand(body);
  return slash +
    theme.syntaxCommand(body.slice(0, idx)) +
    theme.highlight(body.slice(idx, idx + query.length)) +
    theme.syntaxCommand(body.slice(idx + query.length));
}

/**
 * Show the inline suggest dropdown and resolve when the user picks
 * or cancels.
 *
 * The caller should have cleared rl.line and refreshed the prompt
 * before calling — we repaint the prompt line ourselves but the
 * cursor needs to be on a stable row (not mid-scroll).
 */
export async function inlineSuggest(
  _rl: RLInterface,
  items: SuggestItem[],
  initialFilter: string = '/',
  opts: InlineSuggestOptions = {},
): Promise<InlineSuggestResult> {
  return new Promise<InlineSuggestResult>((resolve) => {
    let filter = initialFilter;
    let selected = 0;
    // Rows of dropdown printed on the previous frame (NOT including
    // the filter row). The next frame goes up by this many to land
    // back on the filter row.
    let dropdownRows = 0;
    let displayedFilterVisibleLen = initialFilter.length;

    const promptPrefix = opts.promptPrefix ?? '  ❯ ';
    const promptVisLen = opts.promptVisibleLen ?? ansiVisibleLen(promptPrefix);

    // Defensive: ensure raw mode is on and the stream is flowing.
    const wasRaw = stdin.isRaw;
    try { stdin.setRawMode(true); } catch { /* noop */ }
    stdin.resume();

    // Detach readline's low-level input path so the line editor does
    // not also process selector keystrokes. On Windows ConHost,
    // detaching only keypress listeners can still let Enter resolve
    // the pending rl.question() with the stale bare "/" while this
    // selector resolves the highlighted command.
    const dataListeners = stdin.listeners('data').slice() as DataListener[];
    for (const l of dataListeners) stdin.removeListener('data', l);

    // Detach readline's keypress listeners too. The hotkey listener
    // (tagged __grawkusHotkey__) stays attached because it has its
    // own bail for `pickerActive`; the others get pulled.
    const allKeypress = stdin.listeners('keypress').slice() as TaggedListener[];
    const togglable = allKeypress.filter((l) => !l.__grawkusHotkey__);
    for (const l of togglable) stdin.removeListener('keypress', l);

    function visibleItems(): SuggestItem[] {
      return filterSuggestItems(items, filter);
    }

    function render(): void {
      const visible = visibleItems();
      if (selected >= visible.length) selected = Math.max(0, visible.length - 1);
      if (selected < 0) selected = 0;

      const win = visibleSuggestWindow(visible, selected, maxVisibleSuggestRows(stdout.rows || 24));
      const shown = win.items;

      // Column widths — command col sized to longest visible command,
      // clamped to a reasonable range so the description col gets
      // enough space on narrow terminals.
      const termCols = Math.max(20, stdout.columns || 80);
      const cmdCol = Math.min(
        20,
        Math.max(10, shown.reduce((m, it) => Math.max(m, it.command.length), 0)),
      );
      const hintCol = shown.some((it) => it.hint) ? 12 : 0;
      const descMax = Math.max(20, termCols - cmdCol - hintCol - 10);
      const displayFilter = formatInlineSuggestFilterForPrompt(filter, promptVisLen, termCols);
      displayedFilterVisibleLen = displayFilter.visibleLen;

      // ── Repaint only the rows the selector owns ──
      // Earlier versions used ESC[J (clear-to-end-of-screen), which
      // made the selector feel like it blanked the whole terminal.
      // Keep the surrounding chat and scrollback intact by erasing only
      // the prompt row and the dropdown rows emitted by the last frame.
      stdout.write(buildInlineSuggestEraseSequence(dropdownRows));

      // Repaint the prompt line: styled prefix + filter chars. We
      // own this line now (the clear above wiped whatever was here).
      stdout.write(promptPrefix + displayFilter.text);

      // Draw dropdown rows beneath. Each row gets a "\r\n" prefix
      // so it lands on a fresh line at col 0 regardless of where the
      // previous write left the cursor. (Bare "\n" in raw mode only
      // moves down, not back to col 0.)
      let rowsDrawn = 0;
      if (shown.length === 0) {
        // Hint the args path: if the filter starts with `/` and has
        // letters after it, Enter still submits as-is so the user
        // can type `/customcmd args` even if customcmd isn't in our
        // local catalog.
        const hint = filter.length > 1 && filter.startsWith('/')
          ? '(no match — Enter submits as-is, Backspace narrows, Esc cancels)'
          : '(no matches — Backspace to clear, Esc to dismiss)';
        stdout.write(`\r\n  ${theme.dim(clipText(hint, Math.max(10, termCols - 4)))}`);
        rowsDrawn = 1;
      } else {
        for (let i = 0; i < shown.length; i++) {
          const it = shown[i];
          const itemIndex = win.startIdx + i;
          const isSel = itemIndex === selected;

          const cmdText = clipText(it.command, cmdCol);
          const cmdPad = ' '.repeat(Math.max(0, cmdCol - cmdText.length));
          const cmd = colorCommand(cmdText, filter) + cmdPad;

          const aliasText = it.aliases?.length ? ` aliases: ${it.aliases.join(', ')}` : '';
          const desc = clipText(`${it.description}${aliasText}`, descMax);
          const indicator = isSel ? theme.selection(' > ') : theme.syntaxPunctuation('   ');
          const hint = it.hint
            ? theme.syntaxOption(clipText(`[${it.hint}]`, Math.max(8, hintCol)).padEnd(hintCol, ' '))
            : '';
          const description = isSel ? theme.syntaxString(desc) : theme.dim(desc);

          stdout.write(`\r\n${indicator}${cmd}  ${hint}${description}`);
          rowsDrawn++;
        }
        if (visible.length > shown.length) {
          const range = `${win.startIdx + 1}-${win.endIdx}/${visible.length}`;
          const footer = `${range} · PgUp/PgDn scroll · Home/End jump · type narrows`;
          stdout.write(`\r\n  ${theme.syntaxPunctuation('…')} ${theme.dim(clipText(footer, Math.max(10, termCols - 4)))}`);
          rowsDrawn++;
        }
      }

      // Cursor back to the end of the filter on the prompt row.
      // After the last write we're at end-of-last-dropdown-row;
      // go up `rowsDrawn` lines, \r to col 0, then advance to the
      // visible column of end-of-filter.
      stdout.write(`\x1b[${rowsDrawn}A\r`);
      const endCol = promptVisLen + displayedFilterVisibleLen;
      if (endCol > 0) {
        stdout.write(`\x1b[${endCol}C`);
      }
      dropdownRows = rowsDrawn;
    }

    function teardown(): void {
      stdin.removeListener('data', onData);
      for (const l of dataListeners) {
        if (!stdin.listeners('data').includes(l)) stdin.on('data', l);
      }
      for (const l of togglable) stdin.on('keypress', l);
      try { stdin.setRawMode(wasRaw); } catch { /* noop */ }
      // Wipe only the dropdown area. Leave the filter on screen — the
      // caller decides whether to overwrite (on accept) or restore
      // rl.line + redraw (on cancel).
      if (dropdownRows > 0) {
        stdout.write(buildInlineSuggestDropdownEraseSequence(dropdownRows));
        const endCol = promptVisLen + displayedFilterVisibleLen;
        if (endCol > 0) {
          stdout.write(`\x1b[${endCol}C`);
        }
      }
      dropdownRows = 0;
    }

    function moveSelection(delta: number): void {
      const visible = visibleItems();
      if (visible.length === 0) return;
      selected = (selected + delta + visible.length) % visible.length;
      render();
    }

    function onData(buf: Buffer): void {
      // Defensive wrapper — if any branch throws we don't want the
      // dropdown to silently freeze. Restore listeners so the user
      // can keep typing.
      try {
        const input = parseInlineSuggestInput(buf);

        if (input.type === 'cancel') {
          teardown();
          resolve({ accepted: false, filter });
          return;
        }
        // Enter — accept the current selection and return it to the
        // caller. The REPL fills the live prompt with this value; the
        // user can edit it or press Enter again to run it.
        //
        // Three accepted-value paths:
        //   1. Filter contains a space → user typed "/cmd args".
        //      Return the FULL filter so handleSlashCommand can later see the
        //      command AND its arguments (e.g. "/perm auto" sets the
        //      perm mode, "/think on" toggles). This is the path that
        //      was broken before — typing a space yielded zero
        //      matches and Enter did nothing, so users got stuck.
        //   2. No space, dropdown has a match → return the selected
        //      item's command verbatim.
        //   3. No space, dropdown has no match, but the user typed
        //      something past "/" → return the raw filter and let
        //      handleSlashCommand say "unknown command". Better than
        //      silently swallowing the Enter.
        if (input.type === 'accept') {
          const toSubmit = resolveInlineSuggestAccept(filter, visibleItems(), selected);
          if (!toSubmit) {
            // Filter is "/" alone or empty - nothing to submit. Stay
            // open so the user can keep typing.
            return;
          }
          teardown();
          resolve({ accepted: true, command: toSubmit, filter });
          return;
        }
        // Backspace (DEL 0x7F on POSIX, BS 0x08 on Windows).
        //
        // Behavior: shrink the filter by one char. If the filter is
        // already empty we dismiss; otherwise we KEEP THE DROPDOWN
        // OPEN even when the filter shrinks to "" (so the user can
        // see the full list when they backspace past the trigger '/'
        // — previous behavior dismissed on filter='/' which felt
        // jumpy when the user just wanted to clear their typing).
        if (input.type === 'backspace') {
          if (filter.length === 0) {
            teardown();
            resolve({ accepted: false, filter });
            return;
          }
          filter = filter.slice(0, -1);
          selected = 0;
          render();
          return;
        }
        if (input.type === 'move') {
          moveSelection(input.delta);
          return;
        }
        if (input.type === 'jump') {
          const visible = visibleItems();
          if (visible.length === 0) return;
          selected = input.target === 'start' ? 0 : visible.length - 1;
          render();
          return;
        }
        if (input.type === 'ignore') return;

        // Printable input — extend filter and re-render. Robust
        // against mixed chunks: instead of all-or-nothing, strip
        // ANY non-printable bytes from the chunk and append only
        // the printable subset. This means a chunk like `[h, 0x01]`
        // (an 'h' followed by a stray Ctrl+A) still appends the 'h'
        // instead of dropping the whole chunk.
        //
        // This is the per-char update path: every printable byte
        // lands here and triggers render() with the new filter.
        if (input.type === 'append') {
          filter += input.text;
          selected = 0;
          render();
        }
      } catch {
        // Don't let a render error wedge the user in the dropdown
        // with a dead handler. Tear down, resolve as cancelled with
        // the current filter, and let the parent restore the prompt.
        try { teardown(); } catch { /* noop */ }
        resolve({ accepted: false, filter });
      }
    }

    stdin.on('data', onData);
    render();
  });
}
