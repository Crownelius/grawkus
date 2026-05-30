/**
 * stitch tool — calls the Google Stitch MCP server.
 *
 * The LLM uses this to manage UI/UX design projects on Stitch:
 *   - List the user's projects
 *   - Read screens within a project
 *   - Download assets (images, HTML)
 *   - Generate a new screen from a text prompt
 *
 * Auth: API key from ~/.grawkus/stitch.json or STITCH_API_KEY env var.
 * Configure with `/stitch-config <key>` inside the REPL.
 */
import type { Tool, ToolResult } from './types.js';
import { callStitchMcp, stitchConfigured } from '../stitch.js';

// Per-process cache of the tools/list response. Stitch's catalog is
// effectively static — the tool list doesn't change between calls
// inside a single session. Without caching, the model routinely
// re-calls tools/list 3+ times per chain to "re-discover" the schema,
// each call returning ~100KB that floods context with duplicate
// information. Caching saves both the API round-trip AND the
// context tokens spent re-ingesting the same schema.
//
// Cache lives in module scope (per process), so it survives between
// tool calls in the same session but doesn't leak across REPL
// invocations. The hit-count is exposed via the result message so
// the model gets a clear "you've already seen this" signal and
// stops asking for it.
let _stitchToolsListCache: { output: string; hitCount: number } | null = null;

export const StitchTool: Tool = {
  name: 'stitch',
  description:
    'Google Stitch MCP server (stitch.googleapis.com/mcp). 12 tools across 4 categories: ' +
    'Project Management (create_project, get_project, list_projects), ' +
    'Screen Management (list_screens, get_screen), ' +
    'AI Generation (generate_screen_from_text, edit_screens, generate_variants), ' +
    'Design Systems (create_design_system, update_design_system, list_design_systems, apply_design_system). ' +
    'AI Generation calls take a few minutes — do not retry on connection errors; poll with get_screen instead. ' +
    'Requires STITCH_API_KEY or `/stitch-config` setup.',
  parameters: {
    type: 'object',
    properties: {
      method: {
        type: 'string',
        description: 'JSON-RPC method. "tools/call" to invoke a tool (default). "tools/list" to re-enumerate the catalog if you hit a tool-not-found error.',
      },
      name: {
        type: 'string',
        description: 'For "tools/call": the exact tool name (e.g. "list_projects", "generate_screen_from_text", "edit_screens"). See description for the full 12-tool catalog.',
      },
      arguments: {
        type: 'object',
        description: 'For "tools/call": tool-specific arguments. Examples: get_project → { name: "projects/{id}" }; list_screens → { projectId: "<id>" }; generate_screen_from_text → { projectId, prompt, deviceType?: "MOBILE"|"DESKTOP"|"TABLET"|"AGNOSTIC", modelId?: "GEMINI_3_PRO"|"GEMINI_3_FLASH" }.',
      },
    },
    required: ['method'],
  },
  isReadOnly: false,
  // Marked destructive because the tool covers AI Generation (generate_screen_
  // from_text, edit_screens, generate_variants) and Design System mutations
  // (create/update/apply). Permission gating in permissions.ts will prompt
  // under /perm ask, auto-approve in /perm yolo.
  isDestructive: true,

  async call(input): Promise<ToolResult> {
    if (!stitchConfigured()) {
      return {
        output: 'Stitch is not configured. Run `/stitch-config <api-key>` in the REPL, or set STITCH_API_KEY in your environment. Get a key from https://stitch.withgoogle.com/ → Stitch Settings → API Keys.',
        isError: true,
      };
    }

    const method = String(input.method || '').trim();
    if (!method) {
      return { output: 'stitch: missing required parameter "method"', isError: true };
    }
    if (method !== 'tools/list' && method !== 'tools/call') {
      return {
        output: `stitch: unsupported method "${method}". Use "tools/list" or "tools/call".`,
        isError: true,
      };
    }

    let params: Record<string, unknown> = {};
    if (method === 'tools/call') {
      const name = String(input.name || '').trim();
      if (!name) {
        return {
          output: 'stitch: "tools/call" requires a "name" parameter. Run with method="tools/list" first to discover available tools.',
          isError: true,
        };
      }
      params = {
        name,
        arguments: (input.arguments as Record<string, unknown>) || {},
      };
    }

    // ── tools/list cache short-circuit ────────────────────
    // Hit the cache on every tools/list after the first. The model
    // sometimes re-discovers the catalog 3-5+ times per session
    // (each call dumping ~100KB of duplicate schema into context).
    // The cached response is prefixed with a one-line hint telling
    // the model to STOP asking — the schema doesn't change. If the
    // hint doesn't dissuade, the per-fingerprint loop detector
    // (still active) catches genuine pathological loops.
    if (method === 'tools/list' && _stitchToolsListCache) {
      _stitchToolsListCache.hitCount++;
      const hint =
        `// CACHED — you already called stitch tools/list earlier this session ` +
        `(${_stitchToolsListCache.hitCount + 1}× total). The catalog doesn't change between calls. ` +
        `Use the tools you already saw; do NOT call tools/list again.\n`;
      return { output: hint + _stitchToolsListCache.output, isError: false };
    }

    const resp = await callStitchMcp({ method, params });
    if (!resp.ok) {
      return {
        output: `stitch error${resp.status ? ` (HTTP ${resp.status})` : ''}: ${resp.error?.message || 'unknown error'}`,
        isError: true,
      };
    }

    // Truncate huge payloads (Stitch can return image bytes / large HTML)
    const formatted = typeof resp.result === 'string'
      ? resp.result
      : JSON.stringify(resp.result, null, 2);
    const MAX = 100_000;
    const output = formatted.length > MAX
      ? formatted.slice(0, MAX) + `\n…[truncated ${formatted.length - MAX} bytes]`
      : formatted;

    // Cache the FIRST successful tools/list result so subsequent
    // calls hit the short-circuit above. The hitCount starts at 0
    // (this is the first call); next call will increment it.
    if (method === 'tools/list' && !_stitchToolsListCache) {
      _stitchToolsListCache = { output, hitCount: 0 };
    }

    return { output, isError: false };
  },
};
