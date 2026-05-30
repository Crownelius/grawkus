/**
 * Command palette catalog — the slash commands exposed via the
 * inline `/` command selector. Hand-curated rather than auto-
 * extracted from handleSlashCommand's switch, because:
 *
 *   1. The switch contains alias arms (/branch → /fork, /quit → /exit,
 *      etc.) that would clutter a UI listing.
 *   2. Some commands are internal sentinels (__DICTATE__, __SWARM__)
 *      that should never appear to users.
 *   3. Curating gives us a tight description column for each entry —
 *      the picker shows label + hint + description, and a hand-
 *      written one-liner is more scannable than a parsed comment.
 *
 * Categories mirror /help's grouping so muscle memory transfers.
 */

export interface CommandEntry {
  command: string;     // e.g. "/model" — what we inject into the prompt on selection
  description: string; // one-line scannable description
  category: string;
  aliases?: string[];
  usage?: string;
}

export const COMMAND_CATALOG: CommandEntry[] = [
  // ── General ──
  { command: '/help', description: 'Show the full command reference', category: 'General' },
  { command: '/clear', description: 'Reset the conversation (also resets side-channel state)', category: 'General' },
  { command: '/back', description: 'Rewind to before the nth most-recent user turn', category: 'General', aliases: ['/rewind'], usage: '/back [n]' },
  { command: '/fork', description: 'Branch the current conversation; previous still resumable', category: 'General', aliases: ['/branch'], usage: '/fork [name]' },
  { command: '/btw', description: 'Side question that doesn\'t pollute the main thread', category: 'General' },
  { command: '/editor', description: 'Open $EDITOR for a multi-line prompt', category: 'General', aliases: ['/edit-prompt'], usage: '/editor [seed]' },
  { command: '/history', description: 'Message count + token estimate', category: 'General' },
  { command: '/export', description: 'Export conversation (md/json/txt)', category: 'General' },
  { command: '/walkthrough', description: 'Agent-led tour of Grawkus', category: 'General', aliases: ['/tour', '/guide'] },
  { command: '/config', description: 'Reconfigure provider / model / key (re-runs the setup wizard)', category: 'General' },
  { command: '/theme', description: 'Change display mode (full/compact/minimal)', category: 'General' },
  { command: '/palette', description: 'Switch color palette (run /palettes to list)', category: 'General', aliases: ['/pallete'] },
  { command: '/palettes', description: 'List the 12 Coolors-based color palettes', category: 'General' },
  { command: '/footer', description: 'Customize the fixed bottom footer and opening prompt', category: 'General' },

  // ── Model & Provider ──
  { command: '/model', description: 'Switch model (no arg → interactive picker on OpenRouter)', category: 'Model' },
  { command: '/models', description: 'List available models for the current provider', category: 'Model' },
  { command: '/fallback', description: 'Set/show the model auto-retried on cryptic errors', category: 'Model' },
  { command: '/openrouter-free', description: 'Switch to OpenRouter free-tier router', category: 'Model' },
  { command: '/provider', description: 'Show provider info (URL, masked key)', category: 'Model' },
  { command: '/openai-login', description: 'OpenAI Codex OAuth login, status, or smoke test', category: 'Model' },
  { command: '/keys', description: 'Multi-key rotation pool (/keys add, status, remove)', category: 'Model' },
  { command: '/route', description: 'Auto-route to a model for the next message', category: 'Model', usage: '/route [fast|balanced|powerful|coding|analysis|review|verification]' },

  // ── Modes ──
  { command: '/mode', description: 'Switch mode (dev/review/tdd/research/plan/debug/benchmark/architect/sentience/design)', category: 'Modes' },
  { command: '/modes', description: 'List all available modes', category: 'Modes' },
  { command: '/sentience', description: 'Switch to Sentience mode (self-improving learning loop)', category: 'Modes', aliases: ['/hermes'] },
  { command: '/design', description: 'Switch to design mode (Stitch-powered UI work)', category: 'Modes' },

  // ── Session ──
  { command: '/sessions', description: 'List saved sessions', category: 'Session' },
  { command: '/save', description: 'Save current session', category: 'Session' },
  { command: '/resume', description: 'Resume a saved session (accepts id, prefix, or "last")', category: 'Session' },
  { command: '/delete', description: 'Delete a session', category: 'Session' },
  { command: '/import', description: 'Import Claude/Codex/MemPalace conversations and memory', category: 'Session', usage: '/import <scan|preview|run|status|rollback>' },

  // ── Git ──
  { command: '/commit', description: 'AI-generated commit message', category: 'Git' },
  { command: '/pr', description: 'AI-generated pull request', category: 'Git' },
  { command: '/diff', description: 'Show git diff', category: 'Git' },
  { command: '/log', description: 'Show git log', category: 'Git' },

  // ── Code Quality ──
  { command: '/review', description: 'AI code review (severity-rated findings)', category: 'Code Quality', usage: '/review [target]' },
  { command: '/auto-review', description: 'Code review with auto-detected language lens', category: 'Code Quality' },
  { command: '/tdd', description: 'Test-driven workflow (RED → GREEN → REFACTOR)', category: 'Code Quality' },
  { command: '/security-review', description: 'Security-focused audit', category: 'Code Quality' },
  { command: '/audit', description: 'Local-only project health check', category: 'Code Quality' },
  { command: '/doctor', description: 'Install/config/benchmark readiness check', category: 'Code Quality' },
  { command: '/verify', description: 'Run tests, fix failures, repeat until green', category: 'Code Quality' },
  { command: '/build-fix', description: 'Auto-detect language + fix build errors', category: 'Code Quality' },
  { command: '/test-coverage', description: 'Analyze coverage, suggest missing tests', category: 'Code Quality' },
  { command: '/benchmark', description: 'Benchmark-grade SWE/terminal/Open Agent run', category: 'Code Quality', aliases: ['/bench', '/leaderboard'], usage: '/benchmark <profile> <task>' },
  { command: '/refactor', description: 'Dead code detection + cleanup', category: 'Code Quality', aliases: ['/refactor-clean'], usage: '/refactor [target]' },
  { command: '/eval', description: 'Evaluate the project against explicit criteria', category: 'Code Quality' },
  { command: '/hunt-silent', description: 'Silent-failure-hunter agent (empty catches, log-and-forget)', category: 'Code Quality' },
  { command: '/explore', description: 'Code-explorer agent (codebase reconnaissance pass)', category: 'Code Quality' },
  { command: '/types', description: 'Type-design-analyzer agent (type system critique)', category: 'Code Quality' },
  { command: '/architect', description: 'Code-architect agent (structural critique)', category: 'Code Quality' },
  { command: '/simplify', description: 'Code-simplifier agent (find + collapse incidental complexity)', category: 'Code Quality' },
  { command: '/e2e', description: 'Generate E2E tests', category: 'Code Quality' },

  // ── Tools & Config ──
  { command: '/tools', description: 'List currently-available tools', category: 'Config' },
  { command: '/harness', description: 'Map harness components to files, tests, and docs', category: 'Config', aliases: ['/harness-components'], usage: '/harness [component] [--json]' },
  { command: '/command-audit', description: 'Audit slash command catalog, handlers, and smoke coverage', category: 'Config', usage: '/command-audit [--json] [--strict]' },
  { command: '/rules', description: 'Show the active coding and safety rules', category: 'Config' },
  { command: '/agents', description: 'Show active AGENTS.md instruction files and scoped sections', category: 'Config' },
  { command: '/perm', description: 'Permission mode and /perm why explanations', category: 'Config', aliases: ['/permissions'], usage: '/perm ask|auto|yolo | /perm why <tool> [command-or-path]' },
  { command: '/perm-reset', description: 'Clear the per-tool always-allow list', category: 'Config' },
  { command: '/sandbox', description: 'OS-native bash sandbox (off/standard/strict)', category: 'Config' },
  { command: '/dry-run', description: 'Toggle dry-run mode (preview tool calls)', category: 'Config' },
  { command: '/thinking', description: 'Toggle thinking/reasoning display (live + auto-collapse)', category: 'Config' },
  { command: '/think', description: 'Re-expand the most recent collapsed thinking block', category: 'Config' },
  { command: '/cd', description: 'Change working directory', category: 'Config' },
  { command: '/hooks', description: 'List configured hooks', category: 'Config' },
  { command: '/reset-hooks', description: 'Re-seed the default hook configuration', category: 'Config', aliases: ['/hooks-reset'] },
  { command: '/hook-profile', description: 'Show hook profile and controls', category: 'Config' },
  { command: '/pm2', description: 'PM2 service management', category: 'Config' },
  { command: '/detect', description: 'Detect package manager, test runner, and build tool', category: 'Config' },
  { command: '/users', description: 'Manage the local users table', category: 'Config' },
  { command: '/count', description: 'Increment, decrement, or reset the demo counter', category: 'Config' },

  // ── Planning ──
  { command: '/plan', description: 'Structured implementation planning', category: 'Planning' },
  { command: '/checkpoint', description: 'Save git-state checkpoint inside this session', category: 'Planning' },
  { command: '/checkpoints', description: 'List saved git-state checkpoints', category: 'Planning' },
  { command: '/search-first', description: 'Research before coding', category: 'Planning' },
  { command: '/docs-lookup', description: 'Search documentation for an answer', category: 'Planning' },
  { command: '/manifest', description: 'Print an AHE prediction/regression edit contract', category: 'Planning', usage: '/manifest [task-or-target]' },
  { command: '/sources', description: 'Direct arXiv/GitHub/HF/Kaggle source scan without a model call', category: 'Planning', aliases: ['/source-scan'], usage: '/sources <query> [--source arxiv|github|huggingface|kaggle] [--json]' },
  { command: '/benchmark-repos', description: 'Public Terminal-Bench repo catalog for source mining', category: 'Planning', aliases: ['/bench-repos', '/leaderboard-repos', '/tb-repos'], usage: '/benchmark-repos [query] [--all|--unverified|--top-open-source] [--limit n]' },
  { command: '/repo-digest', description: 'Direct GitHub repo component/source digest without a model call', category: 'Planning', aliases: ['/repo-inspect', '/github-digest'], usage: '/repo-digest <owner/repo> [--files n]' },
  { command: '/context', description: 'Cheap repo preflight and task-aware candidate file dossier', category: 'Planning', usage: '/context brief [path] | /context dossier <task>' },
  { command: '/lifespan', description: 'Diagnose long-session aging risks before benchmark runs', category: 'Planning', usage: '/lifespan [--json]' },
  { command: '/source-research', description: 'Research arXiv, GitHub, Hugging Face, and Kaggle', category: 'Planning', aliases: ['/research-sources'] },
  { command: '/update-docs', description: 'Sync documentation with code', category: 'Planning' },

  // ── Orchestration ──
  { command: '/orchestrate', description: 'Decompose into parallel sub-agents', category: 'Orchestration' },
  { command: '/swarm', description: 'Infer agent roles for a task; expert form accepts agent CSV', category: 'Orchestration', usage: '/swarm <task>' },
  { command: '/pr-loop', description: 'Autonomous pull-request review loop', category: 'Orchestration' },
  { command: '/multi-plan', description: 'Multi-agent planning', category: 'Orchestration' },
  { command: '/multi-execute', description: 'Execute the current multi-agent plan', category: 'Orchestration' },
  { command: '/multi-backend', description: 'Generate coordinated backend components', category: 'Orchestration' },
  { command: '/multi-frontend', description: 'Generate coordinated frontend components', category: 'Orchestration' },

  // Codemaps
  { command: '/codemap', description: 'Show the project structure map', category: 'Codemaps', aliases: ['/codemaps'] },
  { command: '/update-codemaps', description: 'Regenerate and save codemaps', category: 'Codemaps' },

  // Content Engine
  { command: '/article', description: 'Generate an article or blog post', category: 'Content' },
  { command: '/slides', description: 'Generate a slide outline', category: 'Content' },
  { command: '/repurpose', description: 'Repurpose content for multiple channels', category: 'Content' },
  { command: '/market-research', description: 'Draft a market research report', category: 'Content' },
  { command: '/investor-deck', description: 'Draft an investor pitch deck', category: 'Content' },
  { command: '/investor-outreach', description: 'Draft investor outreach emails', category: 'Content' },
  { command: '/code-quality', description: 'Run a comprehensive code-quality audit', category: 'Content' },
  { command: '/skill-stocktake', description: 'Inventory skills and capabilities', category: 'Content' },
  { command: '/chief-of-staff', description: 'Create an executive briefing and priorities', category: 'Content' },

  // ── Skills & Memory ──
  { command: '/skills', description: 'List learned + bundled ECC skills', category: 'Skills' },
  { command: '/skill-show', description: 'Print the full prompt of a specific skill', category: 'Skills' },
  { command: '/skill-create', description: 'Create a reusable skill from git patterns', category: 'Skills' },
  { command: '/git-patterns', description: 'Analyze git commit patterns', category: 'Skills' },
  { command: '/git-workflow', description: 'Summarize the repository git workflow', category: 'Skills' },
  { command: '/ecc-guide', description: 'Browse the bundled ECC corpus', category: 'Skills' },
  { command: '/curate', description: 'Report duplicate or stale skill registry entries', category: 'Skills' },
  { command: '/memory', description: 'MemPalace: status, search, recall, list', category: 'Skills' },
  { command: '/learn', description: 'Extract patterns from this session into instincts', category: 'Skills' },
  { command: '/instincts', description: 'Show learned instincts', category: 'Skills' },
  { command: '/instinct-export', description: 'Export instincts to JSON', category: 'Skills' },
  { command: '/instinct-import', description: 'Import instincts from JSON', category: 'Skills' },
  { command: '/evolve', description: 'Cluster instincts into reusable skills', category: 'Skills' },
  { command: '/prune', description: 'Delete expired instincts', category: 'Skills' },

  // ── Cost & Usage ──
  { command: '/usage', description: 'Token + cost summary', category: 'Cost' },
  { command: '/budget', description: 'Set daily/monthly USD budget', category: 'Cost' },

  // ── Debug ──
  { command: '/debug', description: 'Toggle debug instrumentation + tail event log', category: 'Debug' },

  // ── Voice / Accessibility ──
  { command: '/voice', description: 'Voice config + master switch', category: 'Voice' },
  { command: '/accessibility', description: 'Screen-reader mode, audio cues, destructive-confirm', category: 'Voice', aliases: ['/a11y'] },
  { command: '/dictate', description: 'One-shot record + transcribe', category: 'Voice' },

  // ── Stitch ──
  { command: '/stitch', description: 'Show Stitch config status', category: 'Stitch', aliases: ['/stitch-status'] },
  { command: '/stitch-config', description: 'Save your Stitch API key', category: 'Stitch' },

  // ── Exit ──
  { command: '/exit', description: 'Quit the REPL', category: 'General', aliases: ['/quit'] },
];

function normalizeSlashCommand(value: string): string {
  const token = value.trim().split(/\s+/, 1)[0].toLowerCase();
  if (!token) return '';
  return token.startsWith('/') ? token : `/${token}`;
}

export const COMMAND_ALIAS_TO_CANONICAL: ReadonlyMap<string, string> = new Map(
  COMMAND_CATALOG.flatMap((entry) => (entry.aliases ?? []).map((alias) => [alias, entry.command] as const)),
);

export function resolveCommandEntry(value: string): { entry: CommandEntry; alias?: string } | null {
  const normalized = normalizeSlashCommand(value);
  if (!normalized) return null;
  const canonical = COMMAND_ALIAS_TO_CANONICAL.get(normalized) ?? normalized;
  const entry = COMMAND_CATALOG.find((item) => item.command === canonical);
  if (!entry) return null;
  return normalized === entry.command ? { entry } : { entry, alias: normalized };
}

function isSubsequence(needle: string, haystack: string): boolean {
  let pos = 0;
  for (const ch of haystack) {
    if (ch === needle[pos]) pos++;
    if (pos === needle.length) return true;
  }
  return needle.length === 0;
}

export function suggestCommandEntries(value: string, limit = 6): CommandEntry[] {
  const query = normalizeSlashCommand(value).replace(/^\//, '');
  if (!query) return COMMAND_CATALOG.slice(0, limit);

  return COMMAND_CATALOG
    .map((entry) => {
      const command = entry.command.replace(/^\//, '');
      const aliases = (entry.aliases ?? []).map((alias) => alias.replace(/^\//, ''));
      let score = 0;
      if (command.startsWith(query)) score = 100;
      else if (aliases.some((alias) => alias.startsWith(query))) score = 90;
      else if (command.includes(query)) score = 70;
      else if (aliases.some((alias) => alias.includes(query))) score = 60;
      else if (entry.category.toLowerCase().includes(query)) score = 40;
      else if (entry.description.toLowerCase().includes(query)) score = 20;
      else if (query.length >= 3 && isSubsequence(query, command)) score = 10;
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.command.localeCompare(b.entry.command))
    .slice(0, limit)
    .map((item) => item.entry);
}

export function allSlashCommandNames(): string[] {
  return Array.from(new Set(
    COMMAND_CATALOG.flatMap((entry) => [entry.command, ...(entry.aliases ?? [])]),
  )).sort();
}

export function completeSlashCommandNames(
  line: string,
  commands: string[] = allSlashCommandNames(),
): [string[], string] {
  if (!line.startsWith('/')) return [[], line];

  const matches = commands.filter((c) => c.startsWith(line));
  return matches.length === 1 ? [matches, line] : [[], line];
}
