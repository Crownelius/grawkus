/**
 * MemPalace data model — TypeScript port of the core MemPalace concepts.
 *
 * Mental model:
 *
 *   Wing     ─ a top-level domain ("projects", "people", "code", "wisdom")
 *   Room     ─ a category inside a wing ("grawkus", "abc-reborn", ...)
 *   Drawer   ─ an individual memory item: a chunk of text + tags + metadata
 *   Tunnel   ─ a directed link between two drawers, typed by relation
 *   Triple   ─ a knowledge-graph fact: (subject, predicate, object)
 *
 * Drawers are the atomic unit of memory. Wings + rooms give them addressable
 * structure. Tunnels and KG triples give them relational structure.
 *
 * Two stores live side-by-side:
 *   GLOBAL   ~/.grawkus/memory/    cross-project knowledge (user prefs,
 *                                    recurring patterns, skills)
 *   PROJECT  <cwd>/.grawkus/memory/  this-codebase-specific (e.g. "build
 *                                    is broken because X", "the queue lives
 *                                    in services/queue/...")
 *
 * The agent picks which store to query based on the request. User-modeling
 * queries hit global; codebase queries hit project. Search APIs accept a
 * Scope hint or 'both' to search across.
 */

/**
 * Which memory store an operation targets.
 *
 *   'global'  — ~/.grawkus/memory/ (cross-project)
 *   'project' — <cwd>/.grawkus/memory/ (per-repo)
 *   'both'    — search both; writes pick based on content (global for user
 *               preferences, project for codebase facts)
 */
export type Scope = 'global' | 'project' | 'both';

/**
 * A drawer is one memory item — a chunk of text living at wing/room. Tags
 * are free-form lowercase strings used for filtering. Importance is a 0–1
 * heuristic the agent or user can set to bias search ordering.
 */
export interface Drawer {
  id: string;               // ulid-ish: timestamp + random hex
  wing: string;             // e.g. "projects"
  room: string;             // e.g. "grawkus"
  content: string;          // the actual memory text
  tags: string[];           // free-form, lowercase
  importance: number;       // 0..1, default 0.5
  createdAt: string;        // ISO timestamp
  updatedAt: string;
  scope: Scope;             // 'global' | 'project' (never 'both' at rest)
  // Light source attribution — which session created this drawer. Lets us
  // age or invalidate drawers tied to a session that turned out to be wrong.
  sourceSessionId?: string;
}

/**
 * Convenience metadata about a wing — populated by `listWings` for UI/
 * status output. Not stored separately; derived from drawer counts.
 */
export interface WingMeta {
  name: string;
  rooms: string[];          // unique room names within this wing
  drawerCount: number;
}

/**
 * Same for rooms.
 */
export interface RoomMeta {
  wing: string;
  name: string;
  drawerCount: number;
  // Most-recent updatedAt across drawers in this room. Useful for "what
  // have I been working on lately" queries.
  lastTouched: string;
}

/**
 * A tunnel is a directed link from one drawer to another with a labelled
 * relation. Use cases:
 *   - "drawer A inspired drawer B" (relation: "inspired")
 *   - "drawer A supersedes drawer B" (relation: "supersedes")
 *   - "drawer A is part of drawer B's project" (relation: "in-project")
 *
 * Bidirectional traversal is supported by following tunnels in reverse.
 */
export interface Tunnel {
  id: string;
  fromDrawerId: string;
  toDrawerId: string;
  relation: string;         // free-form lowercase verb
  createdAt: string;
  scope: Scope;             // matches the scope of its source drawer
}

/**
 * A knowledge-graph triple — semantic-web style. Stored separately from
 * drawers because triples express *facts* (small, atomic, queryable in
 * aggregate) whereas drawers express *content* (larger, narrative).
 *
 * Example: ("rsfit", "owns", "Grawkus") or ("grawkus", "uses",
 * "OpenRouter").
 */
export interface KGTriple {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  // Optional weight (confidence). 1.0 = certain, lower = inferred / guess.
  confidence: number;
  // Optional context — a drawer or session ID this fact came from. Lets us
  // explain WHERE we learned something when asked.
  sourceDrawerId?: string;
  sourceSessionId?: string;
  createdAt: string;
  scope: Scope;
  // ── Temporal validity (MemPalace audit item 4) ──────────
  // Both fields are ISO strings, both optional. Semantics:
  //   validFrom undefined  → "this fact has always been true (or we don't know when it started)"
  //   validTo   undefined  → "this fact is currently true"
  //   validTo   set         → "this fact was invalidated at validTo"
  //
  // Lets us answer "what was true about X in January?" — see queryTriples
  // with asOf. Invalidation via kgInvalidate sets validTo to now.
  validFrom?: string;
  validTo?: string;
}

/**
 * Internal disk schema. One JSON file per store containing all drawers,
 * tunnels, and triples. Simple, atomic-write-via-rename safe.
 *
 * For very large stores (>10k drawers) this approach will get slow; the
 * intent is to swap to SQLite/FTS5 later behind the same Store interface.
 */
export interface StoreState {
  schemaVersion: number;
  drawers: Drawer[];
  tunnels: Tunnel[];
  triples: KGTriple[];
}

export const SCHEMA_VERSION = 1;

/**
 * Search options shared across query APIs.
 */
export interface SearchOptions {
  scope?: Scope;            // default 'both'
  wing?: string;            // filter to a wing
  room?: string;            // filter to a room
  tags?: string[];          // AND-match on these tags
  limit?: number;           // default 20
  // Importance threshold below which drawers are excluded. Useful when you
  // want only the "high-signal" items.
  minImportance?: number;
}

/**
 * A scored search hit — the drawer plus the relevance score the search
 * function computed. Higher = more relevant. Score is unitless; only
 * meaningful for ordering, not absolute comparison.
 */
export interface SearchHit {
  drawer: Drawer;
  score: number;
  // Which fields matched, useful for diagnostics + UI highlighting.
  matchedFields: ('content' | 'tags' | 'wing' | 'room')[];
}
