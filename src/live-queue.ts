/**
 * Live queue display — a bottom-anchored input box that stays visible
 * during streaming and tool execution, so the user can see what they're
 * typing into the queue (and erase it with backspace).
 *
 * The technique: ANSI DECSTBM (Set Top and Bottom Margins) reserves a
 * scrolling region above the last row. Streaming output scrolls in the
 * upper region; the bottom row is fixed and we redraw it on every
 * keystroke.
 *
 * Layout:
 *
 *   ┌── upper scroll region (rows 1..N-1) ──┐
 *   │                                        │
 *   │  streamed model output writes here     │
 *   │  scrolling naturally as text arrives   │
 *   │                                        │
 *   ├── fixed bottom row (row N) ────────────┤
 *   │  ▶ type-ahead: <user's typed text>     │  ← updated on each keystroke
 *   └────────────────────────────────────────┘
 *
 * Caveats:
 *   - DECSTBM is widely supported in many xterm-like terminals, but the
 *     Windows PowerShell host path can corrupt scrollback by repainting the
 *     fixed row over previous output. Windows therefore opts out by default;
 *     set GRAWKUS_LIVE_QUEUE=1 to force it for a known-good terminal.
 *   - Terminal resize mid-stream isn't handled — the box stays at the
 *     row we reserved. Acceptable trade-off; resize is rare mid-chain.
 *   - Screen-reader mode skips this entirely — NVDA / JAWS read every
 *     cursor move as fresh text, which makes a live-updating widget
 *     much worse than a quiet one-line hint.
 */
import { isFooterActive, setFooterActivity, setFooterDraft } from './fixed-footer.js';

const ANSI = {
  saveCursor: '\x1B7',                              // DECSC (more reliable than ESC[s)
  restoreCursor: '\x1B8',                           // DECRC
  scrollRegion: (top: number, bot: number) => `\x1B[${top};${bot}r`,
  resetScrollRegion: '\x1B[r',
  moveTo: (row: number, col: number) => `\x1B[${row};${col}H`,
  clearLine: '\x1B[2K',
  bold: '\x1B[1m',
  reset: '\x1B[0m',
  dim: '\x1B[2m',
};

interface ActiveState {
  rows: number;
  cols: number;
  // Reserved row at the very bottom for the input box
  boxRow: number;
}

let active: ActiveState | null = null;

export function shouldUseLiveQueue(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.GRAWKUS_LIVE_QUEUE || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes') return true;

  // The scroll-region implementation is not reliable enough on Windows
  // shells to be enabled implicitly. The prompt must never risk merging
  // with streamed model output; queued text is still captured and restored.
  if (platform === 'win32') return false;
  return true;
}

/**
 * Begin reserving the bottom row + setting the scroll region.
 * Safe to call repeatedly; subsequent calls are no-ops.
 * Returns true if activation succeeded.
 */
export function activate(): boolean {
  if (isFooterActive()) {
    setFooterActivity('Sumi ink moving', 0, Date.now());
    setFooterDraft('');
    return true;
  }
  if (active) return true;
  if (!shouldUseLiveQueue()) return false;
  const stdout = process.stdout;
  if (!stdout.isTTY) return false;

  const rows = stdout.rows;
  const cols = stdout.columns;
  // Bail if terminal didn't report dimensions (rare but possible)
  if (!rows || !cols || rows < 4) return false;

  // Print one blank line at the cursor position to ensure we don't
  // collide with prior content (the reserved bottom row is logically
  // below current output after this newline).
  stdout.write('\n');

  // Set scroll region to rows 1..(rows-1), leaving the last row for
  // the input box. The cursor stays where it currently is — inside
  // the scroll region — and subsequent output streams from there.
  // Once the cursor reaches row (rows-1) and another newline is
  // written, the region scrolls upward; the box on row `rows` stays
  // pinned.
  //
  // Previous behavior force-moved the cursor to row (rows-1) via
  // moveTo() so output would START at the bottom of the scroll
  // region. That looked fine in long sessions but left a giant
  // visible gap immediately after a fresh start / model switch:
  // the prompt would render high on the screen, then the cursor
  // would jump down ~20 rows to the bottom of the viewport before
  // the first response token arrived. Visible result: huge empty
  // band between the user's prompt and the model's first line.
  //
  // Dropping the moveTo means output appears RIGHT below the prompt;
  // as it accumulates the prompt scrolls naturally upward and the
  // box stays at the bottom.
  stdout.write(ANSI.scrollRegion(1, rows - 1));

  active = { rows, cols, boxRow: rows };

  // Initial draw of empty box
  drawBox('');
  return true;
}

/**
 * Update the input-box content. Call on every typed char (or
 * backspace) so the user sees their queue in real time.
 *
 * Truncates text to fit terminal width; if longer, shows the LAST
 * (cols-12) chars so the most-recent typing is always visible.
 */
export function update(text: string): void {
  if (isFooterActive()) {
    setFooterDraft(text);
    return;
  }
  if (!active) return;
  drawBox(text);
}

function drawBox(text: string): void {
  if (!active) return;
  const stdout = process.stdout;
  const { boxRow, cols } = active;

  // Save where the streaming cursor was
  stdout.write(ANSI.saveCursor);

  // Move to the reserved row, clear it, draw the indicator + queue
  stdout.write(ANSI.moveTo(boxRow, 1));
  stdout.write(ANSI.clearLine);

  const hasQueuedText = text.trim().length > 0;
  const prefix = hasQueuedText ? '  > type-ahead: ' : '  > active turn: ';
  const budget = Math.max(20, cols - prefix.length - 2);
  let display = hasQueuedText
    ? text
    : 'waiting for model; Esc/F5 cancels, type to prepare the next prompt';
  // Show the END of the text (most recently typed) when overflowing
  if (display.length > budget) {
    display = '…' + display.slice(display.length - budget + 1);
  }
  // Replace any CR/LF in the display so they don't break the box layout
  display = display.replace(/[\r\n]+/g, ' ⏎ ');

  // Soft-styled prefix + content. The empty state describes the active
  // model call, not a queued prompt, so users don't think their submitted
  // task was moved into the queue.
  stdout.write(ANSI.bold + '  >' + ANSI.reset + ANSI.dim + (hasQueuedText ? ' type-ahead: ' : ' active turn: ') + ANSI.reset + display);

  // Restore cursor to where streaming was writing
  stdout.write(ANSI.restoreCursor);
}

/**
 * Tear down the box and restore the default scroll region.
 * Safe to call repeatedly; no-op when not active.
 *
 * Idempotency matters because we want this in `finally` blocks alongside
 * other cleanup that might also call it.
 */
export function deactivate(): void {
  if (isFooterActive()) {
    setFooterDraft('');
    setFooterActivity('Ready', 0, null);
    return;
  }
  if (!active) return;
  const stdout = process.stdout;
  const { boxRow } = active;

  // Reset the scroll region and clear the reserved box row without
  // parking the cursor at the bottom of the viewport. Moving to the
  // bottom created a large blank gap after each chain and made the
  // visible conversation history/banner look like it disappeared.
  stdout.write(ANSI.saveCursor);
  stdout.write(ANSI.resetScrollRegion);
  stdout.write(ANSI.moveTo(boxRow, 1));
  stdout.write(ANSI.clearLine);
  stdout.write(ANSI.restoreCursor);

  active = null;
}

/** Test helper / fallback: are we currently active? */
export function isActive(): boolean {
  return active !== null;
}
