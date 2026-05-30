import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { globSync } from 'glob';
import type { Message } from './types.js';
import { getConfigDir } from './config.js';
import { deleteSession, generateSessionId, type Session } from './sessions.js';
import * as mempalace from './mempalace/index.js';

export type ImportSource = 'claude' | 'codex' | 'mempalace';
export type ImportKind = 'session' | 'drawer';

export interface ImportSourceStatus {
  source: ImportSource;
  detected: boolean;
  rootPath: string;
  artifactsFound: number;
  note?: string;
}

export interface ImportPreviewThread {
  sourcePath: string;
  sourceThreadId: string;
  name: string;
  cwd: string;
  model: string;
  provider: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImportPreview {
  source: ImportSource;
  artifactsFound: number;
  importableArtifacts: number;
  alreadyImportedArtifacts: number;
  totalMessages: number;
  threads: ImportPreviewThread[];
  warnings: string[];
}

export interface ImportRunResult {
  runId: string;
  source: ImportSource;
  importedArtifacts: number;
  skippedArtifacts: number;
  importedMessages: number;
  importedSessions: number;
  importedDrawers: number;
  warnings: string[];
}

export interface ImportRollbackResult {
  runId: string;
  deletedSessions: number;
  deletedDrawers: number;
  warnings: string[];
}

export interface ImportStatusSummary {
  ledgerEntries: number;
  runs: number;
  sessionsImported: number;
  drawersImported: number;
  bySource: Record<ImportSource, { sessions: number; drawers: number }>;
}

interface ImportRunManifest {
  runId: string;
  source: ImportSource;
  startedAt: string;
  finishedAt: string;
  createdSessionIds: string[];
  createdDrawerIds: string[];
}

interface ImportLedgerEntry {
  runId: string;
  source: ImportSource;
  kind: ImportKind;
  sourcePath: string;
  contentSha256: string;
  importedId: string;
  importedAt: string;
  messageCount?: number;
}

interface ParsedThread {
  sourcePath: string;
  sourceThreadId: string;
  name: string;
  cwd: string;
  model: string;
  provider: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  contentSha256: string;
}

interface ParsedDrawer {
  sourcePath: string;
  content: string;
  contentSha256: string;
  wing: string;
  room: string;
  tags: string[];
  importance: number;
}

interface ImportOptions {
  homeDir?: string;
  cwd?: string;
  limit?: number;
}

interface RunImportOptions extends ImportOptions {
  dryRun?: boolean;
}

interface ParseWarning {
  sourcePath: string;
  warning: string;
}

function homePath(homeDir?: string): string {
  return homeDir || homedir();
}

function importsDir(): string {
  return join(getConfigDir(), 'imports');
}

function ledgerPath(): string {
  return join(importsDir(), 'ledger.jsonl');
}

function runsDir(): string {
  return join(importsDir(), 'runs');
}

function sessionsDir(): string {
  return join(getConfigDir(), 'sessions');
}

function ensureImportDirs(): void {
  mkdirSync(importsDir(), { recursive: true });
  mkdirSync(runsDir(), { recursive: true });
}

function readJsonl(path: string): unknown[] {
  const out: unknown[] = [];
  const raw = readFileSync(path, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip malformed rows
    }
  }
  return out;
}

function toIsoDate(input: unknown): string | null {
  if (typeof input === 'number' && Number.isFinite(input)) {
    // Some histories store unix milliseconds.
    const ms = input > 2_000_000_000 ? input : input * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof input === 'string' && input.trim()) {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function flattenText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => flattenText(item)).filter(Boolean).join('\n');
  if (typeof value !== 'object') return String(value);
  const obj = value as Record<string, unknown>;
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.content === 'string') return obj.content;
  if (obj.content !== undefined) return flattenText(obj.content);
  return '';
}

function normalizeRole(rawRole: unknown): Message['role'] {
  const role = String(rawRole || '').toLowerCase();
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') return role;
  if (role === 'developer') return 'system';
  return 'system';
}

function pushMessage(messages: Message[], role: Message['role'], content: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;
  messages.push({ role, content: trimmed });
}

function parseClaudeThread(path: string): { thread: ParsedThread | null; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];
  const raw = readFileSync(path, 'utf-8');
  const rows = readJsonl(path);
  const messages: Message[] = [];
  let threadId = basename(path, '.jsonl');
  let cwd = process.cwd();
  let model = 'unknown';
  let provider = 'Claude';
  let createdAt: string | null = null;
  let updatedAt: string | null = null;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const ts = toIsoDate(r.timestamp);
    if (ts) {
      if (!createdAt) createdAt = ts;
      updatedAt = ts;
    }
    if (typeof r.sessionId === 'string' && r.sessionId.trim()) threadId = r.sessionId;
    if (typeof r.cwd === 'string' && r.cwd.trim()) cwd = r.cwd;

    if (r.type === 'user') {
      const msg = r.message as Record<string, unknown> | undefined;
      pushMessage(messages, 'user', flattenText(msg?.content));
      continue;
    }
    if (r.type === 'assistant') {
      const msg = r.message as Record<string, unknown> | undefined;
      const m = msg?.model;
      if (typeof m === 'string' && m.trim()) model = m;
      pushMessage(messages, 'assistant', flattenText(msg?.content));
      continue;
    }
    if (r.type === 'last-prompt') {
      pushMessage(messages, 'user', flattenText(r.lastPrompt));
      continue;
    }
  }

  if (messages.length === 0) {
    warnings.push({ sourcePath: path, warning: 'no importable messages found' });
    return { thread: null, warnings };
  }
  const nowIso = new Date().toISOString();
  const thread: ParsedThread = {
    sourcePath: path,
    sourceThreadId: threadId,
    name: `Claude ${threadId}`,
    cwd,
    model,
    provider,
    messages,
    createdAt: createdAt || nowIso,
    updatedAt: updatedAt || createdAt || nowIso,
    contentSha256: sha256(raw),
  };
  return { thread, warnings };
}

function parseCodexThread(path: string): { thread: ParsedThread | null; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];
  const raw = readFileSync(path, 'utf-8');
  const rows = readJsonl(path);
  const messages: Message[] = [];
  let threadId = basename(path, '.jsonl');
  let name = `Codex ${threadId}`;
  let cwd = process.cwd();
  let model = 'unknown';
  let provider = 'Codex';
  let createdAt: string | null = null;
  let updatedAt: string | null = null;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const ts = toIsoDate(r.timestamp);
    if (ts) {
      if (!createdAt) createdAt = ts;
      updatedAt = ts;
    }
    if (r.type === 'session_meta') {
      const payload = r.payload as Record<string, unknown> | undefined;
      if (typeof payload?.id === 'string' && payload.id.trim()) threadId = payload.id;
      if (typeof payload?.cwd === 'string' && payload.cwd.trim()) cwd = payload.cwd;
      if (typeof payload?.model_provider === 'string' && payload.model_provider.trim()) provider = payload.model_provider;
      continue;
    }
    if (r.type === 'turn_context') {
      const payload = r.payload as Record<string, unknown> | undefined;
      if (typeof payload?.model === 'string' && payload.model.trim()) model = payload.model;
      continue;
    }
    if (r.type !== 'response_item') continue;
    const payload = r.payload as Record<string, unknown> | undefined;
    if (!payload || payload.type !== 'message') continue;
    const role = normalizeRole(payload.role);
    const content = flattenText(payload.content);
    pushMessage(messages, role, content);
  }

  if (messages.length === 0) {
    warnings.push({ sourcePath: path, warning: 'no importable messages found' });
    return { thread: null, warnings };
  }
  name = name.slice(0, 120);
  const nowIso = new Date().toISOString();
  const thread: ParsedThread = {
    sourcePath: path,
    sourceThreadId: threadId,
    name,
    cwd,
    model,
    provider,
    messages,
    createdAt: createdAt || nowIso,
    updatedAt: updatedAt || createdAt || nowIso,
    contentSha256: sha256(raw),
  };
  return { thread, warnings };
}

function parseMempalaceDrawers(homeDir: string): { drawers: ParsedDrawer[]; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];
  const roots = [
    join(homeDir, '.mempalace', 'session_notes'),
    join(homeDir, '.mempalace', 'identity.txt'),
  ];
  const mdFiles = existsSync(roots[0])
    ? globSync('**/*.{md,markdown,txt}', { cwd: roots[0], absolute: true, nodir: true })
    : [];
  const files = [...mdFiles];
  if (existsSync(roots[1])) files.push(roots[1]);
  const drawers: ParsedDrawer[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8').trim();
      if (!content) continue;
      drawers.push({
        sourcePath: file,
        content,
        contentSha256: sha256(content),
        wing: 'imports',
        room: 'mempalace',
        tags: ['import', 'source:mempalace', `file:${basename(file).toLowerCase()}`],
        importance: 0.55,
      });
    } catch {
      warnings.push({ sourcePath: file, warning: 'failed to read file' });
    }
  }
  return { drawers, warnings };
}

function readLedger(): ImportLedgerEntry[] {
  const path = ledgerPath();
  if (!existsSync(path)) return [];
  const rows = readJsonl(path);
  const out: ImportLedgerEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Partial<ImportLedgerEntry>;
    if (!r.runId || !r.source || !r.kind || !r.sourcePath || !r.contentSha256 || !r.importedId || !r.importedAt) continue;
    out.push({
      runId: r.runId,
      source: r.source,
      kind: r.kind,
      sourcePath: r.sourcePath,
      contentSha256: r.contentSha256,
      importedId: r.importedId,
      importedAt: r.importedAt,
      messageCount: r.messageCount,
    });
  }
  return out;
}

function appendLedger(rows: ImportLedgerEntry[]): void {
  if (rows.length === 0) return;
  ensureImportDirs();
  const payload = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  if (!existsSync(ledgerPath())) {
    writeFileSync(ledgerPath(), payload, 'utf-8');
    return;
  }
  const prev = readFileSync(ledgerPath(), 'utf-8');
  writeFileSync(ledgerPath(), prev + payload, 'utf-8');
}

function persistedSessionPath(sessionId: string): string {
  return join(sessionsDir(), `${sessionId}.json`);
}

function persistImportedSession(thread: ParsedThread): string {
  const id = generateSessionId();
  mkdirSync(sessionsDir(), { recursive: true });
  const session: Session = {
    id,
    name: thread.name,
    cwd: thread.cwd,
    model: thread.model,
    provider: thread.provider,
    messages: thread.messages,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    tokenCount: 0,
    turnCount: thread.messages.filter((m) => m.role === 'user').length,
    mode: 'dev',
  };
  writeFileSync(persistedSessionPath(id), JSON.stringify(session, null, 2), 'utf-8');
  return id;
}

function saveRunManifest(manifest: ImportRunManifest): void {
  ensureImportDirs();
  writeFileSync(join(runsDir(), `${manifest.runId}.json`), JSON.stringify(manifest, null, 2), 'utf-8');
}

function sourceRoots(homeDir: string): Record<ImportSource, string> {
  return {
    claude: join(homeDir, '.claude'),
    codex: join(homeDir, '.codex'),
    mempalace: join(homeDir, '.mempalace'),
  };
}

function sourceFiles(source: ImportSource, homeDir: string): string[] {
  const roots = sourceRoots(homeDir);
  if (source === 'claude') {
    const cwd = join(roots.claude, 'projects');
    if (!existsSync(cwd)) return [];
    return globSync('**/*.jsonl', { cwd, absolute: true, nodir: true });
  }
  if (source === 'codex') {
    const cwd = join(roots.codex, 'sessions');
    if (!existsSync(cwd)) return [];
    return globSync('**/*.jsonl', { cwd, absolute: true, nodir: true });
  }
  const notes = join(roots.mempalace, 'session_notes');
  const out: string[] = [];
  if (existsSync(notes)) out.push(...globSync('**/*.{md,markdown,txt}', { cwd: notes, absolute: true, nodir: true }));
  const identity = join(roots.mempalace, 'identity.txt');
  if (existsSync(identity)) out.push(identity);
  return out;
}

function parseThreads(source: ImportSource, homeDir: string): { threads: ParsedThread[]; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];
  const files = sourceFiles(source, homeDir);
  const threads: ParsedThread[] = [];
  if (source === 'mempalace') return { threads, warnings };
  for (const file of files) {
    const parsed = source === 'claude' ? parseClaudeThread(file) : parseCodexThread(file);
    warnings.push(...parsed.warnings);
    if (parsed.thread) threads.push(parsed.thread);
  }
  threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { threads, warnings };
}

function ledgerKey(source: ImportSource, kind: ImportKind, sourcePath: string, contentSha256: string): string {
  return `${source}:${kind}:${sourcePath}:${contentSha256}`;
}

export function scanImportSources(options: ImportOptions = {}): ImportSourceStatus[] {
  const homeDir = homePath(options.homeDir);
  const roots = sourceRoots(homeDir);
  return (['claude', 'codex', 'mempalace'] as const).map((source) => {
    const rootPath = roots[source];
    const detected = existsSync(rootPath);
    const artifactsFound = detected ? sourceFiles(source, homeDir).length : 0;
    let note = '';
    if (detected && artifactsFound === 0) note = 'installed but no importable artifacts found';
    if (!detected) note = 'not detected';
    return { source, detected, rootPath, artifactsFound, note };
  });
}

export function previewImport(source: ImportSource, options: ImportOptions = {}): ImportPreview {
  const homeDir = homePath(options.homeDir);
  const limit = Math.max(1, Math.min(options.limit ?? 20, 200));
  const ledger = readLedger();
  const known = new Set(ledger.map((row) => ledgerKey(row.source, row.kind, row.sourcePath, row.contentSha256)));
  if (source === 'mempalace') {
    const parsed = parseMempalaceDrawers(homeDir);
    let already = 0;
    let totalImportable = 0;
    for (const drawer of parsed.drawers) {
      const k = ledgerKey(source, 'drawer', drawer.sourcePath, drawer.contentSha256);
      if (known.has(k)) already++;
      else totalImportable++;
    }
    return {
      source,
      artifactsFound: parsed.drawers.length,
      importableArtifacts: totalImportable,
      alreadyImportedArtifacts: already,
      totalMessages: 0,
      threads: [],
      warnings: parsed.warnings.map((w) => `${w.sourcePath}: ${w.warning}`),
    };
  }

  const parsed = parseThreads(source, homeDir);
  let already = 0;
  let totalImportable = 0;
  let totalMessages = 0;
  const threads: ImportPreviewThread[] = [];
  for (const thread of parsed.threads.slice(0, limit)) {
    const k = ledgerKey(source, 'session', thread.sourcePath, thread.contentSha256);
    if (known.has(k)) already++;
    else totalImportable++;
    totalMessages += thread.messages.length;
    threads.push({
      sourcePath: thread.sourcePath,
      sourceThreadId: thread.sourceThreadId,
      name: thread.name,
      cwd: thread.cwd,
      model: thread.model,
      provider: thread.provider,
      messageCount: thread.messages.length,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    });
  }
  return {
    source,
    artifactsFound: parsed.threads.length,
    importableArtifacts: totalImportable,
    alreadyImportedArtifacts: already,
    totalMessages,
    threads,
    warnings: parsed.warnings.map((w) => `${w.sourcePath}: ${w.warning}`),
  };
}

export function runImport(source: ImportSource, options: RunImportOptions = {}): ImportRunResult {
  const homeDir = homePath(options.homeDir);
  const cwd = options.cwd || process.cwd();
  const limit = Math.max(1, Math.min(options.limit ?? 1000, 10_000));
  const dryRun = options.dryRun === true;
  const runId = `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const ledger = readLedger();
  const known = new Set(ledger.map((row) => ledgerKey(row.source, row.kind, row.sourcePath, row.contentSha256)));
  const newLedgerRows: ImportLedgerEntry[] = [];
  const warnings: string[] = [];
  const createdSessionIds: string[] = [];
  const createdDrawerIds: string[] = [];
  let importedArtifacts = 0;
  let skippedArtifacts = 0;
  let importedMessages = 0;
  let importedSessions = 0;
  let importedDrawers = 0;

  if (source === 'mempalace') {
    const parsed = parseMempalaceDrawers(homeDir);
    warnings.push(...parsed.warnings.map((w) => `${w.sourcePath}: ${w.warning}`));
    for (const drawer of parsed.drawers.slice(0, limit)) {
      const key = ledgerKey(source, 'drawer', drawer.sourcePath, drawer.contentSha256);
      if (known.has(key)) {
        skippedArtifacts++;
        continue;
      }
      importedArtifacts++;
      if (dryRun) continue;
      const saved = mempalace.addDrawer({
        wing: drawer.wing,
        room: drawer.room,
        content: drawer.content,
        tags: drawer.tags,
        importance: drawer.importance,
        scope: 'global',
        cwd,
        sourceSessionId: runId,
      });
      createdDrawerIds.push(saved.id);
      importedDrawers++;
      newLedgerRows.push({
        runId,
        source,
        kind: 'drawer',
        sourcePath: drawer.sourcePath,
        contentSha256: drawer.contentSha256,
        importedId: saved.id,
        importedAt: new Date().toISOString(),
      });
    }
  } else {
    const parsed = parseThreads(source, homeDir);
    warnings.push(...parsed.warnings.map((w) => `${w.sourcePath}: ${w.warning}`));
    for (const thread of parsed.threads.slice(0, limit)) {
      const key = ledgerKey(source, 'session', thread.sourcePath, thread.contentSha256);
      if (known.has(key)) {
        skippedArtifacts++;
        continue;
      }
      importedArtifacts++;
      importedMessages += thread.messages.length;
      if (dryRun) continue;
      const sessionId = persistImportedSession(thread);
      createdSessionIds.push(sessionId);
      importedSessions++;
      newLedgerRows.push({
        runId,
        source,
        kind: 'session',
        sourcePath: thread.sourcePath,
        contentSha256: thread.contentSha256,
        importedId: sessionId,
        importedAt: new Date().toISOString(),
        messageCount: thread.messages.length,
      });
    }
  }

  if (!dryRun) {
    appendLedger(newLedgerRows);
    saveRunManifest({
      runId,
      source,
      startedAt,
      finishedAt: new Date().toISOString(),
      createdSessionIds,
      createdDrawerIds,
    });
  }

  return {
    runId,
    source,
    importedArtifacts,
    skippedArtifacts,
    importedMessages,
    importedSessions,
    importedDrawers,
    warnings,
  };
}

export function rollbackImport(runId: string, cwd = process.cwd()): ImportRollbackResult {
  const warnings: string[] = [];
  const path = join(runsDir(), `${runId}.json`);
  if (!existsSync(path)) {
    return { runId, deletedSessions: 0, deletedDrawers: 0, warnings: ['run id not found'] };
  }
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as ImportRunManifest;
  let deletedSessions = 0;
  let deletedDrawers = 0;

  for (const id of parsed.createdSessionIds || []) {
    if (deleteSession(id)) deletedSessions++;
  }
  for (const id of parsed.createdDrawerIds || []) {
    const removed = mempalace.getGlobalStore().deleteDrawer(id)
      || mempalace.getProjectStore(cwd).deleteDrawer(id);
    if (removed) deletedDrawers++;
  }

  // Remove ledger entries for this run.
  const kept = readLedger().filter((row) => row.runId !== runId);
  ensureImportDirs();
  const payload = kept.map((row) => JSON.stringify(row)).join('\n');
  writeFileSync(ledgerPath(), payload ? payload + '\n' : '', 'utf-8');
  try { rmSync(path, { force: true }); } catch { warnings.push('failed to remove run manifest'); }

  return { runId, deletedSessions, deletedDrawers, warnings };
}

export function importStatus(): ImportStatusSummary {
  const rows = readLedger();
  const bySource: ImportStatusSummary['bySource'] = {
    claude: { sessions: 0, drawers: 0 },
    codex: { sessions: 0, drawers: 0 },
    mempalace: { sessions: 0, drawers: 0 },
  };
  const runs = new Set<string>();
  let sessionsImported = 0;
  let drawersImported = 0;
  for (const row of rows) {
    runs.add(row.runId);
    if (row.kind === 'session') {
      sessionsImported++;
      bySource[row.source].sessions++;
    } else {
      drawersImported++;
      bySource[row.source].drawers++;
    }
  }
  return {
    ledgerEntries: rows.length,
    runs: runs.size,
    sessionsImported,
    drawersImported,
    bySource,
  };
}

export const _internal = {
  parseClaudeThread,
  parseCodexThread,
  parseMempalaceDrawers,
  readLedger,
  ledgerKey,
};

