/**
 * Animation primitives — terminal in-place rendering for tight,
 * "futuristic"-feeling transitions on state changes (thinking
 * open/close, tool run/result, banner boot).
 *
 * Two patterns:
 *
 *   playFrames()      Render a sequence of frames in place
 *                     (`\r\x1b[K` + content), then settle on the
 *                     last frame. Async — caller awaits the brief
 *                     transition (~150–250 ms typical). Use for
 *                     state-transition moments: opening a section,
 *                     closing/collapsing a section, settling a
 *                     result.
 *
 *   startSpinner()    Kick off a setInterval that overwrites the
 *                     current line with rotating spinner frames
 *                     (Braille) until stop() is called. Non-
 *                     blocking — use for "waiting" indicators when
 *                     nothing else is writing to that line (e.g.
 *                     while a tool is executing).
 *
 * Both bail to no-op when:
 *   - stdout is not a TTY (CI, log capture, piped output)
 *   - screen-reader mode is on (in-place repaints become a flood
 *     of new content events for the screen reader)
 *   - the env override GRAWKUS_ANIMATIONS=0 is set
 *   - setAnimationConfig({ enabled: false }) was called
 *
 * Disabled-mode behavior: `playFrames()` paints only the LAST frame
 * instantly (settles to the final visual state without the
 * sequence), and `startSpinner()` paints a static "●" placeholder
 * and returns no-op stop()/stopAndCommit() helpers. Callers that
 * use the spinner result keep working — they just don't see motion.
 */
import { stdout } from 'node:process';

/**
 * Braille spinner — 10-frame rotation. The smooth gradient between
 * adjacent frames gives it a more "tech" feel than ASCII spinners
 * (| / - \) and renders in any UTF-8 terminal.
 */
export const BRAILLE_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Quarter-arc spinner — heavier visual weight than Braille, fits
 * better next to text labels when we want the spinner to read as
 * "active state" rather than ambient indicator.
 */
export const ARC_SPINNER = ['◐', '◓', '◑', '◒'];

/**
 * Filling-dot sequence — used by transition animations to suggest
 * "powering up" or "settling" without needing rotation.
 */
export const POWER_UP = ['◌', '◍', '◉'];
export const POWER_DOWN = ['◉', '◍', '◌'];

let _enabled = true;
let _screenReader = false;

/**
 * Configure animations globally. Called by index.ts after config
 * load + when the user toggles screen-reader mode.
 */
export function setAnimationConfig(opts: { enabled?: boolean; screenReader?: boolean }): void {
  if (opts.enabled !== undefined) _enabled = opts.enabled;
  if (opts.screenReader !== undefined) _screenReader = opts.screenReader;
}

/**
 * Resolved "should I animate" check. Combines the static config,
 * the screen-reader flag, the env override, and the TTY check.
 */
export function animationsEnabled(): boolean {
  if (!stdout.isTTY) return false;
  if (process.env.GRAWKUS_ANIMATIONS === '0') return false;
  if (_screenReader) return false;
  return _enabled;
}

/**
 * Paint a frame in-place: `\r` (col 0 of current line) + `\x1b[K`
 * (clear to end of line) + the new content. No trailing newline —
 * the next paint or commitFrame() handles that.
 *
 * Exported because some callers (cancel paths, error fallbacks) need
 * to forcibly repaint a line even when animations are off.
 */
export function paintFrame(text: string): void {
  stdout.write('\r\x1b[K' + text);
}

/**
 * Commit the current in-place frame by emitting a newline. After
 * this the cursor is on a fresh row and the painted frame is locked
 * into the transcript.
 */
export function commitFrame(): void {
  stdout.write('\n');
}

/**
 * Play a sequence of frames in place at the given period. The
 * promise resolves once the last frame has been painted and the
 * period for it has elapsed.
 *
 * When animations are disabled the function paints ONLY the last
 * frame (no waiting, no intermediate frames) so the screen still
 * settles on the correct final visual.
 *
 * The caller controls whether to commit the final frame: if you
 * want subsequent prints to start on a new row, call commitFrame()
 * after playFrames() resolves. If you want a spinner to take over
 * the same row, leave the frame uncommitted.
 */
export async function playFrames(frames: string[], periodMs = 50): Promise<void> {
  if (frames.length === 0) return;
  if (!animationsEnabled()) {
    paintFrame(frames[frames.length - 1]);
    return;
  }
  for (const f of frames) {
    paintFrame(f);
    await sleep(periodMs);
  }
}

export interface Spinner {
  /** Stop ticking; leave whatever frame is on screen in place. */
  stop(): void;
  /**
   * Stop ticking, overwrite the spinner line with `line`, then emit
   * a newline. Use when a result is ready and you want the row to
   * settle to the final value before moving on.
   */
  stopAndCommit(line: string): void;
}

/**
 * Start an in-place spinner. The `prefixTemplate` is painted each
 * tick with the literal substring "{S}" replaced by the current
 * spinner frame char. Example:
 *
 *     startSpinner("  {S} running bash")
 *
 * paints, in sequence, "  ⠋ running bash", "  ⠙ running bash", …
 *
 * Returns a handle with stop() and stopAndCommit(). Caller MUST
 * invoke one of them — leaving the interval running leaks an event-
 * loop ref and pins the process open.
 *
 * When animations are off: paints the template once with "●" in
 * place of "{S}" and returns a no-op handle. Callers keep working
 * without changes.
 */
export function startSpinner(prefixTemplate: string, periodMs = 80): Spinner {
  if (!animationsEnabled()) {
    paintFrame(prefixTemplate.replace('{S}', '●'));
    return {
      stop: () => { /* noop */ },
      stopAndCommit: (line: string): void => {
        paintFrame(line);
        commitFrame();
      },
    };
  }
  let i = 0;
  const id = setInterval(() => {
    paintFrame(prefixTemplate.replace('{S}', BRAILLE_SPINNER[i % BRAILLE_SPINNER.length]));
    i++;
  }, periodMs);
  // Don't ref the interval — if the process is otherwise idle the
  // spinner shouldn't keep it alive. unref() is a no-op on intervals
  // in Node 18+, but safe to call.
  if (typeof id.unref === 'function') id.unref();
  return {
    stop: (): void => {
      clearInterval(id);
    },
    stopAndCommit: (line: string): void => {
      clearInterval(id);
      paintFrame(line);
      commitFrame();
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
