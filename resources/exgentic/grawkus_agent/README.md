# Grawkus for Exgentic

This directory is a custom Exgentic agent package for running Grawkus in
Open Agent Leaderboard style evaluations.

The adapter implements Exgentic's `Agent` / `AgentInstance` split. On each
`react()` step it writes an Exgentic prompt, launches Grawkus in
non-interactive `/benchmark` mode, asks Grawkus to finish with one JSON
action object, then maps that JSON back to an Exgentic `ActionType`.
It auto-selects specialized `/benchmark` profiles for AppWorld, BrowseComp+,
tau2, ARC, SaaS, roadmap, mobile, WebDevBench, SWE-Cycle, SWE-CI, SWE-PRBench, TML-Bench, and Pi-Bench-style tasks from the task, context, and
available action schemas. It also builds a deterministic recommended action
shortlist before the full schema list, including required argument keys and
redacted exact latest-observation/context hints when those required values are
already present. This matches the Open Agent leaderboard finding that
action-scaffold details matter while preserving compatibility with every
available benchmark action. Long sessions use a folded history ledger
that preserves latest observations, selected actions, action counts, and
diagnostics without reinjecting bulky raw stdout into every step. Before
dispatch, near-miss action JSON is repaired conservatively: action names are
matched by case/identifier normalization, schema argument keys are canonicalized,
required schema fields are filled from exact latest-observation/context keys
when available, and unknown extra keys are dropped when the benchmark exposes a
fixed schema. If Grawkus produces malformed or missing action JSON, the adapter
uses the same shortlist and exact required-argument hints to select a viable
non-finish action while the latest observation is still pending, instead of
falling straight to a finish/message action. When a selected action is followed
by an effectively unchanged observation, the next shortlist and deterministic
fallback mark that action as a no-effect repeat and prefer another viable action
with satisfiable required arguments.
For WebDevBench-style app-agency tasks, the folded ledger keeps canary business
requirements, frontend/backend coupling evidence, and production/security gaps
visible across turns so an attractive UI-only action does not look complete.
For SWE-Cycle-style lifecycle tasks, it keeps the phase, bare-repo environment
setup state, implementation requirements, generated/selected tests, judge
commands, and unresolved lifecycle gaps visible across turns.
For SWE-CI-style codebase maintenance tasks, it keeps current/target commits,
test gaps, inferred requirements, touched files, verifier deltas, and unresolved
regressions visible across the `run_tests -> define_requirements -> modify_code`
loop.
For SWE-PRBench-style PR review tasks, it keeps PR metadata, changed files, diff
hunks, suspected findings, evidence gaps, and context-expansion reasons visible
so the agent produces severity-rated findings instead of drifting into broad
repo inspection or unsolicited patch generation.
For TML-Bench-style tabular ML tasks, it keeps the data contract, metric,
validation split, leakage checks, model artifact, submission path, and submission
validity evidence visible so the agent favors a reproducible valid baseline over
an invalid high-complexity attempt.
For Pi-Bench-style proactive assistant tasks, it keeps user profile, current
request, message/file/app context, available domain tools, hidden-intent
hypotheses, privacy risk, clarification state, selected actions, and observable
completion evidence visible so the agent can ask focused questions without
overreaching or fabricating personal state.

## Python API use

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path("path/to/resources/exgentic").resolve()))

from grawkus_agent import GrawkusAgent
from exgentic.interfaces.lib import evaluate

results = evaluate(
    benchmark="gsm8k",
    agent=GrawkusAgent(
        model="openrouter/free",
        provider="openrouter",
        max_turns=8,
    ),
    num_tasks=5,
)
```

## Registry use

For Exgentic CLI usage, copy this directory into an Exgentic checkout at:

```text
src/exgentic/agents/grawkus_agent/
```

Then add a registry entry:

```python
"grawkus_agent": RegistryEntry(
    display_name="Grawkus",
    module="exgentic.agents.grawkus_agent.agent",
    class_name="GrawkusAgent",
),
```

After that:

```bash
exgentic install --agent grawkus_agent --local
exgentic evaluate --benchmark gsm8k --agent grawkus_agent --model openrouter/free
```

## Configuration

- `GRAWKUS_EXGENTIC_COMMAND` or `GRAWKUS_EXGENTIC_COMMAND` overrides the command, default `grawkus`.
- `GRAWKUS_INSTALL_SPEC` controls `setup.sh`, default `grawkus@latest`.
- `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, and other Grawkus provider env vars
  are passed through by the launched Grawkus process.
- `model`, `provider`, `max_turns`, `max_tokens`, `context_window_tokens`,
  `temperature`, and `output_format` become Grawkus CLI flags.
- `extra_env` and `extra_args` let Exgentic experiments pass additional
  Grawkus settings without modifying this adapter.

The adapter reports Grawkus's `summary.json` estimated cost to Exgentic
when `GRAWKUS_BENCHMARK_TRACE_DIR` output is present.
