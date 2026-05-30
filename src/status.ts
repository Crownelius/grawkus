/**
 * Runtime status — "what is the agent doing right now?"
 *
 * A tiny global state object that runQuery updates at each transition and
 * the F1 "what's happening?" hotkey reads back via TTS. Lets blind users
 * press F1 and hear "calling claude-sonnet-4, 8 seconds elapsed" instead
 * of sitting in front of a silent terminal wondering if it crashed.
 *
 * State machine (happy path):
 *
 *   idle → recording → transcribing → streaming → responding → idle
 *                                         ↘ tool-call → streaming ↗
 *                                         ↘ compacting → streaming ↗
 *
 * `since` is reset only when the state actually changes — that way pressing
 * F1 twice in a row reports the same elapsed-since-this-state, not a tiny
 * delta from the last read.
 *
 * setStatus is fire-and-forget from anywhere; getStatus / describeStatus
 * are pure reads. No allocations on the hot streaming path.
 */

export type AgentState =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'streaming'      // API request in flight, before first token
  | 'responding'     // tokens are arriving
  | 'tool-call'      // executing a tool (detail = tool name + brief arg)
  | 'compacting';    // context compaction running

export interface RuntimeStatus {
  state: AgentState;
  detail?: string;       // e.g. "bash: rm -rf /tmp/x", "read_file: src/foo.ts"
  since: number;         // ms timestamp when current state was entered
  model?: string;
  provider?: string;
  mode?: string;
  permissionMode?: string;
}

let currentStatus: RuntimeStatus = { state: 'idle', since: Date.now() };

/**
 * Update one or more fields. Resets `since` only when `state` changes
 * (so reading status twice doesn't lie about how long we've been here).
 */
export function setStatus(patch: Partial<RuntimeStatus>): void {
  if (patch.state && patch.state !== currentStatus.state) {
    currentStatus = { ...currentStatus, ...patch, since: Date.now() };
  } else {
    currentStatus = { ...currentStatus, ...patch };
  }
}

export function getStatus(): RuntimeStatus {
  return currentStatus;
}

/**
 * Short, speakable description of the current state. Designed to be read
 * aloud through TTS — short enough not to feel chatty, specific enough to
 * be useful while waiting.
 */
export function describeStatus(): string {
  const s = currentStatus;
  const elapsed = Math.max(0, Math.floor((Date.now() - s.since) / 1000));
  const elapsedPart = elapsed >= 2 ? `, ${elapsed} seconds elapsed` : '';
  switch (s.state) {
    case 'idle':
      return 'Idle, ready for input.';
    case 'recording':
      return `Recording${elapsedPart}.`;
    case 'transcribing':
      return `Transcribing audio${elapsedPart}.`;
    case 'streaming':
      return `Calling ${s.model || 'the model'}, waiting for first token${elapsedPart}.`;
    case 'responding':
      return `Receiving response from ${s.model || 'the model'}${elapsedPart}.`;
    case 'tool-call':
      return `Executing ${s.detail || 'tool'}${elapsedPart}.`;
    case 'compacting':
      return `Compacting conversation context${elapsedPart}.`;
  }
}

/**
 * "Where am I" — short summary of the current model, provider, mode, and
 * permission level. Spoken on F2. Doesn't include the elapsed timer since
 * this is positional info, not progress info.
 */
export function describeLocation(): string {
  const s = currentStatus;
  const parts: string[] = [];
  if (s.model) parts.push(`Model ${s.model}`);
  if (s.provider) parts.push(`via ${s.provider}`);
  if (s.mode) parts.push(`in ${s.mode} mode`);
  if (s.permissionMode) parts.push(`with ${s.permissionMode} permissions`);
  return parts.length > 0 ? parts.join(', ') + '.' : 'No active session.';
}
