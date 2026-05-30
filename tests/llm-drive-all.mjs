#!/usr/bin/env node
/**
 * Drive every LLM-dependent slash command against a real API.
 *
 * Uses an isolated CAWDEX_HOME temp dir so the user's real config stays
 * untouched. API key is read from OPENROUTER_API_KEY env var, or fall back
 * to the user's ~/.cawdex/config.json if they've restored it.
 *
 * Each command:
 *   - Dispatches via handleSlashCommand to get the injectPrompt
 *   - Sends to runQuery with a fresh per-test message history
 *   - Captures stdout per-test
 *   - Records: completed? tool calls used? hallucinated names attempted?
 *
 * Outputs a JSONL log to tests/llm-drive-all.log and a summary table to stdout.
 *
 * Run:
 *   $env:OPENROUTER_API_KEY = "<sk-or-...>"     # PowerShell
 *   export OPENROUTER_API_KEY="<sk-or-...>"     # POSIX
 *   node tests/llm-drive-all.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── Bootstrap: API key + temp config dir ────────────────────────────
let apiKey = process.env.OPENROUTER_API_KEY || '';
const realConfig = path.join(homedir(), '.cawdex', 'config.json');
if (!apiKey && fs.existsSync(realConfig)) {
  try {
    const real = JSON.parse(fs.readFileSync(realConfig, 'utf-8'));
    if (real.apiKey) apiKey = real.apiKey;
  } catch {}
}
if (!apiKey) {
  console.error('No OpenRouter API key found.');
  console.error('Set OPENROUTER_API_KEY env var, or restore ~/.cawdex/config.json by running `cawdex` and going through setup.');
  process.exit(2);
}

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cawdex-llm-drive-'));
process.env.CAWDEX_HOME = TMP_HOME;
process.on('exit', () => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }); } catch {}
});

// Write the test config — model + filter overridable via env so we can re-run
// just the timeouts against a different model without editing source.
const TEST_MODEL = process.env.CAWDEX_TEST_MODEL || 'inclusionai/ring-2.6-1t:free';
const TEST_FILTER = (process.env.CAWDEX_TEST_FILTER || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const TEST_CONFIG = {
  apiKey,
  baseURL: 'https://openrouter.ai/api/v1',
  model: TEST_MODEL,
  provider: 'OpenRouter',
  maxTokens: 4096,
  temperature: 0.3,
  permissionMode: 'yolo',
  dryRun: false,
  theme: 'minimal',
  showThinking: false,
};
fs.writeFileSync(path.join(TMP_HOME, 'config.json'), JSON.stringify(TEST_CONFIG, null, 2));

// ── Import Cawdex internals ────────────────────────────────────────
const dist = path.join(PROJECT_ROOT, 'dist', 'index.js');
if (!fs.existsSync(dist)) {
  console.error('dist/index.js missing. Run: npx tsc');
  process.exit(2);
}
const indexMod  = await import(pathToFileURL(dist).href);
const queryMod  = await import(pathToFileURL(path.join(PROJECT_ROOT, 'dist', 'query.js')).href);
const configMod = await import(pathToFileURL(path.join(PROJECT_ROOT, 'dist', 'config.js')).href);
const toolsMod  = await import(pathToFileURL(path.join(PROJECT_ROOT, 'dist', 'tools', 'index.js')).href);
const sessMod   = await import(pathToFileURL(path.join(PROJECT_ROOT, 'dist', 'sessions.js')).href);

const { handleSlashCommand } = indexMod;
const { runQuery }           = queryMod;
const { loadConfig }         = configMod;
const { ALL_TOOLS }          = toolsMod;
const { createSession }      = sessMod;

const VALID_TOOL_NAMES = new Set(ALL_TOOLS.map((t) => t.name));

// ── Test commands ───────────────────────────────────────────────────
// Mostly built-in commands; ECC-only ones are flagged.
const TESTS = [
  // The user's original failing scenario — should trigger web_search now
  { name: 'enrique-pram',       cmd: 'I need you to write a website for a javascript engineer named Enrique Pram. Research what the theme and selling points should be. He has completed 5 micro-credentials you choose. Don\'t worry about being factual about location/age.', kind: 'freeform', timeoutMs: 240000 },

  // Code Quality
  { name: '/tdd',               cmd: '/tdd add a counter button',                      timeoutMs: 180000 },
  { name: '/review',            cmd: '/review',                                        timeoutMs: 180000 },
  { name: '/security-review',   cmd: '/security-review',                               timeoutMs: 180000 },
  { name: '/build-fix',         cmd: '/build-fix',                                     timeoutMs: 180000 },
  { name: '/refactor',          cmd: '/refactor',                                      timeoutMs: 180000 },
  { name: '/e2e',               cmd: '/e2e login flow',                                timeoutMs: 180000 },
  { name: '/eval',              cmd: '/eval correctness of the test files',            timeoutMs: 180000 },
  { name: '/plan',              cmd: '/plan add a settings page',                      timeoutMs: 180000 },
  { name: '/verify',            cmd: '/verify',                                        timeoutMs: 180000 },
  { name: '/test-coverage',     cmd: '/test-coverage',                                 timeoutMs: 180000 },
  { name: '/update-docs',       cmd: '/update-docs',                                   timeoutMs: 180000 },

  // Git workflows — may noop if no changes; verify no crash
  { name: '/commit',            cmd: '/commit',                                        timeoutMs: 120000 },
  { name: '/pr',                cmd: '/pr',                                            timeoutMs: 120000 },

  // Walkthrough — verify the tour fires + agent goes into onboarding mode
  { name: '/walkthrough',       cmd: '/walkthrough',                                   timeoutMs: 180000 },

  // Search/research — these SHOULD use the new web_search tool
  { name: '/search-first',      cmd: '/search-first refactor the parser to use streams',timeoutMs: 180000 },
  { name: '/docs-lookup',       cmd: '/docs-lookup how to use the OpenAI SDK streaming',timeoutMs: 180000 },

  // Orchestration & multi-agent
  { name: '/orchestrate',       cmd: '/orchestrate refactor billing service',          timeoutMs: 180000 },
  { name: '/multi-plan',        cmd: '/multi-plan refactor billing service',           timeoutMs: 180000 },
  { name: '/multi-execute',     cmd: '/multi-execute add users table',                 timeoutMs: 180000 },
  { name: '/multi-backend',     cmd: '/multi-backend users,billing',                   timeoutMs: 180000 },
  { name: '/multi-frontend',    cmd: '/multi-frontend header,footer',                  timeoutMs: 180000 },
  { name: '/pr-loop',           cmd: '/pr-loop',                                       timeoutMs: 180000 },

  // Language-specific reviewers (sample, not all 10)
  { name: '/auto-review',       cmd: '/auto-review',                                   timeoutMs: 180000 },
  { name: '/ts-review',         cmd: '/ts-review',                                     timeoutMs: 180000 },
  { name: '/py-review',         cmd: '/py-review',                                     timeoutMs: 180000 },

  // Language-specific build fixes (sample)
  { name: '/ts-build-fix',      cmd: '/ts-build-fix',                                  timeoutMs: 180000 },
  { name: '/pytorch-fix',       cmd: '/pytorch-fix',                                   timeoutMs: 180000 },

  // Content engine (sample)
  { name: '/article',           cmd: '/article 5 productivity hacks for engineers',    timeoutMs: 180000 },
  { name: '/slides',            cmd: '/slides intro to TDD 5',                         timeoutMs: 180000 },
  { name: '/market-research',   cmd: '/market-research developer productivity tools',  timeoutMs: 180000 },
  { name: '/code-quality',      cmd: '/code-quality',                                  timeoutMs: 180000 },
  { name: '/skill-stocktake',   cmd: '/skill-stocktake',                               timeoutMs: 180000 },

  // Skill creation
  { name: '/skill-create',      cmd: '/skill-create',                                  timeoutMs: 180000 },

  // ECC-only (no built-in equivalent)
  { name: '/ecc-feature-development', cmd: '/ecc-feature-development add login flow',  timeoutMs: 180000 },
  { name: '/ecc-database-migration',  cmd: '/ecc-database-migration add users table',  timeoutMs: 180000 },
  { name: '/ecc-add-language-rules',  cmd: '/ecc-add-language-rules typescript',       timeoutMs: 180000 },
];

// ── Driver ──────────────────────────────────────────────────────────
const config = loadConfig();
const cwd = process.cwd();
const rlStub = { question: async () => 'y', close: () => {} };

// Use a model-suffixed log name when overriding, so we don't clobber prior runs.
const LOG_SUFFIX = process.env.CAWDEX_TEST_MODEL
  ? '.' + TEST_MODEL.replace(/[^A-Za-z0-9]+/g, '-')
  : '';
const LOG_FILE = path.join(__dirname, `llm-drive-all${LOG_SUFFIX}.log`);
fs.writeFileSync(LOG_FILE, ''); // truncate

function logJsonl(entry) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

function captureStdoutDuring(fn) {
  // Returns { captured, error } — preserves the captured string even if fn()
  // rejects (e.g. on timeout), so timeout cases don't show empty transcripts.
  const orig = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let captured = '';
  process.stdout.write = (s) => { captured += String(s); return true; };
  process.stderr.write = (s) => { captured += String(s); return true; };
  return new Promise((resolve) => {
    fn()
      .then(() => {
        process.stdout.write = orig;
        process.stderr.write = origErr;
        resolve({ captured, error: null });
      })
      .catch((e) => {
        process.stdout.write = orig;
        process.stderr.write = origErr;
        resolve({ captured, error: e });
      });
  });
}

async function withTimeout(promise, ms, label) {
  return await Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT after ${ms}ms`)), ms)),
  ]);
}

function analyzeOutput(stdout, messages) {
  const hallucinated = new Set();
  const realToolCalls = new Set();
  let errorMatched = null;

  // Scan stdout for our own "Unknown tool: X" pattern
  for (const m of stdout.matchAll(/Unknown tool: ([\w-]+)/g)) {
    hallucinated.add(m[1]);
  }

  // Scan assistant tool_calls in the message log
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const name = tc?.function?.name;
        if (!name) continue;
        if (VALID_TOOL_NAMES.has(name)) realToolCalls.add(name);
        else hallucinated.add(name);
      }
    }
  }

  // Crude error detection in stdout
  const errMatch = stdout.match(/error[:\s]+([^\n]{0,120})/i);
  if (errMatch && !/\bno error\b/i.test(errMatch[0])) errorMatched = errMatch[1].trim();

  return {
    hallucinated: [...hallucinated],
    realToolCalls: [...realToolCalls],
    errorHint: errorMatched,
  };
}

// Apply optional filter — runs only the named tests (comma-separated).
const ACTIVE_TESTS = TEST_FILTER.length
  ? TESTS.filter((t) => TEST_FILTER.includes(t.name))
  : TESTS;
if (TEST_FILTER.length && ACTIVE_TESTS.length === 0) {
  console.error(`No tests matched filter: ${TEST_FILTER.join(', ')}`);
  console.error(`Available names: ${TESTS.map((t) => t.name).join(', ')}`);
  process.exit(2);
}

console.log(`\n  ── LLM driver: ${ACTIVE_TESTS.length}/${TESTS.length} commands, model ${TEST_CONFIG.model}`);
if (TEST_FILTER.length) console.log(`     filter: ${TEST_FILTER.join(', ')}`);
console.log('');

const results = [];
for (let i = 0; i < ACTIVE_TESTS.length; i++) {
  const t = ACTIVE_TESTS[i];
  const idx = `${i + 1}/${ACTIVE_TESTS.length}`;
  process.stdout.write(`  [${idx}] ${t.name.padEnd(34)} … `);

  // Per-command session + messages so prior turns don't bleed
  const messages = [];
  const session = createSession(cwd, config.model, config.provider, 'dev');
  const mode = { current: 'dev' };

  const t0 = Date.now();
  let outcome = 'ok';
  let detail = '';
  let captured = '';
  let analysis = null;

  try {
    if (t.kind === 'freeform') {
      messages.push({ role: 'user', content: t.cmd });
    } else {
      const dispatch = handleSlashCommand(t.cmd, config, messages, session, mode);
      if (!dispatch.injectPrompt) {
        outcome = 'no-prompt';
        detail = JSON.stringify({ handled: dispatch.handled });
      } else {
        messages.push({ role: 'user', content: dispatch.injectPrompt });
      }
    }

    if (outcome === 'ok') {
      const { captured: cap, error } = await captureStdoutDuring(async () => {
        await withTimeout(
          runQuery({ config, messages, cwd, rl: rlStub, sessionId: session.id, mode: mode.current }),
          t.timeoutMs,
          t.name,
        );
      });
      captured = cap;
      if (error) {
        const msg = String(error?.message || error);
        outcome = msg.startsWith('TIMEOUT') ? 'timeout' : 'error';
        detail = msg;
      }
      // Always analyze captured + messages — hallucinations can happen before
      // a timeout fires, and we want to count them.
      analysis = analyzeOutput(captured, messages);
      if (outcome === 'ok' && analysis.hallucinated.length) {
        outcome = 'hallucinated';
        detail = `bad tool calls: ${analysis.hallucinated.join(', ')}`;
      } else if (analysis.hallucinated.length) {
        // Tag hallucinations seen during timeouts/errors in the detail
        detail += ` (also saw bad tool calls: ${analysis.hallucinated.join(', ')})`;
      }
    }
  } catch (e) {
    outcome = String(e?.message || e).startsWith('TIMEOUT') ? 'timeout' : 'error';
    detail = e?.message || String(e);
  }

  const ms = Date.now() - t0;
  const tag =
    outcome === 'ok'           ? '\x1b[32mOK\x1b[0m' :
    outcome === 'hallucinated' ? '\x1b[31mHALLU\x1b[0m' :
    outcome === 'timeout'      ? '\x1b[33mTIME\x1b[0m' :
    outcome === 'no-prompt'    ? '\x1b[33mSKIP\x1b[0m' :
                                 '\x1b[31mERR\x1b[0m';
  const real = analysis ? `tools=[${analysis.realToolCalls.join(',')}]` : '';
  console.log(`${tag}  ${(ms/1000).toFixed(1)}s ${real} ${detail ? '— ' + detail : ''}`);

  results.push({ name: t.name, outcome, ms, detail, analysis });
  logJsonl({
    name: t.name, cmd: t.cmd, outcome, ms, detail,
    analysis,
    captured: captured.slice(0, 4000), // truncate for log size
    messageCount: messages.length,
  });

  // Throttle a bit between calls to be friendly to the free tier
  await new Promise((r) => setTimeout(r, 10000));
}

// ── Summary ─────────────────────────────────────────────────────────
const tally = { ok: 0, hallucinated: 0, timeout: 0, error: 0, 'no-prompt': 0 };
for (const r of results) tally[r.outcome]++;

console.log('\n  ──────────────────────────────────────────────');
console.log(`    Total:        ${results.length}`);
console.log(`    OK:           \x1b[32m${tally.ok}\x1b[0m`);
console.log(`    Hallucinated: \x1b[31m${tally.hallucinated}\x1b[0m`);
console.log(`    Timeout:      \x1b[33m${tally.timeout}\x1b[0m`);
console.log(`    Error:        \x1b[31m${tally.error}\x1b[0m`);
console.log(`    Skipped:      \x1b[33m${tally['no-prompt']}\x1b[0m`);
console.log(`    Log:          ${LOG_FILE}`);
console.log('  ──────────────────────────────────────────────\n');

if (tally.hallucinated || tally.error) {
  console.log('Failures:');
  for (const r of results.filter((r) => r.outcome === 'hallucinated' || r.outcome === 'error')) {
    console.log(`  ${r.name.padEnd(34)} ${r.outcome.toUpperCase()}: ${r.detail}`);
  }
}

process.exit(tally.error + tally.hallucinated > 0 ? 1 : 0);
