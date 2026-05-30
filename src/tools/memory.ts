/**
 * MemPalace-backed memory tools the agent can call.
 *
 * Surface (kept small, action-oriented):
 *   memory_search   read    full-text search across global + project stores
 *   memory_recall   read    fetch a specific drawer by id, plus its tunnels
 *   memory_add      write   create a new drawer (or save a fact via KG)
 *   memory_link     write   tunnel between two drawers
 *   memory_list     read    inventory: wings/rooms/recent drawers
 *
 * The agent should reach for these whenever the user mentions facts that
 * are worth keeping across sessions ("I always use vitest, never jest"),
 * codebase landmarks ("the auth flow lives in src/auth/oauth.ts"), or
 * lessons learned during this turn that future sessions would benefit
 * from. The system prompt nudges this — see src/system-prompt.ts.
 *
 * All write tools are marked isDestructive: false because they only
 * append to a local file — no network, no external state. They still
 * require permission in `ask` mode by default but don't trigger the
 * destructive-action verbal-confirm path.
 */

import type { Tool, ToolResult } from './types.js';
import {
  addDrawer, getDrawer, listDrawers, search, linkDrawers,
  kgAdd, kgQuery, listWings, listRooms, stats,
  diaryWrite, diaryRead,
} from '../mempalace/index.js';
import type { Scope } from '../mempalace/index.js';

// ── memory_add ────────────────────────────────────────────
export const MemoryAddTool: Tool = {
  name: 'memory_add',
  description:
    'Save a memory drawer to the MemPalace store. Use this when the user mentions ' +
    'a fact, preference, codebase landmark, or lesson worth remembering across sessions. ' +
    'Scope: "global" for user preferences / cross-project facts, "project" for ' +
    'codebase-specific knowledge, "auto" (default) to infer from content. ' +
    'Pick a sensible wing ("preferences", "code", "people", "projects", "lessons") and ' +
    'a room (the project name, person name, or topic). Tag generously — tags are the ' +
    'strongest search signal.',
  parameters: {
    type: 'object',
    properties: {
      wing: { type: 'string', description: 'Top-level domain, e.g. "preferences" / "code" / "lessons"' },
      room: { type: 'string', description: 'Category within the wing, e.g. project name or topic' },
      content: { type: 'string', description: 'The memory text. Be concise but specific.' },
      tags: { type: 'array', description: 'Lowercase keywords for filtering + search', items: { type: 'string' } },
      importance: { type: 'number', description: '0..1, default 0.5. Boosts search ranking.' },
      scope: { type: 'string', description: '"global" | "project" | "auto" (default auto)' },
    },
    required: ['wing', 'room', 'content'],
  },
  isReadOnly: false,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const drawer = addDrawer({
        wing: input.wing as string,
        room: input.room as string,
        content: input.content as string,
        tags: (input.tags as string[]) || [],
        importance: typeof input.importance === 'number' ? input.importance : undefined,
        scope: (input.scope as 'global' | 'project' | 'auto' | undefined) || 'auto',
        cwd,
      });
      return {
        output: `Saved drawer ${drawer.id} (${drawer.scope}: ${drawer.wing}/${drawer.room}).`,
        isError: false,
      };
    } catch (e) {
      return { output: `Error saving drawer: ${e instanceof Error ? e.message : e}`, isError: true };
    }
  },
};

// ── memory_search ─────────────────────────────────────────
export const MemorySearchTool: Tool = {
  name: 'memory_search',
  description:
    'Search the MemPalace store for drawers matching a query. Searches both ' +
    'global and project memory by default; pass scope to narrow. Returns top ' +
    'hits ranked by relevance with their wing/room and content excerpt. Use ' +
    'this BEFORE proposing something the user may have said before, and to ' +
    'recall codebase landmarks instead of re-discovering them.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-text query; keywords work best' },
      scope: { type: 'string', description: '"global" | "project" | "both" (default both)' },
      wing: { type: 'string', description: 'Optional wing filter' },
      room: { type: 'string', description: 'Optional room filter' },
      tags: { type: 'array', description: 'Optional tag AND-filter', items: { type: 'string' } },
      limit: { type: 'number', description: 'Max results, default 10' },
    },
    required: ['query'],
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const hits = search(input.query as string, cwd, {
        scope: (input.scope as Scope) || 'both',
        wing: input.wing as string,
        room: input.room as string,
        tags: (input.tags as string[]) || undefined,
        limit: typeof input.limit === 'number' ? input.limit : 10,
      });
      if (hits.length === 0) {
        return { output: `No drawers matched "${input.query}".`, isError: false };
      }
      const lines = hits.map((h) => {
        const excerpt = h.drawer.content.length > 200
          ? h.drawer.content.slice(0, 200) + '…'
          : h.drawer.content;
        const tagStr = h.drawer.tags.length > 0 ? ` [${h.drawer.tags.join(', ')}]` : '';
        return `${h.drawer.id} (${h.drawer.scope} · ${h.drawer.wing}/${h.drawer.room}${tagStr}) score=${h.score.toFixed(2)}\n  ${excerpt}`;
      });
      return { output: `Found ${hits.length} drawer(s):\n\n${lines.join('\n\n')}`, isError: false };
    } catch (e) {
      return { output: `Error searching: ${e instanceof Error ? e.message : e}`, isError: true };
    }
  },
};

// ── memory_recall ─────────────────────────────────────────
export const MemoryRecallTool: Tool = {
  name: 'memory_recall',
  description:
    'Fetch a specific drawer by its id (returned by memory_search). Also lists ' +
    'any tunnels (relationships) the drawer has to other drawers. Use to get ' +
    'the full content + context of something a search surfaced.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Drawer id, e.g. "drw_xxxxxxx"' },
    },
    required: ['id'],
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const id = input.id as string;
      const drawer = getDrawer(id, cwd);
      if (!drawer) return { output: `No drawer with id ${id} in either store.`, isError: false };

      const tagStr = drawer.tags.length > 0 ? ` [${drawer.tags.join(', ')}]` : '';
      const out: string[] = [
        `${drawer.id} (${drawer.scope} · ${drawer.wing}/${drawer.room}${tagStr})`,
        `importance: ${drawer.importance}  created: ${drawer.createdAt}  updated: ${drawer.updatedAt}`,
        '',
        drawer.content,
      ];
      return { output: out.join('\n'), isError: false };
    } catch (e) {
      return { output: `Error recalling: ${e instanceof Error ? e.message : e}`, isError: true };
    }
  },
};

// ── memory_link ───────────────────────────────────────────
export const MemoryLinkTool: Tool = {
  name: 'memory_link',
  description:
    'Create a directed tunnel from one drawer to another with a labelled relation. ' +
    'Both drawers must be in the same store (global or project). Examples of ' +
    'relations: "supersedes", "inspired", "in-project", "depends-on", "refines". ' +
    'Use sparingly — only link when the connection is genuinely useful for later ' +
    'traversal.',
  parameters: {
    type: 'object',
    properties: {
      from_id: { type: 'string', description: 'Source drawer id' },
      to_id: { type: 'string', description: 'Target drawer id' },
      relation: { type: 'string', description: 'Verb describing how from relates to to' },
    },
    required: ['from_id', 'to_id', 'relation'],
  },
  isReadOnly: false,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const t = linkDrawers(
        input.from_id as string,
        input.to_id as string,
        input.relation as string,
        cwd,
      );
      return { output: `Linked ${t.fromDrawerId} → ${t.toDrawerId} via "${t.relation}" (tunnel ${t.id}).`, isError: false };
    } catch (e) {
      return { output: `Error linking: ${e instanceof Error ? e.message : e}`, isError: true };
    }
  },
};

// ── memory_list ───────────────────────────────────────────
export const MemoryListTool: Tool = {
  name: 'memory_list',
  description:
    'Inventory the MemPalace store. With no args, returns wings + drawer counts ' +
    'in both stores. With a wing arg, lists rooms within that wing. With wing + ' +
    'room, lists drawer summaries. Use to orient before searching, or to see ' +
    '"what do I know about X" at a glance.',
  parameters: {
    type: 'object',
    properties: {
      wing: { type: 'string', description: 'Optional wing to drill into' },
      room: { type: 'string', description: 'Optional room (requires wing)' },
      scope: { type: 'string', description: '"global" | "project" | "both" (default both)' },
    },
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const scope = (input.scope as Scope) || 'both';
      const wing = input.wing as string | undefined;
      const room = input.room as string | undefined;

      if (wing && room) {
        const drawers = listDrawers({ wing, room, scope, cwd });
        if (drawers.length === 0) return { output: `No drawers in ${wing}/${room}.`, isError: false };
        const lines = drawers.map((d) => {
          const excerpt = d.content.length > 80 ? d.content.slice(0, 80) + '…' : d.content;
          return `${d.id} (${d.scope}) ${excerpt}`;
        });
        return { output: `${drawers.length} drawer(s) in ${wing}/${room}:\n${lines.join('\n')}`, isError: false };
      }
      if (wing) {
        const r = listRooms(cwd, wing, scope);
        const all = [...r.global, ...r.project];
        if (all.length === 0) return { output: `No rooms in wing "${wing}".`, isError: false };
        const lines = all.map((rm) => `  ${rm.wing}/${rm.name} — ${rm.drawerCount} drawer(s), last ${rm.lastTouched.slice(0, 10)}`);
        return { output: `Rooms in "${wing}":\n${lines.join('\n')}`, isError: false };
      }
      const w = listWings(cwd, scope);
      const s = stats(cwd);
      const out: string[] = [];
      out.push(`Global store: ${s.global.drawers} drawer(s), ${s.global.tunnels} tunnel(s), ${s.global.triples} triple(s)`);
      for (const wm of w.global) {
        out.push(`  ${wm.name}: ${wm.drawerCount} drawer(s) across ${wm.rooms.length} room(s)`);
      }
      out.push('');
      out.push(`Project store: ${s.project.drawers} drawer(s), ${s.project.tunnels} tunnel(s), ${s.project.triples} triple(s)${s.projectExists ? '' : ' (not yet created)'}`);
      for (const wm of w.project) {
        out.push(`  ${wm.name}: ${wm.drawerCount} drawer(s) across ${wm.rooms.length} room(s)`);
      }
      return { output: out.join('\n'), isError: false };
    } catch (e) {
      return { output: `Error listing: ${e instanceof Error ? e.message : e}`, isError: true };
    }
  },
};

// ── memory_fact_add / memory_fact_query (knowledge graph) ──
export const MemoryFactAddTool: Tool = {
  name: 'memory_fact_add',
  description:
    'Record a structured fact in the knowledge graph: (subject, predicate, object). ' +
    'Example: subject="rsfit" predicate="prefers" object="vitest over jest". ' +
    'Use for atomic facts you want to be able to QUERY later by parts ' +
    '("what does rsfit prefer?"). For longer narrative content, use memory_add ' +
    'instead.',
  parameters: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Entity the fact is about' },
      predicate: { type: 'string', description: 'Relation/verb' },
      object: { type: 'string', description: 'Value or related entity' },
      confidence: { type: 'number', description: '0..1, default 1.0 (certain)' },
      scope: { type: 'string', description: '"global" | "project" (default global)' },
    },
    required: ['subject', 'predicate', 'object'],
  },
  isReadOnly: false,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const scope = ((input.scope as Scope) || 'global') as 'global' | 'project';
      const t = kgAdd({
        subject: input.subject as string,
        predicate: input.predicate as string,
        object: input.object as string,
        confidence: typeof input.confidence === 'number' ? input.confidence : 1.0,
      }, scope, cwd);
      return { output: `Added fact: (${t.subject}, ${t.predicate}, ${t.object}) [${t.scope}, confidence ${t.confidence}]`, isError: false };
    } catch (e) {
      return { output: `Error adding fact: ${e instanceof Error ? e.message : e}`, isError: true };
    }
  },
};

export const MemoryFactQueryTool: Tool = {
  name: 'memory_fact_query',
  description:
    'Query the knowledge graph for facts. Any of subject/predicate/object can be ' +
    'left unspecified to act as a wildcard. e.g. predicate="prefers" finds all ' +
    'preferences; subject="rsfit" finds everything we know about the user. ' +
    'Temporal: by default returns only CURRENT facts (not invalidated). Pass ' +
    'as_of with an ISO date to query historical state ("what was true on 2025-12-01?"), ' +
    'or as_of="all" to ignore validity intervals.',
  parameters: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      predicate: { type: 'string' },
      object: { type: 'string' },
      scope: { type: 'string', description: '"global" | "project" | "both" (default both)' },
      as_of: { type: 'string', description: 'ISO timestamp or "all"; omit for current facts only' },
    },
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const triples = kgQuery({
        subject: input.subject as string,
        predicate: input.predicate as string,
        object: input.object as string,
        asOf: input.as_of as (string | 'all' | undefined),
      }, cwd, (input.scope as Scope) || 'both');
      if (triples.length === 0) return { output: 'No matching facts.', isError: false };
      const lines = triples.map((t) => {
        const status = t.validTo ? ` [invalidated ${t.validTo.slice(0, 10)}]` : ' [current]';
        return `(${t.subject}, ${t.predicate}, ${t.object}) [${t.scope}, confidence ${t.confidence}, ${t.createdAt.slice(0, 10)}]${status}`;
      });
      return { output: `${triples.length} fact(s):\n${lines.join('\n')}`, isError: false };
    } catch (e) {
      return { output: `Error querying: ${e instanceof Error ? e.message : e}`, isError: true };
    }
  },
};

// ── diary_write / diary_read ────────────────────────────────
export const DiaryWriteTool: Tool = {
  name: 'diary_write',
  description:
    'Append a timestamped journal entry to a named agent\'s diary. Use to record ' +
    'observations, lessons, or decisions the agent should be able to scan back ' +
    'through later. Lives in global memory under wing "diary", room "agent_<name>" ' +
    '(lowercased — case is silently folded so "Claude" and "claude" stay together).',
  parameters: {
    type: 'object',
    properties: {
      agent_name: { type: 'string', description: 'Free-form agent identifier (case-insensitive)' },
      entry: { type: 'string', description: 'The journal entry text' },
      topic: { type: 'string', description: 'Optional topic tag for filtering' },
    },
    required: ['agent_name', 'entry'],
  },
  isReadOnly: false,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const d = diaryWrite({
        agentName: input.agent_name as string,
        entry: input.entry as string,
        topic: input.topic as string | undefined,
        cwd,
      });
      return { output: `Diary entry saved as ${d.id} (agent ${(input.agent_name as string).toLowerCase()}).`, isError: false };
    } catch (e) {
      return { output: `Error writing diary: ${e instanceof Error ? e.message : e}`, isError: true };
    }
  },
};

export const DiaryReadTool: Tool = {
  name: 'diary_read',
  description:
    'Read the most-recent entries from a named agent\'s diary. Returns up to ' +
    'last_n entries (default 20), newest first. Agent name is case-insensitive.',
  parameters: {
    type: 'object',
    properties: {
      agent_name: { type: 'string', description: 'Free-form agent identifier (case-insensitive)' },
      last_n: { type: 'number', description: 'Max entries to return (default 20)' },
    },
    required: ['agent_name'],
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const entries = diaryRead({
        agentName: input.agent_name as string,
        lastN: typeof input.last_n === 'number' ? input.last_n : 20,
        cwd,
      });
      if (entries.length === 0) {
        return { output: `No diary entries for agent "${input.agent_name}".`, isError: false };
      }
      const lines = entries.map((d) => `[${d.createdAt}] ${d.content.length > 200 ? d.content.slice(0, 200) + '…' : d.content}`);
      return { output: `${entries.length} entry/entries (newest first):\n\n${lines.join('\n\n')}`, isError: false };
    } catch (e) {
      return { output: `Error reading diary: ${e instanceof Error ? e.message : e}`, isError: true };
    }
  },
};

// Convenience export for the tool registry
export const MEMORY_TOOLS: Tool[] = [
  MemorySearchTool,
  MemoryRecallTool,
  MemoryAddTool,
  MemoryLinkTool,
  MemoryListTool,
  MemoryFactAddTool,
  MemoryFactQueryTool,
  DiaryWriteTool,
  DiaryReadTool,
];
