---
name: Grawkus
version: 1.35.58
developers:
  - Crownelius
license: MIT
repository: https://github.com/Crownelius/grawkus
framework: CLI agent with packaged benchmark adapters
models:
  - configurable OpenAI-compatible model
tags:
  - coding-agent
  - general-agent
  - open-agent-leaderboard
  - exgentic
  - terminal-bench
  - kbench
  - hal
  - mempalace
---

# Grawkus Agent Card

## Agent Details

Grawkus is a terminal coding agent system with a mind for the whole repo. It runs as a CLI, speaks OpenAI-compatible APIs, and packages adapters for Terminal-Bench, KBench, HAL, and Exgentic/Open Agent Leaderboard style evaluation. The npm package is `grawkus` and installs both the primary `grawkus` command and the legacy `cawdex` alias.

This card documents the agent system. It is not an official benchmark result and does not claim leaderboard performance without official harness output.

## Architecture

Grawkus uses an iterative tool-calling loop with benchmark mode prompts, read-only preflight context, task-contract extraction, todo tracking, source-specific research, redacted benchmark traces, and structured process scoring.

Primary tool surfaces include shell execution, file read/write/edit/patch operations, search/glob/listing, `benchmark_context`, `harness_components`, `research_sources`, `benchmark_repo_catalog`, `github_repo_digest`, `todo_write`, web fetch/search, MemPalace memory tools, and progressive-disclosure skills.

Source-grounded benchmark work uses `research_sources` for current arXiv/GitHub/Hugging Face/Kaggle discovery and `benchmark_repo_catalog` as an offline Terminal-Bench public-repo seed, then `github_repo_digest` on relevant public repositories before adopting repo-level implementation patterns. The digest evidence is treated as a bounded demonstration to compare against local manifests, commands, CI files, and component surfaces, not as authority over the current checkout.

Benchmark mode emphasizes:

- Current task instructions and verifier output over prior memory.
- Task-contract checklist creation before edits.
- Task-alignment checks for ignored constraints, distractor/decoy references, and off-task-looking edits.
- Reproduction before repair when feasible.
- Live preflight checks for PATH, package-manager, interpreter, virtualenv, and network/offline mismatches before treating a verifier as representative.
- Narrow-to-broad validation after edits.
- Reward-hack checks for verifier tampering, oracle/solution probes, result-file edits, shortcut completion markers, and bypass commands.
- CI workflow reconstruction from visible configuration.
- Anti-leakage handling for oracle, answer, gold, hidden, result, and solution files.
- Bounded replay of prior read/search/verifier checkpoints as hypotheses, not patch recipes.

## Memory

Grawkus includes MemPalace-backed project and global memory. In benchmark mode, `benchmark_context` can surface bounded relevant memories and prior local benchmark experience cards. These are explicitly framed as hypotheses that must be verified against current task files and verifier output. For Pi-Bench-style tasks, prior-run ranking uses complete proactivity ledgers as positive evidence and routes proactivity-ledger defects to warnings instead of replay hints.

Benchmark traces write compact `experienceCard` summaries with replay checkpoints, failure signatures, component-observability edit classification, task-contract state and signals, task-alignment, spec-compliance, reward-hack, HarnessAudit-style harness-safety, long-horizon roadmap/SaaS/mobile/WebDevBench/SWE-Cycle/SWE-CI coverage risk signals, and Pi-Bench proactivity ledger signals for context contract, hidden-intent hypothesis, clarification, privacy, and observable completion evidence. They also capture environment-reconstruction setup/failure evidence, dependency-upgrade setup-validation evidence, root-cause hypothesis state, failure-onset diagnosis state, trajectory-triage categories for interaction/execution/environment informativeness, and targeted-fix counts for failed-verifier repair edits, decision-observability edit predictions, validation-reliability evidence, context-utilization precision/miss evidence plus pre-edit context-bloat evidence, trajectory-cleanup evidence for base64/data-URI blobs, high-entropy output, duplicate output, and excessive truncation, evidence-grounding signals for stale/no-effect edit retries without a current-state refresh, AHE publish-state mutation signals for post-pass edits or state-changing commands without revalidation, run-efficiency action/usage/cost/time evidence, source-research coverage, verification commands, changed files, and warnings. They also emit a redacted ACC-style task/context/answer JSONL artifact and an AHE-style change-evaluation artifact for edit prediction verdicts, unpredicted edits, targeted-fix counts, and post-edit regression-cycle attribution.

## Models

Grawkus classifies edit targets by changed surface and records explicit regression foresight for AHE-style component and decision observability. Non-trivial benchmark edits should name the component surface and include both `Prediction:` and `At-risk regression:` lines; failed-verifier repair edits should also record a `Root cause:`, `Diagnosis:`, or failure-tied `Hypothesis:` plus a `Targeted fix:` or `Fix plan:` before patching. Repeated failing-verifier reruns and post-edit regression cycles are compressed into a failure-onset diagnosis so repair loops can be inspected before another patch. Missing forecasts, diagnoses, failure-onset diagnoses, and fix plans appear in change evaluation, experience-card state, trajectory quality, process defects, and completion reminders.

Grawkus is model-agnostic across OpenAI-compatible providers. Common configurations include OpenRouter, OpenAI, NVIDIA, Ollama, LM Studio, and DeepSeek-compatible endpoints. The model and provider are selected by CLI flags or environment configuration.

## Supported Environments

Packaged evaluation surfaces:

- Terminal-Bench adapter.
- KBench custom adapter.
- HAL custom agent.
- Exgentic/Open Agent Leaderboard custom agent.

Benchmark mode is designed for SWE-bench-style code repair, Terminal-Bench and TerminalWorld-style terminal tasks, context-reuse benchmarks, long-horizon RoadmapBench/SaaSBench/SWE-Bench Mobile/SWE-WebDevBench/SWE-Cycle/SWE-CI-style tasks, SWE-PRBench-style pull request review tasks, TML-Bench/Kaggle-style tabular ML tasks, Pi-Bench-style proactive personal assistant tasks, Open Agent AppWorld/BrowseComp+/tau2-style tasks, and generic multi-step tool-use tasks. The TerminalWorld profile treats `instruction.md` or task text as the outcome contract, marks `solve.sh` as oracle-only reference material, and emphasizes real CLI execution plus persistent `/app` artifact/service verification for tasks synthesized from in-the-wild terminal recordings. The Exgentic adapter builds a deterministic recommended action shortlist from the current task, context, latest observation, profile, schemas, and recent diagnostics before showing the full action schemas, highlights required argument keys with redacted exact current-state hints when available, repairs case/camelCase/schema-key near misses and exact latest-observation/context required-argument omissions before `ActionType` dispatch, avoids repeating no-effect actions when the latest observation did not change, uses the shortlist/hints to recover from malformed or missing action JSON with a viable non-finish action while completion is not ready, then folds prior observations/actions into a compact task-relevant ledger between steps so long noisy sessions keep current state, policy evidence, TerminalWorld artifact requirements and reference-solution avoidance, WebDevBench canary requirements, frontend/backend evidence, SWE-Cycle lifecycle phases, environment setup state, generated/selected tests, judge evidence, SWE-CI current/target commits, test gaps, inferred requirements, verifier deltas, SWE-PRBench PR metadata/diff/findings/evidence gaps, TML-Bench data contract/validation/submission evidence, Pi-Bench user/workspace/app context, hidden-intent hypotheses, clarification state, privacy risk, selected actions, and diagnostics in view without repeatedly reinjecting raw transcripts. The interactive CLI acknowledges submitted turns before provider I/O, treats F5/Shift+F5 raw terminal sequences as active-turn cancellation on Windows/xterm terminals, and auto-heals known-stuck OpenRouter preview models to the configured free fallback unless explicitly overridden.

## Evaluation Results

Grawkus writes `summary.json`, `trace.jsonl`, `worktree.patch`, `git-status.txt`, `open-agent-leaderboard-draft.json`, `agent-context-compiled.jsonl`, `change-evaluation.json`, and `submission-bundle-manifest.json` artifacts when benchmark trace output is enabled. The draft row follows the public Open Agent Leaderboard result-column shape where local trace evidence can support it, but remains `submissionReady:false` until an official harness supplies benchmark-owned scores and session success evidence. The submission bundle manifest indexes artifact paths and SHA-256 hashes, summarizes verifier/usage/process evidence, and lists missing official fields so local traces are not mistaken for leaderboard scores. Trajectory quality includes explicit task-alignment, spec-compliance, reward-hack, HarnessAudit-style harness-safety, long-horizon coverage, Pi-Bench proactivity, component-observability, root-cause hypothesis, failure-onset diagnosis, trajectory triage, targeted-fix manifest, context-utilization, candidate-file dossier, trajectory cleanup, pre-edit context-bloat, weak change-manifest, and evidence-grounding risk fields so benchmark reviewers can separate genuine task progress from distractor-following, repair edits without a failure-tied diagnosis or fix plan, undiagnosed verifier repair loops, recall-heavy unused context gathering without a compact localization dossier, noisy encoded or duplicate tool observations, visible-suite-only validation, stale/no-effect edit loops, verifier tampering, unsafe protected-resource access, external information transfer, destructive operations, oracle access, shortcut score markers, unsupported RoadmapBench/SaaSBench/SWE-Bench Mobile/SWE-WebDevBench/SWE-Cycle/SWE-CI/Pi-Bench completion claims, or edits/actions without falsifiable prediction and observable follow-through.

Prior experience reuse also reads AHE change-evaluation verdicts. Confirmed manifests can rank higher, while contradicted, regression-risk, pending-verification, missing-prediction, or missing-regression-forecast manifests are emitted as warning patterns instead of replay hints.

Prior experience reuse also applies ContextBench-style context discipline: concise runs whose inspected files were used by the eventual patch can rank higher, while low-utilization or pre-edit context-bloat runs are emitted as warning patterns instead of replay hints.

Prior experience reuse also applies AHE-style cleanup discipline: traces with encoded blobs, duplicate observations, or excessive truncation are emitted as warning patterns instead of replay hints.

Prior experience reuse also applies AHE-style diagnosis discipline: traces that repaired after a failed verifier without a root-cause hypothesis are emitted as warning patterns instead of replay hints.

Prior experience reuse also applies failure-onset discipline: traces with repeated verifier loops or regression cycles that were repaired without a diagnosis are emitted as warning patterns instead of replay hints.

Prior experience reuse also applies AHE-style fix-plan discipline: traces that repaired after a failed verifier without a targeted-fix manifest are emitted as warning patterns instead of replay hints.

Interactive type-ahead is preserved through active-turn cancellation and permission interruptions: text captured while the model/tool chain is running is restored into the next editable prompt instead of being emitted as a passive queued hint or silently submitted.

Official results should be produced through Exgentic, HAL, Terminal-Bench, KBench, or another benchmark-owned grader before submission.

## Limitations

- Prior memory and replay traces can be stale or mismatched; current task evidence must override them.
- Generic web or source research cannot prove task success without local or official verifier evidence.
- The agent card does not substitute for official harness scoring.
- Hosted or sandboxed benchmarks may restrict network, package install, or provider access; use pinned bundles or preinstalled `grawkus` where possible. The legacy `cawdex` alias remains supported for older images.
- Open-weight or free-tier models may show high variance on long-horizon tasks.

## How To Run

Print packaged adapters and card paths:

```bash
grawkus --print-exgentic-agent
grawkus --print-hal-agent
grawkus --print-kbench-adapter
grawkus --print-open-agent-card
```

Run a benchmark task directly:

```bash
grawkus --provider openrouter --model openrouter/free --perm yolo --prompt "/benchmark swe-bench fix the issue"
```

For reproducible leaderboard runs, pin the installed package or bundle, pass provider credentials through environment variables, enable benchmark trace output, and submit only official harness results.
