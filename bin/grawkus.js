#!/usr/bin/env node
// In-process best-effort: override process.emitWarning to drop DEP0040.
// Catches the warning when it's emitted late (after this runs), but does NOT
// catch warnings fired during Node's ESM bootstrap (before any user code).
// For a fully clean stderr, invoke Grawkus via:
//   node --no-deprecation bin/grawkus.js
//   NODE_OPTIONS=--no-deprecation grawkus
(() => {
  const orig = process.emitWarning;
  process.emitWarning = function patched(warning, ...rest) {
    let code;
    if (rest[0] && typeof rest[0] === 'object') code = rest[0].code;
    else code = rest[1];
    if (code === 'DEP0040') return;
    return orig.call(this, warning, ...rest);
  };
})();

// ── --debug [level] flag ───────────────────────────────────
// Parse here at the entry point so that the env var is set BEFORE
// any module-level code in dist/index.js reads it. The debug
// instrumentation in src/debug.ts checks $GRAWKUS_DEBUG at
// init time; setting it from argv keeps the implementation in one
// place (env var as single source of truth).
//
// Accepted forms:
//   --debug              → info
//   --debug=trace        → trace
//   --debug trace        → trace
//   --debug=on           → info  (alias)
//   --debug=off          → off
//
// Invalid levels fall back to 'info' with a one-line stderr notice.
(() => {
  const argv = process.argv;
  const VALID = new Set(['off', 'info', 'debug', 'trace', 'on']);
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--debug') {
      const next = argv[i + 1];
      if (next && VALID.has(next.toLowerCase())) {
        process.env.GRAWKUS_DEBUG = next.toLowerCase() === 'on' ? 'info' : next.toLowerCase();
        argv.splice(i, 2);
      } else {
        process.env.GRAWKUS_DEBUG = 'info';
        argv.splice(i, 1);
      }
      break;
    }
    if (a && a.startsWith('--debug=')) {
      const lvl = a.slice('--debug='.length).toLowerCase();
      if (VALID.has(lvl)) {
        process.env.GRAWKUS_DEBUG = lvl === 'on' ? 'info' : lvl;
      } else {
        process.stderr.write(`[grawkus] unknown --debug level "${lvl}"; defaulting to 'info'.\n`);
        process.env.GRAWKUS_DEBUG = 'info';
      }
      argv.splice(i, 1);
      break;
    }
  }
})();

// ── --prompt / --prompt-file (non-interactive single-chain mode) ──
//
// When this CLI is being driven by an external harness (Terminal-Bench,
// CI scripts, etc.) we need a way to:
//   1. accept a prompt without opening the REPL
//   2. run one runQuery chain to completion
//   3. exit with a meaningful code (0 = success, 1 = error)
//
// Two surface forms:
//   --prompt "do the thing"        — inline text
//   --prompt-file path/to/task.txt — read from disk; useful for long
//                                    or multi-line task descriptions
//                                    that would otherwise need careful
//                                    shell quoting.
//
// We export the resolved prompt via GRAWKUS_PROMPT (or
// GRAWKUS_PROMPT_FILE, which the loader reads with fs.readFile).
// src/index.ts branches on these env vars near the top of main() and
// skips the REPL entirely.
//
// A bare `--non-interactive` flag is also accepted as a no-prompt
// signal — useful when paired with a config that already has
// `__grawkusQueuedInput` set, but mostly an alias for the same path.
// ESM-safe sync FS load. import() is async (returns a promise) and the
// flag parser MUST run synchronously before the dynamic import of
// dist/index.js below. createRequire gives us a real CommonJS require
// inside ESM — same path Node recommends for sync fs in ESM scripts.
const { createRequire } = await import('node:module');
const __require = createRequire(import.meta.url);

function printCliHelp() {
  const pkg = __require('../package.json');
  process.stdout.write(`Grawkus — terminal coding agents with a mind for the whole repo
version ${pkg.version}

Usage:
  grawkus [options]
  grawkus doctor [--json] [--no-registry]
  grawkus --prompt "fix the failing test" [options]
  grawkus --prompt-file task.txt [options]

Options:
  -h, --help                         Show this help and exit.
  -v, --version                      Print the installed version and exit.
  --provider <name>                  Use a provider for this run.
  --model <model>                    Override the configured model.
  --fallback-model <model>           Override the fallback model.
  --base-url <url>                   Override the OpenAI-compatible base URL.
  --api-key <key>                    Use an API key for this run.
  --api-key-env <name>               Read the API key from an environment variable.
  --perm <ask|auto|yolo>             Override permission mode.
  --prompt <text>                    Run one non-interactive task.
  --prompt-file <path>               Run one task read from a file.
  --non-interactive                  Disable the interactive REPL path.
  --max-turns <n>                    Limit non-interactive agent turns.
  --max-tokens <n>                   Override max output tokens.
  --context-window-tokens <n>        Override context window estimate.
  --temperature <n>                  Override model temperature.
  --output-format <text|json>        Set non-interactive output format.
  --benchmark-trace-dir <path>       Write benchmark trace artifacts.
  --openai-oauth-smoke               Test Codex OAuth auth, request, and stream parsing.
  --doctor                           Run install/config/benchmark readiness checks.
  --doctor-json                      Run readiness checks and print JSON.
  --doctor-no-registry               Skip the npm registry check in doctor mode.
  --debug[=<off|info|debug|trace>]   Enable wrapper debug logging.

Packaged paths:
  --print-terminal-bench-adapter
  --print-kbench-adapter
  --print-hal-agent
  --print-exgentic-agent
  --print-open-agent-card
`);
}

(() => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') {
    printCliHelp();
    process.exit(0);
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    const pkg = __require('../package.json');
    process.stdout.write(`${pkg.version}\n`);
    process.exit(0);
  }
})();

(() => {
  const argv = process.argv;
  const wantsDoctor = argv.slice(2).some((a) => a === 'doctor' || a === '--doctor' || a === '--doctor-json');
  if (!wantsDoctor) return;

  process.env.GRAWKUS_DOCTOR = '1';
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'doctor' || a === '--doctor') {
      argv.splice(i, 1);
      i--;
      continue;
    }
    if (a === '--doctor-json' || a === '--json') {
      process.env.GRAWKUS_DOCTOR_JSON = '1';
      argv.splice(i, 1);
      i--;
      continue;
    }
    if (a === '--doctor-no-registry' || a === '--no-registry') {
      process.env.GRAWKUS_DOCTOR_REGISTRY = '0';
      argv.splice(i, 1);
      i--;
      continue;
    }
  }
})();

function readFlagValue(argv, index, flag) {
  const current = argv[index];
  const prefix = `${flag}=`;
  if (current && current.startsWith(prefix)) {
    return { value: current.slice(prefix.length), removeCount: 1 };
  }
  const next = argv[index + 1];
  if (typeof next !== 'string' || next.startsWith('--')) {
    process.stderr.write(`[grawkus] ${flag} requires an argument.\n`);
    process.exit(2);
  }
  return { value: next, removeCount: 2 };
}

(() => {
  const fs = __require('node:fs');
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompt') {
      const next = argv[i + 1];
      if (typeof next !== 'string') {
        process.stderr.write('[grawkus] --prompt requires an argument.\n');
        process.exit(2);
      }
      process.env.GRAWKUS_PROMPT = next;
      process.env.GRAWKUS_NON_INTERACTIVE = '1';
      argv.splice(i, 2);
      i--;
      continue;
    }
    if (a && a.startsWith('--prompt=')) {
      process.env.GRAWKUS_PROMPT = a.slice('--prompt='.length);
      process.env.GRAWKUS_NON_INTERACTIVE = '1';
      argv.splice(i, 1);
      i--;
      continue;
    }
    if (a === '--prompt-file') {
      const next = argv[i + 1];
      if (typeof next !== 'string') {
        process.stderr.write('[grawkus] --prompt-file requires a path.\n');
        process.exit(2);
      }
      try {
        process.env.GRAWKUS_PROMPT = fs.readFileSync(next, 'utf8');
      } catch (err) {
        process.stderr.write(`[grawkus] could not read --prompt-file: ${err && err.message ? err.message : err}\n`);
        process.exit(2);
      }
      process.env.GRAWKUS_NON_INTERACTIVE = '1';
      argv.splice(i, 2);
      i--;
      continue;
    }
    if (a === '--non-interactive') {
      process.env.GRAWKUS_NON_INTERACTIVE = '1';
      argv.splice(i, 1);
      i--;
      continue;
    }
    if (a === '--openai-oauth-smoke') {
      process.env.GRAWKUS_OPENAI_OAUTH_SMOKE = '1';
      process.env.GRAWKUS_NON_INTERACTIVE = '1';
      process.env.GRAWKUS_PROVIDER = process.env.GRAWKUS_PROVIDER || 'openai-codex';
      process.env.GRAWKUS_ENV_CONFIG = '1';
      argv.splice(i, 1);
      i--;
      continue;
    }
    // --perm <mode>: override permission mode without touching saved
    // config. Critical for harness runs that want yolo without
    // mutating the user's interactive config file.
    if (a === '--perm') {
      const next = argv[i + 1];
      if (next && /^(ask|auto|yolo)$/.test(next)) {
        process.env.GRAWKUS_PERM_OVERRIDE = next;
        argv.splice(i, 2);
        i--;
        continue;
      }
      process.stderr.write('[grawkus] --perm requires ask|auto|yolo.\n');
      process.exit(2);
    }
    if (a === '--model' || (a && a.startsWith('--model='))) {
      const { value, removeCount } = readFlagValue(argv, i, '--model');
      process.env.GRAWKUS_MODEL = value;
      process.env.GRAWKUS_MODEL_OVERRIDE = value;
      argv.splice(i, removeCount);
      i--;
      continue;
    }
    if (a === '--fallback-model' || (a && a.startsWith('--fallback-model='))) {
      const { value, removeCount } = readFlagValue(argv, i, '--fallback-model');
      process.env.GRAWKUS_FALLBACK_MODEL = value;
      process.env.GRAWKUS_FALLBACK_MODEL_OVERRIDE = value;
      argv.splice(i, removeCount);
      i--;
      continue;
    }
    if (a === '--provider' || (a && a.startsWith('--provider='))) {
      const { value, removeCount } = readFlagValue(argv, i, '--provider');
      process.env.GRAWKUS_PROVIDER = value;
      process.env.GRAWKUS_ENV_CONFIG = '1';
      argv.splice(i, removeCount);
      i--;
      continue;
    }
    if (a === '--base-url' || (a && a.startsWith('--base-url='))) {
      const { value, removeCount } = readFlagValue(argv, i, '--base-url');
      process.env.GRAWKUS_BASE_URL = value;
      process.env.GRAWKUS_BASE_URL_OVERRIDE = value;
      argv.splice(i, removeCount);
      i--;
      continue;
    }
    if (a === '--api-key' || (a && a.startsWith('--api-key='))) {
      const { value, removeCount } = readFlagValue(argv, i, '--api-key');
      process.env.GRAWKUS_API_KEY = value;
      process.env.GRAWKUS_API_KEY_OVERRIDE = value;
      argv.splice(i, removeCount);
      i--;
      continue;
    }
    if (a === '--api-key-env' || (a && a.startsWith('--api-key-env='))) {
      const { value, removeCount } = readFlagValue(argv, i, '--api-key-env');
      process.env.GRAWKUS_API_KEY_ENV = value;
      if (process.env[value]) {
        process.env.GRAWKUS_API_KEY = process.env[value];
        process.env.GRAWKUS_API_KEY_OVERRIDE = process.env[value];
      }
      argv.splice(i, removeCount);
      i--;
      continue;
    }
    if (a === '--max-turns' || (a && a.startsWith('--max-turns='))) {
      const { value, removeCount } = readFlagValue(argv, i, '--max-turns');
      process.env.GRAWKUS_MAX_TURNS = value;
      process.env.GRAWKUS_MAX_TURNS_OVERRIDE = value;
      argv.splice(i, removeCount);
      i--;
      continue;
    }
    if (a === '--max-tokens' || (a && a.startsWith('--max-tokens='))) {
      const { value, removeCount } = readFlagValue(argv, i, '--max-tokens');
      process.env.GRAWKUS_MAX_TOKENS = value;
      process.env.GRAWKUS_MAX_TOKENS_OVERRIDE = value;
      argv.splice(i, removeCount);
      i--;
      continue;
    }
    if (a === '--context-window-tokens' || (a && a.startsWith('--context-window-tokens='))) {
      const { value, removeCount } = readFlagValue(argv, i, '--context-window-tokens');
      process.env.GRAWKUS_CONTEXT_WINDOW_TOKENS = value;
      process.env.GRAWKUS_CONTEXT_WINDOW_TOKENS_OVERRIDE = value;
      argv.splice(i, removeCount);
      i--;
      continue;
    }
    if (a === '--temperature' || (a && a.startsWith('--temperature='))) {
      const { value, removeCount } = readFlagValue(argv, i, '--temperature');
      process.env.GRAWKUS_TEMPERATURE = value;
      process.env.GRAWKUS_TEMPERATURE_OVERRIDE = value;
      argv.splice(i, removeCount);
      i--;
      continue;
    }
    if (a === '--output-format' || (a && a.startsWith('--output-format='))) {
      const { value, removeCount } = readFlagValue(argv, i, '--output-format');
      process.env.GRAWKUS_OUTPUT_FORMAT = value;
      argv.splice(i, removeCount);
      i--;
      continue;
    }
    if (a === '--benchmark-trace-dir' || (a && a.startsWith('--benchmark-trace-dir='))) {
      const { value, removeCount } = readFlagValue(argv, i, '--benchmark-trace-dir');
      process.env.GRAWKUS_BENCHMARK_TRACE_DIR = value;
      argv.splice(i, removeCount);
      i--;
      continue;
    }
  }
})();

(() => {
  const argv = process.argv;
  const idx = argv.indexOf('--print-terminal-bench-adapter');
  if (idx !== -1) {
    const path = __require('node:path');
    const { fileURLToPath } = __require('node:url');
    const binDir = path.dirname(fileURLToPath(import.meta.url));
    process.stdout.write(path.resolve(binDir, '..', 'resources', 'terminal_bench', 'grawkus_agent.py') + '\n');
    process.exit(0);
  }
  const kbenchIdx = argv.indexOf('--print-kbench-adapter');
  if (kbenchIdx !== -1) {
    const path = __require('node:path');
    const { fileURLToPath } = __require('node:url');
    const binDir = path.dirname(fileURLToPath(import.meta.url));
    process.stdout.write(path.resolve(binDir, '..', 'resources', 'kbench', 'grawkus_agent') + '\n');
    process.exit(0);
  }
  const halIdx = argv.indexOf('--print-hal-agent');
  if (halIdx !== -1) {
    const path = __require('node:path');
    const { fileURLToPath } = __require('node:url');
    const binDir = path.dirname(fileURLToPath(import.meta.url));
    process.stdout.write(path.resolve(binDir, '..', 'resources', 'hal', 'grawkus_agent') + '\n');
    process.exit(0);
  }
  const exgenticIdx = argv.indexOf('--print-exgentic-agent');
  if (exgenticIdx !== -1) {
    const path = __require('node:path');
    const { fileURLToPath } = __require('node:url');
    const binDir = path.dirname(fileURLToPath(import.meta.url));
    process.stdout.write(path.resolve(binDir, '..', 'resources', 'exgentic', 'grawkus_agent') + '\n');
    process.exit(0);
  }
  const agentCardIdx = argv.indexOf('--print-open-agent-card');
  if (agentCardIdx !== -1) {
    const path = __require('node:path');
    const { fileURLToPath } = __require('node:url');
    const binDir = path.dirname(fileURLToPath(import.meta.url));
    process.stdout.write(path.resolve(binDir, '..', 'resources', 'open_agent_leaderboard', 'grawkus-agent-card.md') + '\n');
    process.exit(0);
  }
})();

import('../dist/index.js');
