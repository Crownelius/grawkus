/**
 * MemPalace — high-level API.
 *
 * Combines the global (cross-project) and project (per-repo) stores into
 * one façade. Most callers use these functions rather than poking the
 * JsonStore directly because they handle the scope selection:
 *
 *   - Reads with scope: 'both' search both stores and merge results
 *   - Writes with scope: 'global' or 'project' target one
 *   - Writes with scope: 'both' rejected at runtime — every drawer lives
 *     in exactly one store
 *
 * This module is the boundary between the storage internals (types.ts,
 * store.ts, search.ts) and the agent-facing tools (src/tools/memory.ts)
 * + slash commands.
 */

import { existsSync, readFileSync } from 'node:fs';
import { JsonStore, globalStorePath, projectStorePath } from './store.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  Drawer, Tunnel, KGTriple, Scope, SearchOptions, SearchHit, WingMeta, RoomMeta,
} from './types.js';

type WriteScope = Exclude<Scope, 'both'>;

// Lazily-constructed singletons — we don't want to create the global file
// just by importing the module. They materialize on first read or write.
let _global: JsonStore | null = null;
let _project: JsonStore | null = null;
let _projectCwd: string | null = null;

export function getGlobalStore(): JsonStore {
  if (!_global) _global = new JsonStore(globalStorePath(), 'global');
  return _global;
}

/**
 * Is MemPalace enabled in the user's config? Read directly from
 * ~/.grawkus/config.json so this can be checked at module-load
 * time by src/tools/index.ts without creating an import cycle through
 * src/config.ts (which imports types.ts which we import here).
 *
 * Resolves the dir manually (same priority as config.ts) instead of
 * importing getHomeStateDir to keep this side of the import graph free
 * of side-effecting modules.
 *
 * Treats missing config / missing memory block / undefined enabled as
 * TRUE (default-on for the featured capability). Only explicit false
 * disables.
 */
export function isMemoryEnabled(): boolean {
  try {
    const cfgDir =
      process.env.GRAWKUS_HOME ||
      join(homedir(), '.grawkus');
    const cfgPath = join(cfgDir, 'config.json');
    if (!existsSync(cfgPath)) return true;
    const raw = readFileSync(cfgPath, 'utf-8');
    const cfg = JSON.parse(raw) as { memory?: { enabled?: boolean } };
    return cfg.memory?.enabled !== false;
  } catch {
    return true;
  }
}

/**
 * Per-project store keyed by `cwd`. If the cwd changes mid-session (the
 * user `/cd`s elsewhere), the next call gets a fresh store pointing at
 * the new location. The old one stays valid for any held references.
 */
export function getProjectStore(cwd: string): JsonStore {
  if (!_project || _projectCwd !== cwd) {
    _project = new JsonStore(projectStorePath(cwd), 'project');
    _projectCwd = cwd;
  }
  return _project;
}

/**
 * Heuristic: should a piece of content live in the global or project
 * store? Used when the agent calls memory_add with scope: 'auto'.
 *
 * Signals pushing GLOBAL: content mentions the user by name, talks about
 * preferences, recurring patterns, identity, or cross-project facts.
 * Default lean is PROJECT since per-repo facts dominate by volume.
 */
export function inferScope(content: string, tags: string[]): Scope {
  const lc = content.toLowerCase();
  const tagsLc = tags.map((t) => t.toLowerCase());

  // User-modeling signals → global
  const userKeywords = [
    'i prefer', 'i like', 'i always', 'i never', 'the user',
    'my style', 'my workflow', 'rsfit',
  ];
  for (const k of userKeywords) {
    if (lc.includes(k)) return 'global';
  }
  if (tagsLc.some((t) => ['preference', 'user', 'identity', 'workflow'].includes(t))) {
    return 'global';
  }

  // Default: project-scoped. Codebase-specific facts outnumber cross-
  // project facts in most workflows.
  return 'project';
}

// ── Drawer operations ─────────────────────────────────────
export interface AddDrawerInput {
  wing: string;
  room: string;
  content: string;
  tags?: string[];
  importance?: number;
  scope?: WriteScope | 'auto';
  sourceSessionId?: string;
  cwd: string;            // required for project-scoped writes
}

export function addDrawer(input: AddDrawerInput): Drawer {
  const tags = input.tags || [];
  const resolvedScope = resolveWriteScope(input.scope, input.content, tags);

  const store = resolvedScope === 'global' ? getGlobalStore() : getProjectStore(input.cwd);
  return store.addDrawer({
    wing: input.wing,
    room: input.room,
    content: input.content,
    tags,
    importance: input.importance ?? 0.5,
    sourceSessionId: input.sourceSessionId,
  });
}

function resolveWriteScope(scope: AddDrawerInput['scope'], content: string, tags: string[]): WriteScope {
  if (scope === undefined || scope === 'auto') return inferScope(content, tags) as WriteScope;
  if (scope === 'global' || scope === 'project') return scope;
  throw new Error(`Invalid memory write scope "${String(scope)}"; use "global", "project", or "auto".`);
}

export function getDrawer(id: string, cwd: string): Drawer | null {
  return getGlobalStore().getDrawer(id) ?? getProjectStore(cwd).getDrawer(id);
}

export function listDrawers(opts: { wing?: string; room?: string; tag?: string; scope?: Scope; cwd: string }): Drawer[] {
  const { wing, room, tag, cwd, scope = 'both' } = opts;
  const filter = { wing, room, tag };
  if (scope === 'global') return getGlobalStore().listDrawers(filter);
  if (scope === 'project') return getProjectStore(cwd).listDrawers(filter);
  return [...getGlobalStore().listDrawers(filter), ...getProjectStore(cwd).listDrawers(filter)];
}

// ── Search (the main agent-facing query) ──────────────────
/**
 * Search both stores by default and merge results, re-sorted by score.
 * Specify scope to limit to one. Returns the top `limit` hits across
 * the union.
 */
export function search(query: string, cwd: string, opts: SearchOptions = {}): SearchHit[] {
  const scope = opts.scope ?? 'both';
  const limit = opts.limit ?? 20;

  const hits: SearchHit[] = [];
  if (scope === 'global' || scope === 'both') {
    hits.push(...getGlobalStore().search(query, { ...opts, limit: limit * 2 }));
  }
  if (scope === 'project' || scope === 'both') {
    hits.push(...getProjectStore(cwd).search(query, { ...opts, limit: limit * 2 }));
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

// ── Tunnels (drawer relationships) ────────────────────────
/**
 * Link two drawers with a labelled relation. Both drawers must live in
 * the same store — we don't cross global ↔ project boundaries because
 * the link would silently break if either side is moved/deleted.
 */
export function linkDrawers(
  fromId: string,
  toId: string,
  relation: string,
  cwd: string,
): Tunnel {
  // Try both stores to find the source drawer's scope
  if (getGlobalStore().getDrawer(fromId)) {
    if (!getGlobalStore().getDrawer(toId)) {
      throw new Error(`linkDrawers: ${toId} not found in global scope (cross-scope tunnels not supported)`);
    }
    return getGlobalStore().addTunnel(fromId, toId, relation);
  }
  if (getProjectStore(cwd).getDrawer(fromId)) {
    if (!getProjectStore(cwd).getDrawer(toId)) {
      throw new Error(`linkDrawers: ${toId} not found in project scope (cross-scope tunnels not supported)`);
    }
    return getProjectStore(cwd).addTunnel(fromId, toId, relation);
  }
  throw new Error(`linkDrawers: source drawer ${fromId} not found in either scope`);
}

export function traverseTunnels(
  startId: string,
  cwd: string,
  maxDepth = 3,
): { drawer: Drawer; depth: number; via: string[] }[] {
  // Detect which scope the start drawer lives in
  if (getGlobalStore().getDrawer(startId)) {
    return getGlobalStore().traverse(startId, maxDepth);
  }
  return getProjectStore(cwd).traverse(startId, maxDepth);
}

// ── Knowledge graph ───────────────────────────────────────
export function kgAdd(
  triple: { subject: string; predicate: string; object: string; confidence?: number; sourceSessionId?: string; sourceDrawerId?: string },
  scope: Scope,
  cwd: string,
): KGTriple {
  if (scope === 'both') throw new Error('kgAdd: scope must be global or project');
  const store = scope === 'global' ? getGlobalStore() : getProjectStore(cwd);
  return store.addTriple({
    subject: triple.subject,
    predicate: triple.predicate,
    object: triple.object,
    confidence: triple.confidence ?? 1.0,
    sourceSessionId: triple.sourceSessionId,
    sourceDrawerId: triple.sourceDrawerId,
  });
}

export function kgQuery(
  q: { subject?: string; predicate?: string; object?: string; asOf?: string | 'all' },
  cwd: string,
  scope: Scope = 'both',
): KGTriple[] {
  const out: KGTriple[] = [];
  if (scope === 'global' || scope === 'both') out.push(...getGlobalStore().queryTriples(q));
  if (scope === 'project' || scope === 'both') out.push(...getProjectStore(cwd).queryTriples(q));
  return out;
}

/**
 * Invalidate a triple by id — finds it in whichever scope owns it,
 * sets validTo. Use for "this fact stopped being true" without
 * deleting historical record.
 */
export function kgInvalidate(id: string, cwd: string, endedAt?: string): KGTriple | null {
  const g = getGlobalStore();
  if (g.getDrawer(id) !== null || g.queryTriples({ asOf: 'all' }).some((t) => t.id === id)) {
    try { return g.invalidateTriple(id, endedAt); } catch { /* try project */ }
  }
  return getProjectStore(cwd).invalidateTriple(id, endedAt);
}

// ── Diary (MemPalace audit item 3) ───────────────────────
/**
 * Per-agent timestamped journal. Stored as drawers with
 * wing="diary", room=`agent_<name>`, tags including the agent name.
 *
 * MemPalace's hard-won lesson: lowercase the agent name on both
 * write and read so "Claude" and "claude" don't silently store/return
 * disjoint sets.
 */
export function diaryWrite(opts: {
  agentName: string;
  entry: string;
  topic?: string;
  cwd: string;
  sourceSessionId?: string;
}): Drawer {
  const agent = opts.agentName.toLowerCase().trim();
  const tags = ['diary', `agent:${agent}`];
  if (opts.topic) tags.push(`topic:${opts.topic.toLowerCase().trim()}`);
  return addDrawer({
    wing: 'diary',
    room: `agent_${agent}`,
    content: opts.entry,
    tags,
    importance: 0.4,
    scope: 'global',
    sourceSessionId: opts.sourceSessionId,
    cwd: opts.cwd,
  });
}

export function diaryRead(opts: { agentName: string; lastN?: number; cwd: string }): Drawer[] {
  const agent = opts.agentName.toLowerCase().trim();
  const drawers = listDrawers({
    wing: 'diary',
    room: `agent_${agent}`,
    scope: 'global',
    cwd: opts.cwd,
  });
  // Most-recent-first
  drawers.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return drawers.slice(0, opts.lastN ?? 20);
}

export function kgTimeline(cwd: string, limit = 20, scope: Scope = 'both'): KGTriple[] {
  const out: KGTriple[] = [];
  if (scope === 'global' || scope === 'both') out.push(...getGlobalStore().recentTriples(limit * 2));
  if (scope === 'project' || scope === 'both') out.push(...getProjectStore(cwd).recentTriples(limit * 2));
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out.slice(0, limit);
}

// ── Inventory / status ────────────────────────────────────
export function listWings(cwd: string, scope: Scope = 'both'): { global: WingMeta[]; project: WingMeta[] } {
  return {
    global: scope !== 'project' ? getGlobalStore().listWings() : [],
    project: scope !== 'global' ? getProjectStore(cwd).listWings() : [],
  };
}

export function listRooms(cwd: string, wing?: string, scope: Scope = 'both'): { global: RoomMeta[]; project: RoomMeta[] } {
  return {
    global: scope !== 'project' ? getGlobalStore().listRooms(wing) : [],
    project: scope !== 'global' ? getProjectStore(cwd).listRooms(wing) : [],
  };
}

export function stats(cwd: string): {
  global: ReturnType<JsonStore['stats']>;
  project: ReturnType<JsonStore['stats']>;
  globalPath: string;
  projectPath: string;
  projectExists: boolean;
} {
  return {
    global: getGlobalStore().stats(),
    project: getProjectStore(cwd).stats(),
    globalPath: globalStorePath(),
    projectPath: projectStorePath(cwd),
    projectExists: existsSync(projectStorePath(cwd)),
  };
}

// Re-exports for callers that need the raw types
export type { Drawer, Tunnel, KGTriple, Scope, SearchHit, SearchOptions, WingMeta, RoomMeta } from './types.js';
