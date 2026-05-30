/**
 * Terminal list picker — an interactive arrow-key navigation widget
 * that takes over the screen briefly, lets the user filter + select
 * from a list, and returns the chosen value (or null on cancel).
 *
 * Design choice: alt-screen, not inline.
 *
 * Inline pickers (write a list below the cursor, redraw on each
 * keystroke) are simpler to implement but fragile — they break when
 * the terminal scrolls, when the live-queue scroll-region is active,
 * or when items overflow the visible rows. The alt-screen pattern
 * (`\x1b[?1049h` / `\x1b[?1049l`) is what `git diff --interactive`,
 * `less`, `vim`, and `fzf` all use: switch to a fresh screen buffer,
 * render the picker as a full-screen widget, exit back to the normal
 * screen with the original contents intact.
 *
 * Trade-off: the user briefly loses sight of the surrounding REPL
 * output during selection. In exchange, the picker is robust against
 * any terminal state — it can be invoked from any point in the chat
 * without coordinating with the live queue, current prompt, scroll
 * position, etc.
 *
 * Key handling: bytes parsed from raw stdin. Recognized:
 *   Arrow Up / Down       move selection
 *   Page Up / Down        move 10 at a time
 *   Home / End            jump to first / last
 *   Enter                 select current item
 *   Esc                   cancel (returns null)
 *   Ctrl+C                cancel (returns null)
 *   Backspace             delete last filter char
 *   Printable ASCII       append to filter, reset selection to 0
 *
 * Returns the `value` field of the chosen item, or null if cancelled.
 */
import { stdin, stdout } from 'node:process';

export interface PickerItem<T = string> {
  /** The line shown to the user. Plain text — no ANSI codes. */
  label: string;
  /** Optional right-aligned hint (e.g. pricing, key combo). */
  hint?: string;
  /** Optional second line under the label (e.g. description). */
  description?: string;
  /** The value returned when this item is selected. */
  value: T;
}

export interface PickerOptions {
  /** Title shown at the top of the picker. */
  title?: string;
  /** Footer hint about what's happening (overrides default). */
  footer?: string;
  /**
   * Filtering: when true (default), the user can type to narrow the
   * list. Set to false for pickers where you want pure navigation
   * (rare).
   */
  filterable?: boolean;
  /**
   * Pre-fill the filter with this string before showing the picker.
   * Use case: triggering the picker via a specific key (`/`) and
   * wanting that character already in the filter so the user can
   * keep typing to narrow without re-typing the trigger.
   */
  initialFilter?: string;
}

// ANSI control sequences. Centralized so the rendering loop stays
// readable.
const ANSI = {
  altScreenOn: '\x1b[?1049h',
  altScreenOff: '\x1b[?1049l',
  cursorHide: '\x1b[?25l',
  cursorShow: '\x1b[?25h',
  clearScreen: '\x1b[2J\x1b[H',
  reverse: '\x1b[7m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

/**
 * Show the picker and resolve with the user's selection (or null
 * on cancel). Restores terminal state cleanly on either path.
 */
export async function pick<T>(
  items: PickerItem<T>[],
  opts: PickerOptions = {},
): Promise<T | null> {
  if (items.length === 0) return null;

  return new Promise<T | null>((resolve) => {
    let filter = opts.initialFilter ?? '';
    let selected = 0;
    const wasRaw = stdin.isRaw;
    const filterable = opts.filterable !== false;

    function visibleItems(): PickerItem<T>[] {
      if (!filter) return items;
      const f = filter.toLowerCase();
      return items.filter((i) =>
        i.label.toLowerCase().includes(f) ||
        (i.description ?? '').toLowerCase().includes(f) ||
        (i.hint ?? '').toLowerCase().includes(f),
      );
    }

    function render(): void {
      const visible = visibleItems();
      if (visible.length === 0) {
        selected = 0;
      } else if (selected >= visible.length) {
        selected = visible.length - 1;
      }

      stdout.write(ANSI.clearScreen);

      // Title row.
      if (opts.title) {
        stdout.write(`${ANSI.bold}  ${opts.title}${ANSI.reset}\n`);
      }
      // Filter row. The trailing ▮ is a visible cursor since we hid
      // the real one (reduces flicker on each render).
      if (filterable) {
        stdout.write(`  ${ANSI.dim}filter:${ANSI.reset} ${filter}${ANSI.dim}▮${ANSI.reset}\n`);
      }
      stdout.write('\n');

      // Item list. Window around the selection so we always show
      // the selected row even with hundreds of items. Reserve ~5
      // rows for header + footer.
      const termRows = stdout.rows || 24;
      const itemSlot = Math.max(5, termRows - 7);
      const startIdx = Math.max(0, selected - Math.floor(itemSlot / 2));
      const endIdx = Math.min(visible.length, startIdx + itemSlot);

      for (let i = startIdx; i < endIdx; i++) {
        const item = visible[i];
        const isSel = i === selected;
        const hint = item.hint ? `  ${ANSI.dim}${item.hint}${ANSI.reset}` : '';
        const prefix = isSel ? `${ANSI.reverse}  ▸ ` : '    ';
        const suffix = isSel ? `${ANSI.reset}` : '';
        stdout.write(`${prefix}${item.label}${suffix}${hint}\n`);
        if (item.description) {
          const descPrefix = isSel ? `${ANSI.reverse}    ` : '      ';
          stdout.write(`${descPrefix}${ANSI.dim}${item.description}${ANSI.reset}${suffix}\n`);
        }
      }

      if (visible.length === 0) {
        stdout.write(`  ${ANSI.dim}(no matches — Backspace to clear filter, Esc to cancel)${ANSI.reset}\n`);
      }

      // Footer.
      stdout.write('\n');
      const footerText = opts.footer ??
        `${visible.length}/${items.length} • ↑↓ navigate • Enter select • Esc cancel${filterable ? ' • type to filter' : ''}`;
      stdout.write(`  ${ANSI.dim}${footerText}${ANSI.reset}\n`);
    }

    function cleanup(): void {
      stdin.removeListener('data', onData);
      try { stdin.setRawMode(wasRaw); } catch { /* noop */ }
      stdout.write(ANSI.cursorShow);
      stdout.write(ANSI.altScreenOff);
    }

    function onData(buf: Buffer): void {
      const visible = visibleItems();

      // Ctrl+C — cancel. Has to win over everything else.
      if (buf.length === 1 && buf[0] === 0x03) {
        cleanup();
        resolve(null);
        return;
      }

      // Esc — cancel. But Esc is also the start byte of ANSI escape
      // sequences (arrows, function keys), so only bare Esc (single
      // byte) counts as a cancel. Arrows arrive as a 3+ byte chunk.
      if (buf.length === 1 && buf[0] === 0x1B) {
        cleanup();
        resolve(null);
        return;
      }

      // Enter (CR or LF).
      if (buf.length === 1 && (buf[0] === 0x0D || buf[0] === 0x0A)) {
        if (visible.length === 0) return;
        const chosen = visible[selected];
        cleanup();
        resolve(chosen ? chosen.value : null);
        return;
      }

      // Backspace (DEL 0x7F on POSIX, BS 0x08 on Windows).
      if (buf.length === 1 && (buf[0] === 0x7F || buf[0] === 0x08)) {
        if (filterable && filter.length > 0) {
          filter = filter.slice(0, -1);
          selected = 0;
          render();
        }
        return;
      }

      // Arrow keys arrive as `Esc [ <code>` (typically 3 bytes).
      // Page Up / Down arrive as `Esc [ 5 ~` / `Esc [ 6 ~`.
      // Home / End vary: `Esc [ H`, `Esc [ F`, or `Esc [ 1 ~` / `Esc [ 4 ~`.
      if (buf.length >= 3 && buf[0] === 0x1B && buf[1] === 0x5B) {
        const code = buf[2];
        if (code === 0x41) { // Up
          if (visible.length > 0) selected = (selected - 1 + visible.length) % visible.length;
          render();
          return;
        }
        if (code === 0x42) { // Down
          if (visible.length > 0) selected = (selected + 1) % visible.length;
          render();
          return;
        }
        if (code === 0x48) { // Home
          selected = 0;
          render();
          return;
        }
        if (code === 0x46) { // End
          selected = Math.max(0, visible.length - 1);
          render();
          return;
        }
        if (buf.length >= 4 && (code === 0x35 || code === 0x36) && buf[3] === 0x7E) {
          // Page Up (5~) / Page Down (6~) — move by 10.
          const step = code === 0x35 ? -10 : 10;
          if (visible.length > 0) {
            selected = Math.max(0, Math.min(visible.length - 1, selected + step));
          }
          render();
          return;
        }
        // Unknown escape sequence — ignore.
        return;
      }

      // Otherwise: treat as filter input, but only printable ASCII.
      // Multi-byte UTF-8 entry (e.g. paste) gets appended as the
      // string it represents; the regex check keeps control bytes
      // out.
      if (filterable) {
        const s = buf.toString('utf-8');
        // Allow printable ASCII + extended ranges; reject control
        // chars + the escape we already handled.
        if (/^[\x20-\x7E -￿]+$/.test(s)) {
          filter += s;
          selected = 0;
          render();
        }
      }
    }

    // Enter the picker.
    stdout.write(ANSI.altScreenOn);
    stdout.write(ANSI.cursorHide);
    try { stdin.setRawMode(true); } catch { /* noop */ }
    stdin.on('data', onData);
    stdin.resume();
    render();
  });
}
