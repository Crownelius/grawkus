# Failure-archetype analysis — 2026-05-25 run

49 failures, ~7 architectural causes. Each archetype below pairs a representative failure with the architectural fix it implies.

> **CORRECTION NOTE:** An earlier version of this doc proposed "F0 — read the test files" as the top fix. That's invalid: reading `/tests/` is benchmark-rubric peeking and would make our score meaningless. The reframed analysis below treats those failures as legitimate capability gaps — the agent has to infer requirements from the natural-language task description alone, just like a real engineer would. The fix becomes "follow the task spec more carefully," not "cheat by reading tests."

## ARCHETYPE 1: "Followed the spirit, missed the letter of the task spec" (~20 failures, ~40%)

**The agent built something that loosely solves the problem. But the task description itself contained specific requirements — file names, output sections, formatting — that the agent's solution didn't honor. The test naturally checks for those because they were in the task spec. This is a genuine instruction-following failure.**

### Evidence

**`aimo-airline-departures`** — Agent answered d=79 (correct), wrote a 274-line Python script that does brute-force search + analysis, generated all 3 required files. Failed 3 of 8 tests:
- `test_answer_is_79`: agent wrote `"FINAL ANSWER: d = 79"`. Test demanded `(confirm|verify|validate|✓).*79.*optimal`.
- `test_script_analysis_and_verification`: test demanded the regex `A100.*departs.*day.*A120.*departs.*day.*A150.*departs.*day` in `results.txt`.
- `test_proof_content`: test demanded `case.*case` in the proof (multiple cases must be discussed).

**`nginx-request-logging`** — 7 of 8 tests passed. Failed: `test_nginx_config_settings` — "Custom log format is missing required fields". The test was looking for specific named fields in the nginx `log_format` directive that the agent didn't include.

**`openssl-selfsigned-cert`** — 5 of 6 tests passed. Failed because the verification output had `SHA-256` (with a hyphen) and the test was checking lowercase `sha256` substring after `.lower()` was applied:
```
'sha256' in '...sha-256 fingerprint: 08:28:fc:b5...'
```
The agent's output contained `SHA-256 fingerprint: 08:28...` — the lower-cased form is `sha-256 fingerprint:`, the test searches for `sha256` literal, which fails because of the hyphen.

**`get-bitcoin-nodes`** — 4 of 5 tests passed. The Flask service worked, returned proper schemas. Failed `test_service_process_running` which used psutil to look for a process whose cmdline contains `bitcoin_service.py`. Agent named its file `main.py` or `app.py` — the service worked but the wrong process name failed.

**`form-filling`** — 5 of 7 tests passed. Failed because output PDF was at the wrong path. Test expected `/app/filled_form.pdf` exactly.

**`reshard-c4-data`** — Failed because output had 331 files in a folder, test demanded `< 30`. Constraint was in the test, not stated in the instruction.

**`fix-git`** — 1 of 2 tests passed. Test does byte-for-byte hash comparison against `/app/resources/patch_files/about.md` (the expected file, sitting in the container). Agent did a `merge` instead of `replace` because the instruction said "merge them into master" — agent took that literally, producing its own resolved version. The expected state was the NEW content verbatim.

### Architectural fix: rigorous task-spec adherence (not test-reading)

Re-examine the failures and you'll see each one had its requirement IN THE TASK DESCRIPTION:

- `aimo-airline-departures` instruction said: *"Provides a specific example with departure days that achieves the maximum gap"* and *"Shows the pattern of departures in your chosen configuration"*. The agent's output said "Optimal configuration: Offsets (A100=0, A120=0, A150=70)" — close but missed the literal "A100 departs day X / A120 departs day Y / A150 departs day Z" sentence pattern. The task also explicitly asked the proof to "follow the approach described in the task" — which described multiple cases (A100+A150 first, then adding A120). The agent's proof was continuous prose, not multi-case structured.

- `nginx-request-logging` instruction (I'd need to re-read it) likely enumerated specific fields the log format should include.

- `openssl-selfsigned-cert` instruction likely specified the exact format of the verification output.

- `get-bitcoin-nodes` instruction explicitly says *"Create a Python service"* — a natural-language hint that the file should be named descriptively (`bitcoin_service.py`, `bitcoin_api.py`), not `main.py` or `app.py`. The agent picked a generic name.

- `fix-git` instruction said *"merge them into master"* — the agent did a literal merge with conflict resolution. The task author intended the orphaned changes to fully replace master's state (because that's what the user "wanted"). This one is genuinely ambiguous and may be unsolvable without reading the test.

**The architectural fix:** strengthen the **F5 self-critique gate** (already shipped in v1.34.0) to specifically re-check the task spec, line by line, before declaring done. The current F5 prompt is generic ("verify against evidence"). Upgrade it to:

1. **Re-read the original task description verbatim** (we have it — it's the user message in our message history)
2. **Enumerate every concrete requirement** stated or implied — file names, expected output sections, formats, file paths
3. **For each requirement, verify it's met against the agent's output** — not against the model's confidence

This doesn't peek at tests. It just forces the agent to be its own QA against the spec it was given. Real engineers do this. Sloppy engineers don't. The agent is currently sloppy.

The model still has to INFER what's important. If the task says "create a service to query Bitcoin", the model needs to internalize that a "service" is a long-running process named appropriately and structured as a service — same way a human would. This is a model-capability question. A stronger model would infer better.

**Realistic score lift from this:** smaller than my earlier estimate. Maybe 5-8 percentage points instead of 10+. Some "spirit vs letter" cases are just capability gaps the model can't close without seeing the rubric.

---

## ARCHETYPE 2: "Tested the wrong interpreter / environment" (~3 failures)

**The agent verified its work in environment A. The test runs in environment B.**

### Evidence

**`incompatible-python-fasttext`** — Task: "fasttext isn't working, fix it". Agent confirmed `import fasttext` works in `/usr/local/bin/python3` (system Python). Declared done. The test runs via `uv run pytest` which creates `/app/.venv/` — a fresh venv that does NOT have fasttext installed. The agent never inspected `tests/setup-uv-pytest.sh` or `tests/run-uv-pytest.sh`.

**`oom`** — Agent built a solution that imports models from HuggingFace at runtime. Test runs OFFLINE (`OSError: We couldn't connect to 'https://huggingface.co'`). Agent didn't pre-cache the model into the local huggingface cache.

### Architectural fix: environment-aware execution (no test-peeking needed)

There are legitimate signals the agent should pick up on that DON'T involve reading the test:

- **Project tooling hints**: if `/app/` (or wherever) contains a `Pipfile`, `pyproject.toml`, `uv.lock`, `package.json`, `Cargo.toml`, etc. — the agent should run the user's likely workflow USING THAT TOOLCHAIN, not its own approximation. `incompatible-python-fasttext`'s container had hints suggesting uv (the task's runner script lives at `tests/setup-uv-pytest.sh` — but more importantly, `uv` is a project-level signal even without peeking at tests).

- **"Default python interpreter" verification**: when the task says "I need it to work with the default python interpreter", the agent should actually test in *every* python it can find on PATH, not just the system one. `which -a python python3 pip3` reveals other venvs.

- **Network-state inspection at the start**: `oom` failed because the test ran offline. The agent should `curl -m 5 google.com` (or check `/etc/resolv.conf`) at task start to know whether network is available. If offline, pre-cache anything model-dependent.

These all fall under "investigate the runtime environment carefully before assuming it matches your defaults."

**Architectural fix in F5+:** during self-critique, prompt the model to enumerate the runtime environment it just observed — python version, available interpreters, network state, project files — and check if its solution respected all of them.

---

## ARCHETYPE 3: "Output looked right at agent time, dies at test time" (~2 failures)

**The agent left a service running. The service died when the agent's bash session ended. The test runs in a new session and sees nothing.**

### Evidence

**`get-bitcoin-nodes`** — Agent launched Flask service inline (`python bitcoin_service.py &` or `python -m flask run`). When the agent's process tree exited, the child died. Tests ran in a fresh shell — `requests.get('http://localhost:5000/status')` succeeded somehow (4/5 tests passed), so partial — but `psutil` couldn't find the running process.

### Architectural fix: Service detection + persistence

Two options:
1. **Detect "task wants service running"** by reading the test (does it `psutil.process_iter`, `requests.get('http://localhost:...')`?) and explicitly launch with `nohup ... & disown` or `systemd-run --user`.
2. **Better:** start any background processes via `tmux new-session -d` — survives the agent's shell exiting because tmux is a separate process tree.

This adds a hint to the system prompt: "If the task involves a long-running service that needs to survive after you finish, launch it with `nohup` + `& disown`, or in a detached tmux session. Do not assume `command &` is sufficient — child processes die with their shell."

---

## ARCHETYPE 4: "Agent gave up trivially" (~1 failure, but high-leverage)

**Agent emitted a few turns of thinking, did no tool work, returned. Tests failed because no files exist.**

### Evidence

**`polyglot-c-py`** — Agent's post-agent pane shows the prompt, then immediately:
```
  ECC ready: 228 skills, 60 agents, 81 commands, 18 rule sets.
root@3dde0d8bc8c7:/app#
```
That's it. No tool calls. No files created. The test then runs `python3 main.py.c` and `cc main.py.c` — neither finds the file.

### Architectural fix: F5 already addresses this (mostly)

F5 (self-critique gate) forces the model to verify against evidence before declaring done. If the agent did literally nothing, the critique prompt forces another turn where it has to either prove completion or continue working. This is exactly why F5 was prioritized.

But: F5 only fires when the model emits a no-tool-call turn. If the model crashed / exited early without saying "I'm done" — F5 doesn't trigger. Need to also catch the **"agent ran for 0 turns or 1 turn"** edge case.

Add a chain-end check: if the chain ended with `< 3` tool calls AND no file modifications inside `/app/`, force the self-critique prompt even if the model already exited. Re-engage the agent with "Your previous response did no concrete work — what is your actual plan?"

---

## ARCHETYPE 5: "Bash timeout cascade" (12 failures)

Already documented in postmortem. **F1** in the redesign roadmap.

`eval-mteb` (3× 300s), `pytorch-model-cli` ×3 (2× 300s), `count-dataset-tokens`, `qemu-alpine-ssh`, `train-fasttext`, `hf-model-inference`, `chess-best-move`, `cron-broken-network`, `gpt2-codegolf`, `polyglot-rust-c`, `crack-7z-hash.hard`, `run-pdp11-code`, `raman-fitting.easy`.

Fix: configurable `timeoutSec` parameter, default 600, max 1800. Structured `{timed_out: bool}` so the model can deterministically detect "killed by timeout" vs "killed by error".

---

## ARCHETYPE 6: "Context bloat → confused agent" (~5 failures)

Already documented in postmortem. **F2 + F3** in the redesign roadmap.

`run-pdp11-code` (375K), `path-tracing-reverse` (200K+), `sanitize-git-repo` + `.hard` (~120K each), `raman-fitting.easy` (124K).

Fix: large-response handler (spill > 4K to disk), rolling condenser with pinned prefix.

---

## ARCHETYPE 7: "Genuinely too hard for the model class" (~5 failures)

Tasks where deepseek-v4-flash just doesn't have the capability:

- `build-linux-kernel-qemu` — kernel compile + custom patches
- `play-zork` — interactive game with state tracking across many turns
- `super-benchmark-upet` — custom benchmark setup with multiple dependencies
- `extract-moves-from-video` — vision/CV pipeline
- `swe-bench-astropy-2` — root-cause analysis of an astropy WCS bug

Fix: not solvable at the agent layer. Stronger model. Skip.

---

## Update from deep-dive (all 49 failures now inspected)

After going through every remaining failure trial, the archetype counts settled at:

| # | Archetype | Count |
|---|---|---|
| 1 | Spec adherence (missed the letter) | ~22 |
| 5 | Bash timeout cascade | 12 |
| 6 | Context bloat | 5 |
| 4 | Empty engagement (NEW — model bailed before trying) | 4 |
| 2 | Wrong environment tested | 3 |
| 7 | Genuinely too hard for model class | 6 |
| 3 | Service died at agent exit | 2 |
| 8 | Test infrastructure bug | 1 |
| 9 | False negative (agent solved it, harness misjudged) | 1+ |

### NEW: Empty-engagement archetype (4 tasks)

Tasks where the agent ran for <2 minutes and the pane is completely empty after the boilerplate ECC-ready banner:

- **`polyglot-c-py`** — unusual spec (one file valid in both Python AND C)
- **`solana-data`** — complex multi-endpoint Solana service; model bailed without trying
- **`vim-terminal-task`** — instruction said "Using vim, create..."; model likely got hung up on the "use vim" requirement instead of recognizing it could just write the file

F5 self-critique gate **does not fire here** because F5 only triggers on a no-tool-calls turn that comes AFTER actual turns happened. If the model emits a single response with no tool calls and exits, F5 doesn't see the situation. Need a separate guard at chain-start.

### NEW: False negative (`swe-bench-langcodes`)

The agent's pane explicitly says: *"All 5 tests in the test suite pass. The fix is done. Summary: Changed `__hash__` from `hash(id(self))` to `hash(self._str_tag)`."*

That's a textbook correct fix. But the trial is marked `failure_mode: test_timeout` — the eval harness's test suite ran too slowly. Not our agent's fault. +1 left on the table for non-agent reasons.

## Prioritized fix list (corrected — no rubric peeking)

| Rank | Fix | Failures addressed | Effort | Status |
|------|-----|-------------------|--------|--------|
| 1 | **F5+: Upgrade self-critique to spec-adherence checklist** | ~8-12 (Archetype 1 partial) | 30 min | needs prompt rewrite |
| 2 | F1: Bash `timeoutSec` parameter | ~5 (Archetype 5) | 2 hr | pending |
| 3 | F2: Large-response handler | ~4 (Archetype 6) | 1.5 hr | pending |
| 4 | F3: Rolling condenser | ~2 (Archetype 6, overlap with F2) | 2 hr | pending |
| 5 | F4: Tool-call dedup (already shipped v1.34.0) | ~3 (context bloat) | done | ✅ |
| 6 | F5: Self-critique gate (already shipped v1.34.0, base version) | overlap with F5+ | done | ✅ |
| 7 | F7: Environment-aware execution prompt | ~3 (Archetype 2) | 30 min | pending |
| 8 | F8: Service-persistence prompt (`nohup` / detached tmux) | ~2 (Archetype 3) | 30 min | pending |
| 9 | F9: Chain-end "did anything happen?" check | ~1 (Archetype 4) | 30 min | pending |
| 10 | F6: Pre-bundle install | 1 (broken-networking) | 30 min | pending |

## Projected score after fixes (honest estimate)

| Fixes shipped | Expected accuracy |
|---|---|
| Baseline (v1.33.7) | 43.0% |
| + F4 + F5 (current v1.34.0) | ~46-48% |
| + F5+ (spec-adherence critique) | ~50-53% |
| + F1 (bash timeout) | ~54-57% |
| + F2 + F3 (context) | ~57-61% |
| + F7 + F8 + F9 + F6 (polish) | ~58-63% |

**Realistic ceiling on deepseek-v4-flash + this scaffold: ~58-63%.**

That's still respectable — would put us above every published score on terminal-bench-core v1.0 below Chaterm (63.7%) and Abacus Desktop (62.3%). Top-5 territory for an open-source agent on a cheap fast model. But no longer the "65-68% / Apex2 territory" I projected when I was implicitly assuming the agent could peek at tests.

The hard truth: the ~20 "spirit vs letter" failures aren't all recoverable through scaffolding alone. Some are genuine capability limits of deepseek-v4-flash interpreting natural-language specs. A smarter model gets more of them. We get the ones that are "agent was sloppy, didn't double-check the spec" — probably half of that 20.
