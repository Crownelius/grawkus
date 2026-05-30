/**
 * Turn-boundary context cleanup.
 *
 * Background. The conversation history sent to the model grows as:
 *   [user, assistant(tool_calls), tool, assistant(tool_calls), tool, …,
 *    assistant(final text), user, assistant(tool_calls), tool, …]
 *
 * Once a turn is *complete* (assistant returned text with no tool_calls),
 * the in-progress scaffolding from that turn — the assistant messages
 * carrying tool_calls and the tool-result messages — is no longer
 * actionable. But it still LOOKS actionable to a weaker model: it sees
 * "tool_calls" entries and treats them as pending TODOs, which is why
 * owl-alpha kept re-writing the same poem on every new user turn:
 *
 *     turn 1 user: "write a poem"
 *     ... model writes poem ...
 *     turn 2 user: "find a github repo for X"
 *     model: "I'll handle BOTH requests" (because it still sees the
 *            poem's tool_calls scaffolding as if it hadn't run)
 *     turn 3 user: "research further"
 *     model: "I'll handle all THREE requests"  ← infinite re-execution
 *
 * Fix. Before each new turn, walk back through history. For every
 * COMPLETED turn (any turn before the latest user message), collapse the
 * [user, ...intermediate scaffolding..., final assistant text] sequence
 * into [user, "final assistant text + [Completed: used X, Y]"]. The model
 * sees a clean conversational record of what already happened, with no
 * dangling tool_calls signals to misinterpret.
 *
 * The currently-active turn (everything from the latest user message
 * forward) is left untouched — its tool_calls and tool-result messages
 * are still in-flight and the API protocol requires them paired.
 */

import type { Message } from './types.js';

/**
 * Collapse all completed turns in a message list. Returns a new array;
 * input is not mutated.
 *
 * A completed turn is any turn ENDING before the latest user message.
 * The latest user message and everything after it is the "active turn"
 * and is passed through unchanged.
 */
export function collapseCompletedTurns(messages: Message[]): Message[] {
  // Locate the latest user message — the start of the active turn.
  let activeStart = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      activeStart = i;
      break;
    }
  }
  // No user message yet (e.g. fresh session start) → nothing to collapse.
  if (activeStart <= 0) return messages.slice();

  const history = messages.slice(0, activeStart);
  const active = messages.slice(activeStart);

  const collapsed: Message[] = [];
  let i = 0;

  while (i < history.length) {
    const m = history[i];

    // Pass-through system/user messages until we find a user message
    // that starts a turn. Stray non-system/user messages get kept as-is
    // (defensive: shouldn't happen in normal flow, but don't lose data).
    if (m.role === 'system') {
      collapsed.push(m);
      i++;
      continue;
    }
    if (m.role !== 'user') {
      // Orphan assistant/tool message at the head of history — keep verbatim
      // and skip past it. Avoids losing context if message ordering ever
      // gets weird.
      collapsed.push(m);
      i++;
      continue;
    }

    // m is a user message — start of a historical turn.
    const userMsg = m;
    collapsed.push(userMsg);
    i++;

    // Walk forward collecting the rest of this turn (everything up to
    // but not including the next user message).
    const toolsUsed: string[] = [];
    let finalText = '';
    while (i < history.length && history[i].role !== 'user') {
      const t = history[i];
      if (t.role === 'assistant') {
        if (t.tool_calls && t.tool_calls.length > 0) {
          for (const tc of t.tool_calls) {
            // tc.function.name on function-tool variants. Defensive .? in
            // case the union shape changes.
            const name = (tc as { function?: { name?: string } }).function?.name;
            if (name) toolsUsed.push(name);
          }
        }
        if (typeof t.content === 'string' && t.content.trim()) {
          // Keep the LAST assistant text we see — that's the model's
          // final summary at the end of the turn. Intermediate "I'll
          // now do X" sentences are intentionally discarded since the
          // tool list below already captures what happened.
          finalText = t.content;
        }
      }
      // role === 'tool' messages are intentionally dropped here.
      i++;
    }

    // Emit the collapsed turn. If the assistant produced no final text
    // but ran tools, synthesize a one-line "completed" marker; if neither
    // tools nor text, skip emitting anything (empty turn — odd but safe).
    if (finalText || toolsUsed.length > 0) {
      const uniqueTools = Array.from(new Set(toolsUsed));
      const trailer = uniqueTools.length > 0
        ? `\n\n[Completed in a prior turn. Tools used: ${uniqueTools.join(', ')}. Do NOT re-execute these — they were for that prior user message, not the current one.]`
        : '';
      collapsed.push({
        role: 'assistant',
        content: (finalText || '(no text response)') + trailer,
      });
    }
  }

  return [...collapsed, ...active];
}
