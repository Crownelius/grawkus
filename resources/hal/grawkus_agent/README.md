# Grawkus HAL adapter

This directory is a HAL-style custom agent package. It exposes `run(input, **kwargs)` in `main.py` and shells out to the installed `grawkus` CLI in non-interactive benchmark mode.

Defaults:

- SWE-bench-like tasks return a git patch string.
- ScienceAgentBench-like tasks return a solution/trajectory string.
- AppWorld-like tasks return `Completed` after a successful Grawkus run.
- WebDevBench-like tasks are routed to the `webdevbench` benchmark profile, which keeps canary requirements plus frontend-backend and production/security validation evidence visible.
- SWE-Cycle-like tasks are routed to the `swe-cycle` benchmark profile, which keeps lifecycle phase, environment setup, implementation, verification-test generation, and static/dynamic judge evidence visible.
- SWE-CI-like tasks are routed to the `swe-ci` benchmark profile, which keeps current/target commits, test gaps, inferred requirements, and CI-loop verifier deltas visible.
- SWE-PRBench-like tasks are routed to the `swe-prbench` benchmark profile, which reviews PR metadata and diff first, expands only for concrete suspected findings, and returns severity-rated file/line findings unless patches are explicitly requested.
- TML-Bench/Kaggle-style tabular ML tasks are routed to the `tml-bench` benchmark profile, which extracts the data contract, avoids hidden-label leakage, trains an honest baseline, and validates the generated submission schema before completion.
- Pi-Bench-style proactive personal assistant tasks are routed to the `pi-bench` benchmark profile, which builds a user/workspace/app context contract, tracks hidden-intent hypotheses, asks focused clarification only when needed, and verifies observable state after proactive actions.
- USACO and other text-response tasks return the original task dict with a `response` field.
- Oracle-like fields such as `patch`, `test_patch`, `solution`, `answer`, `gold`, `FAIL_TO_PASS`, and `PASS_TO_PASS` are omitted from the prompt unless `GRAWKUS_HAL_INCLUDE_ORACLE_FIELDS=1` is set.
- Traces and logs are written under `.grawkus/hal-trace/` unless `GRAWKUS_HAL_TRACE_DIR` is set.

Useful overrides:

- `GRAWKUS_HAL_COMMAND` or `GRAWKUS_HAL_COMMAND`: command used to invoke Grawkus, default `grawkus`.
- `GRAWKUS_HAL_TIMEOUT_SEC`: per-task timeout, default `1800`.
- HAL `-A model_name=...`, `-A provider=...`, `-A max_turns=...`, and `-A output_format=...` are forwarded to Grawkus CLI flags when present.
