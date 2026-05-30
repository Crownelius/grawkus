# Terminal-Bench Postmortem — 2026-05-25

**Run**: `runs/2026-05-25__07-54-25/`
**Model**: `deepseek/deepseek-v4-flash` via OpenRouter
**Agent**: `grawkus@1.33.7` with `--perm yolo`
**Score**: **37/86 = 43.02% accuracy**
**Wall time**: ~6h with 3-way concurrency, 25-min per-task budget

## Failures broken down by root cause

### 1. ❗ Bash 5-minute timeout (3 trials, ~$1 wasted, potential +1-3 passes)

**Root cause**: grawkus's `bash` tool has a hard-coded 300s timeout. ML model loads, conda installs, pytest runs, and emulator boots routinely exceed this. The model can't ask for more time, so it kills the command, sees `✗ 300.0s`, assumes failure, and **retries the same command** — burning another 5 min for the same result.

| Task | Hits | Outcome | What the agent was running |
|------|------|---------|----------------------------|
| `eval-mteb` | 3× | TIMEOUT | Loading a HuggingFace model + pip install |
| `pytorch-model-cli` | 2× | TEST_TIMEOUT | Training a small CNN |
| `qemu-startup` | 1× | PASS (lucky) | `apt install qemu-system` |

**Fix in grawkus** — concrete proposal:

```typescript
// src/tools/bash.ts: accept an optional timeoutMs param up to 30 min
{
  command: string;
  timeoutMs?: number;  // default 300_000, max 1_800_000
  background?: boolean; // if true, tee output to a logfile, return pid + tail-path
}
```

…and add a system-prompt nudge that says "If you see `✗ 300.0s` on a command you'd expect to take longer (model load, install, training), re-issue with `timeoutMs: 1200000` instead of retrying as-is."

**Expected impact**: rescue `eval-mteb` (high confidence — it was clearly making progress) and possibly the pytorch tasks. **+1-3 passes (~+2% accuracy)**.

### 2. ❗ Context bloat — auto-compaction is too lazy (6 trials, ~$2 wasted, +2-4 passes)

**Root cause**: grawkus only auto-compacts the conversation when context gets dangerously full. But on long agentic loops, the tool-output history balloons — by the time compaction kicks in, the agent has already wasted 10+ turns reading stale 30K-token tool outputs into context.

| Task | Peak Input | Outcome |
|------|-----------|---------|
| `run-pdp11-code` | **375K tokens** | AGENT_TIMEOUT (regenerated the same `gen_load.py` file twice) |
| `path-tracing` | 214K | PASS (only barely) |
| `security-vulhub-minio` | 179K | PASS |
| `raman-fitting.easy` | 124K | AGENT_TIMEOUT |
| `sanitize-git-repo.hard` | 120K | FAIL |
| `sanitize-git-repo` | 112K | FAIL |

**Fix in grawkus**:

1. **Aggressively summarize tool outputs > 5K tokens** — keep first/last 1K + a sketch
2. **Lower the auto-compact threshold** — currently somewhere ~80% of model max; drop to 50%
3. **Drop tool outputs after N turns** (e.g. after 5 turns, the agent rarely needs the verbatim grep result from turn 1)

The pdp11 case is the smoking gun: at 375K tokens the model literally forgot it had already written `/app/gen_load.py` 12 turns ago and wrote it again with identical content. The loop detector didn't catch it because the *prompts* between calls weren't identical (the surrounding context had drifted).

**Expected impact**: rescue `run-pdp11-code`, `raman-fitting.easy`, both `sanitize-git-repo` variants. **+2-4 passes (~+3-5%)**.

### 3. ❗ Network-disabled containers break our install (1 trial, niche but ugly)

**Root cause**: `broken-networking` is a task that intentionally breaks the container's network. Our adapter's install script (`apt-get install nodejs` + `npm i -g grawkus`) needs the internet. Result: install fails silently, agent never starts, both panes are completely empty, harness throws `parse_error`.

**Fix in `bench/grawkus_agent_adapter.py`**:

Pre-bundle grawkus into a base image (or pin a tarball) and copy from there instead of pulling from npm in-container. ~30 min of work. Niche but bulletproof.

### 4. 🧠 Task comprehension failures (~10 trials, model issue)

The agent reads the task and confidently does the wrong thing. Not a grawkus bug — a model capability ceiling.

| Task | What went wrong |
|------|-----------------|
| `aimo-airline-departures` | Got the math wrong: said d=79, correct is d=129 |
| `incompatible-python-fasttext` | Declared "nothing to fix" without realizing fasttext WAS broken |
| `fix-git` | "Everything's merged" — wrong git state, didn't match expected resolution |
| `polyglot-c-py` | Misread the polyglot requirement |
| `play-zork` | Tried to brute-force; needed actual interactive play |
| `super-benchmark-upet` | Skipped a required setup step |
| `swe-bench-astropy-2` | Astropy WCS bug — fix didn't address root cause |
| `recover-obfuscated-files` | Wrong deobfuscation approach |
| `extract-moves-from-video` | Failed to set up ffmpeg pipeline |
| `solana-data` | Wrong RPC query |

**Fix**: not grawkus. Use a stronger model — `anthropic/claude-sonnet-4` or `openai/o1-mini` for the next baseline run. Expected lift: 10-15 percentage points.

### 5. ⏱️ Test infrastructure timeouts (8 trials, t-bench issue)

These passed `is_resolved: null` with `failure_mode: test_timeout` — the agent finished its work, but the test suite itself ran longer than 60s (`max_test_timeout_sec` per task.yaml).

Affected: `swe-bench-astropy-1`, `swe-bench-langcodes`, `pytorch-model-cli`/.easy/.hard, `build-initramfs-qemu`, `jupyter-notebook-server`.

**Fix**: rescue with `--global-test-timeout-sec 300`. A few of these may have actually passed.

### 6. 🐌 Hard-task agent timeouts (12 trials, expected losses)

Tasks that genuinely need more than 25 min OR are out of the model's depth. Kernel builds, kernel debugging, ML training loops, etc.

Affected: `chess-best-move`, `count-dataset-tokens`, `crack-7z-hash.hard`, `cron-broken-network`, `gpt2-codegolf`, `hf-model-inference`, `polyglot-rust-c`, `qemu-alpine-ssh`, `train-fasttext`.

**Fix**: rescue with `--global-agent-timeout-sec 2700` (45 min). Most won't budge but a couple might.

## Prioritized fix list

| Priority | Fix | Effort | Est. score lift |
|----------|-----|--------|-----------------|
| **P0** | Bash tool: configurable `timeoutMs` up to 30 min | 30 min | +1-3 passes |
| **P0** | Aggressive tool-output truncation when >5K tokens | 1 hr | +2-4 passes |
| **P1** | Loop detector: detect identical *file writes* (not just prompt fingerprints) | 30 min | +1 pass |
| **P1** | Lower auto-compact threshold to 50% of context | 15 min | +1-2 passes |
| **P2** | Pre-bundle grawkus install (handle broken-networking) | 30 min | +1 pass |
| **P2** | Rescue test_timeouts with `--global-test-timeout-sec 300` | next-run flag | +0-2 passes |
| **N/A** | Run with stronger model (claude-sonnet-4) | next-run config | **+10-15 passes** |

**Realistic next run**: P0 fixes + claude-sonnet-4 → projected **~52-58% accuracy** (puts grawkus at parity with the published Claude Code baseline).

## Cost

Per OpenRouter (deepseek-v4-flash @ ~$0.07/M input / $0.7/M output), estimated $3-5 for this run. Worth a check on your dashboard.
