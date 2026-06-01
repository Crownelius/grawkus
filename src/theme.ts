/**
 * TUI theme — Grawkus terminal styling.
 *
 * Inspired by Gemini CLI and Claude Code design patterns:
 *   - Semantic color tokens (not raw hex everywhere)
 *   - Unicode symbols for status indicators
 *   - Clean typography with proper contrast
 *   - 12 Coolors palettes plus the Grawkus Forge brand palette
 *
 * The active palette is a module-level mutable record. setPalette() rebuilds
 * every chalk-bound token in the exported `theme` object in place, so any
 * code holding a reference to `theme.brand`, `theme.dim`, etc. picks up the
 * new colors on the next call — no re-import or restart required.
 *
 * Palettes intentionally share the same named slots (accent, danger,
 * warning + neutrals). The public palette IDs map to Coolors trending
 * schemes; UI code reads semantic tokens so color placement can evolve
 * without spreading raw hex values through the app.
 */
import chalk from 'chalk';
import { BRAND_SPACED_NAME, BRAND_TAGLINE } from './brand.js';

// ── Palette catalog ─────────────────────────────────────
// All palettes use the same 13 slots so UI code can treat them uniformly.
// Slot meanings:
//   cyan / cyanLight / cyanDim   — primary accent + variants
//   magenta / magentaDim          — destructive / error accent
//   yellow / yellowDim            — warning / command accent
//   key                            — background-ish neutral for badge text
//   white / light / mid / gray / darkGray — text hierarchy, light → dark
export interface ColorPalette {
  cyan: string; cyanLight: string; cyanDim: string;
  magenta: string; magentaDim: string;
  yellow: string; yellowDim: string;
  key: string;
  white: string; light: string; mid: string; gray: string; darkGray: string;
  swatches: string[];
}

export type PaletteId =
  | 'olive-garden-feast'
  | 'fiery-ocean'
  | 'refreshing-summer-fun'
  | 'ocean-blue-serenity'
  | 'pastel-dreamland-adventure'
  | 'sunny-beach-day'
  | 'dark-sunset'
  | 'fiery-red-sunset'
  | 'fiery-palette'
  | 'rustic-earthy-tones'
  | 'golden-summer-fields'
  | 'vibrant-tones'
  | 'grawkus-forge';

export interface PaletteMeta {
  id: PaletteId;
  name: string;
  source: string;
  description: string;
}

interface PaletteSlots {
  primary: number;
  secondary: number;
  dim: number;
  danger: number;
  dangerDim: number;
  warning: number;
  warningDim: number;
}

const READABLE_NEUTRALS = {
  key: '#101114',
  white: '#F7F7F8',
  light: '#DADDE2',
  mid: '#B4BBC6',
  gray: '#7F8793',
  darkGray: '#515966',
};

function coolorsPalette(swatches: string[], slots: PaletteSlots): ColorPalette {
  const pick = (idx: number): string => swatches[Math.max(0, Math.min(swatches.length - 1, idx))];
  return {
    cyan: pick(slots.primary),
    cyanLight: pick(slots.secondary),
    cyanDim: pick(slots.dim),
    magenta: pick(slots.danger),
    magentaDim: pick(slots.dangerDim),
    yellow: pick(slots.warning),
    yellowDim: pick(slots.warningDim),
    ...READABLE_NEUTRALS,
    swatches,
  };
}

export const PALETTES: Record<PaletteId, ColorPalette> = {
  'olive-garden-feast': coolorsPalette(
    ['#606C38', '#283618', '#FEFAE0', '#DDA15E', '#BC6C25'],
    { primary: 3, secondary: 2, dim: 0, danger: 4, dangerDim: 1, warning: 3, warningDim: 4 },
  ),
  'fiery-ocean': coolorsPalette(
    ['#780000', '#C1121F', '#FDF0D5', '#003049', '#669BBC'],
    { primary: 4, secondary: 2, dim: 3, danger: 1, dangerDim: 0, warning: 2, warningDim: 4 },
  ),
  'refreshing-summer-fun': coolorsPalette(
    ['#8ECAE6', '#219EBC', '#023047', '#FFB703', '#FB8500'],
    { primary: 1, secondary: 0, dim: 2, danger: 4, dangerDim: 2, warning: 3, warningDim: 4 },
  ),
  'ocean-blue-serenity': coolorsPalette(
    ['#03045E', '#023E8A', '#0077B6', '#0096C7', '#00B4D8', '#48CAE4', '#90E0EF', '#ADE8F4', '#CAF0F8'],
    { primary: 5, secondary: 6, dim: 2, danger: 8, dangerDim: 3, warning: 7, warningDim: 4 },
  ),
  'pastel-dreamland-adventure': coolorsPalette(
    ['#CDB4DB', '#FFC8DD', '#FFAFCC', '#BDE0FE', '#A2D2FF'],
    { primary: 4, secondary: 3, dim: 0, danger: 2, dangerDim: 0, warning: 1, warningDim: 2 },
  ),
  'sunny-beach-day': coolorsPalette(
    ['#264653', '#2A9D8F', '#E9C46A', '#F4A261', '#E76F51'],
    { primary: 1, secondary: 2, dim: 0, danger: 4, dangerDim: 0, warning: 2, warningDim: 3 },
  ),
  'dark-sunset': coolorsPalette(
    ['#335C67', '#FFF3B0', '#E09F3E', '#9E2A2B', '#540B0E'],
    { primary: 0, secondary: 1, dim: 3, danger: 4, dangerDim: 3, warning: 2, warningDim: 1 },
  ),
  'fiery-red-sunset': coolorsPalette(
    ['#03071E', '#370617', '#6A040F', '#9D0208', '#D00000', '#DC2F02', '#E85D04', '#F48C06', '#FAA307', '#FFBA08'],
    { primary: 8, secondary: 9, dim: 2, danger: 4, dangerDim: 1, warning: 9, warningDim: 7 },
  ),
  'fiery-palette': coolorsPalette(
    ['#5F0F40', '#9A031E', '#FB8B24', '#E36414', '#0F4C5C'],
    { primary: 2, secondary: 4, dim: 0, danger: 1, dangerDim: 0, warning: 2, warningDim: 3 },
  ),
  'rustic-earthy-tones': coolorsPalette(
    ['#7F5539', '#A68A64', '#EDE0D4', '#656D4A', '#414833'],
    { primary: 3, secondary: 2, dim: 1, danger: 0, dangerDim: 4, warning: 2, warningDim: 1 },
  ),
  'golden-summer-fields': coolorsPalette(
    ['#CCD5AE', '#E9EDC9', '#FEFAE0', '#FAEDCD', '#D4A373'],
    { primary: 0, secondary: 1, dim: 4, danger: 4, dangerDim: 0, warning: 3, warningDim: 4 },
  ),
  'vibrant-tones': coolorsPalette(
    ['#F94144', '#F3722C', '#F8961E', '#F9844A', '#F9C74F', '#90BE6D', '#43AA8B', '#4D908E', '#577590', '#277DA1'],
    { primary: 6, secondary: 9, dim: 8, danger: 0, dangerDim: 1, warning: 4, warningDim: 2 },
  ),
  'grawkus-forge': coolorsPalette(
    ['#1A1A1E', '#B87333', '#8B3A3A', '#C8754B', '#D4A06A', '#4A5568', '#2D3748', '#E2C08D', '#A0522D', '#6B3A2E'],
    { primary: 1, secondary: 7, dim: 5, danger: 2, dangerDim: 8, warning: 3, warningDim: 4 },
  ),
};

export const PALETTE_META: Record<PaletteId, PaletteMeta> = {
  'olive-garden-feast': { id: 'olive-garden-feast', name: 'Olive Garden Feast', source: 'Coolors trending', description: 'Olive greens with cream and copper.' },
  'fiery-ocean': { id: 'fiery-ocean', name: 'Fiery Ocean', source: 'Coolors trending', description: 'Red accents against cream and navy.' },
  'refreshing-summer-fun': { id: 'refreshing-summer-fun', name: 'Refreshing Summer Fun', source: 'Coolors trending', description: 'Sky blues with amber and orange.' },
  'ocean-blue-serenity': { id: 'ocean-blue-serenity', name: 'Ocean Blue Serenity', source: 'Coolors trending', description: 'A deep-to-bright blue ramp.' },
  'pastel-dreamland-adventure': { id: 'pastel-dreamland-adventure', name: 'Pastel Dreamland Adventure', source: 'Coolors trending', description: 'Soft lavender, pink, and blue.' },
  'sunny-beach-day': { id: 'sunny-beach-day', name: 'Sunny Beach Day', source: 'Coolors trending', description: 'Teal, sand, and warm coral.' },
  'dark-sunset': { id: 'dark-sunset', name: 'Dark Sunset', source: 'Coolors trending', description: 'Petrol blue, cream, amber, and deep red.' },
  'fiery-red-sunset': { id: 'fiery-red-sunset', name: 'Fiery Red Sunset', source: 'Coolors trending', description: 'Deep red ramp into orange and gold.' },
  'fiery-palette': { id: 'fiery-palette', name: 'Fiery Palette', source: 'Coolors trending', description: 'Wine, orange, and deep teal.' },
  'rustic-earthy-tones': { id: 'rustic-earthy-tones', name: 'Rustic Earthy Tones', source: 'Coolors trending', description: 'Brown clay, warm beige, and muted olive.' },
  'golden-summer-fields': { id: 'golden-summer-fields', name: 'Golden Summer Fields', source: 'Coolors trending', description: 'Muted green and cream with a gold accent.' },
  'vibrant-tones': { id: 'vibrant-tones', name: 'Vibrant Tones', source: 'Coolors trending', description: 'Saturated warm tones into green and blue.' },
  'grawkus-forge': { id: 'grawkus-forge', name: 'Grawkus Forge', source: 'Original', description: 'Dark forge with copper accents, rust, and muted steel.' },
};

// Active palette — mutable. Starts on the default; index.ts calls
// setPalette() with the user's choice during startup.
let palette: ColorPalette = PALETTES['olive-garden-feast'];
let activePaletteId: PaletteId = 'olive-garden-feast';

const PALETTE_ALIASES: Record<string, PaletteId> = {
  'compact-cmyk': 'ocean-blue-serenity',
  dracula: 'pastel-dreamland-adventure',
  nord: 'ocean-blue-serenity',
  'solarized-dark': 'dark-sunset',
  gruvbox: 'sunny-beach-day',
  'tokyo-night': 'ocean-blue-serenity',
  catppuccin: 'pastel-dreamland-adventure',
  'high-contrast': 'fiery-red-sunset',
  'vibrant-color-fiesta': 'vibrant-tones',
  'pastel-dreamland': 'pastel-dreamland-adventure',
  'deep-sea': 'ocean-blue-serenity',
  'soft-sand': 'rustic-earthy-tones',
  'watermelon-sorbet': 'refreshing-summer-fun',
  'soft-lavender': 'pastel-dreamland-adventure',
};

export function getPaletteId(): PaletteId { return activePaletteId; }
export function listPalettes(): PaletteMeta[] { return Object.values(PALETTE_META); }
export function resolvePaletteId(s: string): PaletteId | null {
  const id = s.trim().toLowerCase();
  if (id in PALETTES) return id as PaletteId;
  return PALETTE_ALIASES[id] ?? null;
}
export function isPaletteId(s: string): s is PaletteId { return resolvePaletteId(s) !== null; }

// ── Symbols (matching Gemini/Claude patterns) ───────────
export const sym = {
  mark:      '◈',           // Grawkus brand mark
  prompt:    '❯',           // User input prompt
  assistant: '✦',           // Assistant message prefix
  success:   '✓',           // Tool success
  error:     '✗',           // Tool error
  pending:   '○',           // Tool pending
  running:   '●',           // Tool running
  thinking:  '∴',           // Thinking indicator
  warn:      '⚠',           // Warning
  arrow:     '→',           // Flow indicator
  bullet:    '▸',           // List item
  divider:   '─',           // Horizontal rule char
};

// ── Theme (semantic color tokens) ───────────────────────
// `theme` is a mutable object — setPalette() reassigns every property in
// place. UI callers (which look up theme.brand, theme.dim, etc. at call
// time) automatically pick up the new palette without re-imports.
type ChalkFn = (s: string) => string;
type BadgeFn = (s: string) => string;
interface Theme {
  brand: ChalkFn; brandBold: ChalkFn; brandDim: ChalkFn;
  success: ChalkFn; warning: ChalkFn; error: ChalkFn; info: ChalkFn;
  primary: ChalkFn; secondary: ChalkFn; dim: ChalkFn; muted: ChalkFn; bright: ChalkFn; italic: ChalkFn;
  header: ChalkFn; subheader: ChalkFn; command: ChalkFn; cost: ChalkFn; link: ChalkFn;
  transcriptUser: ChalkFn;
  highlight: ChalkFn; selection: ChalkFn;
  syntaxCommand: ChalkFn; syntaxOption: ChalkFn; syntaxArgument: ChalkFn; syntaxPath: ChalkFn; syntaxString: ChalkFn; syntaxPunctuation: ChalkFn;
  prompt: ChalkFn; assistant: ChalkFn; user: ChalkFn;
  toolName: ChalkFn; toolArgs: ChalkFn; toolStatus: ChalkFn; toolError: ChalkFn; toolTime: ChalkFn;
  thinkBorder: ChalkFn; thinkText: ChalkFn; thinkLabel: ChalkFn;
  modeBadge: BadgeFn; secBadge: BadgeFn;
}

/**
 * Build a fresh Theme object for the currently active palette. Called by
 * setPalette() at runtime and once at module load for the default.
 */
function buildTheme(p: ColorPalette): Theme {
  return {
    brand:       chalk.hex(p.cyan),
    brandBold:   chalk.hex(p.cyan).bold,
    brandDim:    chalk.hex(p.cyanDim),

    success:     chalk.hex(p.cyanLight),
    warning:     chalk.hex(p.yellow),
    error:       chalk.hex(p.magenta),
    info:        chalk.hex(p.cyanLight),

    primary:     chalk.hex(p.white),
    secondary:   chalk.hex(p.mid),
    dim:         chalk.hex(p.gray),
    muted:       chalk.hex(p.darkGray),
    bright:      chalk.hex(p.white).bold,
    italic:      chalk.hex(p.mid).italic,

    header:      chalk.hex(p.cyan).bold,
    subheader:   chalk.hex(p.yellow),
    command:     chalk.hex(p.cyanLight).bold,
    cost:        chalk.hex(p.gray),
    link:        chalk.hex(p.cyanLight).underline,
    transcriptUser: chalk.bgHex('#1B1A22').hex(p.light).bold,

    highlight:   chalk.bgHex(p.cyanLight).hex(p.key).bold,
    selection:   chalk.bgHex(p.yellow).hex(p.key).bold,
    syntaxCommand: chalk.hex(p.cyanLight).bold,
    syntaxOption: chalk.hex(p.yellow),
    syntaxArgument: chalk.hex(p.magenta),
    syntaxPath: chalk.hex(p.cyan).underline,
    syntaxString: chalk.hex(p.light),
    syntaxPunctuation: chalk.hex(p.gray),

    prompt:      chalk.hex(p.yellow).bold,
    assistant:   chalk.hex(p.cyanLight).bold,
    user:        chalk.hex(p.white),

    toolName:    chalk.hex(p.cyanLight).bold,
    toolArgs:    chalk.hex(p.mid),
    toolStatus:  chalk.hex(p.yellow),
    toolError:   chalk.hex(p.magenta),
    toolTime:    chalk.hex(p.gray),

    // Thinking display uses the brand accent (same as the banner
    // title) so the "currently happening" line reads as the most
    // recent action. Per user spec — no animation, just static
    // brand-cyan styling on the thinking section. Final assistant
    // text streams in terminal default (white) for contrast.
    thinkBorder: chalk.hex(p.cyanDim),
    thinkText:   chalk.hex(p.cyanLight).italic,
    thinkLabel:  chalk.hex(p.yellow),

    modeBadge: (mode: string): string => {
      const colors: Record<string, ChalkFn> = {
        dev:       chalk.bgHex(p.cyan).hex(p.key),
        review:    chalk.bgHex(p.cyanDim).hex(p.white),
        tdd:       chalk.bgHex(p.magenta).hex(p.white),
        research:  chalk.bgHex(p.yellow).hex(p.key),
        plan:      chalk.bgHex(p.yellowDim).hex(p.key),
        debug:     chalk.bgHex(p.magentaDim).hex(p.white),
        architect: chalk.bgHex(p.cyanLight).hex(p.key),
        sentience: chalk.bgHex(p.magenta).hex(p.white),
        hermes:    chalk.bgHex(p.magenta).hex(p.white),
        design:    chalk.bgHex(p.yellowDim).hex(p.key),
      };
      return (colors[mode] || chalk.bgGray.white)(` ${mode.toUpperCase()} `);
    },

    secBadge: (level: string): string => {
      const colors: Record<string, ChalkFn> = {
        critical: chalk.bgHex(p.magenta).hex(p.white).bold,
        high:     chalk.hex(p.magenta).bold,
        medium:   chalk.hex(p.yellow),
        low:      chalk.hex(p.gray),
        safe:     chalk.hex(p.cyan),
      };
      return (colors[level] || chalk.white)(level.toUpperCase());
    },
  };
}

export const theme: Theme = buildTheme(palette);

/**
 * Switch the active palette. Mutates the exported `theme` object in place
 * so existing callers don't need to re-import. Returns true if the palette
 * was found and applied; false if id was unknown.
 */
export function setPalette(id: string): boolean {
  const resolved = resolvePaletteId(id);
  if (!resolved) return false;
  palette = PALETTES[resolved];
  activePaletteId = resolved;
  Object.assign(theme, buildTheme(palette));
  return true;
}

// ── Banner (single unified startup display) ────────────
//
// Layout (per the user-supplied mock):
//
//   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀         ← heavy top bar
//   ◈  C A W D E X                                  ← brand line
//        terminal coding agents with a mind for the whole repo
//                                                   ← blank
//     ────────────────────────────────────────      ← thin divider
//     Provider  X  │  Model  Y                      ← provider/model row
//     Mode      M  │  Perms  P                      ← mode/perms row
//     Session   abc                                ◆ ← session row, right-aligned brand mark
//                                                   ← blank
//   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀         ← heavy bottom bar
//
// Design notes:
//   - The ▀ char (U+2580 UPPER HALF BLOCK) renders as a solid bar at
//     the top of the row, giving more visual weight than the previous
//     ─ thin rule. Side-by-side it forms a "framed window" feel.
//   - Brand line has NO leading indent — it sits flush against the
//     top bar's left edge to read as a header rather than indented body.
//   - Right-aligned ◆ on the Session row mirrors the brand mark on the
//     left of the title — a visual "bookend" within the frame.
//   - Tools list + /help hint removed: they bloated the banner without
//     adding signal (users find tools via `/tools`, help via `/help`).
//   - Width: 39 cells of border. Wide enough to fit the longest sane
//     content row (Session prefix + 22-char session id + right-aligned
//     ◆) in a standard 80-col terminal, narrow enough to look like a
//     widget rather than spanning the whole screen.
export function printBanner(
  provider: string,
  model: string,
  mode: string,
  permissionMode: string,
  sessionId: string,
  _toolNames: string[], // kept in signature for backward compat; intentionally unused
): void {
  void _toolNames;
  const b = theme.brandBold;
  const d = theme.dim;
  const s = theme.secondary;
  const w = theme.bright;
  const brand = theme.brand;

  const termCols = Math.max(56, process.stdout.columns || 80);
  const BAR_WIDTH = Math.min(74, Math.max(54, termCols - 8));
  const inner = BAR_WIDTH - 4;
  const leftPad = ' '.repeat(Math.max(0, Math.floor((termCols - BAR_WIDTH) / 2)));
  const heavyBar = '▀'.repeat(BAR_WIDTH);
  const divider = sym.divider.repeat(inner);

  const clean = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');
  const clip = (text: string, width: number): string => {
    const plain = clean(text);
    if (plain.length <= width) return plain;
    return width <= 1 ? plain.slice(0, width) : plain.slice(0, width - 1) + '…';
  };
  const center = (text: string, width: number): string => {
    const plain = clip(text, width);
    const pad = Math.max(0, width - plain.length);
    return ' '.repeat(Math.floor(pad / 2)) + plain + ' '.repeat(Math.ceil(pad / 2));
  };
  const row = (text: string): string => leftPad + '  ' + text;
  const meta = (label: string, value: string, width: number): string => `${label} ${clip(value, width)}`;

  const halfWidth = Math.floor((inner - 3) / 2);
  const providerCell = meta('Provider', provider, Math.max(12, halfWidth - 9)).padEnd(halfWidth);
  const modelCell = meta('Model', model, Math.max(12, inner - halfWidth - 11));
  const modeCell = meta('Mode', mode.toUpperCase(), Math.max(8, halfWidth - 5)).padEnd(halfWidth);
  const permCell = meta('Perms', permissionMode, Math.max(8, inner - halfWidth - 11));
  const sessionText = `Session ${clip(sessionId, Math.max(10, inner - 10))}`;

  console.log('');
  console.log(leftPad + brand(heavyBar));
  console.log(leftPad + b(center(`${sym.mark}   ${BRAND_SPACED_NAME}   ${sym.mark}`, BAR_WIDTH)));
  console.log(leftPad + d(center(BRAND_TAGLINE, BAR_WIDTH)));
  console.log(row(d(divider)));
  console.log(row(s(providerCell) + d(' │ ') + w(modelCell)));
  console.log(row(s(modeCell) + d(' │ ') + w(permCell)));
  console.log(row(d(sessionText.padEnd(inner - 2)) + brand(sym.mark)));
  console.log(leftPad + brand(heavyBar));
  console.log('');
}

// ── Duration formatter ─────────────────────────────────
// Human-readable elapsed time for session + chain timers.
// Examples: 5s · 1m 23s · 2h 5m · 1d 4h
function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function padVisible(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - visibleLen(s)));
}

export function formatTranscriptUserLine(text: string, cols = process.stdout.columns || 100): string {
  const oneLine = text.replace(/\r?\n/g, ' ').trimEnd();
  const max = Math.max(20, cols);
  const prefix = theme.prompt('> ');
  const available = Math.max(1, max - visibleLen(prefix));
  const clipped = oneLine.length > available ? oneLine.slice(0, Math.max(0, available - 1)) + '\u2026' : oneLine;
  return theme.transcriptUser(padVisible(prefix + theme.user(clipped), max));
}

export function printTranscriptUserLine(text: string): void {
  console.log(formatTranscriptUserLine(text));
}

export function assistantTranscriptPrefix(): string {
  return theme.assistant(`${sym.assistant} `);
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// printSplash kept as a no-op for API compatibility — ASCII art was removed
// per user request. Existing callers don't need to be updated, but ideally
// would be (see src/index.ts for the canonical call site).
export function printSplash(): void { /* removed */ }

// ── Forge Header ─────────────────────────────────────────
// Grawkus Forge ASCII art — a sturdy dwarf blacksmith with a fiery
// red beard, handlebar mustache, and forge-hammer in hand. Rendered
// in the forge palette (copper hair, rust beard, steel armor).
// Disabled automatically when stdout is not a TTY (CI/piped output)
// or in screen-reader mode.
export function printForgeHeader(): void {
  const copper = chalk.hex('#B87333');
  const rust = chalk.hex('#8B3A3A');
  const steel = chalk.hex('#4A5568');
  const ember = chalk.hex('#E2C08D');
  const iron = chalk.hex('#2D3748');
  const fire = chalk.hex('#C8754B');
  const ash = chalk.hex('#6B3A2E');

  // Skip if stdout isn't a TTY — ASCII art is visual noise in piped/CI output
  if (!process.stdout.isTTY) return;

  console.log('');
  console.log([
    steel('         ▄▄▄███████▄▄▄        '),
    copper('       ▄████████████████▄      '),
    fire('      ██▀▀▀▀▀▀▀▀▀▀▀▀▀██     '),
    copper('     ▐█▌') + ember('   ◉     ◉  ') + copper('▐█▌    ') + fire('⚒ ') + ember.bold('GRAWKUS') + fire(' FORGE ') + fire('⚒'),
    rust('     ▐█▌') + ember('     ═══    ') + rust('▐█▌   '),
    rust('     ▐█▌') + fire('  ═══│││═══ ') + rust('▐█▌    ') + steel('hammering code'),
    copper('     ▐█▌') + fire('   ╲╱ ╲╱  ') + copper('▐█▌    ') + steel('into shape'),
    rust('      ██████████████████▀      ') + steel('  with a mind for the whole repo'),
    iron('       ▀▀▀▀▀▀▀▀▀▀▀▀▀▀        '),
  ].join('\n'));
  console.log('');
}

// ── Screen-reader output dispatch ───────────────────────
// When accessibility.screenReader is enabled, every console.log / stderr
// line passes through applyScreenReader first. We install this as a
// runtime stdout/stderr patch rather than rewriting every call site —
// otherwise we'd have to touch 200+ console.log lines across the codebase.
//
// The patch is idempotent: calling installScreenReaderDispatch() twice
// won't double-wrap. Calling uninstallScreenReaderDispatch() restores
// the original write functions.
type WriteFn = typeof process.stdout.write;
interface StreamPatchState {
  original: WriteFn;
  transform: (s: string) => string;
}
const _streamState = new WeakMap<NodeJS.WriteStream, StreamPatchState>();

export function installScreenReaderDispatch(transform: (s: string) => string): void {
  for (const stream of [process.stdout, process.stderr] as NodeJS.WriteStream[]) {
    if (_streamState.has(stream)) continue;
    const original = stream.write.bind(stream) as WriteFn;
    _streamState.set(stream, { original, transform });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stream as any).write = function patchedWrite(this: NodeJS.WriteStream, chunk: any, encodingOrCb?: any, cb?: any): boolean {
      try {
        if (typeof chunk === 'string') chunk = transform(chunk);
        else if (Buffer.isBuffer(chunk)) chunk = transform(chunk.toString('utf-8'));
      } catch { /* fall through to original */ }
      // eslint-disable-next-line prefer-rest-params
      return original(chunk, encodingOrCb, cb);
    };
  }
}

export function uninstallScreenReaderDispatch(): void {
  for (const stream of [process.stdout, process.stderr] as NodeJS.WriteStream[]) {
    const state = _streamState.get(stream);
    if (!state) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stream as any).write = state.original;
    _streamState.delete(stream);
  }
}

// ── Section Header ──────────────────────────────────────
export function printSection(title: string): void {
  console.log('');
  console.log(theme.header(`  ${sym.divider}${sym.divider} ${title} ${sym.divider.repeat(Math.max(2, 36 - title.length))}`));
}

// ── Key-Value Pair ──────────────────────────────────────
export function printKV(key: string, value: string, indent = 2): void {
  const padding = ' '.repeat(indent);
  console.log(padding + theme.secondary(key.padEnd(14)) + theme.bright(value));
}

// ── Tool Execution Display ──────────────────────────────
//
// Two-phase render: "run" paints a boot animation in-place then
// starts a Braille spinner that keeps ticking while the tool executes;
// "result" stops the spinner and animates a short settle into the
// final ✓/✗ + elapsed + preview line.
//
// Layout footprint: ONE LINE per tool call. The run line is in-place
// (no \n) while the tool is running; the result phase paints over the
// SAME row and only THEN commits with a newline. Compared to the
// previous two-line render (run on row N, result on row N+1) this
// halves the vertical footprint and the in-place rewrite reads as
// "the tool is morphing from running → done" rather than "two
// distinct events".
//
// Module-level _toolSpinner tracks the active spinner across the
// run→result handoff. Tools run sequentially in query.ts so single-
// track state is fine.
let _toolSpinner: import('./animations.js').Spinner | null = null;

export async function printToolRun(name: string, args: string): Promise<void> {
  const compactArgs = args.replace(/\s+/g, ' ').trim();
  const display = compactArgs.length > 80 ? compactArgs.slice(0, 77) + '...' : compactArgs;
  const argsSuffix = display ? theme.toolArgs(` ${display}`) : '';

  // Lazy-import animations so this module stays loadable from sync
  // contexts (CLI startup) that might not need animation infra.
  const anims = await import('./animations.js');

  // Boot animation — 3 frames of "powering up" before the persistent
  // spinner takes over. Total ~150ms; barely perceptible but reads as
  // intentional motion rather than a static "tool name appeared".
  const bootFrames = [
    `  ${theme.dim(anims.POWER_UP[0])}`,
    `  ${theme.dim(anims.POWER_UP[1])} ${theme.toolName(name)}`,
    `  ${theme.toolStatus(anims.POWER_UP[2])} ${theme.toolName(name)}${argsSuffix}`,
  ];
  await anims.playFrames(bootFrames, 50);

  // Persistent spinner. {S} placeholder gets each rotating Braille
  // frame swapped in. The line stays in-place (no \n) so the result
  // phase can overwrite it.
  const prefix = `  ${theme.toolStatus('{S}')} ${theme.toolName(name)}${argsSuffix}`;
  _toolSpinner = anims.startSpinner(prefix);
}

export async function printToolResult(success: boolean, elapsed: number, output: string): Promise<void> {
  const anims = await import('./animations.js');

  // Tear down the run-phase spinner. We don't commit yet — the
  // settle animation will overwrite the line and then commit.
  if (_toolSpinner) {
    _toolSpinner.stop();
    _toolSpinner = null;
  }

  const icon = success ? theme.toolStatus(sym.success) : theme.toolError(sym.error);
  const time = theme.toolTime(`${(elapsed / 1000).toFixed(1)}s`);
  const firstLine = (output.split('\n').find((l) => l.trim().length > 0) || '').trim();
  const preview = firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine;
  const tail = output.length > preview.length + 10
    ? theme.dim(`  +${output.length - preview.length}b`)
    : '';
  const finalLine = `  ${icon} ${time}  ${theme.dim(preview)}${tail}`;

  // Settle animation — a short "morphing" sequence from the spinner
  // glyph through arc states into the final icon. Reads as "the
  // spinner settled into a result" rather than "the spinner
  // disappeared and a new icon appeared".
  const arc = success ? anims.ARC_SPINNER : ['◐', '◑']; // shorter for error path
  const settleFrames = [
    `  ${theme.dim(arc[0])}`,
    `  ${theme.dim(arc[1 % arc.length])}  ${theme.dim(time)}`,
    finalLine,
  ];
  await anims.playFrames(settleFrames, 40);
  anims.commitFrame();
}

// ── Thinking Display ────────────────────────────────────
// Live streaming with a left border during the thinking phase, then
// collapses to a one-liner "tab" when the section closes. The full
// buffered text stays available via expandLastThinking() (wired to
// /think) so the user can re-expand any time after collapse.
//
// Why collapse: long reasoning traces (DeepSeek-R1, Claude extended
// thinking, o1) can run 100+ lines per turn. Leaving them sprawled
// in the transcript pushes the actual answer off-screen and makes
// the conversation hard to scan. Collapsing to a single line
// preserves the "I saw it think" affordance while keeping the
// transcript scannable.
//
// Module-level state is fine here because thinking is single-track —
// the model emits at most one thinking section at a time, and
// printThinkingOpen/Close are called from a single async loop in
// query.ts. If we ever stream multiple concurrent reasoning streams
// (multi-agent swarms etc), refactor to a returned handle.
let _thinkingBuffer = '';
let _thinkingStartMs = 0;
let _thinkingActive = false;

// Live spinner state. While thinking text streams below the header,
// a setInterval ticks every ~90ms and repaints the glyph on the
// header row by:
//   1. Saving the cursor (mid-stream position somewhere below)
//   2. Cursor-up by _thinkingRowsBelow lines + \r to col 0
//   3. Writing the header line with the next Braille frame
//   4. Restoring cursor to the streaming position
//
// _thinkingRowsBelow is incremented in printThinkingText proportional
// to newlines added — that's the offset from header row to current
// stream cursor. When the header scrolls out of the addressable area
// (rows-below >= termRows - 3) the spinner stops itself: cursor-up
// past the visible top doesn't land anywhere useful, and we'd waste
// CPU repainting offscreen.
let _thinkingSpinnerInterval: NodeJS.Timeout | null = null;
let _thinkingRowsBelow = 0;
let _thinkingSpinnerFrame = 0;
const _THINKING_SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function _tickThinkingSpinner(): void {
  const frame = _THINKING_SPIN[_thinkingSpinnerFrame % _THINKING_SPIN.length];
  _thinkingSpinnerFrame++;
  const headerLine =
    theme.thinkBorder('  │ ') + theme.thinkLabel(`${frame} thinking`);

  if (_thinkingRowsBelow === 0) {
    // Still on the header row (no text streamed yet) — just \r and
    // repaint. No cursor save/restore needed.
    process.stdout.write('\r' + headerLine);
    return;
  }

  const termRows = process.stdout.rows || 24;
  if (_thinkingRowsBelow > termRows - 3) {
    // Header scrolled out of the addressable area — stop ticking.
    if (_thinkingSpinnerInterval) {
      clearInterval(_thinkingSpinnerInterval);
      _thinkingSpinnerInterval = null;
    }
    return;
  }

  // Save current cursor, jump up to header row, repaint, restore.
  // Using DECSC/DECRC here is safe-ish because no scroll happens
  // between save and restore (no writes that push content past the
  // viewport bottom) — just one set of writes targeting an earlier
  // row in the visible buffer.
  process.stdout.write('\x1b7');
  process.stdout.write(`\x1b[${_thinkingRowsBelow}A\r`);
  process.stdout.write(headerLine);
  process.stdout.write('\x1b8');
}

function _startThinkingSpinner(): void {
  if (_thinkingSpinnerInterval) return;
  _thinkingRowsBelow = 0;
  _thinkingSpinnerFrame = 0;
  // Only spin in a TTY where ANSI codes work. In CI / piped output we
  // leave the header static — the spinner ticks would just emit
  // garbage control sequences.
  if (!process.stdout.isTTY) return;
  _thinkingSpinnerInterval = setInterval(_tickThinkingSpinner, 90);
  if (typeof _thinkingSpinnerInterval.unref === 'function') {
    _thinkingSpinnerInterval.unref();
  }
}

function _stopThinkingSpinner(): void {
  if (_thinkingSpinnerInterval) {
    clearInterval(_thinkingSpinnerInterval);
    _thinkingSpinnerInterval = null;
  }
}

export async function printThinkingOpen(): Promise<void> {
  _thinkingBuffer = '';
  _thinkingStartMs = Date.now();
  _thinkingActive = true;
  // Static header — no boot animation, no live spinner. The whole
  // thinking section sits in brand-cyan so the user can scan it as
  // "currently happening" without flicker. Spec from user: "take
  // away the thinking animation and just color the most recent
  // action with the title color." The header settles immediately.
  console.log(theme.thinkBorder('  │ ') + theme.thinkLabel(`${sym.thinking} thinking`));
}

export function printThinkingText(text: string): void {
  _thinkingBuffer += text;
  // Add the border prefix only after newlines within the chunk — NOT at
  // the start. printThinkingOpen() already wrote the first-line prefix.
  // Adding `'  │ '` to every chunk produced "| word | word | word" output
  // when the model streamed thinking token-by-token, because each token
  // arrived as its own writeStream call and each got a fresh prefix.
  const prefixed = text.replace(/\n(?!$)/g, '\n' + theme.thinkBorder('  │ '));
  process.stdout.write(theme.thinkText(prefixed));
  // Track newline count so the spinner can address the header row
  // via cursor-up from the current stream position.
  const newlines = (text.match(/\n/g) || []).length;
  _thinkingRowsBelow += newlines;
}

/**
 * Close the thinking section.
 *
 * By default, COLLAPSES the streamed content into a one-liner — uses
 * ANSI cursor-up + clear-to-end-of-screen to erase the panel we just
 * printed, then writes a compact "▶ thinking · N tokens · /think to
 * expand" footer in its place. The full buffer is stashed on
 * globalThis so /think can re-print it later.
 *
 * Pass `{ collapse: false }` to skip the collapse and leave the
 * expanded panel on screen (used by expandLastThinking()).
 *
 * Safety: if the thinking output is taller than the terminal can
 * reliably address with cursor-up (more rows than the terminal has,
 * or terminal-width-wrapped lines we can't count precisely), we skip
 * the collapse and just print the footer below. The user still gets
 * the count + elapsed; the panel stays where it is.
 */
export async function printThinkingClose(opts: { collapse?: boolean } = {}): Promise<void> {
  // Spinner is no longer started on open, but call the stop helper
  // anyway so any in-flight tick from a previous version of the
  // module (rare during hot-reload) is cleared.
  _stopThinkingSpinner();
  process.stdout.write('\n');
  if (!_thinkingActive) return;
  _thinkingActive = false;

  // Stash for /think to re-expand on demand. Even when we don't
  // collapse, this lets the user re-read the thinking later via the
  // slash command without scrolling back.
  (globalThis as { __grawkusLastThinking?: string }).__grawkusLastThinking = _thinkingBuffer;

  const collapse = opts.collapse !== false;
  if (!collapse || _thinkingBuffer.length === 0) return;

  // Approximate the physical row count of what we just printed.
  // Layout: 1 row for the open header + (rows per text line) + 1 row
  // for the close \n we just wrote. Each "text line" (segment between
  // \n in the buffer) wraps to ceil((4 + line.length) / termCols)
  // physical rows because the border prefix is 4 visible chars.
  const termCols = process.stdout.columns || 80;
  const termRows = process.stdout.rows || 24;
  const lines = _thinkingBuffer.split('\n');
  let approxRows = 1; // open header
  for (const ln of lines) {
    approxRows += Math.max(1, Math.ceil((4 + ln.length) / termCols));
  }
  approxRows += 1; // trailing close \n

  const tokens = _approxTokens(_thinkingBuffer);
  const elapsed = _thinkingElapsed();

  // Bail on collapse if the panel ran taller than the terminal can
  // address — cursor-up past the top doesn't go anywhere useful and
  // we'd corrupt the surrounding output. Leave the panel as-is and
  // just print the footer (still buffered for /think).
  if (approxRows >= termRows - 2) {
    console.log(
      theme.thinkBorder('  ▶ ') +
      theme.thinkLabel('thinking') +
      theme.dim(` · ${tokens}t · ${elapsed}s · /think to re-read`)
    );
    return;
  }

  // Static collapse — no fold-down animation. Cursor-up to the open
  // header row, clear from there to end of screen, write the
  // collapsed one-liner footer. Matches the "no thinking animation"
  // spec while preserving the collapse-to-summary behavior.
  process.stdout.write(`\r\x1b[${approxRows}A\x1b[J`);
  console.log(
    theme.thinkBorder('  ▶ ') +
    theme.thinkLabel('thinking') +
    theme.dim(` · ${tokens}t · ${elapsed}s · /think to expand`)
  );
}

function _approxTokens(text: string): number {
  // ~4 chars per token is the common heuristic across English-heavy
  // tokenizers. Good enough for a one-liner footer; the actual count
  // shows up in /usage from the API's reported usage.
  return Math.max(1, Math.round(text.length / 4));
}

function _thinkingElapsed(): string {
  return ((Date.now() - _thinkingStartMs) / 1000).toFixed(1);
}

/**
 * Re-print the most recent thinking block (the one /think collapses)
 * in expanded form. Returns false if there's no thinking buffered for
 * this session yet — the slash command uses that to print a "no
 * thinking captured yet" message instead.
 */
export function expandLastThinking(): boolean {
  const text = (globalThis as { __grawkusLastThinking?: string }).__grawkusLastThinking;
  if (!text) return false;
  // Pass collapse: false so the printThinkingClose at the end doesn't
  // try to ANSI-up + clear the expansion we just rendered.
  console.log(theme.thinkBorder('  │ ') + theme.thinkLabel(`${sym.thinking} thinking (expanded · most recent)`));
  const prefixed = text.replace(/\n(?!$)/g, '\n' + theme.thinkBorder('  │ '));
  process.stdout.write(theme.thinkText(prefixed));
  if (!text.endsWith('\n')) process.stdout.write('\n');
  return true;
}

// ── Cost / telemetry line ─────────────────────────────────
// One compact status line per model turn: tokens + cost + elapsed time.
// No leading blank — caller is responsible for line state (newline as
// needed before this is printed).
export function printCost(
  prompt: number,
  completion: number,
  cost: number,
  warning?: string,
  elapsedMs?: number,
): void {
  const fmt = (n: number) => (n > 999 ? `${(n / 1000).toFixed(1)}K` : String(n));
  const p = fmt(prompt);
  const c = fmt(completion);
  const t = typeof elapsedMs === 'number'
    ? `  ${theme.toolTime((elapsedMs / 1000).toFixed(1) + 's')}`
    : '';
  console.log(
    theme.cost(`  ${p}${sym.arrow}${c} tokens  $${cost.toFixed(4)}`) + t,
  );
  if (warning) {
    console.log(theme.warning(`  ${sym.warn} ${warning}`));
  }
}

// ── API error formatter ─────────────────────────────────
/**
 * Pattern-match an API error message + status into a specific category,
 * with provider-aware diagnosis and a one-line fix. Returns the best
 * matching pattern, or a generic fallback.
 */
export interface ApiErrorContext {
  baseURL?: string;
  provider?: string;
  model?: string;
}

export interface CategorizedError {
  category: string;          // short label like "rate-limit-free", "context-overflow"
  status?: number;           // 401/404/429/etc.
  provider: string;          // detected provider name
  title: string;             // one-line headline (becomes the badge body)
  why: string;               // explanation of what happened
  fix: string;               // single concrete next step
  docs?: string;             // optional doc URL
  severity: 'auth' | 'quota' | 'model' | 'context' | 'content' | 'network' | 'server' | 'unknown';
}

function detectProvider(message: string, ctx: ApiErrorContext): string {
  const m = message.toLowerCase();
  if (ctx.provider) return ctx.provider;
  const base = (ctx.baseURL || '').toLowerCase();
  if (base.includes('openrouter') || m.includes('openrouter')) return 'OpenRouter';
  if (base.includes('openai.com')) return 'OpenAI';
  if (base.includes('anthropic.com') || m.includes('anthropic')) return 'Anthropic';
  if (base.includes('deepseek')) return 'DeepSeek';
  if (base.includes('googleapis') || m.includes('google')) return 'Google';
  if (base.includes('bigmodel.cn') || m.includes('zhipu')) return 'GLM';
  if (base.includes('11434')) return 'Ollama';
  if (base.includes('1234')) return 'LM Studio';
  return 'API';
}

function extractStatus(message: string): number | undefined {
  // Common shapes:
  //   "API Error: 404 Ring-..."
  //   "Request failed with status code 401"
  //   "404 Not Found - GET https://..."
  //   "HTTP 502"
  const direct = message.match(/\b(?:status(?:\s+code)?\s*[:=]?\s*|HTTP\s+|API\s+Error:\s*|^)([1-5]\d{2})\b/i);
  if (direct) return parseInt(direct[1], 10);
  // Bare 3-digit code at the start of the message
  const bare = message.match(/^\s*([1-5]\d{2})\b/);
  if (bare) return parseInt(bare[1], 10);
  return undefined;
}

function extractUrl(message: string): string | undefined {
  const m = message.match(/https?:\/\/[^\s)>"']+/);
  return m ? m[0] : undefined;
}

export function categorizeApiError(message: string, ctx: ApiErrorContext = {}): CategorizedError {
  const provider = detectProvider(message, ctx);
  const status = extractStatus(message);
  const lower = message.toLowerCase();

  // ── Most specific patterns first ───────────────────────

  // Free-tier per-minute rate limit (OpenRouter signature)
  if ((status === 429 || lower.includes('rate limit')) && /free[-_\s]*models?[-_\s]*per[-_\s]*min/.test(lower)) {
    return {
      category: 'rate-limit-free-per-min', status, provider, severity: 'quota',
      title: 'Free-tier rate limit (20 RPM)',
      why: `${provider}'s free models cap at ~20 requests per minute.`,
      fix: 'Wait ~60s, OR switch to a paid model with /model, OR add credits to your account.',
      docs: 'https://openrouter.ai/docs/limits',
    };
  }

  // Free-tier daily limit
  if (status === 429 && /(daily|free[-_\s]*models?[-_\s]*per[-_\s]*day|day-limit)/.test(lower)) {
    return {
      category: 'rate-limit-free-per-day', status, provider, severity: 'quota',
      title: 'Free-tier daily limit reached',
      why: `${provider}'s free tier caps daily request count (typically 50–200/day).`,
      fix: 'Wait until the limit resets (UTC midnight), switch models with /model, or upgrade your plan.',
      docs: 'https://openrouter.ai/docs/limits',
    };
  }

  // Generic rate limit
  if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      category: 'rate-limit', status: status ?? 429, provider, severity: 'quota',
      title: 'Rate limited',
      why: `${provider} rejected the request because you're sending them too fast.`,
      fix: 'Wait a few seconds and retry, OR switch to a less-loaded model with /model.',
    };
  }

  // Model deprecated / migrated to paid (OpenRouter "transitioned to a paid model")
  if (/(no longer (available|free)|transitioned to|has been removed|deprecated|sunset)/.test(lower)) {
    return {
      category: 'model-deprecated', status: status ?? 404, provider, severity: 'model',
      title: 'Model deprecated or moved',
      why: 'The upstream provider removed or paywalled this model.',
      fix: 'Pick another model with /model <name>, or run /config to switch provider.',
      docs: extractUrl(message),
    };
  }

  // Model not found
  if (status === 404 || /(model[^\n]*not (found|exist)|no such model|unknown model|engine not found)/.test(lower)) {
    return {
      category: 'model-not-found', status: status ?? 404, provider, severity: 'model',
      title: 'Model not found',
      why: `${provider} doesn't recognize "${ctx.model || 'the configured model'}".`,
      fix: 'Check the spelling with /models, or pick a different one with /model <name>.',
    };
  }

  // Auth failures
  if (status === 401 || /(unauthorized|invalid (api )?key|invalid token|authentication failed|incorrect api key)/.test(lower)) {
    return {
      category: 'auth-bad-key', status: status ?? 401, provider, severity: 'auth',
      title: 'Authentication failed',
      why: `${provider} rejected the API key. It's missing, malformed, or revoked.`,
      fix: 'Re-set your key with /config. Check ~/.grawkus/config.json if /config doesn\'t catch it.',
    };
  }

  // Forbidden - 2FA / restricted
  if (status === 403 && /(two[-_\s]*factor|2fa|otp|second[-_\s]*factor)/.test(lower)) {
    return {
      category: 'auth-2fa', status, provider, severity: 'auth',
      title: '2FA required',
      why: `${provider} requires a one-time code for this account/action.`,
      fix: 'For npm: use `npm publish --otp=<code>`. For account access: complete 2FA in the web UI.',
    };
  }

  // Forbidden - generic permission
  if (status === 403 || lower.includes('forbidden') || lower.includes('permission denied')) {
    return {
      category: 'auth-forbidden', status: status ?? 403, provider, severity: 'auth',
      title: 'Access denied',
      why: `${provider} accepted your key but won't allow this specific action (e.g. model access, geo restriction).`,
      fix: 'Check account permissions in the provider\'s web UI, or try a different model with /model.',
    };
  }

  // Payment / out of credits
  if (status === 402 || /(insufficient[_\s]*(credit|quota|funds)|payment[_\s]*required|out of credit|billing|low balance)/.test(lower)) {
    return {
      category: 'no-credit', status: status ?? 402, provider, severity: 'quota',
      title: 'Out of credits',
      why: `Your ${provider} account doesn't have enough credit/quota for this call.`,
      fix: 'Top up credits in the provider\'s web UI, or switch to a free model with /model.',
    };
  }

  // Context length overflow
  if (/(context[_\s]*length|maximum context|too many tokens|max[_\s]*tokens.*exceed|reduce.*tokens|input is too long)/.test(lower)) {
    return {
      category: 'context-overflow', status, provider, severity: 'context',
      title: 'Context length exceeded',
      why: 'The conversation + system prompt + tools is bigger than the model\'s context window.',
      fix: 'Run /clear to drop history, /history to check size, or switch to a higher-context model with /model.',
    };
  }

  // Content moderation
  if (/(content[_\s]*filter|content[_\s]*policy|safety[_\s]*(filter|guidelines)|blocked by (moderation|safety)|moderation[_\s]*blocked)/.test(lower)) {
    return {
      category: 'content-filter', status, provider, severity: 'content',
      title: 'Content filtered',
      why: `${provider}'s moderation blocked the request.`,
      fix: 'Rephrase the prompt to avoid the trigger, or try a less-restrictive model with /model.',
    };
  }

  // Provider overloaded
  if ((status === 503 || status === 502) || /(overloaded|temporarily unavailable|capacity|try again later)/.test(lower)) {
    return {
      category: 'provider-overloaded', status: status ?? 503, provider, severity: 'server',
      title: `${provider} overloaded`,
      why: 'The upstream provider is at capacity or experiencing an outage.',
      fix: 'Wait 30s and retry, OR switch to a different model with /model, OR check provider status page.',
    };
  }

  // Network errors
  if (/ECONNREFUSED/i.test(message)) {
    const isLocal = /:11434|:1234|localhost|127\.0\.0\.1/.test(ctx.baseURL || '');
    return {
      category: 'network-refused', provider, severity: 'network',
      title: 'Connection refused',
      why: isLocal
        ? `Nothing's listening at ${ctx.baseURL || 'the local URL'}. Is Ollama/LM Studio running?`
        : `${provider} refused the connection — likely a firewall, proxy, or DNS issue.`,
      fix: isLocal
        ? 'Start the local server (`ollama serve` or open LM Studio), then retry.'
        : 'Check internet/proxy/firewall, then retry. /config to switch provider if persistent.',
    };
  }
  if (/ENOTFOUND/i.test(message)) {
    return {
      category: 'network-dns', provider, severity: 'network',
      title: 'DNS lookup failed',
      why: `Couldn't resolve the hostname for ${ctx.baseURL || provider}.`,
      fix: 'Check your network connection and DNS. Verify the baseURL in /provider.',
    };
  }
  if (/(ETIMEDOUT|timeout|timed out)/i.test(message)) {
    return {
      category: 'network-timeout', provider, severity: 'network',
      title: 'Request timed out',
      why: `${provider} didn't respond in time. Could be slow network or a stuck request.`,
      fix: 'Retry. If persistent, try a different model with /model or check your connection.',
    };
  }
  if (/fetch failed/i.test(message)) {
    return {
      category: 'network-generic', provider, severity: 'network',
      title: 'Network request failed',
      why: 'The HTTP call couldn\'t reach the provider.',
      fix: 'Check connectivity, retry. /provider to inspect the current baseURL.',
    };
  }

  // Bad request — usually malformed parameters
  if (status === 400 || /(bad request|invalid[_\s]*(parameter|argument|request|input))/.test(lower)) {
    return {
      category: 'bad-request', status: status ?? 400, provider, severity: 'unknown',
      title: 'Bad request',
      why: 'The provider rejected the request shape. Often a model/tool param mismatch.',
      fix: 'Try /clear to reset state. If it keeps happening, switch model with /model.',
    };
  }

  // 5xx server errors
  if (status && status >= 500) {
    return {
      category: 'server-error', status, provider, severity: 'server',
      title: `${provider} server error (${status})`,
      why: 'The provider had an internal failure. Not your fault.',
      fix: 'Retry in 30s. If persistent, check the provider\'s status page or switch with /model.',
    };
  }

  // Cryptic short error from the provider (e.g. owl-alpha returning just
  // "ERROR" or "Provider returned error" with no detail). These are almost
  // always a sign the model itself is broken on the provider's end.
  if (lower.length < 80 && /^(error|provider returned error|request failed)\.?$/i.test(lower.trim())) {
    return {
      category: 'unknown', status, provider, severity: 'unknown',
      title: `${provider} returned an empty / cryptic error`,
      why: 'The model returned no detail — usually means the model itself is broken or deprecated on the provider\'s end.',
      fix: `Switch with /model <name>. Free-tier-safe OpenRouter choice: openrouter/free. Paid reliable choices include anthropic/claude-sonnet-4, deepseek-chat, google/gemini-2.5-flash. Set /fallback <model> to auto-retry on the next failure.`,
    };
  }

  // Default
  return {
    category: 'unknown', status, provider, severity: 'unknown',
    title: 'Request failed',
    why: 'The provider returned an error not matching any known pattern.',
    fix: 'Try /clear and retry. Report the full message at https://github.com/Crownelius/grawkus/issues if it persists.',
  };
}

function severityColor(severity: CategorizedError['severity']): (s: string) => string {
  switch (severity) {
    case 'auth':    return theme.error;
    case 'quota':   return theme.warning;
    case 'model':   return theme.warning;
    case 'context': return theme.cost;     // blue-ish, recoverable
    case 'content': return theme.warning;
    case 'network': return theme.dim;
    case 'server':  return theme.error;
    default:        return theme.error;
  }
}

/**
 * Render an API error with structured diagnosis.
 *
 *   ✗ API error  [429 · OpenRouter · rate-limit-free-per-min]
 *
 *     Free-tier rate limit (20 RPM)
 *
 *     OpenRouter's free models cap at ~20 requests per minute.
 *     → Wait ~60s, OR switch to a paid model with /model, OR add credits.
 *     · https://openrouter.ai/docs/limits
 *
 *     raw: 429 Rate limit exceeded: free-models-per-min.
 */
export function printApiError(message: string, ctx: ApiErrorContext = {}): void {
  const e = categorizeApiError(message, ctx);
  const color = severityColor(e.severity);
  const tagParts: string[] = [];
  if (e.status) tagParts.push(String(e.status));
  tagParts.push(e.provider);
  tagParts.push(e.category);
  const tag = ` [${tagParts.join(' · ')}]`;

  console.log('');
  console.log(theme.error(`  ${sym.error} API error`) + color(tag));
  console.log('');
  console.log(color(`    ${e.title}`));
  console.log('');
  console.log(theme.dim(`    ${e.why}`));
  console.log(theme.warning(`    → ${e.fix}`));
  if (e.docs) console.log(theme.dim(`    · ${e.docs}`));
  // Raw upstream message, dimmed, for forensics. Strip leading/trailing
  // whitespace and any HTTP URL we already surfaced.
  const raw = message.replace(/\s+/g, ' ').trim();
  if (raw && raw.length < 400) {
    console.log('');
    console.log(theme.dim(`    raw: ${raw}`));
  }
  console.log('');
}

// ── Security Display ────────────────────────────────────
export function printSecurityBadge(level: string, threats: string[], blocked: boolean): void {
  console.log(`  ${sym.warn} Security: ${theme.secBadge(level)}`);
  for (const t of threats) {
    console.log(theme.warning(`    ${sym.bullet} ${t}`));
  }
  if (blocked) {
    console.log(chalk.bgHex(palette.magenta).white(`    BLOCKED ${sym.divider} this operation was prevented`));
  }
}

// ── Divider ─────────────────────────────────────────────
export function printDivider(): void {
  console.log(theme.muted('  ' + sym.divider.repeat(38)));
}

// ── Spinner ─────────────────────────────────────────────
export function spinner(text: string): string {
  return theme.dim(`  ${sym.running} ${text}`);
}
