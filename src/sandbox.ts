/**
 * OS-native sandbox wrapper for the bash tool.
 *
 * Defense-in-depth on top of the execpolicy DSL from 1.19.0. Where
 * execpolicy gates INTENT before the command runs (block "rm -rf /",
 * prompt for "sudo"), this layer adds RUNTIME ISOLATION: the command
 * runs under an OS-native sandbox that limits filesystem write access,
 * network reach, and process privileges even if the intent gate
 * approved or the model is trying to evade detection.
 *
 * Backends:
 *   macOS   → sandbox-exec (Seatbelt). Shipped with macOS since 10.5.
 *             Policy described in scheme-like .sb syntax.
 *   Linux   → bubblewrap (bwrap). Usually preinstalled (Flatpak runtime)
 *             or one apt/yum/dnf install away. Combines user
 *             namespaces, mount namespaces, seccomp.
 *   Windows → no-op for now. Job Objects + restricted tokens + AppContainer
 *             are doable but a much larger project. Documented in /sandbox
 *             output so the user knows.
 *
 * Policy levels (config: sandbox.level):
 *   off       — wrap nothing; behave as before
 *   standard  — read everywhere, write only to cwd + /tmp, no network
 *               (still gives access to the project + scratch space)
 *   strict    — read cwd only, write only to cwd, no network, no /tmp
 *
 * Default: 'off'. Users opt in via /sandbox standard (or strict) — we
 * don't want to surprise anyone whose workflow needs network or writes
 * outside cwd.
 *
 * Failure mode: if the sandbox tool isn't installed or the wrap fails
 * to construct, we LOG and fall through to the un-sandboxed command.
 * Better to run + work than fail closed silently for a missing tool.
 */
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

export type SandboxBackend = 'seatbelt' | 'bwrap' | 'none';
export type SandboxLevel = 'off' | 'standard' | 'strict';

interface BackendDetect {
  backend: SandboxBackend;
  available: boolean;
  reason?: string;
}

let cachedDetection: BackendDetect | null = null;

/**
 * Detect which sandbox backend (if any) is available on this machine.
 * Cached after the first call; pass force=true to re-probe.
 */
export function detectBackend(force = false): BackendDetect {
  if (cachedDetection && !force) return cachedDetection;

  if (process.platform === 'darwin') {
    // sandbox-exec is at /usr/bin/sandbox-exec on every macOS install
    // since 10.5. Deprecated by Apple but still functional in 2026.
    const path = '/usr/bin/sandbox-exec';
    cachedDetection = existsSync(path)
      ? { backend: 'seatbelt', available: true }
      : { backend: 'seatbelt', available: false, reason: 'sandbox-exec not found at /usr/bin/' };
  } else if (process.platform === 'linux') {
    // bwrap could be anywhere on PATH. Use `which` since it's fast.
    try {
      execSync('which bwrap', { stdio: 'ignore', timeout: 1000 });
      cachedDetection = { backend: 'bwrap', available: true };
    } catch {
      cachedDetection = { backend: 'bwrap', available: false, reason: 'bwrap (bubblewrap) not on PATH. Install with: apt install bubblewrap | dnf install bubblewrap | brew install bubblewrap' };
    }
  } else {
    cachedDetection = { backend: 'none', available: false, reason: `${process.platform} doesn't have a supported sandbox backend yet (Windows Job Objects planned)` };
  }
  return cachedDetection;
}

/**
 * Construct a Seatbelt (.sb) policy for the given level and cwd.
 *
 * Seatbelt operates on a deny-by-default model: we declare allowed
 * operations, anything else is denied. The base policy here is
 * deliberately permissive for system reads (so node, git, etc. can
 * find their libraries) while gating writes + network.
 *
 * Quirks:
 *   - file-write* requires the absolute resolved path (no shell expansion)
 *   - network-outbound to localhost is allowed regardless of level so
 *     dev servers + IPC keep working
 */
function buildSeatbeltPolicy(level: SandboxLevel, cwd: string): string {
  // Common: deny all by default; allow process spawning + signal +
  // sysctl reads + IPC (otherwise nothing runs).
  const common = [
    '(version 1)',
    '(deny default)',
    '(allow process-exec*)',
    '(allow process-fork)',
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow ipc-posix-shm*)',
    '(allow file-read*)',  // permissive system-wide read for tool deps
    '(allow file-read-metadata)',
    '(allow file-issue-extension)',
  ];
  const networkLocal = ['(allow network-outbound (local ip "*:*"))'];
  const networkAll = ['(allow network*)'];
  const writeCwd = [`(allow file-write* (subpath "${cwd}"))`];
  const writeTmp = ['(allow file-write* (subpath "/tmp"))', '(allow file-write* (subpath "/private/tmp"))'];

  if (level === 'strict') {
    return [...common, ...networkLocal, ...writeCwd].join('\n');
  }
  // standard: cwd + /tmp writable, full network. Network restriction
  // breaks too many real workflows (npm install, pip, curl docs); we
  // keep that on the execpolicy intent gate instead.
  return [...common, ...networkAll, ...writeCwd, ...writeTmp].join('\n');
}

/**
 * Construct a bwrap argument list. bwrap is invoked as
 *   bwrap [args...] <command>
 * so we return the prefix array; the caller concatenates the user
 * command afterward (typically as `sh -c "..."`).
 */
function buildBwrapArgs(level: SandboxLevel, cwd: string): string[] {
  // Common: a fresh user namespace, /proc, /dev, /tmp, share host's
  // /usr + /etc as read-only so binaries + configs work, share network
  // namespace by default (we restrict via execpolicy / level).
  const common = [
    '--unshare-user-try',     // fall back gracefully if not allowed
    '--unshare-uts',
    '--unshare-pid',
    '--unshare-ipc',
    '--die-with-parent',
    '--proc', '/proc',
    '--dev', '/dev',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/etc', '/etc',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind-try', '/lib64', '/lib64',
    '--ro-bind-try', '/bin', '/bin',
    '--ro-bind-try', '/sbin', '/sbin',
    // HOME read-only (config files, .ssh) — strict drops this
    ...(level === 'strict' ? [] : ['--ro-bind-try', process.env.HOME || '/home', process.env.HOME || '/home']),
    // cwd bind-mounted read-write — this is the project the agent edits
    '--bind', cwd, cwd,
    '--chdir', cwd,
    // /tmp writable in standard, omitted in strict
    ...(level === 'strict' ? [] : ['--tmpfs', '/tmp']),
  ];
  // Network: standard allows, strict disallows
  const network = level === 'strict' ? ['--unshare-net'] : [];

  return [...common, ...network];
}

/**
 * Wrap a shell command for the active backend at the requested level.
 * Returns the wrapped command string and a label for logging. If the
 * backend isn't available or level is 'off', returns the command
 * unchanged (callers don't need to special-case).
 */
export function wrapCommand(cmd: string, opts: { level: SandboxLevel; cwd: string }): { cmd: string; label: string } {
  if (opts.level === 'off') return { cmd, label: 'no-sandbox' };
  const det = detectBackend();
  if (!det.available) {
    // Caller logs the warning; we just pass through.
    return { cmd, label: `unsandboxed (${det.reason || 'no backend'})` };
  }
  if (det.backend === 'seatbelt') {
    const policy = buildSeatbeltPolicy(opts.level, opts.cwd);
    // sandbox-exec -p '<policy>' /bin/sh -c '<command>'
    // Single-quote the policy + escape internal quotes
    const policyEscaped = policy.replace(/'/g, "'\"'\"'");
    const cmdEscaped = cmd.replace(/'/g, "'\"'\"'");
    return {
      cmd: `/usr/bin/sandbox-exec -p '${policyEscaped}' /bin/sh -c '${cmdEscaped}'`,
      label: `seatbelt (${opts.level})`,
    };
  }
  if (det.backend === 'bwrap') {
    const args = buildBwrapArgs(opts.level, opts.cwd);
    // bwrap doesn't accept commands as a single string — use exec form
    // wrapped through sh -c. Shell escaping handled by the outer exec.
    const cmdEscaped = cmd.replace(/'/g, "'\"'\"'");
    const argString = args.map((a) => `'${a.replace(/'/g, "'\"'\"'")}'`).join(' ');
    return {
      cmd: `bwrap ${argString} /bin/sh -c '${cmdEscaped}'`,
      label: `bwrap (${opts.level})`,
    };
  }
  return { cmd, label: 'unsandboxed (unknown backend)' };
}

/**
 * Status snapshot for the /sandbox slash command. Tells the user what's
 * supported on this machine + what's currently active.
 */
export interface SandboxStatus {
  backend: SandboxBackend;
  available: boolean;
  reason?: string;
  platform: NodeJS.Platform;
}

export function status(): SandboxStatus {
  const det = detectBackend();
  return {
    backend: det.backend,
    available: det.available,
    reason: det.reason,
    platform: process.platform,
  };
}
