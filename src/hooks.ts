/**
 * Hook system — configurable pre/post tool execution hooks.
 * Hooks are scripts in ~/.grawkus/hooks/ that fire on events:
 *   - PreToolUse:  before a tool runs (can block)
 *   - PostToolUse: after a tool runs (can log/alert)
 *   - SessionStart: when a session begins
 *   - SessionStop:  when a session ends
 *
 * Hook config in ~/.grawkus/hooks.json:
 * {
 *   "hooks": [
 *     { "event": "PreToolUse", "match": "bash", "command": "node guard.js" },
 *     { "event": "PostToolUse", "match": "*", "command": "node logger.js" }
 *   ]
 * }
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getConfigDir } from './config.js';
import { shouldRunHook } from './hook-controls.js';

const HOOKS_DIR = join(getConfigDir(), 'hooks');
const HOOKS_CONFIG = join(getConfigDir(), 'hooks.json');

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionStop';

export interface HookDef {
  event: HookEvent;
  match: string;          // tool name glob or "*"
  command: string;        // shell command to run
  timeout?: number;       // ms, default 10000
  blocking?: boolean;     // if true (default for PreToolUse), can cancel the operation
  enabled?: boolean;      // default true
}

export interface HooksConfig {
  hooks: HookDef[];
}

export interface HookContext {
  event: HookEvent;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  sessionId?: string;
  cwd: string;
  /**
   * Current permission mode at the time the hook fires. Passed to the
   * hook script as $GRAWKUS_PERMISSION_MODE
   * so checks like GateGuard can no-op in 'yolo' (where the user has
   * explicitly opted in to "approve everything" and pedantic gates
   * contradict that contract).
   */
  permissionMode?: string;
}

export interface HookResult {
  allowed: boolean;       // false = blocked by hook
  message?: string;       // reason for blocking
}

function loadHooksConfig(): HooksConfig {
  if (!existsSync(HOOKS_CONFIG)) {
    return { hooks: [] };
  }
  try {
    return JSON.parse(readFileSync(HOOKS_CONFIG, 'utf-8'));
  } catch {
    return { hooks: [] };
  }
}

export function initHooksDir(): void {
  mkdirSync(HOOKS_DIR, { recursive: true });
  if (!existsSync(HOOKS_CONFIG)) {
    const defaultConfig: HooksConfig = {
      hooks: [
        {
          event: 'PostToolUse',
          match: '*',
          command: 'echo "Tool $GRAWKUS_TOOL used"',
          blocking: false,
          enabled: false,
        },
      ],
    };
    writeFileSync(HOOKS_CONFIG, JSON.stringify(defaultConfig, null, 2), 'utf-8');
  }
}

function matchesTool(pattern: string, toolName: string): boolean {
  if (pattern === '*') return true;
  if (pattern === toolName) return true;
  // Simple glob: "bash*" matches "bash", "bash_safe"
  if (pattern.endsWith('*') && toolName.startsWith(pattern.slice(0, -1))) return true;
  return false;
}

// ── Broken-hook quarantine ───────────────────────────────
// When a hook's command can't be found or crashes due to a system error
// (ENOENT, ETIMEDOUT, MODULE_NOT_FOUND, etc.) we add it to this set and
// skip it for the rest of the session. Otherwise a single bad hook will
// crash every tool call. Logged ONCE on first quarantine so the user
// knows to clean up ~/.grawkus/hooks.json.
const quarantinedHooks = new Set<string>();

function hookSignature(h: HookDef): string {
  return `${h.event}::${h.match}::${h.command}`;
}

// System-level error codes from execSync — these mean the hook's command
// couldn't run at all (file missing, shell missing, timed out). They are
// NOT "the hook intentionally returned non-zero to block the tool". When
// we see one, the hook is broken and we should never block on it.
const SYSTEM_ERROR_CODES = new Set([
  'ENOENT', 'ETIMEDOUT', 'EACCES', 'EPERM', 'EAGAIN', 'EMFILE', 'ENOMEM',
]);

function isSystemError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === 'string' && SYSTEM_ERROR_CODES.has(e.code)) return true;
  // MODULE_NOT_FOUND comes through as a plain string in err.message; the
  // err.code property is also 'MODULE_NOT_FOUND' but on the inner error.
  // Detect it from the message as well.
  if (typeof e.message === 'string' && /MODULE_NOT_FOUND|Cannot find module/.test(e.message)) return true;
  return false;
}

export async function runHooks(ctx: HookContext): Promise<HookResult> {
  const config = loadHooksConfig();
  const matching = config.hooks.filter(
    (h) =>
      h.event === ctx.event &&
      (h.enabled !== false) &&
      (!ctx.toolName || matchesTool(h.match, ctx.toolName)) &&
      !quarantinedHooks.has(hookSignature(h)),
  );

  for (const hook of matching) {
    // Apply profile-based filtering before executing
    const hookId = `${ctx.event}:${hook.match}`;
    if (!shouldRunHook(hookId, ctx.event)) {
      continue;
    }

    // Hooks receive the active context as env vars. The permission mode lets
    // GateGuard and other mode-aware hooks no-op in 'yolo' instead of
    // fighting the user's explicit trust setting.
    const perm = ctx.permissionMode || '';
    const env = {
      ...process.env,
      GRAWKUS_EVENT: ctx.event,
      GRAWKUS_TOOL: ctx.toolName || '',
      GRAWKUS_TOOL_INPUT: ctx.toolInput ? JSON.stringify(ctx.toolInput) : '',
      GRAWKUS_TOOL_OUTPUT: ctx.toolOutput || '',
      GRAWKUS_SESSION_ID: ctx.sessionId || '',
      GRAWKUS_CWD: ctx.cwd,
      GRAWKUS_PERMISSION_MODE: perm,
    };

    const isBlocking = hook.blocking ?? (ctx.event === 'PreToolUse');
    const timeout = hook.timeout ?? 10_000;

    try {
      // Shell choice:
      //   - Windows: omit the `shell` option so execSync uses cmd.exe
      //     (the documented default on win32). Previously we passed
      //     'bash', which routed through Git Bash / WSL bash and mangled
      //     Windows absolute paths like C:\… into /mnt/c/…/C:\….
      //   - Other platforms: keep /bin/bash because hook commands typically
      //     rely on POSIX shell features.
      const execOpts: Parameters<typeof execSync>[1] = {
        cwd: ctx.cwd,
        env,
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
      };
      if (process.platform !== 'win32') {
        execOpts.shell = '/bin/bash';
      }
      const result = execSync(hook.command, execOpts);

      const output = result.toString().trim();
      if (output) {
        console.log(chalk.dim(`  [hook:${ctx.event}] ${output}`));
      }
    } catch (err: unknown) {
      // A SYSTEM-level error (file missing, timeout, MODULE_NOT_FOUND)
      // means the hook is broken — quarantine it and DO NOT block the
      // tool call. Stale hooks shouldn't be able to brick the agent.
      if (isSystemError(err)) {
        const sig = hookSignature(hook);
        if (!quarantinedHooks.has(sig)) {
          quarantinedHooks.add(sig);
          const msg = err instanceof Error ? err.message : String(err);
          console.log(chalk.yellow(
            `  [hook:${ctx.event}] broken hook quarantined for this session: ${hook.match}\n` +
            `    command: ${hook.command.slice(0, 100)}\n` +
            `    reason:  ${msg.split('\n')[0].slice(0, 200)}\n` +
            `    fix:     edit ${HOOKS_CONFIG} or delete the bad entry; restart to re-enable.`,
          ));
        }
        continue;  // do NOT block on a broken hook
      }
      // A non-system error (the hook ran but exited non-zero) is treated
      // per the hook's blocking flag — that's the intentional "block this
      // tool call" path.
      if (isBlocking) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.yellow(`  [hook:${ctx.event}] BLOCKED: ${msg}`));
        return { allowed: false, message: msg };
      }
      // Non-blocking hooks just log errors
      console.log(chalk.dim(`  [hook:${ctx.event}] error (non-blocking): ${err}`));
    }
  }

  return { allowed: true };
}

/**
 * Reset the quarantine list — used by /reset-config when the user has
 * fixed their hooks.json and wants to re-enable hooks without restarting.
 */
export function clearQuarantinedHooks(): void {
  quarantinedHooks.clear();
}

export function saveHooksConfig(config: HooksConfig): void {
  mkdirSync(HOOKS_DIR, { recursive: true });
  writeFileSync(HOOKS_CONFIG, JSON.stringify(config, null, 2), 'utf-8');
}

export function listHooks(): HookDef[] {
  return loadHooksConfig().hooks;
}

export function addHook(hook: HookDef): void {
  const config = loadHooksConfig();
  config.hooks.push(hook);
  saveHooksConfig(config);
}

export function removeHook(index: number): boolean {
  const config = loadHooksConfig();
  if (index < 0 || index >= config.hooks.length) return false;
  config.hooks.splice(index, 1);
  saveHooksConfig(config);
  return true;
}
