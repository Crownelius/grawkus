# Grawkus v2 redesign — driven by Terminal-Bench failure data

This document synthesizes findings from three parallel research passes (Terminal-Bench leaderboard map, Goose architecture deep-dive, context-management literature) into a concrete redesign roadmap for Grawkus.

The goal: take the **43.0% baseline on terminal-bench-core v0.1.1 with deepseek-v4-flash** and push it toward the **51% Terminus 2 / claude-sonnet-4-5 mark** *without changing model*, then beat it with a model swap.

---

## Reference points

- **Top open-source on terminal-bench-core v1.0**: Terminus 2 (Stanford/Laude) at **51.0%** — and Terminus is deliberately minimal (one tool: tmux). This is the "ceiling for a clean ReAct loop on this dataset."
- **Apex2 (proprietary, undisclosed architecture)**: 64.5% — likely uses planning + subagents + heavy context engineering.
- **Goose (Block, OSS, 46k stars)**: ranked but not in current top 15 on v1.0 leaderboard; their architecture is the best-documented open-source reference and ships every technique we need.
- **Aider (45k stars)**: not a Terminal-Bench specialist (it's interactive-edit-focused) but its tree-sitter repo map is widely cited as a critical context primitive.

---

## Failure-mode → fix mapping

Every fix below ties to specific failures from our 43.0% run. See `POSTMORTEM-2026-05-25.md` for the trial-level evidence.

| Failure pattern | Tasks affected | Root cause | Fix |
|---|---|---|---|
| Bash 300s timeout, no escape hatch | eval-mteb, pytorch-model-cli×3, qemu-startup | Hard-coded 300s timeout in our bash tool | F1: configurable `timeout_secs` + structured `{timed_out: bool}` |
| Context bloat → identical retries | run-pdp11-code (375K), raman-fitting.easy (124K), sanitize-git-repo×2 | Tool outputs append verbatim; auto-compact too lazy | F2 + F3 |
| Duplicate file write / re-read | run-pdp11-code (wrote `gen_load.py` twice) | Loop detector keyed on prompt fingerprint, missed by context drift | F4: tool-call deduplication |
| Model declares "done" without doing the work | incompatible-python-fasttext, fix-git, aimo-airline-departures | No self-critique pass before completing | F5: pre-commit self-check |
| Network-disabled task → empty pane | broken-networking | Adapter install script needs internet | F6 (adapter-side, not core) |
| Test infrastructure timeout | swe-bench-astropy-1, pytorch-model-cli×3, build-initramfs-qemu, jupyter-notebook-server, swe-bench-langcodes | Tests need >60s | Rescue rerun flag, not a code fix |

---

## The eight fixes (ordered by ROI)

### F1 — Bash tool: configurable timeout + structured timeout signal **[P0, ~2 hrs]**

Source: Goose's `crates/goose/src/agents/platform_extensions/developer/shell.rs`.

```typescript
// src/tools/bash.ts
{
  command: string;
  cwd?: string;
  timeoutSec?: number;   // default 600, max 1800
  background?: boolean;  // if true, return after first 2s of output + pid + logfile path
}

// Return shape:
{
  ok: boolean;
  stdout: string;        // tail-truncated; full saved to /tmp/<call_id>.log
  stderr: string;
  exitCode: number | null;  // null iff timed_out
  timedOut: boolean;        // structured signal — model can detect deterministically
  truncated: boolean;       // structured signal — model can fetch full from logPath
  logPath: string;          // always set when truncated || timedOut
}
```

The system prompt tells the model: "If `timedOut: true` and you expected the command to take longer, re-issue with `timeoutSec: 1500`. Don't retry as-is."

**Expected impact**: rescues eval-mteb (3× timeouts → pass), pytorch-model-cli×3 (timeout phase), train-fasttext. **+3-5 passes**.

### F2 — Large tool-response handler (Goose's pattern) **[P0, ~1.5 hrs]**

Source: Goose's `large_response_handler.rs` (80 lines).

Every tool response > **threshold tokens** (start at 4K for Grawkus's budget) gets routed through a wrapper that:

1. Writes the full response to `/tmp/grawkus-results/<call_id>.txt`
2. Replaces the in-context payload with: head 1.5K + tail 1.5K + `[middle elided — N more tokens at <path>; use head/tail/grep to read]`

This runs **before** the message even hits message history — the model never sees the 200KB blob. If it later needs the middle, it can `bash` it.

**Expected impact**: rescues run-pdp11-code (375K → ~10K), raman-fitting.easy, both sanitize-git-repo variants. **+2-4 passes**.

### F3 — Rolling condenser with pinned prefix **[P0, ~2 hrs]**

Source: OpenHands `LLMSummarizingCondenser` + Goose `check_if_compaction_needed`.

Replace the current lazy "compact at 80% of max" with an **event-count trigger + pinned prefix**:

```typescript
function shouldCondense(messages: Message[], maxCtxTokens: number): boolean {
  const used = countTokens(messages);
  return used > Math.min(60_000, maxCtxTokens * 0.5);
}

async function condense(messages: Message[]): Promise<Message[]> {
  // Always keep: system + first user turn + last 10 messages verbatim
  const pinned = [...messages.slice(0, 2), ...messages.slice(-10)];
  const middle = messages.slice(2, -10);
  if (middle.length === 0) return messages;

  // Summarize middle with a cheap model (deepseek-v4-flash, no Claude/GPT-4)
  const summary = await llmSummarize(middle, {
    template: "Preserve: task goal, decisions made so far, files touched, " +
              "current sub-goal, blockers. Drop: tool output verbatim, repetition.",
    model: "deepseek/deepseek-v4-flash",  // cheap
  });

  return [...messages.slice(0, 2), summary, ...messages.slice(-10)];
}
```

Trigger at 50% of model max OR 60K (whichever is smaller) — **not** at the cliff edge.

**Expected impact**: prevents context bloat from causing identical-retry failures. Compounds with F2. **+1-3 passes**.

### F4 — Tool-call deduplication **[P0, ~30 min]**

Source: Cline's `contextHistoryUpdates`.

```typescript
const dedup = new Map<string, number>();  // hash(tool, normalizedArgs) → msgIdx

function onToolResult(toolName: string, args: object, result: any, msgIdx: number) {
  const key = hash({ tool: toolName, args: normalizeArgs(args) });
  const prevIdx = dedup.get(key);
  if (prevIdx != null) {
    // Rewrite the PREVIOUS occurrence in-place
    messages[prevIdx].content = `[deduped — same ${toolName} call appears at msg #${msgIdx}]`;
  }
  dedup.set(key, msgIdx);
}
```

Critically: `normalizeArgs` strips paths to absolute form, lowercases, sorts keys. So `read /app/x.py` and `read ./x.py` from `/app` collapse.

**Expected impact**: kills the "regenerated gen_load.py twice" failure mode and similar. **+1 pass directly + reduces context bloat for everything**.

### F5 — Self-critique gate before completion **[P1, ~1.5 hrs]**

Source: ReAct + plan-then-execute literature + Goose blog on subagent design ("each subagent wasn't aware of the others' plan").

Before the agent emits its final user-facing answer (no tool calls), insert a **mandatory self-check turn**:

```typescript
// In query.ts, when model emits a turn with no tool_calls:
if (turnHasNoToolCalls && !alreadyDidSelfCritique) {
  messages.push({
    role: "user",
    content: "Before finalizing: have you actually accomplished the task? " +
             "List the specific evidence (file paths, tests passing, command outputs) " +
             "that confirms it. If anything is missing, say so and continue work."
  });
  // ... another iteration ...
}
```

**Expected impact**: catches `incompatible-python-fasttext` (declared "nothing to fix" without testing), `fix-git` (wrong merge), aimo-airline-departures (gave 79 without verifying against the test). **+2-4 passes**.

### F6 — Adapter: pre-bundle for broken-networking **[P2, ~30 min]**

Source: not in research — just noticed empirically.

Bundle Grawkus's dist/ into the adapter as a base64 tarball. Install script writes it to `/usr/local/lib/grawkus`, symlinks `grawkus`. No npm registry needed.

**Expected impact**: rescues `broken-networking` (the 1 parse_error). +1 pass.

### F7 — Tree-sitter repo map (always-in-context) **[P1, ~4 hrs]**

Source: Aider's `aider/repomap.py` (CC-BY-SA).

For tasks operating on a codebase > 5 files: at session start, parse with tree-sitter, build a file→file reference graph, PageRank-rank symbols, render a ~1.5K-token outline of the top-ranked class/function signatures. Inject as a system message.

Skip on small workspaces. Heuristic: `if (await glob('**/*.{py,ts,js,go,rs,java}')).length >= 5`.

**Expected impact**: cuts exploration turns on multi-file tasks. Hard to estimate but Aider claims it's their single most important context primitive. **+0-3 passes** on terminal-bench (most tasks are small-workspace; bigger lift on real-world SWE work).

### F8 — `todo_write` tool with auto-injection **[P1, ~1.5 hrs]**

Source: Goose's `platform_extensions/todo.rs`.

A simple markdown checklist the model can update via tool call, that Grawkus **auto-injects as a system message before every assistant turn**. Survives context compaction (it's regenerated each turn from the persistent state, not stored in message history).

```typescript
// New tool:
tools.push({
  name: "todo_write",
  description: "Update the working todo list. Persists across context compaction.",
  parameters: { items: string[] }
});

// Per-turn injection:
function injectTodoIfPresent(messages: Message[]): Message[] {
  if (todoState.items.length === 0) return messages;
  const todoBlock = `<current_plan>\n${renderChecklist(todoState.items)}\n</current_plan>`;
  return [...messages, { role: "system", content: todoBlock }];
}
```

**Expected impact**: better long-horizon coherence; helps with multi-step tasks like `swe-bench-astropy-2`, `cron-broken-network`. **+1-2 passes**.

### F9 (deferred for v2.1) — Subagent / `summarize` tool

Source: Goose's `summarize.rs` (one-shot LLM call on file list) + subagent_handler.

A `summarize(paths, question)` tool that loads N files and asks a cheap model. Goose markets this as "more efficient than subagent when you know what to analyze."

Defer because it overlaps with F2 — most of the value comes from per-tool truncation. Re-evaluate after F1-F8 ship.

---

## Total projected impact

| Fix | Effort | Expected passes recovered |
|---|---|---|
| F1 — bash timeout_sec | 2 hrs | +3-5 |
| F2 — large response handler | 1.5 hrs | +2-4 |
| F3 — rolling condenser | 2 hrs | +1-3 |
| F4 — tool dedup | 30 min | +1 |
| F5 — self-critique gate | 1.5 hrs | +2-4 |
| F6 — pre-bundle install | 30 min | +1 |
| F7 — tree-sitter repo map | 4 hrs | +0-3 |
| F8 — todo_write | 1.5 hrs | +1-2 |
| **Total** | ~14 hrs | **+11-23 passes** |

If we ship F1-F6 only (~8 hrs), expected lift is **+10-18 passes → 55-65% accuracy on deepseek-v4-flash**.

If we then swap model to `anthropic/claude-sonnet-4-5`, expected baseline lift is **+10-15 percentage points** on top of that. Combined ceiling on the same dataset: **~65-75% accuracy** — competitive with the proprietary leaderboard top.

---

## Architecture changes (not bug fixes)

Beyond the eight fixes, the research surfaced three architectural shifts Grawkus should consider for v2:

### A. MCP-only tool surface

Source: Goose, OpenHands.

Currently Grawkus has hard-coded TypeScript tools. The research strongly suggests an **MCP-only** architecture where every capability is a server. Benefits:
- Tools are versioned, swappable, A/B-testable without forking the agent
- Users can add their own tools by writing an MCP server (already standard)
- Grawkus's "ECC skills" surface could collapse into MCP servers

This is a v3 conversation — too disruptive for v2. But the design should leave room.

### B. Multi-tier model routing

Source: Goose's deprecated lead/worker → current `/plan` command + subagent_handler.

The right pattern (per Goose's empirical work) is **NOT** auto-routing turn-by-turn — they tried, removed it. Instead:
- A `/plan` slash command that explicitly calls a stronger model for planning
- Cheap model (deepseek-v4-flash) for execution
- Cheap model for summarization (already implicit in F3)
- Optional subagent spawn for sub-tasks that warrant a fresh context window

Worth implementing as v2.1.

### C. Always-on metadata refresh

Source: Goose's `moim.rs` ("Message-Of-Information-Mark").

Inject a fresh `<info>cwd=… time=… env_changes=…</info>` block before every assistant turn — gives the model recency on environment state without bloating the message history. Particularly useful when bash commands change cwd, env vars, or filesystem state.

~50 lines. Tag onto F8 implementation.

---

## Sequence recommendation

**Sprint 1 (~8 hrs, ships as v1.34.0):** F1, F2, F3, F4, F6. The high-ROI fixes. Re-run terminal-bench. If we hit 55%+ on deepseek-v4-flash, ship; otherwise iterate on the failure modes.

**Sprint 2 (~6 hrs, v1.35.0):** F5, F7, F8 + the metadata-refresh part of C.

**Sprint 3 (open-ended, v2.0):** evaluate MCP-only tool surface migration.

Throughout: keep terminal-bench in the regression loop. Every PR should re-run at least the 10 task subset that previously passed, to confirm no regressions, plus the specific failures the PR claims to fix.

---

## References

All findings backed by:
- `bench/POSTMORTEM-2026-05-25.md` — our own trial-level evidence
- Three research reports (this conversation, agents `a8e7a011...`, `accb93b2...`, `a8b935fa...`)
- Goose source: github.com/block/goose
- OpenHands docs: docs.openhands.dev/sdk/guides/context-condenser
- Aider repo map: aider.chat/2023/10/22/repomap.html
- Cline context: docs.cline.bot/prompting/understanding-context-management
- Terminus 2: github.com/laude-institute/terminal-bench
- Terminal-Bench leaderboard: tbench.ai/leaderboards
