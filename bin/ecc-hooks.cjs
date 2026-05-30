#!/usr/bin/env node
/**
 * ECC-native hook dispatcher for Cawdex.
 *
 * Reads Cawdex's hook env vars (CAWDEX_EVENT, CAWDEX_TOOL,
 * CAWDEX_TOOL_INPUT, CAWDEX_TOOL_OUTPUT) and runs a single named check.
 *
 * Exit codes:
 *   0  — allow (PreToolUse) or success (PostToolUse)
 *   2  — block (PreToolUse only; non-zero on a non-blocking hook is just logged)
 *
 * Usage:
 *   node ecc-hooks.cjs <check-name> [__ecc__]
 *
 * The trailing __ecc__ tag is used by the installer to identify ECC-managed
 * hook entries so /ecc-install can refresh them without touching user hooks.
 */
'use strict';

const checkName = process.argv[2] || '';

// Parse the tool-input env var. Previously a parse failure silently
// fell back to `{}`, which makes every per-file check return ok() at
// its empty-path guard — i.e. a malformed payload was a free bypass.
// Now: empty/unset is treated as `{}` (legitimate for events that
// don't carry input, like SessionStart); a NON-empty payload that
// fails to parse is treated as a security event and the hook
// blocks. Fail closed > fail open.
const rawToolInput = process.env.CAWDEX_TOOL_INPUT || '';
let toolInput = {};
if (rawToolInput.length > 0) {
  try {
    toolInput = JSON.parse(rawToolInput);
  } catch {
    process.stderr.write('[ECC] BLOCKED: tool input env var was not valid JSON.\n');
    process.exit(2);
  }
}

const tool = process.env.CAWDEX_TOOL || '';
const cwd = process.env.CAWDEX_CWD || process.cwd();

// ── Helpers ─────────────────────────────────────────────
function bashCommand() {
  return String(toolInput.command || toolInput.cmd || '');
}

function filePath() {
  return String(toolInput.path || toolInput.file_path || toolInput.file || '');
}

function fileContent() {
  return String(
    toolInput.content ||
    toolInput.new_string ||
    toolInput.text ||
    '',
  );
}

function block(message) {
  process.stderr.write(`[ECC] BLOCKED: ${message}\n`);
  process.exit(2);
}

function warn(message) {
  process.stderr.write(`[ECC] ${message}\n`);
  process.exit(0);
}

function ok() {
  process.exit(0);
}

// ── Checks ──────────────────────────────────────────────
const checks = {
  /**
   * Block `git commit --no-verify` and friends — these skip pre-commit hooks.
   */
  'block-no-verify': () => {
    const cmd = bashCommand();
    if (!/\bgit\s+/.test(cmd)) return ok();
    if (/(^|\s)--no-verify(\s|$)/.test(cmd)) {
      return block('`--no-verify` skips git hooks — fix the failure instead.');
    }
    if (/(^|\s)--no-gpg-sign(\s|$)/.test(cmd)) {
      return block('`--no-gpg-sign` bypasses signing — ask the user first.');
    }
    // `git commit -n` is the short form of --no-verify. The previous
    // regex missed it entirely. Scope the check to `git commit`
    // specifically — `-n` in other git subcommands means different
    // things (e.g. `git log -n 5` = limit count, NOT skip hooks).
    if (/\bgit\s+(?:commit|merge|rebase)\b[^|;&]*\s-n(\s|$)/.test(cmd)) {
      return block('`-n` is the short form of `--no-verify` — fix the failing hook instead.');
    }
    // `-c core.hooksPath=/dev/null` (or similar) disables git hooks
    // entirely without using --no-verify. Catches the documented
    // bypass vector even when --no-verify isn't on the command line.
    if (/\bgit\s+-c\s+core\.hooksPath\s*=/i.test(cmd)) {
      return block('`-c core.hooksPath=…` disables git hooks — fix the failure instead.');
    }
    return ok();
  },

  /**
   * Remind the user to run dev servers under tmux (non-blocking, POSIX only).
   */
  'dev-server-tmux': () => {
    if (process.platform === 'win32') return ok();
    if (process.env.TMUX) return ok();
    const cmd = bashCommand();
    const devPattern = /\b(npm\s+run\s+dev|pnpm(?:\s+run)?\s+dev|yarn\s+dev|bun\s+run\s+dev|next\s+dev|vite(?:\s+dev)?)\b/;
    const tmuxLauncher = /^\s*tmux\s+(new|new-session|new-window|split-window)\b/;
    if (devPattern.test(cmd) && !tmuxLauncher.test(cmd)) {
      return warn('Consider running dev servers in tmux for log access: `tmux new-session -d -s dev "<cmd>"`');
    }
    return ok();
  },

  /**
   * Warn (don't block) when reading typically-sensitive files.
   */
  'sensitive-file': () => {
    const path = filePath();
    if (!path) return ok();
    if (/\.(env|key|pem|p12|pfx)$/i.test(path) || /\b(credentials|secrets|id_rsa)\b/i.test(path)) {
      return warn(`Reading sensitive file: ${path}`);
    }
    return ok();
  },

  /**
   * Block edits to linter/formatter config files. Without this, an agent
   * that hits a lint error tends to "fix" it by relaxing the config rule
   * instead of fixing the actual code. Ported from upstream ECC
   * scripts/hooks/config-protection.js (140 LOC condensed to ~40).
   *
   * The full upstream list includes 50+ patterns covering ESLint v8/v9,
   * Prettier (all formats), TS/Babel/Webpack/Vite/Rollup configs,
   * Python (ruff, pyproject.toml, .flake8, setup.cfg), Go (golangci),
   * Ruby (RuboCop), and .editorconfig. We match by basename so paths
   * like `apps/foo/.eslintrc.cjs` are still blocked.
   */
  'config-protection': () => {
    const fp = filePath();
    if (!fp) return ok();
    const base = require('path').basename(fp);
    const protectedFiles = new Set([
      '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json',
      '.eslintrc.yml', '.eslintrc.yaml', 'eslint.config.js',
      'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts',
      'eslint.config.mts', 'eslint.config.cts',
      '.prettierrc', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.json',
      '.prettierrc.yml', '.prettierrc.yaml', '.prettierrc.toml',
      'prettier.config.js', 'prettier.config.mjs', 'prettier.config.cjs',
      '.editorconfig', 'tsconfig.json', 'tsconfig.base.json',
      'tsconfig.build.json', 'jsconfig.json',
      '.ruff.toml', 'ruff.toml', 'pyproject.toml', 'setup.cfg', '.flake8',
      'mypy.ini', 'pytest.ini',
      '.golangci.yml', '.golangci.yaml', '.golangci.toml',
      '.rubocop.yml', '.rubocop.yaml',
      '.swiftlint.yml', '.clang-format', '.clang-tidy',
    ]);
    if (protectedFiles.has(base)) {
      return block(
        `${base} is a linter/formatter config — modifying it to silence ` +
        `errors instead of fixing the code is anti-pattern. Fix the source ` +
        `file the lint/typecheck error points to. If the rule itself is ` +
        `genuinely wrong, ask the user before changing the config.`,
      );
    }
    return ok();
  },

  /**
   * GateGuard — surface "first Edit/Write to this file" as a hint or a
   * block, depending on CAWDEX_GATEGUARD_MODE.
   *
   * Modes:
   *   warn  (default) — print the investigation hint, allow the edit.
   *                     The agent reads the hint as conversational
   *                     context but isn't forced to retry. Zero
   *                     round-trip cost on the happy path.
   *   block           — the original behavior: block once per file,
   *                     allow on retry. Use this when you actively
   *                     want to force the agent to re-investigate
   *                     every existing file before its first edit.
   *   off             — silent no-op.
   *
   * Why warn is the new default (changed in v1.29.1):
   *   - The block-first-allow-on-retry pattern wasted a round-trip on
   *     every first edit to every existing file.
   *   - The investigation hint is just as useful when delivered as a
   *     warning the agent observes — it doesn't need a forced retry
   *     to be acted on.
   *   - User reports across three sessions showed agents always
   *     succeeded on retry, so the block was friction without
   *     proportional safety benefit.
   *   - Strict users who actually want block-first can opt back in
   *     via CAWDEX_GATEGUARD_MODE=block.
   *
   * State lives at ~/.cawdex/state/gateguard/<sessionId>.json
   * even in warn mode — tracking per-file means we only emit the hint
   * once per file per session (don't nag).
   *
   * Auto-cleanup: state files older than 24h are deleted on next run.
   *
   * Upstream credit: github.com/zunoworks/gateguard (the underlying idea).
   */
  'gateguard': () => {
    // ── Disable knob ─────────────────────────────────────
    // Documented in the hint/block message below.
    const disableEnv = (process.env.CAWDEX_GATEGUARD || '').trim();
    if (/^(off|false|0|no|disabled?)$/i.test(disableEnv)) return ok();

    // ── Mode selection ───────────────────────────────────
    // Pick warn (new default) vs block (legacy strict) vs off.
    const modeEnv = (process.env.CAWDEX_GATEGUARD_MODE || 'warn').toLowerCase().trim();
    if (modeEnv === 'off') return ok();
    const strict = modeEnv === 'block' || modeEnv === 'strict';

    // ── yolo bypass ──────────────────────────────────────
    // Permission mode 'yolo' is the user's explicit "trust the agent,
    // skip the speed bumps" contract. GateGuard's investigate-first
    // intervention directly contradicts that — letting it fire in
    // yolo would mean the safest setting in cawdex is more
    // pedantic than the most-cautious, which is backwards. Silent
    // no-op so the user gets the unblocked flow they asked for.
    const perm = (process.env.CAWDEX_PERMISSION_MODE || '').toLowerCase().trim();
    if (perm === 'yolo') return ok();

    const fs = require('fs');
    const pathMod = require('path');
    const os = require('os');
    const targetPath = filePath();
    if (!targetPath) return ok();

    // ── Brand-new file bypass ────────────────────────────
    // The "investigate before editing" rule only makes sense for files
    // that already exist (someone could be depending on the current
    // contents). A brand-new file has no existing contents to read, no
    // current consumers to grep for, and no existing data to validate
    // schema against — the three things the block message tells the
    // agent to do are all no-ops. Skipping prevents the false-positive
    // scaffolding lockup where every fresh project hits a wall on
    // every new file.
    try {
      if (!fs.existsSync(targetPath)) return ok();
    } catch { /* if statSync fails, fall through to the normal path */ }

    // Sanitize sessionId before joining into a path. Without this,
    // a sessionId of e.g. "../../../.ssh/authorized_keys" would let
    // `path.join` traverse out of the state dir, and the subsequent
    // writeFileSync would overwrite arbitrary files with attacker-
    // controllable JSON (the touched-set array, which can include
    // model-controlled file paths). Allow only [A-Za-z0-9_-], length
    // <=64. Anything else falls back to "unknown" — degraded UX
    // (gateguard tracking won't persist), not a security breach.
    const rawSessionId = process.env.CAWDEX_SESSION_ID || '';
    const sessionId = /^[A-Za-z0-9_-]{1,64}$/.test(rawSessionId) ? rawSessionId : 'unknown';
    const stateDir = pathMod.join(os.homedir(), '.cawdex', 'state', 'gateguard');
    const stateFile = pathMod.join(stateDir, `${sessionId}.json`);

    // GC: drop any state files older than 24h. Best-effort, never throws.
    try {
      if (fs.existsSync(stateDir)) {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const name of fs.readdirSync(stateDir)) {
          const p = pathMod.join(stateDir, name);
          try {
            const s = fs.statSync(p);
            if (s.mtimeMs < cutoff) fs.unlinkSync(p);
          } catch { /* noop */ }
        }
      }
    } catch { /* noop */ }

    let touched = new Set();
    try {
      if (fs.existsSync(stateFile)) {
        const raw = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        if (Array.isArray(raw)) touched = new Set(raw);
      }
    } catch { /* corrupt state: treat as empty */ }

    if (touched.has(targetPath)) return ok();   // already seen this file this session

    // First touch — record. In strict (block) mode we block here; in
    // warn (default) mode we print the hint as a one-line warning and
    // exit ok() so the edit proceeds. Persist either way so the next
    // edit to the same file doesn't re-emit the hint.
    touched.add(targetPath);
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify([...touched]), 'utf-8');
    } catch { /* if we can't persist, still emit the hint this one time */ }

    if (strict) {
      return block(
        `First Edit/Write to ${targetPath} this session. Before proceeding, ` +
        `investigate: (1) Read the file. (2) Grep for importers. ` +
        `(3) If schema/type, check existing data. After investigating, ` +
        `retry the edit. Set CAWDEX_GATEGUARD_MODE=warn to switch ` +
        `to non-blocking hints, or =off to disable. /perm yolo also bypasses.`,
      );
    }
    // Warn mode (default): one-line hint, exit 0 so the edit proceeds.
    process.stderr.write(
      `[ECC hint] first edit to ${targetPath} this session — make sure ` +
      `you've read it + checked for callers. (set ` +
      `CAWDEX_GATEGUARD_MODE=block to enforce, =off to silence)\n`,
    );
    return ok();
  },

  /**
   * Quality gate — run formatter/linter against just-edited files and
   * report failures (non-blocking warn). Detects toolchain via standard
   * config files in cwd. PostToolUse hook, exit 0 always.
   *
   * Detection: prettier (.prettierrc*, package.json prettier field),
   * eslint (eslint config), ruff (pyproject.toml ruff section or
   * ruff.toml), golangci (.golangci.*), rubocop (.rubocop.yml).
   *
   * Only checks the path the hook was given — single-file scope keeps
   * the latency bounded. Full repo lint stays on /verify or CI.
   *
   * Defers actually executing the linter to avoid hard-coupling to any
   * one tool's CLI shape. Instead we print a hint with the commands the
   * user can run. This is a "remind, don't run" hook for now; later
   * iterations can actually invoke + parse the output.
   */
  'quality-gate': () => {
    const fp = filePath();
    if (!fp) return ok();
    const ext = fp.split('.').pop()?.toLowerCase() || '';
    const fs = require('fs');
    const pathMod = require('path');
    const findCwd = (start, name) => {
      let dir = pathMod.dirname(start);
      for (let i = 0; i < 10; i++) {
        if (fs.existsSync(pathMod.join(dir, name))) return pathMod.join(dir, name);
        const parent = pathMod.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return null;
    };
    const hints = [];
    // JS/TS family
    if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
      if (findCwd(fp, '.eslintrc.json') || findCwd(fp, '.eslintrc.cjs')
        || findCwd(fp, '.eslintrc.js') || findCwd(fp, 'eslint.config.js')
        || findCwd(fp, 'eslint.config.mjs') || findCwd(fp, 'eslint.config.cjs')) {
        hints.push(`eslint ${fp}`);
      }
      if (findCwd(fp, '.prettierrc') || findCwd(fp, '.prettierrc.json')
        || findCwd(fp, '.prettierrc.js') || findCwd(fp, 'prettier.config.js')) {
        hints.push(`prettier --check ${fp}`);
      }
    }
    // Python
    else if (ext === 'py') {
      if (findCwd(fp, 'pyproject.toml') || findCwd(fp, 'ruff.toml') || findCwd(fp, '.ruff.toml')) {
        hints.push(`ruff check ${fp}`);
      }
      if (findCwd(fp, '.flake8') || findCwd(fp, 'setup.cfg')) {
        hints.push(`flake8 ${fp}`);
      }
    }
    // Go
    else if (ext === 'go') {
      if (findCwd(fp, '.golangci.yml') || findCwd(fp, '.golangci.yaml') || findCwd(fp, '.golangci.toml')) {
        hints.push(`golangci-lint run ${fp}`);
      }
      hints.push(`gofmt -d ${fp}`);
    }
    // Ruby
    else if (ext === 'rb') {
      if (findCwd(fp, '.rubocop.yml') || findCwd(fp, '.rubocop.yaml')) {
        hints.push(`rubocop ${fp}`);
      }
    }
    if (hints.length > 0) {
      return warn(`Quality gate suggestion for ${fp}:\n    ${hints.join('\n    ')}`);
    }
    return ok();
  },

  /**
   * Session-end format/typecheck reminder. PostToolUse for now (since
   * cawdex doesn't have a Stop hook event yet). Fires once per
   * tool call but the body batches reminders rather than spam each one.
   *
   * Goal: surface "you should run `npm run typecheck` (or equivalent)
   * before considering this session done" at the end of substantial
   * work. Detects the right command via package.json scripts.
   *
   * Tracks per-session state at ~/.cawdex/state/quality-hint/<id>.json
   * so we only nudge once per session (per project).
   */
  'format-typecheck-hint': () => {
    const fp = filePath();
    if (!fp) return ok();
    const ext = fp.split('.').pop()?.toLowerCase() || '';
    // Only fires on substantial-edit file extensions
    if (!['ts', 'tsx', 'py', 'go', 'rs', 'java', 'kt'].includes(ext)) return ok();

    const fs = require('fs');
    const pathMod = require('path');
    const os = require('os');
    const rawSessionId = process.env.CAWDEX_SESSION_ID || '';
    const sessionId = /^[A-Za-z0-9_-]{1,64}$/.test(rawSessionId) ? rawSessionId : 'unknown';
    const stateDir = pathMod.join(os.homedir(), '.cawdex', 'state', 'quality-hint');
    const stateFile = pathMod.join(stateDir, `${sessionId}.json`);

    // Already nudged this session — silent
    try { if (fs.existsSync(stateFile)) return ok(); } catch { /* noop */ }

    // Look up the toolchain command via the nearest package.json (TS/JS)
    // or pyproject.toml (Python). Best-effort; no failure on missing.
    let hint = '';
    const findUp = (start, name) => {
      let dir = pathMod.dirname(start);
      for (let i = 0; i < 10; i++) {
        if (fs.existsSync(pathMod.join(dir, name))) return pathMod.join(dir, name);
        const parent = pathMod.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return null;
    };

    if (['ts', 'tsx'].includes(ext)) {
      const pj = findUp(fp, 'package.json');
      if (pj) {
        try {
          const json = JSON.parse(fs.readFileSync(pj, 'utf-8'));
          const scripts = json.scripts || {};
          const tc = scripts.typecheck || scripts['type-check'] || (json.devDependencies?.typescript ? 'tsc --noEmit' : '');
          if (tc) hint = `Before wrapping up, run typecheck: \`${tc}\``;
        } catch { /* noop */ }
      }
    } else if (ext === 'py') {
      const pj = findUp(fp, 'pyproject.toml');
      if (pj) hint = `Before wrapping up, consider \`mypy\` or \`pyright\` (per your toolchain) and \`ruff check\`.`;
    } else if (ext === 'go') {
      hint = `Before wrapping up, run \`go vet ./...\` and \`go test ./...\`.`;
    } else if (ext === 'rs') {
      hint = `Before wrapping up, run \`cargo check\` and \`cargo test\`.`;
    }

    if (!hint) return ok();

    // Record + nudge once
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({ session: sessionId, hintedAt: new Date().toISOString() }), 'utf-8');
    } catch { /* persist failure is fine */ }
    return warn(hint);
  },

  /**
   * Warn when a file edit/write leaves console.log() / print() statements.
   * Looks at the new_string / content payload only — doesn't read disk.
   */
  'console-log-warn': () => {
    const path = filePath();
    const content = fileContent();
    if (!content) return ok();
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) return ok();
    const noisy = /\bconsole\.(log|debug|info|warn|error)\s*\(/g;
    const matches = content.match(noisy);
    if (matches && matches.length > 0) {
      return warn(`${matches.length} console statement(s) in ${path}`);
    }
    return ok();
  },
};

// ── Dispatch ────────────────────────────────────────────
const fn = checks[checkName];
if (!fn) {
  // Unknown check — silently pass so an upgrade that removes a check doesn't
  // break old hooks.json entries.
  process.exit(0);
}

try {
  fn();
} catch (err) {
  // Hook bugs must not break the user's flow.
  process.stderr.write(`[ECC] hook ${checkName} error: ${err && err.message}\n`);
  process.exit(0);
}
