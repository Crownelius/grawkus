# Grawkus — Command Reference

Every command Grawkus exposes, organized by purpose. Three surfaces:

1. **Shell command** — what you type at your OS terminal (`grawkus`; `grawkus` remains a legacy alias)
2. **Slash commands** — what you type inside the REPL once it's running
3. **Tools** — what the underlying LLM calls automatically; not invoked by you

If you're new, run `grawkus` then type `/walkthrough` for an agent-led tour.

---

## 1. Shell invocation

After `npm install -g grawkus`, you have both the primary `grawkus` command and the legacy `grawkus` alias:

```bash
grawkus
grawkus --doctor
grawkus doctor --json --no-registry
grawkus --openai-oauth-smoke
```

`grawkus` launches the REPL. `grawkus --doctor` runs install/config/benchmark readiness checks and exits before setup; `--doctor-json` or `doctor --json` prints machine-readable output, and `--doctor-no-registry` or `--no-registry` skips the npm registry lookup. `grawkus --openai-oauth-smoke` verifies Codex OAuth auth, request creation, and streaming without printing tokens.

First run also fires the setup wizard (provider, API key, model, permission mode). See [INSTALL.md](INSTALL.md) for setup details.

---

## 2. Slash commands

Everything in this section is typed inside the REPL after `❯ `.

At an empty prompt, `/` opens the inline command selector. It stays below the prompt, keeps the widget under roughly half the terminal height, lets you type to narrow, scroll with arrows/PageUp/PageDown, jump with Home/End, and press Enter to fill the prompt with the highlighted command so you can edit it or press Enter again to run it. If a slash prefix is already typed, Tab reopens the same bounded selector with that filter instead of printing the full command list. It only erases its own prompt/dropdown rows instead of clearing the rest of the terminal.

During model/tool work, the bottom five-row footer stays pinned while only the transcript above it scrolls. Typing remains visible in that footer and is restored into the next editable prompt if you cancel. The first interactive prompt opens with `/model` prefilled by default; change that with `/footer opening <prompt>`. While waiting, a subtle Edo/neon-style animation keeps the Esc/F5 interrupt hint visible without relying on a stuck timer. If an OpenRouter preview/free model accepts a request but sends no stream event, Grawkus cancels after a first-token watchdog and retries once only when `/fallback` is configured; otherwise the prompt returns with a timeout note instead of appearing frozen.

### 2.1 General & session control

| Command | What it does |
|---|---|
| `/help` | Show the full command list grouped by category. |
| `/walkthrough` (aliases: `/tour`, `/guide`) | Launches an agent-led tour of every feature. Recommended first thing. |
| `/clear` | Empty the current message history (REPL stays open). |
| `/history` | Show message count + estimated tokens + whether compaction is recommended. |
| `/export [md\|json\|txt]` | Save the current conversation to a file in CWD. Default: `md`. |
| `/exit` / `/quit` | Quit the REPL. |
| `/config` | Re-run the main setup wizard (provider/key/model/fallback, permissions, swarm). |
| `/theme [full\|compact\|minimal]` | With no args, opens the combined display-theme and color-palette picker. With an arg, sets startup display verbosity. |
| `/palette [id]` | With no args, opens the combined appearance picker. With an id, switches to one of 12 Coolors trending color schemes. Typo alias: `/pallete`. |
| `/palettes` | List palette IDs with color swatch previews. |
| `/footer [sub]` | Customize the fixed bottom footer. Supports `on`, `off`, `text <template>`, `opening <prompt>`, `clear`, and `reset`. |
| `!<cmd>` | Run a shell command directly without involving the AI. Example: `!ls -la`. |

Palette IDs: `olive-garden-feast`, `fiery-ocean`, `refreshing-summer-fun`, `ocean-blue-serenity`, `pastel-dreamland-adventure`, `sunny-beach-day`, `dark-sunset`, `fiery-red-sunset`, `fiery-palette`, `rustic-earthy-tones`, `golden-summer-fields`, `vibrant-tones`.

### 2.2 Modes

Modes change the system prompt to bias the agent toward a particular workflow.

| Command | Mode | What changes |
|---|---|---|
| `/mode dev` | Development (default) | General coding — write features, fix bugs, refactor. |
| `/mode review` | Code Review | Severity-rated findings, no edits unless asked. |
| `/mode tdd` | Test-Driven Development | Strict RED → GREEN → REFACTOR. No impl before a failing test. |
| `/mode research` | Research | Read-only exploration. Won't modify files. |
| `/mode plan` | Planning | Designs implementation plans, no edits. |
| `/mode debug` | Debug | Systematic root-cause hunt with hypothesis tracking. |
| `/mode benchmark` | Benchmark | SWE-bench/Terminal-Bench-style runs: localize, patch, verify, and report harness-grade evidence. |
| `/mode architect` | Architect | System-level design, component boundaries, trade-offs. |
| `/mode sentience` | Sentience | Self-improving learning loop — recalls prior memory, models the user, parallelizes, distills skills, persists knowledge. |
| `/mode design` | Design | Stitch-powered UI generation. Agent uses Google Stitch automatically for any visual work and integrates the generated HTML into your code. Requires `/stitch-config`. |
| `/modes` | (list-only) | Print all available modes. **Does NOT switch** — use `/mode <name>`. |
| `/sentience` | Alias | Same as `/mode sentience`. |
| `/hermes` | Legacy alias | Same as `/sentience`. |
| `/design [task]` | Alias + shortcut | Switch to design mode. If `[task]` given, also kicks off the task immediately (e.g. `/design build a stock portfolio app, edgy red, no blue/green`). |

### 2.3 Model & provider

| Command | What it does |
|---|---|
| `/model [name]` | Show current model, or switch to `<name>` (e.g. `/model anthropic/claude-sonnet-4`). Built-in aliases include `free` for `openrouter/free`. |
| `/model alias <name> <model>` | Save a user alias, e.g. `/model alias paid anthropic/claude-sonnet-4`. |
| `/model aliases` | List user and built-in model aliases. |
| `/model unalias <name>` | Remove a saved alias. |
| `/model once <model-or-alias> [--effort <level>]` | Use a model and optional reasoning effort for the next user turn only. Does not mutate `config.json`. |
| `/model effort <none\|minimal\|low\|medium\|high\|xhigh>` | Use a reasoning effort override for the next user turn only. |
| `/models` | List models the provider can serve. |
| `/provider` | Show provider name, base URL, masked key, current model. |
| `/openai-login [status\|smoke]` | Configure Codex OAuth, show token status, or run a smoke request through the OAuth stream path. |
| `/route` | Auto-route the **next** message to a cheaper/more-capable model based on its complexity. Single-use. |

### 2.4 Sessions

Sessions are JSON snapshots stored in `~/.grawkus/sessions/`.

| Command | What it does |
|---|---|
| `/sessions` | List saved sessions with ID, name, model, message count. |
| `/save [name]` | Save the current session. Auto-named if `name` omitted. |
| `/resume [id\|prefix\|last]` | With no args, open the bounded session picker. With an arg, replay that saved session into the current REPL. |
| `/delete <id>` | Remove a saved session. |

### 2.5 Git

| Command | What it does |
|---|---|
| `/commit` | AI writes a commit message from the current diff. |
| `/pr` | AI writes a PR title + body for the current branch vs `main`. |
| `/diff` | Show `git diff` (working tree). |
| `/log [N]` | Show recent `git log` (default 15 entries). |

### 2.6 Code quality (LLM-driven)

These trigger an LLM workflow with an injected prompt. `/tdd`, `/review`, `/security-review`, `/plan`, `/refactor`, `/build-fix` automatically use the higher-quality bundled ECC prompts when ECC is installed (default).

| Command | What it does |
|---|---|
| `/review [target]` | AI code review with severity-rated findings. Target can be a path, commit, or `HEAD~N`. |
| `/tdd <feature>` | TDD workflow — agent writes tests first, then implementation. |
| `/security-review` | Security audit: SQLi, XSS, secrets, auth bypasses, etc. |
| `/audit` | Local-only project health check (git, tests, linter, secrets). No data leaves your machine. |
| `/doctor [json\|no-registry\|offline]` | Install/config/source-research/benchmark readiness check. JSON mode prints machine-readable output; no token values are printed. |
| `/verify [cmd]` | Run tests, fix failures, repeat until green. |
| `/build-fix` | Auto-detect language/build tool and fix build errors. |
| `/test-coverage` | Analyze coverage and suggest missing tests. |
| `/refactor [target]` | Dead code detection + cleanup. With no args, full project scan. |
| `/refactor-clean` | Alias of `/refactor` — same dispatch. |
| `/e2e <feature>` | Generate E2E tests (Playwright/Cypress/Puppeteer, auto-detected). |
| `/eval <criteria> [target]` | Evaluate the project against custom criteria. |
| `/benchmark [profile] <task>` | Benchmark-grade issue/terminal/general-agent workflow. Profiles: `swe-bench`, `terminal-bench`, `terminalworld`, `swe-context`, `swe-chain`, `swe-cycle`, `swe-ci`, `swe-prbench`, `tml-bench`, `pi-bench`, `ci-repair`, `wildclaw`, `arc-agi`, `specbench`, `reward-hacking`, `roadmapbench`, `saasbench`, `swe-bench-mobile`, `appworld`, `browsecomp`, `tau2`, `generic`. Aliases: `/bench`, `/leaderboard`. |
| `/plan <task>` | Structured implementation planning, no edits. |
| `/update-docs` | Sync documentation files with current code. |

### 2.7 Language-aware reviews and build fixes

| Command | What it does |
|---|---|
| `/review [target]` | Code review using ECC's language-agnostic high-quality prompt (default). |
| `/auto-review` | Same, plus auto-detected language-specific lens (TS / Python / Go / Rust / Java / C++ / Kotlin / PHP / SQL). |
| `/build-fix` | Auto-detect language and toolchain, diagnose and fix build errors. |

The legacy per-language slash commands (`/ts-review`, `/py-review`, `/go-review`, `/rust-review`, `/java-review`, `/cpp-review`, `/kotlin-review`, `/php-review`, `/db-review`, `/ts-build-fix`, `/go-build-fix`, `/rust-build-fix`, `/java-build-fix`, `/cpp-build-fix`, `/pytorch-fix`) still work as silent aliases for muscle memory, but `/auto-review` and `/build-fix` are the canonical entry points — they pick the right language-specific prompt themselves.

### 2.9 Multi-agent orchestration

| Command | What it does |
|---|---|
| `/orchestrate <task>` | Decomposes a task and runs sub-agents in parallel. |
| `/swarm <task>` | Asks a compact setup wizard, infers roles, runs analysis-only workers, and prints a main-agent handoff. Expert form: `/swarm <agents> <task>`. |
| `/pr-loop` | Autonomous loop: read PRs, write feedback, repeat. |
| `/multi-plan <task>` | Several agents propose independent plans, then converge. |
| `/multi-execute <plan>` | Several agents execute the same plan, vote on output. |
| `/multi-backend <s1,s2,...>` | Generate multiple services in parallel. |
| `/multi-frontend <c1,c2,...>` | Generate multiple components in parallel. |

### 2.10 Search & docs

| Command | What it does |
|---|---|
| `/search-first <task>` | Forces research-before-code mode: web/grep/glob first, then edit. |
| `/sources <query> [flags]` | Direct source scan without a model call. Defaults to all sources, GitHub all, Hugging Face all, Kaggle both, recent 90 days, limit 5. Flags: `--source`, `--github`, `--hf`, `--kaggle`, `--recent`, `--limit`, `--json`. |
| `/benchmark-repos [query] [flags]` | Offline public Terminal-Bench repo catalog from the packaged research seed, including known no-public-source gaps. Flags: `--all`, `--official`, `--related`, `--unverified`, `--limit`, `--repos-only`, `--top-open-source`, `--from-top`, `--docs-only`. |
| `/repo-digest <github-url\|owner/repo> [flags]` | Direct GitHub repo digest without a model call or clone. Flags: `--ref`, `--files`, `--text-files`, `--chars`. |
| `/docs-lookup <query>` | Search docs (project + web) for a concept or API. |

### 2.11 Tools & config (REPL state)

| Command | What it does |
|---|---|
| `/tools` | List the tools the LLM has access to with flags `[R]` read-only, `[RW]` read-write, `[!]` destructive. |
| `/harness [component] [--json]` | Show an AHE-style harness component map with files, tests, docs, and edit contracts. Add `--json` for machine-readable component observability. Components: `system_prompts`, `tooling`, `middleware`, `skills`, `subagents`, `memory`, `providers`, `benchmark_adapters`, `cli_ui`, `verification`. |
| `/rules` | Show language-specific coding rules currently in the system prompt. |
| `/agents` | Show discovered `AGENTS.md` files plus active model/tool scoped sections. |
| `/perm <ask\|auto\|yolo>` | Permission mode: `ask` prompts every time, `auto` allows non-destructive, `yolo` allows everything. |
| `/dry-run` | Toggle. When ON, tools print what they WOULD do without executing. |
| `/thinking` | Toggle. When ON, model "thinking" / reasoning tokens are displayed. |
| `/cd <path>` | Change CWD without leaving the REPL. |
| `/hooks` | List configured hooks (PreToolUse / PostToolUse / SessionStart / SessionStop). |
| `/hook-profile` | Show + change hook profile (`minimal`, `standard`, `strict`) — controls how many hooks fire. |
| `/pm2 [action]` | PM2 service management if pm2 is on PATH. With no args: list services. |

### 2.12 Planning & checkpoints

| Command | What it does |
|---|---|
| `/plan <task>` | See [Code Quality](#26-code-quality-llm-driven). |
| `/checkpoint [label]` | Snapshot current git working state with a label. |
| `/checkpoints` | List checkpoints. Restore via the listed command. |

### 2.13 Codemaps

| Command | What it does |
|---|---|
| `/codemap` (also `/codemaps`) | Show a saved project structure map summarizing every file. |
| `/update-codemaps` | Regenerate the codemap from the current source tree. |

### 2.14 Content engine

| Command | What it does |
|---|---|
| `/article <topic>` | Generate a long-form article or blog post. |
| `/slides <topic> [count]` | Generate a slide outline. Default `count`: 10. |
| `/repurpose <content>` | Repurpose existing content for twitter / linkedin / blog. |
| `/market-research <market>` | Generate a market-research report. |
| `/investor-deck <company>` | Investor pitch deck outline. |
| `/investor-outreach <co> --investor <name>` | Personalized investor outreach email. |
| `/code-quality` | Comprehensive code-quality audit (broader than `/review`). |
| `/skill-stocktake` | Inventory the assistant's skills + capabilities. |
| `/chief-of-staff <context>` | Executive briefing — top priorities, what to do next. |

### 2.15 Skills & patterns

Skills are reusable prompt templates. The 33 ECC skills are bundled; you can create your own.

| Command | What it does |
|---|---|
| `/skills` | List all skills (built-in + ECC + learned). |
| `/skill-create [args]` | Distill a new skill from recent git commit patterns. |
| `/git-patterns` | Analyze the project's git history for repeating change patterns. |
| `/git-workflow` | Summarize the project's git workflow conventions. |

### 2.16 Learning & cost

The learning system extracts patterns from your sessions and decays unused ones.

| Command | What it does |
|---|---|
| `/usage` | Token + cost summary across sessions. |
| `/budget <daily> <monthly>` | Local budget alerts (no data sent anywhere). |
| `/learn` | Extract patterns from the current session into instincts. |
| `/instincts` | Show learned instincts with confidence scores. |
| `/instinct-export <file>` | Export instincts to JSON for backup/sharing. |
| `/instinct-import <file>` | Import instincts from JSON. |
| `/evolve` | Cluster high-confidence instincts into reusable skills. |
| `/prune` | Delete instincts whose confidence has decayed below threshold. |
| `/memory` | Show cross-session memory status (`~/.grawkus/memory/`). |

### 2.17 Detection

| Command | What it does |
|---|---|
| `/detect` | Print detected package manager (npm/pnpm/yarn/bun), test runner (jest/vitest/pytest/etc.), build tool. |

### 2.18 Users (feature-branch, optional)

If the `users.ts` module is wired in your build, you also get:

| Command | What it does |
|---|---|
| `/users` (or `/users ls`) | List user records. |
| `/users add <email> [name]` | Add a new user record. |
| `/users use <email>` | Set the active user for this REPL. |

### 2.19 Counter demo

A tiny stateful demo command useful for testing/learning:

| Command | What it does |
|---|---|
| `/count` | Show current counter value. |
| `/count inc` (or `/count +`) | Increment. |
| `/count dec` (or `/count -`) | Decrement. |
| `/count reset` | Reset to 0. |

### 2.20 Stitch (Google AI UI/UX design)

Integrates with [Stitch](https://stitch.withgoogle.com/), Google's AI UI/UX design + code generation tool. Ports the [gemini-cli-extensions/stitch](https://github.com/gemini-cli-extensions/stitch) extension to Grawkus.

| Command | What it does |
|---|---|
**Prefer `/mode design` or `/design <task>`** for actual UI work — the agent uses Stitch automatically and integrates the generated HTML into your code. The commands below are for direct/diagnostic access.

| Command | What it does |
|---|---|
| `/stitch` | Show config status (masked key, configured-at timestamp, server URL). |
| `/stitch tools` | Live verification — calls `tools/list` against the server and renders the discovered tool catalog as a Markdown table. Confirms auth + endpoint reachability. |
| `/stitch <query>` | Direct Stitch assistant (intent-routed: `enhance: <prompt>` improves a prompt; anything else hits the assistant). Less useful now that design mode does this automatically. |
| `/stitch-config <api-key>` | Save your Stitch API key to `~/.grawkus/stitch.json`. |

**Get an API key:** <https://stitch.withgoogle.com/> → profile icon → **Stitch Settings** → **API Keys** → **Create Key**.

**Or via env var (no file written):** `$env:STITCH_API_KEY = "..."` (PowerShell) / `export STITCH_API_KEY="..."` (POSIX) before launching `grawkus`.

Once configured, the `stitch` tool appears in `/tools` and the agent can call it directly. Common invocations:

```
❯ /stitch list my projects
❯ /stitch generate a landing page for a podcast about productivity
❯ /stitch enhance: dark dashboard with sidebar nav and 3 charts
❯ /stitch edit the hero on screen abc123 to add a CTA button
❯ /stitch get screens for project 4044680601076201931
```

Auth is **API key only** (the simpler of Stitch's two auth modes). ADC (Application Default Credentials via gcloud) is not currently supported.

#### Tool catalog (sourced from upstream reference docs)

| Tool | Category | Read-only | Notes |
|---|---|:---:|---|
| `create_project` | Project Management | no | Create a new Stitch project |
| `get_project` | Project Management | yes | Args: `{ name: "projects/{projectId}" }` |
| `list_projects` | Project Management | yes | No required args |
| `list_screens` | Screen Management | yes | Args: `{ projectId }` |
| `get_screen` | Screen Management | yes | Prefer `{ name: "projects/{p}/screens/{s}" }`; legacy `{ projectId, screenId }` deprecated |
| `generate_screen_from_text` | AI Generation | no | **Slow (minutes).** Args: `{ projectId, prompt, deviceType?, modelId? }`. Model enum: `GEMINI_3_PRO` / `GEMINI_3_FLASH`. Device enum: `MOBILE` / `DESKTOP` / `TABLET` / `AGNOSTIC`. |
| `edit_screens` | AI Generation | no | **Slow.** Args: `{ projectId, selectedScreenIds: [string], prompt, deviceType? }` |
| `generate_variants` | AI Generation | no | Produces alternate variants of a screen |
| `create_design_system` | Design Systems | no | Create a design system |
| `update_design_system` | Design Systems | no | Update an existing design system |
| `list_design_systems` | Design Systems | yes | List available design systems |
| `apply_design_system` | Design Systems | no | Apply a design system to screens |

**Important behavior for AI Generation:**
- Calls take **a few minutes**. Don't retry on connection errors — the work is likely still progressing. Poll `get_screen` after a few minutes to check status.
- `generate_screen_from_text` may return `output_components` with prompt suggestions. The agent will present them to you in a numbered list; pick one and the agent calls again with that as the new prompt.
- Resource-name format (`projects/{p}/screens/{s}`) is preferred over bare IDs where both are accepted.

### 2.21 ECC (everything-claude-code) — no commands, all automatic

ECC is the bundled skill / agent / hook library from [Crownelius/everything-claude-code](https://github.com/Crownelius/everything-claude-code). **Open-source, free, auto-installed on first launch, no commands needed.**

How it works:

- **Built-in commands use ECC prompts automatically** — `/tdd`, `/review`, `/security-review`, `/plan`, `/refactor`, `/build-fix` all run ECC's high-quality prompts under the hood.
- **ECC skills use progressive disclosure** — the system prompt shows the top matching skill names and short descriptions, and the agent calls `skill_view` for the full prompt only after checking that the skill fits the current task, repo evidence, and version context.
- **ECC-only workflows auto-trigger by keyword** — say "add a database migration", "implement a feature for CSV export", or "add typescript rules" and the relevant workflow prompt injects itself. No `/ecc-*` command needed.
- **Default security hooks fire automatically** — block `git --no-verify`, warn on reading `.env`/`.key`/`.pem`, console-log warnings on edits.

There are no `/ecc-*` slash commands. The previous diagnostic commands (`/ecc`, `/ecc-install`, `/ecc-skills`, `/ecc-agents`, `/ecc-commands`, `/ecc-feature-development`, etc.) have been removed. If you type one, you'll see a hint pointing you to natural language.

Verify ECC is enabled by running `/help` — the first line shows `ECC: ✓ enabled — N skills, N agents, N workflows auto-loaded`.

---

## 3. Tools the LLM uses (not invoked by you)

These are called automatically by the agent during tool-use cycles. Listed for reference because you may see them in the output stream.

| Tool | Description | Read-only? |
|---|---|---|
| `bash` | Run a shell command. | No |
| `read_file` | Read a file (paged, with size limits). | Yes |
| `write_file` | Create or overwrite a file. Auto-creates parent dirs. | No |
| `edit_file` | Find-and-replace within a file (with optional `replace_all`). | No |
| `grep` | Search file contents (ripgrep, falls back to grep). | Yes |
| `glob` | Find files by glob pattern. | Yes |
| `list_dir` | List directory entries (type, size, name). | Yes |
| `benchmark_context` | Read-only benchmark preflight: cwd snapshot, manifests, project-native environment reconstruction setup commands, likely verifier commands, CI workflow run commands plus setup/env-key/service/container hints from GitHub Actions/GitLab/CircleCI/Azure/Jenkins configs, Terminal-Bench/TerminalWorld/Harbor harness artifacts, package scripts, task files, concise task-instruction excerpts with exact line references, task-contract signals from visible acceptance criteria/requirements/success criteria/no-edit clauses, runtime/toolchain hints, live toolchain probes for PATH/package-manager/interpreter/virtualenv mismatches, network/offline env indicators, optional short network reachability probes, service-persistence hints, method hints, exact source-research action plans with redacted auth readiness for benchmark/leaderboard/agent-improvement tasks, packaged Terminal-Bench source-catalog matches/gaps, relevant MemPalace memories, relevant prior local benchmark trace summaries with compact `experienceCard` replay checkpoints, task-alignment/spec-compliance/reward-hack/proactivity risk signals, HarnessAudit-style harness-safety signals, environment-reconstruction setup/failure evidence, dependency-upgrade setup-validation evidence, decision-observability edit predictions, validation-reliability evidence, change-evaluation status, and context-utilization precision/miss plus pre-edit context-bloat evidence from high-quality matching runs, prior low-quality/unsafe experience warnings, and read-with-care candidates such as TerminalWorld `solve.sh`; CI env values are not printed; benchmark traces also score run-level usage/cost/time, cost-efficiency risk when high usage lacks strong evidence, invalid tool-action count/percent/events for unknown tools, malformed JSON, schema failures, security/hook blocks, permission denial, and loop/streak aborts, task-instruction/task-contract checklist use, no-edit/no-op contract compliance, task-alignment risk for ignored constraints, distractor/decoy references, and off-task-looking edits, spec-compliance risk for visible-suite-only validation or hardcoded visible cases, reward-hack risk for verifier tampering, oracle/solution probes, result-file edits, shortcut completion markers, and bypass commands, HarnessAudit-style resource-access, information-transfer, destructive-operation, and oracle-access risk, Pi-Bench proactivity risk for missing context contract, hidden-intent hypothesis, clarification decision, privacy review, or observable completion evidence, test/harness/verifier edit risk, localization/failing-reproduction/validation quality, per-target edit localization and unlocalized edit-target events, weak change manifests for edits without falsifiable prediction/verifier follow-through, local context-utilization precision/risk signals, pre-edit context-bloat risk when broad local inspections are mostly unused by the eventual patch, large edit-surface scope checks, scratch/probe artifact checks, redundant read/search tool loops, redundant failing-verifier reruns, blind repair after failed verifier signals, failed-verifier source-file repair alignment, post-edit pass/fail/pass regression cycles, environment setup commands, dependency manifest/lockfile edit setup-validation signals, unresolved missing-dependency/toolchain/build-artifact verifier failures, skill-view fit/timing signals, latest post-edit verifier status, post-edit and final-state diff/status review, final-edit validation stability/lucky-pass risk, narrow-to-broad post-edit validation, CI-derived verifier command coverage, final-state validation after the last edit, failing reproduction before repair, parsed verifier pass/fail evidence and compact failure signatures across common JS, Python, Rust, Go, JVM, and .NET runners with verifier head/tail previews for noisy logs, final-answer verification-claim and incomplete/blocked completion evidence, incomplete/inconclusive timeout or truncation markers, source research coverage with parsed hit/error/recency evidence including Kaggle competition fallback, structured `research_sources` trace previews that preserve source headings, URLs, coverage notes, and tail endpoint/auth errors, structured process defects with a 0-100 process score, and leakage-risk artifacts. | Yes |
| `harness_components` | AHE-style component observability: maps Grawkus prompts, tools, middleware, skills, sub-agents, MemPalace memory, providers/OAuth, benchmark adapters, CLI UX, and verification/release gates to current files, focused tests, docs, and short `Prediction:` edit contracts without printing credentials or memory contents; supports `format:"json"` for machine-readable reports. | Yes |
| `todo_write` | Update the working todo list; reinjected before each turn and preserved across compaction. | No |
| `research_sources` | Query arXiv, GitHub repositories/issues/PRs/code, Hugging Face papers/models/datasets, and Kaggle datasets/competitions for source-grounded research; output includes coverage/auth/recency notes, a compact source digest, deterministic cross-source ordering for reproducible traces, applies `recent_days` to supported source date fields, caveats GitHub code freshness, reports Kaggle competition fallback, and supports `format:"json"` for machine-readable source packets. | Yes |
| `benchmark_repo_catalog` | Offline Terminal-Bench 2.0 public repository seed catalog for source mining; returns verified direct mappings, related/partial mappings, and known no-public-source gaps, and benchmark traces score positive hits, gap projects, repo slugs, and whether positive hits are followed by `github_repo_digest` before porting patterns. | Yes |
| `github_repo_digest` | Inspect a public GitHub repository without cloning it: metadata, bounded tree/file language counts, manifests, CI files, likely commands, key excerpts, and AHE-style component surface signals; benchmark traces record digest repo slugs as source-mining follow-through, and optional GitHub auth is never printed. | Yes |
| `web_fetch` | Fetch a URL and return text (HTML→text). | Yes |
| `web_search` | Search the web by keyword (DuckDuckGo, no API key). | Yes |
| `stitch` | Call Google Stitch's MCP server (`tools/list`, `tools/call`). Only present when `/stitch-config` has been run. | No |

Prior benchmark hints emitted by `benchmark_context` include compact `efficiency=...` signals when available: tool calls, tool elapsed time, slow tool calls, usage calls, tokens, cost, invalid-action rate, successful verifier count, process score, process-defect count, warnings, cost-efficiency risk, and time-efficiency risk. They also include `source_research=...` signals when prior runs captured source coverage: source kinds, hit/error counts, recency/freshness, targeted-coverage status, Kaggle fallback status, top URLs, and bounded coverage notes. `source_mining=...` signals capture prior Terminal-Bench catalog/digest discipline: catalog calls, repo-digest calls, context hints, positive projects, no-source gaps, repo slugs, and queries; positive catalog mappings without repo digests become prior-experience warnings. ContextBench-style prior reuse prefers runs whose inspected context was used by the eventual patch and whose broad pre-edit inspection was compressed into a candidate-file dossier, while low-utilization, missing-dossier, or pre-edit context-bloat runs become warnings. AHE-style prior reuse also ranks `root_cause=...`, `failure_onset=...`, `targeted_fixes=...`, and `triage=...` discipline, while missing diagnoses, undiagnosed failure-onset repair loops, missing fix plans, and informative failure/loop/exhaustion triage patterns become warnings. Pi-Bench-like tasks also rank prior `proactivity=...` ledgers, preferring complete context/hidden-intent/clarification/privacy/completion evidence and routing proactivity-ledger defects to warnings.

Benchmark trace summaries include `candidate_dossier=...` and `experienceCard.candidateDossier`. If broad read/search/list localization crosses the candidate threshold without a recorded candidate-file dossier before the first patch, Grawkus emits a localization process defect and completion reminder instead of letting recall-heavy browsing roll straight into edits.

Benchmark trace summaries include `root_cause=...`, `root_cause_risk`, `root_cause_signals`, and `experienceCard.rootCauseHypothesis`. If a conclusive failed verifier is followed by a repair edit without an assistant `Root cause:`, `Diagnosis:`, or failure-tied `Hypothesis:` record, Grawkus emits a reproduction process defect and completion reminder so AHE-style traces preserve why the patch was chosen.

Benchmark trace summaries include `failure_onset=...`, `failure_onset_risk`, `failure_onset_category`, `failure_onset_repairs`, and `experienceCard.failureOnset`. Repeated failing-verifier reruns, blind/unaligned repairs, and post-edit regression cycles are tied back to the first bad verifier/edit boundary so AgentRx/CodeTracer-style diagnosis can happen before another patch. Undiagnosed repair loops become prior-experience warnings.

Benchmark trace summaries include `trajectory_triage=...`, `triage_informative`, `triage_signals`, category counts, and `experienceCard.trajectoryTriage`. The no-model-call taxonomy groups interaction misalignment/stagnation/disengagement/satisfaction, execution failure/loop, and environment exhaustion so Signals-style informative traces can be sampled, reused, or avoided without asking a judge model.

Benchmark trace summaries include `targeted_fixes=...`, `missing_targeted_fixes`, and `targeted_fix_risk`. If a repair edit after failed-verifier evidence lacks a `Targeted fix:`, `Fix plan:`, or `Repair plan:` line, Grawkus emits a reproduction process defect and completion reminder so AHE-style manifests preserve the intended change before patching.

Benchmark traces consume both Markdown and `grawkus-research-sources-v1` JSON output from `research_sources`, preserving coverage notes, hit/error counts, source labels, top URLs, auth readiness, Kaggle competition fallback, and recency evidence for trajectory scoring. `benchmark_context` emits a Source Research Action Plan for benchmark/leaderboard/agent-improvement work so the next exact `research_sources`, `benchmark_repo_catalog`, and `github_repo_digest` calls are visible before the agent spends search turns.

Benchmark trace summaries also include `trajectory_cleanup_risk`, `trajectory_cleanup_events`, `trajectory_cleanup_noisy`, `trajectory_cleanup_duplicates`, and `experienceCard.trajectoryCleanup`. Base64/data-URI blobs, high-entropy encoded or minified output, repeated duplicate output, and excessive truncation are treated as cleanup debt; risky runs become execution-control warnings so AHE-style reuse does not replay noisy raw observations.

Benchmark trajectory summaries include `evidence_grounding=...` when an edit retries a target after stale/no-effect edit evidence without first refreshing current file state via read/search/diff. They also include AHE publish-state risk when an edit or state-changing shell command happens after a passing verifier without later passing validation. Both are surfaced as execution-control process defects so benchmark runs do not silently loop on stale observations or claim success for an older clean state. Prior benchmark reuse also honors AHE change-evaluation verdicts: confirmed manifests get a small ranking boost, while contradicted, regression-risk, pending-verification, missing-prediction, or missing-regression-forecast manifests become warnings.

Benchmark trace summaries also include `harness_safety=...` and `experienceCard.harnessSafety` for HarnessAudit-style trajectory auditing. These group protected-resource access, external information transfer, destructive shell operations, and oracle/hidden-material access into bounded redacted signals, process defects, completion reminders, and adapter-visible trace summaries.

Long-horizon profiles (`roadmapbench`, `saasbench`, `swe-bench-mobile`, `webdevbench`, `swe-cycle`, and `swe-ci`) add roadmap/SaaS/mobile/WebDevBench/SWE-Cycle/SWE-CI coverage checks to benchmark traces and KBench/HAL adapter routing. Trace summaries flag missing milestone, canary, lifecycle, or evolution/test-gap checklists, incomplete roadmap items after validation, and absent broad integration/platform/frontend-backend/security/lifecycle-judge/CI-loop validation for RoadmapBench, SaaSBench, SWE-Bench Mobile, SWE-WebDevBench, SWE-Cycle, and SWE-CI-style work.

The `swe-prbench` profile is for pull request review quality tasks. It keeps PR metadata and diff hunks ahead of broad context, tracks Type1/Type2/Type3 review finding classes, returns severity-rated file/line findings instead of patches unless requested, and treats hidden human review comments, gold findings, and benchmark result files as oracle material.

The `tml-bench` profile is for Kaggle-style tabular ML benchmark tasks. It keeps data contract extraction, train/test/sample-submission schema checks, honest validation, leakage checks, baseline modeling, and final submission validity ahead of leaderboard optimization. Hidden labels, private holdout targets, oracle submissions, and scoring internals are treated as oracle material.

The `pi-bench` profile is for proactive personal assistant benchmark tasks. It keeps a context contract for user profile, current request, message/file/app/workspace context, domain tools, hidden-intent hypotheses, privacy risk, and clarification state before acting. Trace summaries expose `experienceCard.proactivity` plus trajectory-quality `proactivity_*` fields and flag missing context contract, hidden-intent hypothesis, clarification decision, privacy review, or observable completion evidence. Hidden intents, gold answers, private rubrics, expected traces, and result files are treated as oracle material.

Open Agent general-task profiles (`appworld`, `browsecomp`, `tau2`, `terminalworld`, and `pi-bench`) tune `/benchmark` prompts for stateful app/API actions, source-grounded web research, policy-bound customer workflows, reproduced terminal workflows, and proactive personal-assistant hidden-intent handling. The Exgentic adapter auto-selects these profiles from task/context/action schemas, prints available action names separately, adds a deterministic current-state action shortlist with required argument keys and redacted exact latest-observation/context hints before the full schemas, repairs case/camelCase/schema-key near misses plus exact latest-observation/context required-argument omissions before dispatch, avoids no-effect repeated actions when the latest observation did not change, and uses the same shortlist/hints to recover from malformed or missing action JSON with a viable non-finish action while the latest observation is still pending.

`terminalworld` is a dedicated benchmark profile for TerminalWorld-style tasks synthesized from in-the-wild terminal recordings. It treats `instruction.md` or task text as an outcome contract, `solve.sh` as oracle-only reference material, and prioritizes real CLI execution plus persistent `/app` artifact/service verification over source-patch assumptions. KBench, HAL, and Exgentic routing recognize TerminalWorld/task-id markers such as `terminalworld`, `terminal-world`, `tw_...`, and `asciinema`.

Any tool name you see in error output other than these (e.g. `web_search_exa`, `TodoWrite`, `exec_file`) is a model hallucination — the agent will be told the valid list and self-correct on the next iteration.

---

## 4. Environment variables

These affect the REPL's runtime behavior. Set in your shell before launching `grawkus` (`grawkus` remains a legacy alias).

For env-built provider config, `GRAWKUS_*` variables cover provider, base URL, model, fallback model, token/turn/context limits, temperature, permission, memory, theme, thinking, reasoning effort, and per-run overrides.

| Variable | Default | Purpose |
|---|---|---|
| `GRAWKUS_HOME` / `GRAWKUS_HOME` | `~/.grawkus` | Override config/state directory (useful for tests, sandboxes, and harnesses). `GRAWKUS_HOME` remains supported for existing installs. |
| `GRAWKUS_HOOK_PROFILE` | `standard` | Hook profile: `minimal`, `standard`, `strict`. See `/hook-profile`. |
| `GRAWKUS_GATEWAY` | (unset) | Hint URL for the LLM gateway, when bundled with the open-antigravity wrapper. |
| `GRAWKUS_ENV_CONFIG` | (unset) | In non-interactive mode, prefer provider settings from env even if `config.json` exists. |
| `GRAWKUS_PROVIDER` | inferred | Provider key such as `openrouter`, `openai`, `deepseek`, `nvidia`, `google`, `glm`, `ollama`, `lmstudio`, `openai-codex`, or `custom`. |
| `GRAWKUS_API_KEY` | provider-specific env | Generic API key override for env-built configs. |
| `GRAWKUS_BASE_URL` | provider default | OpenAI-compatible endpoint for env-built configs. |
| `GRAWKUS_MODEL` | provider default | Model name for env-built configs. |
| `GRAWKUS_MODEL_OVERRIDE` | (unset) | Per-run model override applied after loading config; used by `--model`. |
| `GRAWKUS_FALLBACK_MODEL` | unset | Optional fallback model used by the API retry path. `/config` and `/fallback` are the interactive paths. |
| `GRAWKUS_FALLBACK_MODEL_OVERRIDE` | (unset) | Per-run fallback override used by `--fallback-model`. |
| `GRAWKUS_REASONING_EFFORT` | unset | Optional Chat Completions `reasoning_effort` for env-built configs: `none`, `minimal`, `low`, `medium`, `high`, or `xhigh`. |
| `GRAWKUS_REASONING_EFFORT_OVERRIDE` | (unset) | Per-run reasoning-effort override applied after loading config. |
| `GRAWKUS_MAX_TOKENS` | `8192` | Max output tokens for env-built configs. |
| `GRAWKUS_MAX_TOKENS_OVERRIDE` | (unset) | Per-run max-token override used by `--max-tokens`. |
| `GRAWKUS_CONTEXT_WINDOW_TOKENS` | provider/client default | Optional context budget cap. |
| `GRAWKUS_CONTEXT_WINDOW_TOKENS_OVERRIDE` | (unset) | Per-run context-window override used by `--context-window-tokens`. |
| `GRAWKUS_COMPACTION_TRIGGER_TOKENS` | `min(60000, 50% context)` | Override the automatic rolling-compaction trigger. |
| `GRAWKUS_COMPACTION_MODEL` | OpenRouter fallback or main model | Model used for LLM conversation summaries; keep this cheap/free for long runs. |
| `GRAWKUS_COMPACTION_MAX_TOKENS` | `2048` | Max output tokens for LLM compaction summaries. |
| `GRAWKUS_COMPACTION_USE_FALLBACK` | auto for OpenRouter | Set `0` to prevent OpenRouter compaction from using `fallbackModel`; set `1` to force fallback use when available. |
| `GRAWKUS_LLM_COMPACTION` | `1` | Set `0` to skip the summarizer model call and use deterministic local compaction. |
| `GRAWKUS_COMPACTION_MODE` | `llm` | Set `local` for deterministic no-provider-call compaction. |
| `GRAWKUS_LOCAL_COMPACTION_FALLBACK` | `1` | Set `0` to disable the deterministic fallback summary used when model summarization fails. |
| `GRAWKUS_MAX_TURNS` | config default | Optional tool-loop turn cap. |
| `GRAWKUS_MAX_TURNS_OVERRIDE` | (unset) | Per-run tool-loop cap override used by `--max-turns`. |
| `GRAWKUS_TEMPERATURE` | `0.3` | Sampling temperature for env-built configs. |
| `GRAWKUS_TEMPERATURE_OVERRIDE` | (unset) | Per-run temperature override used by `--temperature`. |
| `GRAWKUS_PERMISSION` | `ask` | Startup permission mode for env-built configs: `ask`, `auto`, or `yolo`. |
| `GRAWKUS_MEMORY` | `1` | Set `0`/`false`/`off` to disable MemPalace for headless runs. |
| `GRAWKUS_SHOW_THINKING` | `1` | Set `0`/`false`/`off` to suppress streamed thinking display. |
| `GRAWKUS_THEME` | config default | Startup display theme: `full`, `compact`, or `minimal`. |
| `GRAWKUS_BASH_TIMEOUT_MS` | `120000` | Default `bash` tool timeout. Harness adapters default this to `300000`; individual tool calls can pass `timeoutMs` or `timeoutSec` up to 30 minutes. Timed-out or truncated foreground output is saved under `.grawkus/bash-output/`. |
| `GRAWKUS_TOOL_OUTPUT_ARCHIVE_CHARS` | `5000` | Archive large non-bash tool outputs under `.grawkus/tool-output/` before adding them to model history. |
| `GRAWKUS_BENCHMARK_PROBE_NETWORK` | `1` outside tests | Set `0` to skip `benchmark_context` TCP reachability probes for package/model hosts, or `1` to force them. Tool calls can override with `probe_network`. |
| `GRAWKUS_REPO_MAP` | `1` | Set `0` to disable automatic bounded repo-map context injection for larger codebases. |
| `GRAWKUS_STREAM_USAGE` | auto | Force streamed token-usage accounting on/off (`1` or `0`). Auto enables it for known cloud OpenAI-compatible endpoints and skips local endpoints. |
| `GRAWKUS_UPDATE_CHECK` | `1` | Check npm for a newer Grawkus package on every interactive launch. Set `0`/`off` to disable. |
| `GRAWKUS_AUTO_UPDATE` | `1` | When an update is found, start `npm install -g grawkus@latest --force` in the background. Set `0`/`off` to only log the availability in debug. |
| `GRAWKUS_BENCHMARK_TRACE` | (unset) | Set `1` to write redacted benchmark-style trace artifacts even outside benchmark mode. |
| `GRAWKUS_BENCHMARK_TRACE_DIR` | `~/.grawkus/benchmark-runs` | Directory for benchmark `summary.json`, `trace.jsonl`, `open-agent-leaderboard-draft.json`, `agent-context-compiled.jsonl`, `change-evaluation.json`, `submission-bundle-manifest.json`, and git `worktree.patch` / `git-status.txt` artifacts. `summary.json` includes a compact `experienceCard` for future replay/context reuse with bounded task-contract signals, Pi-Bench proactivity ledger evidence, environment-reconstruction setup/failure evidence, dependency-upgrade setup-validation evidence, root-cause hypothesis state, failure-onset diagnosis state, decision-observability edit predictions, validation-reliability evidence, context-utilization precision/miss evidence, candidate-file dossier status, and run-efficiency action/usage/cost/time evidence used for prior-run relevance ranking; `agent-context-compiled.jsonl` stores a redacted ACC-style task/context/answer record for retrieval, replay, or training-data curation; `change-evaluation.json` stores AHE-style edit prediction verdicts, unpredicted edits, and pass/fail/pass regression-cycle evidence; `submission-bundle-manifest.json` indexes artifact paths and SHA-256 hashes while marking missing official score/session fields before leaderboard claims; patch output includes unstaged, staged, and untracked file diffs where git can render them. |
| `GRAWKUS_BENCHMARK_EXPERIENCE` | `1` | Set `0` to disable prior local benchmark trace summaries in `benchmark_context`. Current task files and verifier output always override prior experience; similar failed/unsafe prior runs are shown as warnings to avoid copying. |
| `GRAWKUS_BENCHMARK_MEMORY` | `1` | Set `0` to disable relevant MemPalace memories in `benchmark_context`. Remembered facts are always framed as hypotheses and must be verified against current task files and verifier output. |
| `GRAWKUS_MIN_TOOL_CALLS_BEFORE_DONE` | `2` in benchmark, `1` otherwise | Non-interactive empty-engagement guard; set `0` to allow immediate no-tool final answers. |
| `GRAWKUS_API_KEY_ENV` | (unset) | Name of an env var whose value should be used as the per-run API key; used by `--api-key-env`. |
| `GRAWKUS_INSTALL_SPEC` | `grawkus@latest` | Terminal-Bench adapter npm install spec; pin to a version, tag, or tarball for reproducibility. If `grawkus` or legacy `grawkus` is already on `PATH`, setup skips network install. |
| `GRAWKUS_BUNDLE_ROOT` | (unset) | Terminal-Bench offline install source: unpacked Grawkus tree with `bin/`, `dist/`, and preferably `node_modules/`. |
| `GRAWKUS_BUNDLE_TARBALL` | (unset) | Terminal-Bench offline/local install source: path to a Grawkus `.tgz` checked before the npm registry. |
| `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `NVIDIA_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `GLM_API_KEY`, `ZHIPUAI_API_KEY` | (unset) | Provider-specific key env vars used by env-built configs. |
| `GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_API_TOKEN` | unauthenticated public API | Optional GitHub auth for `research_sources` repo/issue/pull/code search and `github_repo_digest`; improves rate limits and private/internal access where the token is allowed. |
| `HF_TOKEN`, `HUGGING_FACE_HUB_TOKEN`, `HUGGINGFACE_TOKEN`, `HUGGINGFACE_API_KEY`, `HF_API_KEY` | token file fallback | Optional Hugging Face auth for `research_sources` papers/models/datasets; also checks `HF_TOKEN_PATH`, `HF_HOME/token`, and the default Hugging Face token cache. |
| `KAGGLE_API_TOKEN`, `KAGGLE_TOKEN` | token file fallback | Optional Kaggle bearer auth for `research_sources` datasets/competitions; also checks `KAGGLE_CONFIG_DIR/access_token`. |
| `KAGGLE_USERNAME` + `KAGGLE_KEY` | `kaggle.json` fallback | Optional legacy Kaggle auth for `research_sources` datasets/competitions; also checks `KAGGLE_CONFIG_DIR/kaggle.json` or `~/.kaggle/kaggle.json`. |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Local Ollama endpoint for env-built configs. |
| `STITCH_API_KEY` | (unset) | Stitch API key. Overrides `~/.grawkus/stitch.json`. |

AHE change evaluation expects each non-trivial benchmark edit to carry both `Prediction:` and `At-risk regression:` manifest lines. Failed-verifier repair edits should also carry a `Root cause:`, `Diagnosis:`, or failure-tied `Hypothesis:` line plus a `Targeted fix:` or `Fix plan:` line before patching. Repeated verifier loops and regression cycles should be treated as failure-onset diagnosis work before another patch. Missing regression forecasts, root-cause hypotheses, failure-onset diagnoses, and targeted-fix manifests are reported in trace summaries, `change-evaluation.json` or `experienceCard.*` as applicable, process defects, and completion reminders.

Component observability classifies benchmark edit targets as system prompts, tool descriptions, tool implementations, middleware, skills, sub-agents, memory, adapters, tests/verifiers, dependency files, documentation, or product source code. The live trajectory block and `experienceCard.componentObservability` expose the counts so AHE-style regression attribution can point at the changed surface.

OpenRouter free-tier context is intentionally conservative for compatibility. `openrouter/free` plans around a 128k window because the router can select different available free models; manually typed unknown `:free` model IDs plan around 32k unless `GRAWKUS_CONTEXT_WINDOW_TOKENS` is set. The interactive OpenRouter `/model` picker reads the live catalog and saves the selected exact model's context hint when available.

`--prompt` and `--prompt-file` imply non-interactive mode. If the prompt begins with a slash command such as `/benchmark terminal-bench ...`, Grawkus dispatches that command first and sends the expanded prompt to the model.

Benchmark-friendly per-run CLI flags: `--model`, `--fallback-model`, `--provider`, `--base-url`, `--api-key`, `--api-key-env`, `--max-turns`, `--max-tokens`, `--context-window-tokens`, `--temperature`, `--output-format`, and `--benchmark-trace-dir`. They do not modify `config.json`. Use `--openai-oauth-smoke` to test Codex OAuth auth, request shape, and stream parsing.

Adapter path helpers:

- `grawkus --print-terminal-bench-adapter` prints the packaged Terminal-Bench Python adapter path.
- `grawkus --print-kbench-adapter` prints the packaged KBench custom-adapter directory.
- `grawkus --print-hal-agent` prints the packaged HAL custom-agent directory.
- `grawkus --print-exgentic-agent` prints the packaged Exgentic/Open Agent Leaderboard custom-agent directory.
- `grawkus --print-open-agent-card` prints the packaged Open Agent Leaderboard-style Grawkus agent card markdown.
- Benchmark adapters export redacted artifacts: Terminal-Bench writes `.grawkus/benchmark-summary.json`, `.grawkus/benchmark-trace.jsonl`, `.grawkus/agent-context-compiled.jsonl`, `.grawkus/change-evaluation.json`, `.grawkus/submission-bundle-manifest.json`, `.grawkus/benchmark.patch`, and `.grawkus/git-status.txt` when available; KBench returns redacted `instruction`, `stdout`, `stderr`, `patch`, and `git-status` artifact refs. Patch output includes unstaged, staged, and untracked file diffs where git can render them. KBench also exposes compact native trace data, including usage/cost telemetry, Open Agent Leaderboard draft rows marked `submissionReady:false` until an official harness score exists, the AHE-style change evaluation, the submission bundle manifest with artifact hashes and missing official fields, final-answer verification-claim and incomplete/blocked completion evidence, `experienceCard` replay/context/task-alignment/spec-compliance/reward-hack/proactivity/environment-reconstruction/dependency-upgrade/root-cause-hypothesis/failure-onset/decision-observability/validation-reliability/context-utilization/candidate-dossier summaries, the compiled task/context/answer record, cost-efficiency risk, invalid tool-action telemetry, task-contract checklist completion/no-edit/test-edit, task-alignment risk signals, spec-compliance risk signals, reward-hack risk signals, Pi-Bench proactivity ledger signals, incomplete/inconclusive verifier, environment setup/reconstruction, dependency manifest/lockfile setup-validation, weak change-manifest signals, per-target edit-localization, local context-utilization precision/risk, root-cause hypothesis risk, failure-onset diagnosis risk, targeted-fix manifest risk, candidate-file dossier risk, large edit-surface, scratch/probe artifact, redundant tool-call, redundant failing-verifier rerun, blind-repair, failed-verifier source-file repair alignment, long-horizon/WebDevBench/SWE-Cycle canary/lifecycle and validation signals, post-edit regression-cycle signals, latest post-edit verifier, post-edit and final-state diff-review, final-edit validation stability/lucky-pass signals, broad-validation signals, and CI-derived validation signals, under `benchmarkResult.traceSummary` when `summary.json` is available; `benchmarkResult.usage` aliases the compact usage block and `benchmarkResult.experienceCard` aliases the compact prior-experience block.
  `benchmarkResult.experienceCard` also includes `runEfficiency` when available, so harnesses can score tool/action count, token/cost, invalid-action rate, successful verifier count, process score, and cost-efficiency risk directly.
  HAL returns SWE-bench-style patch strings, ScienceAgentBench-style trajectory strings, AppWorld `Completed` markers, and USACO/general task dictionaries with `response` fields. Exgentic returns benchmark-native `ActionType` instances selected from Grawkus's final action JSON, auto-routes AppWorld/BrowseComp+/tau2/SWE-Cycle/SWE-CI/SWE-PRBench/TML-Bench/Pi-Bench-style tasks into specialized `/benchmark` profiles, builds a recommended action shortlist with required argument keys and redacted exact current-state hints before the full schema list, repairs near-miss action names/argument keys and fills omitted required schema fields from exact observation/context keys before `ActionType` dispatch, falls back to a viable non-finish shortlisted action when action JSON is missing or malformed and completion is not ready, folds prior observations/actions into a compact task ledger before each step, and stores prompt/stdout/stderr/trace artifacts under the Exgentic session agent directory.

HAL-specific adapter env:

- `GRAWKUS_HAL_COMMAND` or `GRAWKUS_HAL_COMMAND` overrides the command used by the HAL adapter; default `grawkus`.
- `GRAWKUS_HAL_TRACE_DIR` controls HAL adapter logs/traces; default `.grawkus/hal-trace`.
- `GRAWKUS_HAL_TIMEOUT_SEC` controls the per-task adapter timeout; default `1800`.
- `GRAWKUS_HAL_INCLUDE_ORACLE_FIELDS=1` disables the default oracle-field filter for harnesses that intentionally expose those fields.

Exgentic-specific adapter env:

- `GRAWKUS_EXGENTIC_COMMAND` or `GRAWKUS_EXGENTIC_COMMAND` overrides the command used by the Exgentic adapter; default `grawkus`.
- `GRAWKUS_INSTALL_SPEC` controls Exgentic `setup.sh`; default `grawkus@latest`.

---

## 5. Files & state

Grawkus is local-first. Everything currently lives in `~/.grawkus/` (or `$GRAWKUS_HOME` / `$GRAWKUS_HOME` if set) for compatibility:

```
~/.grawkus/
  config.json          # provider, model, key, theme, perms
  usage.json           # token counts, cost estimates (LOCAL ONLY)
  hooks.json           # hook definitions
  ecc-state.json       # ECC install metadata
  stitch.json          # Google Stitch API key (if /stitch-config has been run)
  sessions/            # *.json — saved conversations
  instincts/           # *.json — learned patterns
  skills/              # *.json — reusable skill templates (ECC + your own)
  memory/              # cross-session project context
  rules/               # *.md — language-specific coding rules
  checkpoints/         # git state snapshots
  hooks/               # your hook scripts (if any)
  ecc-commands/        # bundled command prompts (/ecc-*)
  ecc-agents/          # bundled agent prompts
```

**To wipe all state:** `rm -rf ~/.grawkus`.

---

## 6. Hooks

Default ECC-bundled hooks (configured in `~/.grawkus/hooks.json`):

| Event | Match | What fires |
|---|---|---|
| PreToolUse | `bash` | Block `git --no-verify` / `--no-gpg-sign`. Reminder to run dev servers under tmux. |
| PreToolUse | `read_file` | Warn when reading `.env` / `.key` / `.pem` / credential paths. |
| PostToolUse | `edit_file` / `write_file` | Warn when an edit leaves `console.*` statements in `.ts`/`.js`. |

Disable individual hooks by editing the `enabled` field in `~/.grawkus/hooks.json`, or set `GRAWKUS_HOOK_PROFILE=minimal` to silence all but the most critical.

Write your own hooks: add an entry to `hooks.json` with `event`, `match` (tool name glob), `command` (shell), and optional `blocking`/`timeout`. The hook receives `GRAWKUS_TOOL`, `GRAWKUS_TOOL_INPUT`, `GRAWKUS_CWD` in its env.

---

## Quick recipes

**Refactor a service end-to-end with tests:**

```
❯ /mode tdd
❯ /tdd add idempotency to the billing service /create endpoint
```

**Audit a project you just cloned:**

```
❯ /detect            # know what build tools to expect
❯ /audit             # local-only health check
❯ /doctor            # install/config/benchmark readiness check
❯ /auto-review       # AI review of the most recent changes
```

**Bulk codebase exploration without edits:**

```
❯ /mode research
❯ /codemap
❯ /search-first walk through how authentication is wired
```

**Multi-agent feature delivery:**

```
❯ /multi-plan add a search bar with debounced queries and result caching
❯ /multi-execute (use the chosen plan from above)
```

**Sentience mode for ongoing work:**

```
❯ /mode sentience
❯ help me continue what I was doing yesterday on the billing rewrite
```

Sentience will search prior sessions + instincts before asking clarifying questions.

---

## See also

- [README.md](README.md) — feature overview + privacy/data scope table
- [INSTALL.md](INSTALL.md) — installation, providers, troubleshooting
- Upstream [everything-claude-code](https://github.com/Crownelius/everything-claude-code) — the bundled skill library
