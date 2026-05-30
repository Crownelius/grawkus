# Grawkus KBench Adapter

This directory is a KBench `custom-adapter` for Grawkus.

```bash
kbench run \
  --benchmark swe \
  --harness custom-adapter \
  --adapter /path/to/resources/kbench/grawkus_agent \
  --model-name openrouter/free \
  --instruction "Fix the bug"
```

The runner reads the KBench JSON payload from `KBENCH_ADAPTER_INPUT` or stdin,
invokes `grawkus --prompt "/benchmark ..."` in task mode, and emits one
`AdapterRunnerOutput` JSON object to stdout.
Known KBench slugs are mapped to benchmark profiles before dispatch:
`swe`/`swe-bench`, `tb2`/`terminal-bench`, `terminalworld`/`terminal-world`,
`swe-chain`,
`swe-cycle`/`fullcycle`/`swe-judge`, `swe-ci`/`swecibench`, `swe-prbench`/`prbench`/`pr-review`, `tml-bench`/`tabular-ml`/`kaggle-ml`, `pi-bench`/`proactive-assistant`, `ci-repair`/`ci-repair-bench`, `roadmapbench`, `saasbench`,
`swe-bench-mobile`, `webdevbench`/`swe-webdev-bench`, `appworld`, `browsecomp`/`browsecompplus`, and
`tau2`/`tau-bench` use specialized prompts; unknown slugs use
`generic`.

The output includes redacted instruction/stdout/stderr artifact refs, native
Grawkus trace refs, and redacted git patch/status refs when the task
worktree is a git repo. If a native `summary.json` exists, compact verifier
evidence, including parsed counts, compact failure signatures, and final-answer
verification-claim plus incomplete/blocked completion evidence, usage/cost
telemetry, cost-efficiency risk, invalid tool-action telemetry, task-contract checklist completion/no-edit/test-edit signals,
task-alignment risk signals, spec-compliance risk signals, reward-hack risk signals, long-horizon coverage risk signals, Pi-Bench proactivity ledger signals, incomplete/inconclusive verifier markers,
environment setup/reconstruction signals for missing dependencies, toolchains,
or build artifacts, dependency manifest/lockfile setup-validation signals,
HarnessAudit-style harness-safety signals for protected-resource access, external information transfer, destructive operations, and oracle access,
candidate-file dossier signals for broad pre-edit inspection without a compact dossier,
root-cause hypothesis signals for repair edits after failed verifiers without an explicit diagnosis,
targeted-fix manifest signals for repair edits after failed verifiers without a fix plan,
trajectory-cleanup signals for base64/data-URI blobs, high-entropy encoded output, duplicate output, and excessive truncation,
skill-view fit/timing signals, per-target edit localization signals, large edit-surface
signals, scratch/probe artifact signals, redundant tool-call signals,
redundant failing-verifier rerun signals, blind-repair signals, post-edit regression-cycle signals,
AHE publish-state mutation signals, latest post-edit verifier signals, post-edit and final-state
diff-review signals, final-edit validation stability/lucky-pass signals, broad-validation signals,
CI-derived validation signals,
source-research recency signals,
process-defect scoring, AHE-style change-evaluation verdicts, submission bundle manifest readiness/hash metadata,
and trajectory-quality fields are copied to
`benchmarkResult.traceSummary` for harness-side scoring. `benchmarkResult.usage`
also aliases the native usage block for cost-aware leaderboards. Native verifier
trace previews preserve both head and tail output so final test summaries survive
noisy install/build logs. `benchmarkResult.experienceCard` includes bounded
task-alignment/spec-compliance/reward-hack/harness-safety/long-horizon/proactivity risk blocks, component-observability edit classification for AHE-style surface attribution, including SWE-WebDevBench canary/frontend-backend/security validation signals, SWE-Cycle lifecycle/setup/test-generation/judge validation signals, SWE-CI evolution/checklist/CI-loop validation signals, and Pi-Bench context-contract/hidden-intent/clarification/privacy/completion evidence, root-cause hypothesis state and targeted-fix counts for failed-verifier repair edits, decision-observability predictions for edits and validation-reliability evidence
for final verifier stability, broad validation, and CI-derived validation, plus
context-utilization precision/miss evidence, candidate-dossier status, and
trajectory-cleanup summaries for retrieval-aware scoring and avoiding noisy prior
traces, plus run-efficiency action/usage/cost/time evidence for cost-aware scoring. Prior
experience hints also expose compact source-research coverage, including
hit/error counts, targeted/fresh coverage, recency windows, top URLs, and
Kaggle fallback status. When present, `benchmarkResult.traceSummary` also
includes the redacted ACC-style task/context/answer compilation from the native
Grawkus trace for retrieval, replay, or training-data curation.
It also includes `changeEvaluation` and `submissionBundleManifest` when present, so leaderboard
submission tooling can inspect artifact hashes and missing official score/session
fields without parsing the full summary.

Inside benchmark mode, the read-only `benchmark_context` preflight also surfaces
CI workflow run commands plus setup actions, env key names, service containers,
job containers, and images from GitHub Actions, GitLab CI, CircleCI, Azure
Pipelines, and Jenkins files. Env values are not printed. Agents can reconstruct
the relevant CI environment and then reproduce project-native test/build/lint
steps before finalizing.
It also separates reusable prior local benchmark experience from similar failed
or unsafe prior runs, so context reuse stays method-level and current verifier
evidence remains authoritative. Pi-Bench-like tasks additionally prefer prior
experience with complete context/hidden-intent/clarification/privacy/completion
proactivity ledgers and surface incomplete ledgers as warnings. AHE change
evaluations also participate in reuse: confirmed manifests can rank higher,
while contradicted, regression-risk, pending-verification, missing-prediction,
or missing-regression-forecast manifests are warnings rather than replay hints.
Context-utilization evidence participates in reuse as well: concise runs whose
inspected context was used by the eventual patch and whose pre-edit search was
compressed into a candidate-file dossier can rank higher, while low-utilization,
missing-dossier, or pre-edit context-bloat runs are warnings rather than replay
hints.
AHE-style cleanup evidence participates in reuse too: prior runs with encoded blobs,
duplicate observations, or excessive truncation are surfaced as warnings instead of
replay hints.
AHE-style diagnosis evidence participates in reuse too: prior runs that repaired after
failed verifiers without a root-cause hypothesis are surfaced as warnings instead of
replay hints.
AHE-style fix-plan evidence participates in reuse too: prior runs that repaired after
failed verifiers without a targeted-fix manifest are surfaced as warnings instead of
replay hints.
Interactive type-ahead is preserved across active-turn cancellation and
permission interruptions, so user drafts return to the prompt instead of being
silently submitted while the harness is still running.

Useful env vars:

- `GRAWKUS_KBENCH_COMMAND` or `GRAWKUS_KBENCH_COMMAND`: command used to launch Grawkus, default `grawkus`.
- `GRAWKUS_KBENCH_PERMISSION`: permission flag value, default `yolo`.
- `GRAWKUS_KBENCH_EXTRA_ARGS`: extra Grawkus CLI flags.
- `GRAWKUS_KBENCH_ARTIFACT_DIR`: directory for redacted instruction/stdout/stderr and trace files.
- `GRAWKUS_BASH_TIMEOUT_MS`: default Grawkus `bash` tool timeout; the adapter defaults to `300000` when unset.

Provider keys should be passed via normal Grawkus env config or KBench's
`--api-key-env`, which the runner forwards as Grawkus `--api-key-env`.
