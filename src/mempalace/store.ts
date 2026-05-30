/**
 * MemPalace storage layer.
 *
 * Each store is a single JSON file written atomically (tmp file + rename)
 * so a crashed write can't corrupt the existing state. The choice of JSON-
 * over-SQLite is deliberate for v1: zero native dependencies, trivial to
 * inspect by hand, no migration story needed for npm-published CLI.
 *
 * The Store interface is the swappable seam — when we outgrow JSON (>~10k
 * drawers, slow search) we replace the implementation with SQLite/FTS5 or
 * a vector store without touching callers.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  Drawer, Tunnel, KGTriple, StoreState, Scope,
  WingMeta, RoomMeta, SearchOptions, SearchHit,
} from './types.js';
import { SCHEMA_VERSION } from './types.js';
import { searchDrawers } from './search.js';
import { getHomeStateDir, getProjectStateDir } from '../config.js';

// ── Paths ─────────────────────────────────────────────────
/** ~/.grawkus/memory/store.json — cross-project knowledge */
export function globalStorePath(): string {
  return join(getHomeStateDir(), 'memory', 'store.json');
}
/** <cwd>/.grawkus/memory/store.json — per-repo knowledge */
export function projectStorePath(cwd: string): string {
  return join(getProjectStateDir(cwd), 'memory', 'store.json');
}

// ── ID generation ─────────────────────────────────────────
/**
 * Time-ordered ID: hex timestamp + 8 random hex chars. Sorts naturally by
 * creation time, no UUID library needed. ~96 bits of entropy total which
 * is overkill for a single-user store but keeps collision chances at
 * effective zero even across machines.
 */
export function newId(prefix: string): string {
  const ts = Date.now().toString(16).padStart(11, '0');
  const rand = randomBytes(4).toString('hex');
  return `${prefix}_${ts}${rand}`;
}

// ── Atomic JSON read/write ────────────────────────────────
function readState(path: string): StoreState {
  if (!existsSync(path)) {
    return { schemaVersion: SCHEMA_VERSION, drawers: [], tunnels: [], triples: [] };
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as StoreState;
    // Defensive: future schema migrations would dispatch on parsed.schemaVersion here
    return {
      schemaVersion: parsed.schemaVersion ?? SCHEMA_VERSION,
      drawers: parsed.drawers ?? [],
      tunnels: parsed.tunnels ?? [],
      triples: parsed.triples ?? [],
    };
  } catch {
    // Corrupted store — log and return empty so we don't crash the agent.
    // The bad file is preserved alongside as .corrupt for forensic recovery.
    try { renameSync(path, path + '.corrupt-' + Date.now()); } catch { /* noop */ }
    return { schemaVersion: SCHEMA_VERSION, drawers: [], tunnels: [], triples: [] };
  }
}

function writeState(path: string, state: StoreState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp-' + process.pid;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  try {
    renameSync(tmp, path);
  } catch (e) {
    // On some Windows filesystems renaming over an existing file can fail.
    // Fall back to unlink + rename.
    try { unlinkSync(path); } catch { /* noop */ }
    renameSync(tmp, path);
  }
}

// ── Store class ───────────────────────────────────────────
/**
 * A single-file MemPalace store backed by JSON. Mutations are immediately
 * persisted to disk — there's no in-memory cache to flush. Trades a small
 * amount of throughput for crash safety, which matters more for a memory
 * system.
 */
export class JsonStore {
  constructor(private readonly path: string, public readonly scope: Scope) {}

  private read(): StoreState { return readState(this.path); }
  private write(s: StoreState): void { writeState(this.path, s); }

  // ── Drawers ───────────────────────────────────────────
  addDrawer(input: Omit<Drawer, 'id' | 'createdAt' | 'updatedAt' | 'scope'>): Drawer {
    const now = new Date().toISOString();
    const drawer: Drawer = {
      id: newId('drw'),
      createdAt: now,
      updatedAt: now,
      scope: this.scope,
      ...input,
      // Defensive normalization
      tags: (input.tags || []).map((t) => t.toLowerCase().trim()).filter(Boolean),
      importance: clamp01(input.importance ?? 0.5),
      wing: input.wing.toLowerCase().trim(),
      room: input.room.toLowerCase().trim(),
    };
    const state = this.read();
    state.drawers.push(drawer);
    this.write(state);
    return drawer;
  }

  getDrawer(id: string): Drawer | null {
    return this.read().drawers.find((d) => d.id === id) || null;
  }

  updateDrawer(id: string, patch: Partial<Omit<Drawer, 'id' | 'createdAt' | 'scope'>>): Drawer | null {
    const state = this.read();
    const idx = state.drawers.findIndex((d) => d.id === id);
    if (idx < 0) return null;
    const updated: Drawer = {
      ...state.drawers[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
      tags: patch.tags
        ? patch.tags.map((t) => t.toLowerCase().trim()).filter(Boolean)
        : state.drawers[idx].tags,
      importance: patch.importance !== undefined ? clamp01(patch.importance) : state.drawers[idx].importance,
    };
    state.drawers[idx] = updated;
    this.write(state);
    return updated;
  }

  deleteDrawer(id: string): boolean {
    const state = this.read();
    const before = state.drawers.length;
    state.drawers = state.drawers.filter((d) => d.id !== id);
    // Cascade: drop tunnels touching this drawer + triples sourced from it
    state.tunnels = state.tunnels.filter(
      (t) => t.fromDrawerId !== id && t.toDrawerId !== id,
    );
    state.triples = state.triples.filter((t) => t.sourceDrawerId !== id);
    const removed = state.drawers.length < before;
    if (removed) this.write(state);
    return removed;
  }

  listDrawers(filter: { wing?: string; room?: string; tag?: string } = {}): Drawer[] {
    let drawers = this.read().drawers;
    if (filter.wing) drawers = drawers.filter((d) => d.wing === filter.wing!.toLowerCase());
    if (filter.room) drawers = drawers.filter((d) => d.room === filter.room!.toLowerCase());
    if (filter.tag) drawers = drawers.filter((d) => d.tags.includes(filter.tag!.toLowerCase()));
    return drawers;
  }

  // ── Wings + Rooms (derived views) ─────────────────────
  listWings(): WingMeta[] {
    const drawers = this.read().drawers;
    const byWing = new Map<string, { rooms: Set<string>; count: number }>();
    for (const d of drawers) {
      const entry = byWing.get(d.wing) ?? { rooms: new Set(), count: 0 };
      entry.rooms.add(d.room);
      entry.count++;
      byWing.set(d.wing, entry);
    }
    return [...byWing.entries()]
      .map(([name, v]) => ({ name, rooms: [...v.rooms].sort(), drawerCount: v.count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  listRooms(wing?: string): RoomMeta[] {
    const drawers = this.read().drawers;
    const filtered = wing ? drawers.filter((d) => d.wing === wing.toLowerCase()) : drawers;
    const byRoom = new Map<string, { wing: string; count: number; lastTouched: string }>();
    for (const d of filtered) {
      const key = `${d.wing}/${d.room}`;
      const entry = byRoom.get(key) ?? { wing: d.wing, count: 0, lastTouched: d.updatedAt };
      entry.count++;
      if (d.updatedAt > entry.lastTouched) entry.lastTouched = d.updatedAt;
      byRoom.set(key, entry);
    }
    return [...byRoom.entries()]
      .map(([key, v]) => ({
        wing: v.wing,
        name: key.split('/')[1],
        drawerCount: v.count,
        lastTouched: v.lastTouched,
      }))
      .sort((a, b) => b.lastTouched.localeCompare(a.lastTouched));
  }

  // ── Tunnels (drawer relationships) ────────────────────
  addTunnel(fromDrawerId: string, toDrawerId: string, relation: string): Tunnel {
    const tunnel: Tunnel = {
      id: newId('tun'),
      fromDrawerId,
      toDrawerId,
      relation: relation.toLowerCase().trim(),
      createdAt: new Date().toISOString(),
      scope: this.scope,
    };
    const state = this.read();
    state.tunnels.push(tunnel);
    this.write(state);
    return tunnel;
  }

  /**
   * Find all tunnels touching a drawer, in either direction. Useful for
   * "what is this drawer related to?" queries.
   */
  findTunnels(drawerId: string): { outgoing: Tunnel[]; incoming: Tunnel[] } {
    const tunnels = this.read().tunnels;
    return {
      outgoing: tunnels.filter((t) => t.fromDrawerId === drawerId),
      incoming: tunnels.filter((t) => t.toDrawerId === drawerId),
    };
  }

  /**
   * Walk outgoing tunnels from a start drawer for up to maxDepth hops,
   * returning every drawer reached and the path that got us there.
   * Bounded by visited-set so cycles don't loop forever.
   */
  traverse(startId: string, maxDepth = 3): { drawer: Drawer; depth: number; via: string[] }[] {
    const state = this.read();
    const drawerById = new Map(state.drawers.map((d) => [d.id, d]));
    const tunnelsByFrom = new Map<string, Tunnel[]>();
    for (const t of state.tunnels) {
      const arr = tunnelsByFrom.get(t.fromDrawerId) ?? [];
      arr.push(t);
      tunnelsByFrom.set(t.fromDrawerId, arr);
    }

    const visited = new Set<string>();
    const results: { drawer: Drawer; depth: number; via: string[] }[] = [];
    const queue: { id: string; depth: number; via: string[] }[] = [{ id: startId, depth: 0, via: [] }];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);

      const drawer = drawerById.get(cur.id);
      if (drawer && cur.depth > 0) {
        results.push({ drawer, depth: cur.depth, via: cur.via });
      }

      if (cur.depth >= maxDepth) continue;
      const outgoing = tunnelsByFrom.get(cur.id) ?? [];
      for (const t of outgoing) {
        if (!visited.has(t.toDrawerId)) {
          queue.push({ id: t.toDrawerId, depth: cur.depth + 1, via: [...cur.via, t.relation] });
        }
      }
    }
    return results;
  }

  deleteTunnel(id: string): boolean {
    const state = this.read();
    const before = state.tunnels.length;
    state.tunnels = state.tunnels.filter((t) => t.id !== id);
    const removed = state.tunnels.length < before;
    if (removed) this.write(state);
    return removed;
  }

  // ── Knowledge graph triples ───────────────────────────
  addTriple(t: Omit<KGTriple, 'id' | 'createdAt' | 'scope'>): KGTriple {
    const triple: KGTriple = {
      ...t,
      id: newId('kg'),
      createdAt: new Date().toISOString(),
      scope: this.scope,
      confidence: clamp01(t.confidence ?? 1.0),
    };
    const state = this.read();
    state.triples.push(triple);
    this.write(state);
    return triple;
  }

  /**
   * Query triples with optional s/p/o filters. Any field left undefined
   * acts as a wildcard. Matching is case-insensitive equality on each
   * specified field.
   *
   * If `asOf` is provided (ISO string), only triples whose validity
   * interval CONTAINS asOf are returned. Semantics:
   *   include if (validFrom undefined OR validFrom <= asOf)
   *           AND (validTo   undefined OR validTo   >  asOf)
   *
   * If `asOf` is omitted, "current" facts are returned (validTo undef).
   * Pass `asOf: 'all'` to return everything regardless of temporal state.
   */
  queryTriples(q: { subject?: string; predicate?: string; object?: string; asOf?: string | 'all' }): KGTriple[] {
    const triples = this.read().triples;
    const lc = (s: string | undefined): string | undefined => s?.toLowerCase();
    const s = lc(q.subject);
    const p = lc(q.predicate);
    const o = lc(q.object);
    const filtered = triples.filter(
      (t) =>
        (s === undefined || t.subject.toLowerCase() === s) &&
        (p === undefined || t.predicate.toLowerCase() === p) &&
        (o === undefined || t.object.toLowerCase() === o),
    );
    if (q.asOf === 'all') return filtered;
    if (q.asOf === undefined) {
      // Default: current facts only (not yet invalidated)
      return filtered.filter((t) => !t.validTo);
    }
    // Specific point in time — interval-contains check
    return filtered.filter((t) => {
      const from = t.validFrom ?? '0000';
      const to = t.validTo ?? '9999';
      return from <= q.asOf! && q.asOf! < to;
    });
  }

  /**
   * Invalidate a triple by id — sets validTo to now (or a caller-
   * supplied ISO timestamp). The triple is preserved in the store so
   * historical queries (asOf in the past) still find it; "current"
   * queries (asOf default) will exclude it.
   */
  invalidateTriple(id: string, endedAt?: string): KGTriple | null {
    const state = this.read();
    const idx = state.triples.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    const when = endedAt || new Date().toISOString();
    // Defensive: reject inverted intervals
    if (state.triples[idx].validFrom && state.triples[idx].validFrom! > when) {
      throw new Error(`invalidateTriple: validTo (${when}) precedes validFrom (${state.triples[idx].validFrom})`);
    }
    state.triples[idx] = { ...state.triples[idx], validTo: when };
    this.write(state);
    return state.triples[idx];
  }

  /** Most-recent triples first. For "what have I been learning?" views. */
  recentTriples(limit = 20): KGTriple[] {
    return [...this.read().triples]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  // ── Search ────────────────────────────────────────────
  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    const drawers = this.read().drawers;
    return searchDrawers(drawers, query, opts);
  }

  // ── Stats ─────────────────────────────────────────────
  stats(): { drawers: number; tunnels: number; triples: number; wings: number; rooms: number } {
    const state = this.read();
    const wings = new Set(state.drawers.map((d) => d.wing));
    const rooms = new Set(state.drawers.map((d) => `${d.wing}/${d.room}`));
    return {
      drawers: state.drawers.length,
      tunnels: state.tunnels.length,
      triples: state.triples.length,
      wings: wings.size,
      rooms: rooms.size,
    };
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
