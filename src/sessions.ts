/**
 * Session persistence — save, resume, list, delete conversations.
 * Stores sessions as JSON files in ~/.grawkus/sessions/
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config.js';
import type { Message } from './types.js';

// Lazy — evaluated per call instead of cached at module load. The
// cached form prevented tests + sandboxed runs from overriding the
// state dir via GRAWKUS_HOME, because the first import froze
// it at the user's real ~/.grawkus/sessions. getConfigDir()
// is itself cheap; recomputing per call has zero observable cost.
function getSessionsDir(): string {
  return join(getConfigDir(), 'sessions');
}

// Simple write lock to prevent concurrent writes
let isWriting = false;
const writeQueue: (() => Promise<void>)[] = [];

async function acquireWriteLock(fn: () => void): Promise<void> {
  return new Promise((resolve) => {
    const task = async () => {
      fn();
      resolve();
    };

    if (!isWriting) {
      isWriting = true;
      task().finally(() => {
        isWriting = false;
        const next = writeQueue.shift();
        if (next) next();
      });
    } else {
      writeQueue.push(task);
    }
  });
}

export interface Session {
  id: string;
  name: string;
  cwd: string;
  model: string;
  provider: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  tokenCount: number;
  turnCount: number;
  mode: string;
  /**
   * Permission mode active when the session was last saved. Optional
   * for back-compat — pre-v1.30.2 session files don't have this field.
   * Restored by /resume so a yolo session resumes in yolo, not in
   * whatever mode the current REPL happens to be in.
   */
  permissionMode?: 'ask' | 'auto' | 'yolo';
}

function ensureDir(): void {
  mkdirSync(getSessionsDir(), { recursive: true });
}

function sessionPath(id: string): string {
  return join(getSessionsDir(), `${id}.json`);
}

export function generateSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

export function saveSession(session: Session): Promise<void> {
  return acquireWriteLock(() => {
    ensureDir();
    session.updatedAt = new Date().toISOString();
    session.turnCount = session.messages.filter((m) => m.role === 'user').length;
    writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2), 'utf-8');
  });
}

export function loadSession(id: string): Session | null {
  const p = sessionPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function listSessions(): Pick<Session, 'id' | 'name' | 'cwd' | 'model' | 'createdAt' | 'updatedAt' | 'turnCount'>[] {
  ensureDir();
  const files = readdirSync(getSessionsDir()).filter((f) => f.endsWith('.json'));
  const sessions: ReturnType<typeof listSessions> = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(getSessionsDir(), file), 'utf-8');
      const s = JSON.parse(raw) as Session;
      sessions.push({
        id: s.id,
        name: s.name,
        cwd: s.cwd,
        model: s.model,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        turnCount: s.turnCount,
      });
    } catch {
      // skip corrupt files
    }
  }

  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteSession(id: string): boolean {
  const p = sessionPath(id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

/**
 * Resolve a user-provided session reference to a canonical session ID.
 * Accepts:
 *   - Exact session ID (any length)
 *   - Unique prefix match (like `git checkout <short-sha>`). If multiple
 *     sessions share the prefix, returns null + the candidate list via
 *     the second return slot so the caller can show a helpful error.
 *   - "last" or "latest" → the most-recently-updated session
 *
 * Wrappers (`<id>`, `"id"`, etc.) are stripped before matching — the
 * same forgiving input handling as /stitch-config. This matches user
 * muscle memory: "/resume <id>" gets typed instinctively because the
 * /help line shows `<session-id>` as a placeholder.
 *
 * Returns:
 *   { id: string }            on success
 *   { error: string, candidates?: string[] }  on ambiguity or no match
 */
export function resolveSessionRef(raw: string): { id: string } | { error: string; candidates?: string[] } {
  let ref = raw.trim();
  // Strip a paired wrap: <>, "", '', ``, [], ()
  const wraps: Array<[string, string]> = [
    ['<', '>'], ['"', '"'], ["'", "'"], ['`', '`'], ['[', ']'], ['(', ')'],
  ];
  for (const [open, close] of wraps) {
    if (ref.startsWith(open) && ref.endsWith(close) && ref.length > 2) {
      ref = ref.slice(1, -1).trim();
      break;
    }
  }
  if (!ref) return { error: 'empty session reference' };

  // Shortcut: "last" / "latest" → most-recent by updatedAt
  if (ref === 'last' || ref === 'latest') {
    const sessions = listSessions();
    if (sessions.length === 0) return { error: 'no saved sessions' };
    return { id: sessions[0].id };
  }

  // Exact match — fastest path, also lets the user re-resume the
  // currently-active session by its full ID.
  if (existsSync(sessionPath(ref))) return { id: ref };

  // Prefix match — the /sessions display previously truncated IDs
  // to 12 chars, so users naturally copy a partial ID. Behave like
  // git: if exactly one session starts with the prefix, use it; if
  // multiple, list them.
  ensureDir();
  const ids = readdirSync(getSessionsDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5));
  const matches = ids.filter((id) => id.startsWith(ref));
  if (matches.length === 1) return { id: matches[0] };
  if (matches.length > 1) {
    return {
      error: `ambiguous prefix "${ref}" — matches ${matches.length} sessions`,
      candidates: matches,
    };
  }
  return { error: `no session ID starts with "${ref}"` };
}

export function createSession(cwd: string, model: string, provider: string, mode: string): Session {
  return {
    id: generateSessionId(),
    name: `Session ${new Date().toLocaleString()}`,
    cwd,
    model,
    provider,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tokenCount: 0,
    turnCount: 0,
    mode,
  };
}

/**
 * Optional snapshot of the live state that should be written into the
 * session file alongside messages. Without this, the saved session
 * captures only the values that happened to be on the Session object
 * at create time — mode/perm switches mid-session never make it to
 * disk, and /resume restores stale values.
 */
export interface AutoSaveSnapshot {
  model?: string;
  provider?: string;
  mode?: string;
  permissionMode?: 'ask' | 'auto' | 'yolo';
  cwd?: string;
}

export async function autoSave(
  session: Session,
  messages: Message[],
  snapshot?: AutoSaveSnapshot,
): Promise<void> {
  session.messages = messages;
  // Pull live state forward if the caller passed it. This is what
  // makes /resume actually restore a yolo session as yolo, an
  // architect-mode session as architect, etc. Defensively skip any
  // fields the caller didn't provide so old callsites that don't
  // pass the snapshot still work (just won't see drift captured).
  if (snapshot) {
    if (snapshot.model) session.model = snapshot.model;
    if (snapshot.provider) session.provider = snapshot.provider;
    if (snapshot.mode) session.mode = snapshot.mode;
    if (snapshot.permissionMode) session.permissionMode = snapshot.permissionMode;
    if (snapshot.cwd) session.cwd = snapshot.cwd;
  }
  await saveSession(session);
}
