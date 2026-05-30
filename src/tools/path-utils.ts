/**
 * Path resolution for file-touching tools.
 *
 * Wraps node:path.resolve with two universally-expected behaviors:
 *   1. `~/…` expands to the user's home directory (os.homedir()), which
 *      Node's resolve() does NOT do natively. Without this, the model's
 *      common idiom of `~/Downloads/foo.txt` resolves to a literal `~`
 *      directory inside cwd and fails with ENOENT.
 *   2. `$VAR/…` / `%VAR%/…` are NOT expanded here — that's the shell's job
 *      and we don't want to leak env values into file paths silently.
 *
 * Returns an absolute path suitable for fs operations on any platform.
 */
import { resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

export function resolveUserPath(cwd: string, input: string): string {
  if (!input) return cwd;
  // Tilde expansion: `~`, `~/`, `~\` only — `~user/...` is intentionally
  // unsupported because it requires resolving the OS user database and
  // is rarely used in agent workflows. Anyone needing it can spell out
  // the full path.
  if (input === '~') return homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return resolve(homedir(), input.slice(2));
  }
  if (isAbsolute(input)) return resolve(input);
  return resolve(cwd, input);
}
