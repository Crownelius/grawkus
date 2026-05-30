import type * as readline from 'node:readline/promises';
import chalk from 'chalk';
import type { GrawkusConfig } from './types.js';
import { getUsageSummary } from './cost-tracker.js';
import { formatDuration, formatTranscriptUserLine, theme } from './theme.js';
import { getCurrentVersion } from './updater.js';
import { getPromodeLoopDelayForFooter } from './promode/loop.js';

const ANSI = {
  saveCursor: '\x1B7',
  restoreCursor: '\x1B8',
  scrollRegion: (top: number, bottom: number) => `\x1B[${top};${bottom}r`,
  resetScrollRegion: '\x1B[r',
  moveTo: (row: number, col: number) => `\x1B[${row};${col}H`,
  clearLine: '\x1B[2K',
};

const FOOTER_ROWS = 5;
const PROMPT_PREFIX = '> ';
const TEMPLATE_KEYS = [
  'provider',
  'model',
  'permissions',
  'session',
  'cwd',
  'workspace',
  'sandbox',
  'mode',
  'cost',
  'tokens',
  'sessioncost',
  'sessiontokens',
  'latency',
  'firsttoken',
  'turnlatency',
  'budget',
  'activity',
  'version',
] as const;

export interface FooterSnapshot {
  provider: string;
  model: string;
  permissionMode: string;
  mode: string;
  sessionId: string;
  sessionName?: string;
  cwd: string;
  sandbox?: string;
  template?: string;
  version: string;
}

interface ActiveFooter {
  rows: number;
  cols: number;
  scrollBottom: number;
  footerTop: number;
}

interface FooterState extends FooterSnapshot {
  activity: string;
  activityStartedAtMs: number | null;
  activityFrame: number;
  turn: number;
  draft: string;
  lastCost: string;
  lastTokens: string;
  sessionCost: string;
  sessionTokens: string;
  lastFirstToken: string;
  lastTurnLatency: string;
  budget: string;
  acceptingPrompt: boolean;
}

let active: ActiveFooter | null = null;
let state: FooterState = {
  provider: '',
  model: '',
  permissionMode: '',
  mode: 'dev',
  sessionId: '',
  sessionName: '',
  cwd: process.cwd(),
  sandbox: 'off',
  version: getCurrentVersion(),
  activity: 'Ready',
  activityStartedAtMs: null,
  activityFrame: 0,
  turn: 0,
  draft: '',
  lastCost: '$0.0000',
  lastTokens: '0 tokens',
  sessionCost: '$0.0000',
  sessionTokens: '0 tokens',
  lastFirstToken: '',
  lastTurnLatency: '',
  budget: '',
  acceptingPrompt: false,
};
let activityTicker: ReturnType<typeof setInterval> | null = null;

export function shouldUseFixedFooter(config: GrawkusConfig, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.GRAWKUS_FIXED_FOOTER || env.GRAWKUS_FOOTER || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  if (env.GRAWKUS_NON_INTERACTIVE === '1') return false;
  if (config.footer?.enabled === false) return false;
  if (config.voice?.accessibility?.screenReader === true) return false;
  return true;
}

export function buildFooterSnapshot(
  config: GrawkusConfig,
  mode: string,
  session: { id: string; name?: string },
  cwd: string,
): FooterSnapshot {
  let modeLabel = mode;
  const pm = getPromodeLoopDelayForFooter(config, cwd);
  if (pm) modeLabel = `${mode}+${pm}`;
  return {
    provider: config.provider,
    model: config.model,
    permissionMode: config.permissionMode,
    mode: modeLabel,
    sessionId: session.id,
    sessionName: session.name,
    cwd,
    sandbox: config.sandbox?.level || 'off',
    template: config.footer?.template,
    version: getCurrentVersion(),
  };
}

export function activateFooter(snapshot: FooterSnapshot): boolean {
  Object.assign(state, snapshot);
  if (active) {
    resizeIfNeeded();
    syncActivityTicker();
    redraw();
    return true;
  }
  if (!process.stdout.isTTY) return false;
  const rows = process.stdout.rows || 0;
  const cols = process.stdout.columns || 0;
  if (rows < FOOTER_ROWS + 6 || cols < 40) return false;

  active = {
    rows,
    cols,
    scrollBottom: rows - FOOTER_ROWS,
    footerTop: rows - FOOTER_ROWS + 1,
  };
  process.stdout.write('\n');
  process.stdout.write(ANSI.scrollRegion(1, active.scrollBottom));
  process.stdout.write(ANSI.moveTo(active.scrollBottom, 1));
  syncActivityTicker();
  redraw();
  return true;
}

export function deactivateFooter(): void {
  if (!active) return;
  const current = active;
  process.stdout.write(ANSI.saveCursor);
  process.stdout.write(ANSI.resetScrollRegion);
  for (let row = current.footerTop; row <= current.rows; row++) {
    process.stdout.write(ANSI.moveTo(row, 1));
    process.stdout.write(ANSI.clearLine);
  }
  process.stdout.write(ANSI.restoreCursor);
  active = null;
  syncActivityTicker();
}

export function isFooterActive(): boolean {
  return active !== null;
}

export function updateFooter(snapshot: Partial<FooterSnapshot>): void {
  Object.assign(state, snapshot);
  if (!active) return;
  resizeIfNeeded();
  syncActivityTicker();
  redraw();
}

export function setFooterActivity(activity: string, turn = state.turn, startedAtMs: number | null = state.activityStartedAtMs): void {
  state.activity = activity || 'Ready';
  state.turn = turn;
  state.activityStartedAtMs = startedAtMs;
  state.activityFrame++;
  syncActivityTicker();
  if (active) redraw();
}

export function setFooterDraft(draft: string): void {
  state.draft = draft;
  if (active && !state.acceptingPrompt) redraw();
}

export interface FooterUsageDetails {
  sessionCost?: number;
  sessionTokens?: number;
  firstTokenMs?: number | null;
  durationMs?: number | null;
}

export function setFooterCost(
  cost: number,
  promptTokens: number,
  completionTokens: number,
  details: FooterUsageDetails = {},
): void {
  const summary = safeUsageSummary(state.sessionId);
  const last = summary?.last;
  const firstTokenMs = finiteMs(details.firstTokenMs) ?? finiteMs(last?.firstTokenMs);
  const durationMs = finiteMs(details.durationMs) ?? finiteMs(last?.durationMs);
  const sessionCost = details.sessionCost ?? summary?.session.cost ?? cost;
  const sessionTokens = details.sessionTokens ?? summary?.session.tokens ?? (promptTokens + completionTokens);
  state.lastCost = `$${cost.toFixed(4)}`;
  state.lastTokens = `${formatTokenCount(promptTokens)}->${formatTokenCount(completionTokens)} tokens`;
  state.sessionCost = `$${sessionCost.toFixed(4)}`;
  state.sessionTokens = `${formatTokenCount(sessionTokens)} tokens`;
  state.lastFirstToken = firstTokenMs === undefined ? '' : formatLatency(firstTokenMs);
  state.lastTurnLatency = durationMs === undefined ? '' : formatLatency(durationMs);
  state.budget = formatBudget();
  if (active) redraw();
}

export function prepareFooterPrompt(): boolean {
  if (!active) return false;
  state.acceptingPrompt = true;
  state.draft = '';
  resizeIfNeeded();
  redraw(false);
  process.stdout.write(ANSI.moveTo(active.footerTop + 2, 1));
  process.stdout.write(ANSI.clearLine);
  return true;
}

export async function askWithFooterPrompt(
  rl: readline.Interface,
  prefill = '',
  options: { echoSubmittedLine?: boolean } = {},
): Promise<string> {
  if (!prepareFooterPrompt()) {
    return rl.question(theme.prompt(PROMPT_PREFIX));
  }
  const echoSubmittedLine = options.echoSubmittedLine !== false;
  const answerPromise = rl.question(theme.prompt(PROMPT_PREFIX));
  if (prefill) {
    setImmediate(() => {
      const line = prefill.replace(/\r?\n/g, ' ');
      try {
        const rlAny = rl as unknown as { write?: (data: string) => void };
        if (typeof rlAny.write === 'function') rlAny.write(line);
      } catch {
        process.stdout.write(line);
      }
    });
  }
  const answer = await answerPromise;
  finishFooterPrompt(answer, echoSubmittedLine);
  return answer;
}

function finishFooterPrompt(answer: string, echoSubmittedLine: boolean): void {
  state.acceptingPrompt = false;
  state.draft = '';
  if (!active) return;
  if (echoSubmittedLine) {
    writeFooterSubmittedLine(answer);
  } else {
    process.stdout.write(ANSI.moveTo(active.scrollBottom, 1));
  }
  redraw();
}

export function writeFooterSubmittedLine(answer: string): void {
  if (!active) return;
  const trimmed = answer.replace(/\r?\n/g, ' ');
  if (trimmed.trim()) {
    writeScrollableLine(formatTranscriptUserLine(trimmed, active.cols));
    return;
  }
  process.stdout.write(ANSI.moveTo(active.scrollBottom, 1));
}

export function writeScrollableLine(line: string): void {
  if (!active) {
    process.stdout.write(line + '\n');
    return;
  }
  process.stdout.write(ANSI.moveTo(active.scrollBottom, 1));
  process.stdout.write(ANSI.clearLine);
  process.stdout.write(line + '\n');
}

function resizeIfNeeded(): void {
  if (!active || !process.stdout.isTTY) return;
  const rows = process.stdout.rows || active.rows;
  const cols = process.stdout.columns || active.cols;
  if (rows === active.rows && cols === active.cols) return;
  if (rows < FOOTER_ROWS + 6 || cols < 40) {
    deactivateFooter();
    return;
  }
  active = {
    rows,
    cols,
    scrollBottom: rows - FOOTER_ROWS,
    footerTop: rows - FOOTER_ROWS + 1,
  };
  process.stdout.write(ANSI.scrollRegion(1, active.scrollBottom));
}

function syncActivityTicker(): void {
  const shouldTick = active !== null && state.activityStartedAtMs !== null;
  if (shouldTick && !activityTicker) {
    activityTicker = setInterval(() => {
      if (!active || state.activityStartedAtMs === null) {
        syncActivityTicker();
        return;
      }
      state.activityFrame++;
      redraw();
    }, 500);
    // Keep referenced so elapsed/activity frames continue while awaiting
    // provider events; cleared immediately when activity ends.
  } else if (!shouldTick && activityTicker) {
    clearInterval(activityTicker);
    activityTicker = null;
  }
}

function redraw(restoreCursor = true): void {
  if (!active) return;
  const lines = footerLines(active.cols);
  if (restoreCursor) process.stdout.write(ANSI.saveCursor);
  for (let i = 0; i < FOOTER_ROWS; i++) {
    process.stdout.write(ANSI.moveTo(active.footerTop + i, 1));
    process.stdout.write(ANSI.clearLine);
    process.stdout.write(lines[i] || '');
  }
  if (restoreCursor) process.stdout.write(ANSI.restoreCursor);
}

function footerLines(cols: number): string[] {
  const status = state.template?.trim()
    ? renderTemplate(state.template)
    : `Provider ${state.provider}  |  Model ${state.model}  |  Permissions ${state.permissionMode}  |  Session ${sessionDisplay()}  |  v${state.version || getCurrentVersion()}`;
  const activity = renderActivity();
  const draft = state.draft.replace(/[\r\n]+/g, ' ');
  const prompt = state.acceptingPrompt
    ? ''
    : draft
      ? theme.prompt(PROMPT_PREFIX) + theme.command(clipAnsi(draft, Math.max(10, cols - PROMPT_PREFIX.length - 2))) + theme.prompt(' \u258a')
      : theme.prompt(PROMPT_PREFIX) + theme.prompt('\u258a ') + theme.dim('Type your message or @path/to/file');
  const columnWidths = footerColumnWidths(cols);
  const workspace = compactCwd(state.cwd);
  const sandbox = state.sandbox === 'off' ? 'no sandbox' : state.sandbox || 'no sandbox';
  const budget = state.budget || formatBudget();
  const latency = formatFooterLatency();
  const usageCore = `${state.sessionCost || '$0.0000'} | ${state.sessionTokens || '0 tokens'}`;
  const usage = [
    usageCore,
    latency,
    budget ? `budget ${budget}` : '',
  ].filter(Boolean).join(' | ');
  const labels = [
    'workspace',
    'sandbox',
    'mode',
    'cost/tokens',
  ];
  const values = [
    workspace.value,
    sandbox,
    state.mode,
    usage,
  ];
  return [
    theme.command(padLine(status, cols)),
    theme.command(padLine(`${activityGlyph()} ${activity}`, cols)),
    padLine(prompt, cols),
    theme.dim(joinColumns(labels, columnWidths, cols)),
    joinColumns([
      theme.primary(values[0]),
      state.sandbox === 'off' ? theme.warning(values[1]) : theme.success(values[1]),
      theme.command(values[2]),
      theme.cost(values[3]),
    ], columnWidths, cols),
  ];
}

function renderActivity(): string {
  if (state.activityStartedAtMs !== null) {
    const elapsed = Math.max(0, Date.now() - state.activityStartedAtMs);
    const detail = [
      formatDuration(elapsed),
      'Esc/F5 to interrupt',
      state.turn > 0 ? `turn ${state.turn}` : '',
    ].filter(Boolean).join(' • ');
    return `${state.activity} (${detail})`;
  }
  return state.activity || 'Ready';
}

function activityGlyph(): string {
  const frames = ['\u25dc', '\u25dd', '\u25de', '\u25df'];
  return state.activityStartedAtMs !== null ? frames[state.activityFrame % frames.length] : '\u25b6';
}

function renderTemplate(template: string): string {
  const usage = getUsageSummary(state.sessionId);
  const latency = formatFooterLatency();
  const values: Record<(typeof TEMPLATE_KEYS)[number], string> = {
    provider: state.provider,
    model: state.model,
    permissions: state.permissionMode,
    session: sessionDisplay(),
    cwd: state.cwd,
    workspace: compactCwd(state.cwd).value,
    sandbox: state.sandbox === 'off' ? 'no sandbox' : state.sandbox || 'no sandbox',
    mode: state.mode,
    cost: state.lastCost,
    tokens: state.lastTokens,
    sessioncost: state.sessionCost,
    sessiontokens: state.sessionTokens,
    latency,
    firsttoken: state.lastFirstToken,
    turnlatency: state.lastTurnLatency,
    budget: usage.budget.monthlyLimit > 0 ? `$${usage.budget.monthlyLimit}` : '',
    activity: renderActivity(),
    version: state.version || getCurrentVersion(),
  };
  return template.replace(/\{([a-z]+)\}/gi, (_match, key: string) => {
    const normalized = key.toLowerCase() as (typeof TEMPLATE_KEYS)[number];
    return normalized in values ? values[normalized] : `{${key}}`;
  });
}

function safeUsageSummary(sessionId?: string): ReturnType<typeof getUsageSummary> | null {
  try {
    return getUsageSummary(sessionId);
  } catch {
    return null;
  }
}

function formatBudget(): string {
  try {
    const usage = getUsageSummary();
    if (usage.budget.monthlyLimit > 0) return `$${usage.budget.monthlyLimit}`;
    if (usage.budget.dailyLimit > 0) return `$${usage.budget.dailyLimit}/day`;
  } catch {
    // best effort only
  }
  return '';
}

function formatTokenCount(n: number): string {
  return n > 999 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function finiteMs(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function formatLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function formatFooterLatency(): string {
  const bits: string[] = [];
  if (state.lastFirstToken) bits.push(`first ${state.lastFirstToken}`);
  if (state.lastTurnLatency) bits.push(`turn ${state.lastTurnLatency}`);
  return bits.join(' | ');
}

function sessionDisplay(): string {
  const name = (state.sessionName || '').trim();
  if (!name) return state.sessionId;
  return name.replace(/^Session\s+/i, '').trim() || name;
}

function footerColumnWidths(cols: number): number[] {
  const side = Math.max(10, Math.min(18, Math.floor(cols * 0.17)));
  const last = cols - side * 3;
  if (last >= 10) return [side, side, side, last];
  const equal = Math.max(8, Math.floor(cols / 4));
  return [equal, equal, equal, Math.max(8, cols - equal * 3)];
}

function compactCwd(cwd: string): { label: string; value: string } {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const normalized = home && cwd.toLowerCase().startsWith(home.toLowerCase())
    ? '~' + cwd.slice(home.length)
    : cwd;
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  const value = normalized === '~' ? '~' : parts.length > 0 ? parts.slice(-2).join('/') : normalized;
  return {
    label: value.length > 20 ? value.slice(0, 19) + '\u2026' : value,
    value: value || '~',
  };
}

function joinColumns(values: string[], columnWidths: number[] | number, cols: number): string {
  const widths = Array.isArray(columnWidths)
    ? columnWidths
    : values.map(() => columnWidths);
  return padLine(values.map((value, index) => {
    const width = widths[index] ?? widths.at(-1) ?? 12;
    return visiblePad(clipAnsi(value, width), width);
  }).join(''), cols);
}

function padLine(value: string, cols: number): string {
  const plainLength = visibleLength(value);
  const clipped = plainLength > cols ? clipAnsi(value, cols) : value;
  return clipped + ' '.repeat(Math.max(0, cols - visibleLength(clipped)));
}

function visiblePad(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - visibleLength(value)));
}

function visibleLength(value: string): number {
  return value.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function clipAnsi(value: string, width: number): string {
  const plain = value.replace(/\x1b\[[0-9;]*m/g, '');
  if (plain.length <= width) return value;
  const clipped = plain.slice(0, Math.max(0, width - 1)) + '\u2026';
  return chalk.reset(clipped);
}
