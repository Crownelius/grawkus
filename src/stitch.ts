/**
 * Stitch integration — Google's AI UI/UX design + code generation tool.
 *
 * Ports gemini-cli-extensions/stitch into Grawkus. Two surfaces:
 *
 *   1. A `stitch` tool (src/tools/stitch.ts) that the LLM can call to hit
 *      the Stitch MCP server at stitch.googleapis.com/mcp via JSON-RPC.
 *
 *   2. A `/stitch <query>` slash command (wired in src/index.ts) that
 *      injects a system-prompt addition copied from the upstream
 *      gemini-extension commands/stitch.toml — intent routing between
 *      "enhance a prompt" and "use the assistant" modes.
 *
 * Auth: API key only, stored at ~/.grawkus/stitch.json. ADC auth
 * (Google Cloud) would require gcloud + the OAuth dance — out of scope
 * for now. Get a key from https://stitch.withgoogle.com/ → profile menu
 * → Stitch Settings → API Keys → Create Key.
 *
 * Bypass the config file via STITCH_API_KEY env var.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getConfigDir } from './config.js';

const STITCH_MCP_URL = 'https://stitch.googleapis.com/mcp';
const STITCH_CONFIG_FILE = join(getConfigDir(), 'stitch.json');

// ── Config ──────────────────────────────────────────────
export interface StitchConfig {
  apiKey: string;
  configuredAt: string;
}

export function loadStitchConfig(): StitchConfig | null {
  const envKey = process.env.STITCH_API_KEY;
  if (envKey) {
    return { apiKey: envKey, configuredAt: '(from STITCH_API_KEY env)' };
  }
  if (!existsSync(STITCH_CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STITCH_CONFIG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveStitchConfig(apiKey: string): void {
  mkdirSync(getConfigDir(), { recursive: true });
  const cfg: StitchConfig = {
    apiKey,
    configuredAt: new Date().toISOString(),
  };
  writeFileSync(STITCH_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

export function stitchConfigured(): boolean {
  return loadStitchConfig() !== null;
}

// ── Minimal MCP JSON-RPC client ─────────────────────────
/**
 * Call the Stitch MCP server. MCP uses JSON-RPC 2.0 over HTTP. We support
 * the two methods we need:
 *
 *   tools/list   →  enumerate available tools
 *   tools/call   →  invoke a tool by name with args
 *
 * The server returns either `{ result: ... }` or `{ error: { code, message } }`.
 */
export interface McpRpcRequest {
  method: 'tools/list' | 'tools/call' | string;
  params?: Record<string, unknown>;
}

export interface McpRpcResponse {
  ok: boolean;
  result?: unknown;
  error?: { code?: number; message: string };
  status?: number;
}

export async function callStitchMcp(req: McpRpcRequest): Promise<McpRpcResponse> {
  const cfg = loadStitchConfig();
  if (!cfg) {
    return {
      ok: false,
      error: { message: 'Stitch not configured. Run /stitch-config to set an API key, or set STITCH_API_KEY in your env.' },
    };
  }

  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: req.method,
    params: req.params ?? {},
  };

  try {
    const resp = await fetch(STITCH_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Goog-Api-Key': cfg.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    const text = await resp.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }

    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        error: {
          message: parsed?.error?.message || `HTTP ${resp.status}: ${text.slice(0, 200)}`,
          code: parsed?.error?.code,
        },
      };
    }

    if (parsed?.error) {
      return { ok: false, status: resp.status, error: parsed.error };
    }

    return { ok: true, status: resp.status, result: parsed?.result ?? parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { message: `Network error: ${msg}` } };
  }
}

/**
 * /stitch-tools — inject a prompt that drives the agent to call tools/list
 * and pretty-print the catalog. Routes through the standard LLM tool loop
 * (async via runQuery) so we don't need to make handleSlashCommand async.
 */
export function buildStitchToolsPrompt(): string {
  return `# Stitch — list available MCP tools

Call the \`stitch\` tool with:

\`\`\`json
{ "method": "tools/list" }
\`\`\`

The response will be \`{ tools: [{ name, description, inputSchema }, ...] }\`.

Then render the catalog as a clean Markdown table with columns:
- **name** (exact string the user types)
- **description** (first line, trimmed)
- **required args** (comma-separated list from inputSchema.required, or "—")

If the call fails (non-ok response), report the HTTP status and error
message verbatim and suggest:
  - Check the API key is valid (\`/stitch-status\`)
  - Re-set it via \`/stitch-config <api-key>\`
  - Confirm internet reachability

Do not invoke any tools other than \`stitch\`. Do not edit any files.`;
}

// ── Status ──────────────────────────────────────────────
export function printStitchStatus(): void {
  const cfg = loadStitchConfig();
  console.log(chalk.cyan('\n  Stitch integration'));
  if (!cfg) {
    console.log(chalk.yellow('    not configured'));
    console.log(chalk.dim('    Configure with /stitch-config <api-key>'));
    console.log(chalk.dim('    Or: $env:STITCH_API_KEY = "..." (PowerShell)'));
    console.log(chalk.dim('         export STITCH_API_KEY="..." (POSIX)'));
    console.log(chalk.dim('    Get a key: https://stitch.withgoogle.com/ → Stitch Settings → API Keys'));
    console.log();
    return;
  }
  const masked = cfg.apiKey.length > 8
    ? cfg.apiKey.slice(0, 4) + '...' + cfg.apiKey.slice(-4)
    : '***';
  console.log(chalk.dim(`    api key:       ${masked}`));
  console.log(chalk.dim(`    configured at: ${cfg.configuredAt}`));
  console.log(chalk.dim(`    server:        ${STITCH_MCP_URL}`));
  console.log(chalk.dim(`\n    Try: /stitch list my projects`));
  console.log(chalk.dim(`         /stitch generate a landing page for a podcast about productivity`));
  console.log(chalk.dim(`         /stitch enhance: dark dashboard with sidebar nav and 3 charts`));
  console.log();
}

// ── Prompt builder (ports gemini-extension/commands/stitch.toml) ─────
/**
 * Returns the prompt body for /stitch <query>. The model is given an intent
 * router (enhance vs assistant) and the complete Stitch MCP tool catalog
 * sourced from https://stitch.withgoogle.com/docs/mcp/reference.
 */
export function buildStitchPrompt(query: string): string {
  const safeQuery = query.replace(/`/g, '\\`');
  return `# Stitch Intelligent Interface

You are the Stitch interface inside Grawkus. Stitch is Google's AI
UI/UX design and code generation tool (https://stitch.withgoogle.com/).
Connect via the \`stitch\` tool, which wraps the Stitch MCP server at
https://stitch.googleapis.com/mcp.

Call shape:

  { "method": "tools/call", "name": "<tool>", "arguments": { ... } }

Use \`{ "method": "tools/list" }\` only if you encounter a tool-not-found
error — the catalog below is the authoritative list from the upstream
reference docs.

The user's query is: "${safeQuery}"

## Intent classification

Does the user want to **Enhance / Improve** a design prompt?
* **YES** (triggers: "enhance", "refine", "make this better"): PROTOCOL A.
* **NO** (any other Stitch operation): PROTOCOL B.

## PROTOCOL A: ENHANCE

1. \`web_fetch\` https://discuss.ai.google.dev/t/stitch-prompt-guide/83844
   for the Stitch Effective Prompting Guide. Read it.
2. Generate a snake_case filename for the topic (e.g. \`podcast_landing_page.md\`).
3. Rewrite the user's intent into a polished prompt following the guide.
4. \`write_file\` to save it to that filename in the CWD.
5. Reply: "✨ Enhanced prompt saved to \`[filename]\`."

## PROTOCOL B: ASSISTANT

Use the catalog below. **Project Management** + **Screen Management** are
read-only and fast. **AI Generation** + **Design Systems** mutate state and
can take **a few minutes** — do NOT retry on connection errors; instead
poll \`get_screen\` after a few minutes to see if it completed.

### Domain model

- A user owns **projects** (a project is a container of UI work).
- Each project has many **screens**. A screen has an image + full HTML/
  Tailwind document.
- Screens can share a **design system** (theme, components, tokens).
- Resource names follow Google Cloud format: \`projects/{projectId}\` and
  \`projects/{projectId}/screens/{screenId}\`.

### Project Management

\`create_project\`  (writes) — Create a new project.
\`get_project\`  (read-only) — Args: \`{ name: "projects/{projectId}" }\`.
\`list_projects\`  (read-only) — Args: \`{}\` or omit.

### Screen Management

\`list_screens\`  (read-only) — Args: \`{ projectId: "<id-no-prefix>" }\`.
  Returns an array of Screen objects.
\`get_screen\`  (read-only) — Prefer \`{ name: "projects/{p}/screens/{s}" }\`.
  Legacy \`projectId\` + \`screenId\` (deprecated, no prefixes) are also
  accepted; currently all three may be required together.

### AI Generation (destructive, slow — minutes per call)

\`generate_screen_from_text\` — Generates a new screen from a text prompt.
  Args: \`{ projectId, prompt, deviceType?, modelId? }\`.
  - \`deviceType\` enum: \`DEVICE_TYPE_UNSPECIFIED\` | \`MOBILE\` | \`DESKTOP\` |
    \`TABLET\` | \`AGNOSTIC\`. Default unspecified.
  - \`modelId\` enum: \`MODEL_ID_UNSPECIFIED\` | \`GEMINI_3_PRO\` |
    \`GEMINI_3_FLASH\`. Default unspecified (server picks Flash).
  - If the response \`output_components\` field contains suggestions,
    present them to the user. If accepted, call this tool AGAIN with the
    chosen suggestion as the new \`prompt\`.
  - This call takes **a few minutes**. Avoid retrying on connection
    errors — they don't necessarily mean failure. Instead, poll
    \`get_screen\` after a few minutes.

\`edit_screens\` — Edits existing screens with a text prompt.
  Args: \`{ projectId, selectedScreenIds: [string], prompt, deviceType? }\`.
  Same minutes-long behavior as \`generate_screen_from_text\`.

\`generate_variants\` — Produces alternate variants of a screen.

### Design Systems

\`create_design_system\`  (writes) — Create a new design system.
\`update_design_system\`  (writes) — Update an existing one.
\`list_design_systems\`  (read-only) — List available design systems.
\`apply_design_system\`  (writes) — Apply a design system to screens.

## Rules

1. **Don't retry slow AI calls.** If \`generate_screen_from_text\` or
   \`edit_screens\` returns a network/timeout error, the work is likely
   still progressing on the server. Wait, then call \`get_screen\` to
   check status. Mention this to the user so they don't get impatient.

2. **Surface suggestions.** When \`generate_screen_from_text\` returns
   \`output_components\` with prompt suggestions, list them for the user
   in a numbered list and ask which to use.

3. **Resource names over deprecated IDs.** Prefer the \`name\` form
   (\`projects/{p}\` or \`projects/{p}/screens/{s}\`) over bare \`projectId\`
   when both are accepted.

4. **Read-only vs destructive matters.** Use read-only tools liberally to
   explore. Confirm before generating/editing if the user wasn't explicit.

5. **Respond with structure.** Lists → Markdown tables. Generated screens
   → screen id + brief description + offer to fetch with \`get_screen\`.
   On any failure, return the upstream error verbatim, then suggest a fix.`;
}

// ── Re-exports ──────────────────────────────────────────
export { STITCH_MCP_URL, STITCH_CONFIG_FILE };
