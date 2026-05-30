import { exec, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tool, ToolResult } from './types.js';
import { getProjectStateDir, loadConfig } from '../config.js';
import { wrapCommand, detectBackend } from '../sandbox.js';

export const DEFAULT_BASH_TIMEOUT_MS = 120_000;
export const MAX_BASH_TIMEOUT_MS = 1_800_000;
export const DEFAULT_BASH_MAX_OUTPUT_CHARS = 32_000;
export const DEFAULT_BASH_MAX_OUTPUT_LINES = 400;

export function truncateBashOutput(
  raw: string,
  maxChars = envNumber('GRAWKUS_BASH_MAX_OUTPUT_CHARS', DEFAULT_BASH_MAX_OUTPUT_CHARS),
  maxLines = envNumber('GRAWKUS_BASH_MAX_OUTPUT_LINES', DEFAULT_BASH_MAX_OUTPUT_LINES),
): { output: string; truncated: boolean; omittedChars: number; omittedLines: number } {
  if (!raw) {
    return { output: '(no output)', truncated: false, omittedChars: 0, omittedLines: 0 };
  }

  const lines = raw.split(/\r?\n/);
  if (raw.length <= maxChars && lines.length <= maxLines) {
    return { output: raw, truncated: false, omittedChars: 0, omittedLines: 0 };
  }

  let tailLines = lines.slice(-maxLines);
  let tail = tailLines.join('\n');
  if (tail.length > maxChars) {
    tail = tail.slice(-maxChars);
    const firstNewline = tail.indexOf('\n');
    if (firstNewline >= 0 && firstNewline < 200) {
      tail = tail.slice(firstNewline + 1);
    }
    tailLines = tail.split(/\r?\n/);
  }

  const omittedChars = Math.max(0, raw.length - tail.length);
  const omittedLines = Math.max(0, lines.length - tailLines.length);
  const header =
    `[output truncated - omitted ${omittedLines.toLocaleString()} line${omittedLines === 1 ? '' : 's'} ` +
    `and ${omittedChars.toLocaleString()} char${omittedChars === 1 ? '' : 's'}; showing tail. ` +
    `Use grep/read with a narrower query to inspect earlier output.]`;
  return {
    output: `${header}\n${tail}`,
    truncated: true,
    omittedChars,
    omittedLines,
  };
}

function envNumber(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function inputNumber(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveBashTimeoutMs(
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): { timeoutMs: number; requestedMs?: number; capped: boolean } {
  const fallback = envNumber('GRAWKUS_BASH_TIMEOUT_MS', DEFAULT_BASH_TIMEOUT_MS, env);
  const requestedSec = inputNumber(input.timeoutSec);
  const requested = inputNumber(input.timeoutMs)
    ?? (requestedSec === null ? null : requestedSec * 1000)
    ?? inputNumber(input.timeout);
  const raw = Math.floor(requested ?? fallback);
  return {
    timeoutMs: Math.min(raw, MAX_BASH_TIMEOUT_MS),
    requestedMs: requested === null ? undefined : Math.floor(requested),
    capped: raw > MAX_BASH_TIMEOUT_MS,
  };
}

function isTimeoutError(error: unknown): boolean {
  const e = error as { killed?: boolean; signal?: string | null; message?: string };
  return e?.killed === true || e?.signal === 'SIGTERM' || /timed?\s*out|timeout/i.test(String(e?.message ?? ''));
}

/**
 * Shell tool. Kept named `bash` for tool-call API compatibility, but on
 * Windows we route through cmd.exe by default — the platform-native shell.
 *
 * Previously this tool forced `shell: 'bash'` on Windows, which picked
 * up whichever bash was on PATH (Git Bash or WSL). WSL bash has its own
 * /home/<user> namespace that doesn't contain the user's actual files,
 * and neither variant inherits the Windows env vars the model typically
 * wants to use. Result: every `echo "..." > "$USERPROFILE/Downloads/x"`
 * failed with "No such file or directory" because $USERPROFILE was empty.
 *
 * On non-Windows platforms we keep /bin/bash since that's what shell
 * conventions assume there.
 *
 * Override either platform's choice with the GRAWKUS_SHELL env
 * variable (e.g. GRAWKUS_SHELL=pwsh, GRAWKUS_SHELL=/bin/zsh).
 */
function pickShell(): string {
  const override = process.env.GRAWKUS_SHELL;
  if (override && override.trim()) return override.trim();
  return process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
}

function shellLabel(): string {
  const s = pickShell();
  const base = s.replace(/\\/g, '/').split('/').pop() || s;
  return base.replace(/\.exe$/i, '');
}

function backgroundLogPath(cwd: string): string {
  const dir = join(getProjectStateDir(cwd), 'bash-background');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(dir, `${stamp}-${randomBytes(3).toString('hex')}.log`);
}

function foregroundLogPath(cwd: string): string {
  const dir = join(getProjectStateDir(cwd), 'bash-output');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(dir, `${stamp}-${randomBytes(3).toString('hex')}.log`);
}

function writeForegroundLog(opts: {
  cwd: string;
  command: string;
  shell: string;
  timeoutMs: number;
  timedOut: boolean;
  truncated: boolean;
  stdout: string;
  stderr: string;
  errorMessage?: string;
}): string {
  const logPath = foregroundLogPath(opts.cwd);
  writeFileSync(
    logPath,
    [
      '[grawkus bash output]',
      `cwd: ${opts.cwd}`,
      `shell: ${opts.shell}`,
      `command: ${opts.command}`,
      `started_timeout_ms: ${opts.timeoutMs}`,
      `timedOut: ${opts.timedOut}`,
      `truncated: ${opts.truncated}`,
      `savedAt: ${new Date().toISOString()}`,
      opts.errorMessage ? `error: ${opts.errorMessage}` : null,
      '',
      '--- stdout ---',
      opts.stdout || '(empty)',
      '',
      '--- stderr ---',
      opts.stderr || '(empty)',
      '',
    ].filter((line): line is string => line !== null).join('\n'),
    'utf-8',
  );
  return logPath;
}

export const BashTool: Tool = {
  name: 'bash',
  description:
    `Execute a shell command and return stdout/stderr. ` +
    `Active shell on this machine: ${shellLabel()} ` +
    `(override via GRAWKUS_SHELL). ` +
    `Use for: running builds/tests, git commands, package installs, ` +
    `process management, system inspection. ` +
    `Use timeoutMs for long builds/tests/installs (max ${MAX_BASH_TIMEOUT_MS}ms). ` +
    `Use background:true for servers and inspect the returned log path. ` +
    `DO NOT use for creating or writing files — use write_file instead. ` +
    `Piping multi-line content through echo > path is fragile across ` +
    `platforms and shells; write_file handles content, paths, and ` +
    `quoting uniformly on Windows/macOS/Linux.`,
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Legacy alias for timeoutMs. Timeout in milliseconds.',
      },
      timeoutMs: {
        type: 'number',
        description: `Timeout in milliseconds (default ${DEFAULT_BASH_TIMEOUT_MS}, max ${MAX_BASH_TIMEOUT_MS}). Increase for genuinely long builds, installs, model loads, or test runs.`,
      },
      timeoutSec: {
        type: 'number',
        description: `Timeout in seconds. Alias for timeoutMs/1000 (max ${Math.floor(MAX_BASH_TIMEOUT_MS / 1000)} seconds).`,
      },
      background: {
        type: 'boolean',
        description: 'Start the command detached and return immediately with a log path. Use for dev servers and long-running services.',
      },
    },
    required: ['command'],
  },
  isReadOnly: false,
  isDestructive: true,

  async call(input, cwd): Promise<ToolResult> {
    const rawCommand = String(input.command ?? '');
    if (!rawCommand.trim()) {
      return { output: 'Error: command is required.', isError: true };
    }
    const timeout = resolveBashTimeoutMs(input);
    const shell = pickShell();

    // Sandbox wrap (no-op when level=off or backend unavailable).
    // Loading config per-call keeps the bash tool stateless and means
    // /sandbox level changes apply on the very next command.
    const cfg = loadConfig();
    const level = cfg.sandbox?.level || 'off';
    let command = rawCommand;
    let sandboxLabel = '';
    if (level !== 'off') {
      const det = detectBackend();
      if (det.available) {
        const wrapped = wrapCommand(rawCommand, { level, cwd });
        command = wrapped.cmd;
        sandboxLabel = wrapped.label;
      } else {
        // Sandbox requested but unavailable on this platform — print
        // once-per-call diagnostic. Doesn't block; falls through to
        // unsandboxed exec because failing closed silently is worse.
        process.stderr.write(`  [sandbox] requested ${level} but ${det.reason}\n`);
      }
    }
    if (sandboxLabel) {
      process.stderr.write(`  [sandbox] ${sandboxLabel}\n`);
    }

    if (input.background === true) {
      try {
        const logPath = backgroundLogPath(cwd);
        appendFileSync(
          logPath,
          `[grawkus] cwd: ${cwd}\n` +
          `[grawkus] command: ${rawCommand}\n` +
          `[grawkus] started: ${new Date().toISOString()}\n\n`,
          'utf-8',
        );
        const fd = openSync(logPath, 'a');
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(command, {
            cwd,
            shell,
            detached: true,
            stdio: ['ignore', fd, fd],
            windowsHide: true,
          });
        } finally {
          closeSync(fd);
        }
        child.unref();

        return {
          output:
            `Started background command.\n` +
            `PID: ${child.pid}\n` +
            `Log: ${logPath}\n` +
            `Inspect the log before assuming the service is ready.`,
          isError: false,
        };
      } catch (err) {
        return {
          output: `Error starting background command: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    }

    return new Promise((resolve) => {
      exec(
        command,
        {
          cwd,
          timeout: timeout.timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          shell,
        },
        (error, stdout, stderr) => {
          const timedOut = isTimeoutError(error);
          const parts = [stdout, stderr].filter(Boolean);
          if (error && parts.length === 0) parts.push(`Error: ${error.message}`);
          if (error && !timedOut && stderr.length === 0) {
            parts.push(`[command exited with error: ${error.message}]`);
          }
          const combinedOutput = parts.join('\n');
          const truncation = truncateBashOutput(combinedOutput);
          let finalOutput = truncation.output;
          let logPath: string | null = null;
          if (truncation.truncated || timedOut) {
            try {
              logPath = writeForegroundLog({
                cwd,
                command: rawCommand,
                shell,
                timeoutMs: timeout.timeoutMs,
                timedOut,
                truncated: truncation.truncated,
                stdout,
                stderr,
                errorMessage: error?.message,
              });
            } catch (logErr) {
              finalOutput += `\n\n[warning: failed to save full bash output log: ${logErr instanceof Error ? logErr.message : String(logErr)}]`;
            }
          }
          if (timedOut) {
            const capNote = timeout.capped
              ? ` Requested timeout was capped at ${MAX_BASH_TIMEOUT_MS}ms.`
              : '';
            finalOutput +=
              `\n\n[command timed out after ${timeout.timeoutMs}ms.${capNote} Try a different strategy: ` +
              `use timeoutMs for genuinely long builds/tests/installs, add the command's own timeout flag, ` +
              `split the work into smaller checks, or start services with background:true and inspect logs later.]`;
          }
          if (logPath) {
            finalOutput +=
              `\n\n[bash status: timedOut=${timedOut} truncated=${truncation.truncated} ` +
              `omittedLines=${truncation.omittedLines} omittedChars=${truncation.omittedChars} ` +
              `fullLog=${logPath}]`;
          }

          resolve({
            output: finalOutput,
            isError: !!error,
          });
        },
      );
    });
  },
};
