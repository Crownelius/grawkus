# Terminal-Bench Feature Integration Ranking

Reviewed: 2026-05-28

This ranks documented features from Grawkus and the verified public repositories in the current Terminal-Bench 2.0 top-20 source review. It uses public README/docs/metadata only. It does not copy or mine competitor implementation source.

Primary sources:

- Terminal-Bench 2.0 leaderboard: https://www.tbench.ai/leaderboard/terminal-bench/2.0
- NexAU-AHE: https://github.com/china-qijizhifeng/agentic-harness-engineering
- LemonAgent: https://github.com/Open-Lemon/LemonAgent
- Codex CLI: https://github.com/openai/codex
- WOZCODE plugin: https://github.com/WithWoz/wozcode-plugin
- Meta-Harness artifact: https://github.com/stanford-iris-lab/meta-harness-tbench2-artifact
- Codelia: https://github.com/kousw/codelia
- Mux: https://github.com/coder/mux

## Ranking Scale

1. Drop-in: already mostly exists in Grawkus; needs polish, docs, or a local command.
2. Easy: small implementation in the current TypeScript CLI architecture.
3. Medium: requires a new subsystem boundary, storage format, or UI state machine.
4. Hard: requires isolation, protocol, multi-process coordination, or careful migration.
5. Research: product-defining architecture or benchmark-evolution work; prototype first.

## Grawkus Baseline

Grawkus already has several matching surfaces:

- Provider and model control: OpenRouter/OpenAI-compatible providers, OpenAI Codex OAuth, `/model`, `/fallback`, `/openrouter-free`, config wizard, per-run CLI overrides.
- Tool loop: bash/read/write/edit/apply_patch/search/list/research/benchmark tools with permission modes.
- Interactive UX: fixed footer/input, palette/theme commands, active-turn cancellation, queued text handling, session save/resume, footer templates, auto-update checks.
- Safety: `/perm`, optional sandbox on macOS/Linux, hook system, secret redaction, no telemetry claim.
- Benchmarking: `/benchmark`, `benchmark_context`, trace artifacts, component observability, root-cause/failure-onset/change-evaluation signals, Terminal-Bench/KBench/HAL/Exgentic adapters.
- Context: rolling compaction, repo-map context, large tool-output archive, memory, ECC skills with progressive disclosure.
- Source research: `/sources`, `/benchmark-repos`, `/repo-digest`, docs-only source guard, GitHub/HF/Kaggle/arXiv scanning.
- Multi-agent: `/swarm` exists but currently keeps workers analysis-only and centralizes writes.
- Accessibility: voice, TTS, dictation, F-row hotkeys, screen-reader oriented behavior.

## Integration Ranking

### Rank 1 - Drop-in Or Nearly Drop-in

| Feature | Top repo evidence | Grawkus today | Plug-in work | Benefit | Downfalls |
| --- | --- | --- | --- | --- | --- |
| Docs-only competitor repo digest | Grawkus now mirrors this from the top-source review; Mux/Codelia have rich docs trees. | `/repo-digest` exists and now supports `--docs-only`. | Keep using it in benchmark/source prompts; add examples in `/help`. | Prevents source-copy risk while still learning product patterns. | Can understate implementation complexity because docs are aspirational. |
| Top-open-source leaderboard catalog | Terminal-Bench top 20 has only seven verified reusable public repo targets. | `/benchmark-repos` now supports `--top-open-source`. | Add this flow to benchmark prompts and docs. | Stops hallucinating public repos and gives repeatable source selection. | Leaderboard changes; packaged evidence can go stale unless refreshed. |
| Environment preflight summary | Meta-Harness documents bootstrapping cwd, file listing, languages/tools, package managers, and memory before the loop. | `benchmark_context` already does this in richer form. | Make preflight cheaper and available outside benchmark mode as `/context brief`. | Saves early turns and reduces "ls/which/npm test" churn. | Too much preflight can bloat the first model call. |
| Component observability | AHE explicitly decomposes harness changes by component. | Grawkus traces classify prompts, tools, middleware, skills, memory, adapters, docs, tests, etc. | Show component counts in `/harness` and final benchmark summaries more prominently. | Debugging becomes about changed surfaces, not vague "the prompt got worse". | Users may see noisy labels if classification is wrong. |
| Decision observability with prediction lines | AHE records evidence-backed edits and predicted impact; Grawkus already asks for `Prediction:` and regression forecasts. | Benchmark traces track missing predictions and change-evaluation risk. | Surface this outside benchmark mode for non-trivial edits. | Better reviewability and less blind patching. | Adds process overhead to small tasks if forced globally. |
| Experience cards / prior-run reuse | AHE has trace distillation; Grawkus has `experienceCard` and prior benchmark warnings. | Implemented in benchmark trace summary. | Add a compact `/experience` or `/last-run` view. | Lets the agent reuse high-signal failures and avoid repeating bad loops. | Bad prior matching can anchor the agent on irrelevant old failures. |
| Tool-output archival | Codelia docs specify tool output cache; Grawkus archives large outputs under `.grawkus/tool-output/`. | Already implemented. | Add a local command to list recent archived outputs. | Keeps context clean without hiding evidence from users. | Cache cleanup policy must avoid disk growth. |
| Token/cost tracking | Codelia usage tracking and WOZ savings reports emphasize token/cost visibility. | Grawkus tracks token/cost in responses and traces. | Rename UI labels consistently to `cost/tokens`; add session totals to footer. | Gives users objective response-time/cost signals. | Provider usage can be missing or inconsistent. |
| Themed spinner/status text | WOZCODE documents spinner verbs and status-line toggles. | Grawkus has working animation/footer work in progress. | Keep this purely UI-level, configurable via `/footer` and `/theme`. | Improves perceived responsiveness during long model waits. | If it masks stalled I/O, users get angrier. It must pair with watchdogs. |
| Session resume picker | Codelia supports `--resume` picker; Grawkus has session picker work. | `/resume` picker is in progress. | Finish bounded picker, filtering, Enter/Esc, and non-interactive compatibility. | Fixes session recovery and user trust. | Bad picker redraw can corrupt terminal output on Windows. |
| Typo-tolerant command aliases | Grawkus already accepts `/pallete`; Mux/Codelia docs show command-heavy UX. | Present for some commands. | Add aliases only for high-frequency mistakes. | Prevents accidental model calls from misspelled commands. | Too many aliases create ambiguous command behavior. |
| Project/global config precedence | Codelia documents global config plus project config override. | Grawkus has global config and project memory; project config is less formal. | Add `.grawkus/config.json` merge with explicit precedence. | Lets teams pin repo defaults without changing user globals. | Config precedence bugs are hard to diagnose. |
| XDG layout option | Codelia supports XDG-style config layout. | Grawkus uses `~/.grawkus`. | Add env-controlled XDG path support for config/cache. | Better Linux convention support. | Path migration and backwards compatibility need care. |
| Built-in theme catalog | Codelia has named themes; Mux has polished UI docs. | Grawkus has `/theme`, `/palette`, `/palettes`. | Combine theme and palette picker as user requested. | Less fragmented appearance setup. | Palette churn can distract from core reliability fixes. |
| Docs link checking | Mux docs run link checking. | Grawkus docs are manual. | Add a lightweight docs link checker script in CI. | Prevents stale command docs as CLI changes. | Link checks can be flaky on external URLs. |

### Rank 2 - Easy Additions

| Feature | Top repo evidence | Grawkus today | Plug-in work | Benefit | Downfalls |
| --- | --- | --- | --- | --- | --- |
| One-shot model override prefix | Mux supports `/sonnet task`, `/opus+high task`, and thinking-level suffixes. | Grawkus has `/model` plus per-run CLI flags, not prompt-level model prefixes. | Parse known model aliases before normal slash-command dispatch. | Fast switching without persistent config changes. | Can conflict with slash commands and user text starting with `/`. |
| Model aliases and first-class model table | Mux documents aliases for first-class models. | Grawkus fetches OpenRouter catalog and supports custom IDs. | Add local alias map plus `/model aliases`. | Better UX for users who do not know provider IDs. | Aliases go stale and can hide exact provider/model identity. |
| Provider env fallback matrix | Mux and Codelia document provider env vars. | Grawkus already supports many `GRAWKUS_*` env overrides. | Print an env readiness table in `/doctor`. | Easier setup and benchmark reproducibility. | Must never print secret values. |
| Custom OpenAI-compatible provider templates | Mux documents custom OpenAI-compatible providers. | Grawkus already supports base URL/provider config. | Add `/provider add openai-compatible` wizard. | Helps LM Studio/vLLM/llama.cpp users. | Validation is hard because each server has quirks. |
| MCP server CLI management | Codelia supports `mcp add/list/test/auth` for stdio/http. | Grawkus has MCP-style app/tool discovery through connectors but no first-class user MCP server manager. | Add config schema and commands for stdio/http MCP servers. | Major extensibility win; structured external tools. | Auth and process lifecycle can become a support burden. |
| MCP project/global scopes | Codelia documents project/global/effective MCP views. | Grawkus has global tools and local repo context. | Reuse project config merge and show effective server list. | Keeps repo-specific servers out of global config. | Confusing if server names collide. |
| Skill browser and progressive disclosure | Codelia and Grawkus both document progressive skill loading; Codex/Mux use AGENTS/skills. | Grawkus already has ECC skills and `skill_view`. | Improve `/skills` search, fit explanation, and load reason. | Reduces token bloat and wrong-skill loading. | Extra UI can slow power users. |
| AGENTS.md instruction layering | Codex, Codelia, and Mux all use AGENTS-style repo instructions. | Grawkus has system prompt and bundled ECC, but AGENTS.md handling is not first-class in docs. | Add explicit discovery/precedence and `/agents` view. | Aligns with ecosystem expectations. | Instruction conflicts can silently degrade behavior. |
| Model-scoped instruction sections | Mux supports `## Model: <regex>` scoped prompts. | Grawkus has modes and model config, not scoped instruction file sections. | Parse model sections from AGENTS.md/project config. | Lets GPT/Claude/Gemini get tailored guidance. | Regex matching can surprise users. |
| Tool-scoped instruction sections | Mux supports `## Tool: bash` style augmentation. | Grawkus tool descriptions are fixed. | Append scoped local instructions to tool descriptions. | Repo-specific shell/edit rules become visible at the right time. | Tool prompt injection risk if untrusted repos set dangerous rules. |
| Smart command normalization for permissions | Codelia normalizes bash commands and supports first one/two word matching. | Grawkus has permissions and sandbox rules. | Add normalized command matcher for `/perm` allow/deny rules. | Safer auto-allow without brittle exact strings. | Shell parsing is never perfect, especially on Windows PowerShell. |
| Approval profiles `minimal/trusted/full-access` | Codelia maps approval mode to allowlist aggressiveness. | Grawkus has `ask/auto/yolo`. | Add aliases or migrate labels carefully. | More standard naming for benchmark vs interactive use. | Renaming existing `/perm` labels can break scripts. |
| Permission rule explanations | Codelia documents rule order and match fields. | Grawkus permissions are less inspectable. | Add `/perm why <tool/cmd>` dry-run evaluator. | Users understand why a command is allowed or blocked. | Explanation must match real enforcement exactly. |
| Unknown-tool self-correction messages | Codelia documents unknown tool as error tool message and loop continues. | Grawkus already handles tool errors. | Standardize invalid tool feedback in benchmark and normal modes. | Models recover from hallucinated tool names faster. | Repeated invalid tool loops still need abort policy. |
| Raw JSON argument fallback | Codelia passes raw args after JSON parse failure. | Grawkus likely rejects malformed tool JSON through provider/tool path. | Add raw-argument diagnostic where safe. | Better recovery from slightly malformed tool calls. | Could create confusing tool inputs if executed too broadly. |
| Tool exception normalization | Codelia converts exceptions to error tool messages. | Grawkus tools return structured errors. | Audit all tools for consistent `isError` and no thrown secrets. | More stable loops and tests. | Over-normalization can hide programmer bugs. |
| Done/complete task tool | AHE and Codelia include stop/done tools. | Grawkus finishes when model stops; has todo/checklist patterns. | Add optional `complete_task` sentinel tool in benchmark mode. | Prevents runaway "one more check" loops. | Models may call done too early unless task contract is strong. |
| Read-only exploration subagent | WOZCODE has `woz:explore`; AHE has explore agents. | Grawkus swarm workers are analysis-only. | Add `/explore <query>` or an internal read-only worker using repo-map/search tools. | Faster localization without risking edits. | Another model call; can duplicate main-agent work. |
| Free/limited fallback agent mode | WOZCODE has `code-free`; Grawkus has fallback model. | Fallback exists but is not framed as capability tier. | Add fallback policy names: off, rescue-only, free-tier, cheap-summary. | Makes fallback explicit and configurable. | Wrong fallback can produce low-quality continuation. |
| Savings report | WOZCODE has `/woz-savings`. | Grawkus tracks tokens/cost but no savings estimate. | Add `/usage` with current/session/lifetime totals, not speculative savings first. | Gives user visibility into slow/costly models. | "Savings" claims can be misleading without a baseline. |
| Status-line feature toggles | WOZCODE exposes status-line settings. | Grawkus footer is customizable. | Add `/footer parts` toggles for provider/model/session/tokens/version. | Users get the footer they want. | Too many parts can overflow narrow terminals. |
| Commit/PR attribution toggle | WOZCODE has attribution settings. | Grawkus does not auto-attribute. | If added, keep off by default and only for generated commits/PRs. | Useful in teams that want AI-assisted metadata. | Users may reject automatic co-author tags. |
| Plugin update command | WOZCODE has `/woz-update`; Grawkus auto-updates globally. | Auto-update exists, but manual control could improve trust. | Add `/update check`, `/update now`, `/update off`. | Gives control over package changes. | Auto-updating a CLI during use can be risky on Windows. |
| Health/doctor readiness per subsystem | Codex app-server has `/readyz`/`/healthz`; Grawkus has `/doctor`. | `/doctor` exists. | Add machine-readable section status for provider, npm, memory, hooks, benchmark, footer. | Easier support and pre-publish validation. | More checks can slow startup if run automatically. |
| Backpressure retry hint | Codex app-server returns retryable overload errors. | Grawkus has provider retries/fallbacks. | Add normalized retryability categories to provider errors. | Better user messages and automatic rescue. | Provider error messages are inconsistent. |
| CLI diagnostics/perf panel | Codelia has diagnostics/perf flags. | Grawkus has `/debug` and traces. | Add `/perf` for live API latency, first-token time, tool time. | Directly addresses user response-time complaints. | Measurement overhead and terminal noise. |
| Markdown rendering richness | Mux supports Mermaid and LaTeX outputs. | Grawkus prints markdown as text. | Add optional terminal render mode for tables/code blocks; keep raw default. | Better readability for plans and docs. | Terminal rendering can corrupt copy/paste and Windows output. |

### Rank 3 - Medium Integrations

| Feature | Top repo evidence | Grawkus today | Plug-in work | Benefit | Downfalls |
| --- | --- | --- | --- | --- | --- |
| Full MCP manager with auth tokens | Codelia supports `mcp auth` and token storage. | Grawkus has app/connector tools but no user-configured MCP lifecycle. | Build secure token storage, command UX, process lifecycle, tests. | Opens Grawkus to arbitrary external tools. | Security and support cost are significant. |
| Separate approval mode from sandbox backend | Codelia explicitly separates approval policy and OS isolation. | Grawkus has `/perm` and `/sandbox`, but docs still conflate user intent sometimes. | Refactor config terminology and UI display into two axes. | Clearer safety claims, especially Windows no-op sandbox. | Requires migration and careful docs. |
| More robust sandbox backends | Codelia lists logical/bwrap/nsjail/container; Codex documents platform sandboxes. | Grawkus has macOS sandbox-exec/Linux bwrap, no Windows sandbox. | Add Docker/container backend first, then nsjail if needed. | Real isolation for benchmarks and risky tasks. | Hard cross-platform UX, volume mounts, credential leakage risk. |
| Windows sandbox safety story | Codex documents Windows sandbox support; Grawkus currently no-ops sandbox on Windows. | Windows users rely on permissions only. | Add explicit Windows "policy only" warnings and optional container/WSL backend. | Prevents false safety assumptions. | Full Windows isolation is hard and may require admin/WSL/Docker. |
| Background task substrate | Codelia task orchestration spec covers spawn/list/status/wait/cancel/result. AHE has background task management. | Grawkus bash has background support; no unified task UI. | Create persisted task registry for shell services and future subagents. | Better long-running servers, benchmarks, and cancellation. | Process cleanup bugs can leave orphan tasks. |
| Subagent task lifecycle | Codelia reserves task kind `subagent`; Mux manages multiple agents. | Grawkus `/swarm` is analysis-only. | Add task-backed subagent runs with ownership, cancellation, result collection. | Enables real parallel work without losing visibility. | Expensive and easy to create merge conflicts. |
| Worktree-based parallel isolation | Mux has worktree runtime; Codelia plans worktree separation. | Grawkus centralizes writes in main agent. | Implement per-subagent worktrees and diff import. | Safer parallel implementation. | Git edge cases, untracked files, LFS/submodules, user dirty worktrees. |
| Docker runtime for agent workspaces | Mux documents Docker runtime and credential sharing. | Grawkus benchmark adapters use containers, interactive work does not. | Add `/runtime docker` for commands/subagents, with volume/secrets policy. | Reproducible, safer execution. | Docker startup cost and credential handling friction. |
| SSH remote runtime | Mux supports SSH runtime for security/performance. | Grawkus is local. | Add remote shell adapter plus file sync or git archive flow. | Lets users run heavy agents off-laptop. | Complex auth, latency, cleanup, secrets. |
| Local/worktree/runtime selector UI | Mux exposes local/worktree/SSH/Docker choices. | Grawkus has permissions/sandbox, not workspace runtime choices. | Add `/runtime` command and config state. | Makes execution environment explicit. | Users may not understand tradeoffs. |
| App-server JSON-RPC protocol | Codex app-server exposes threads, turns, items, approvals, events. | Grawkus is CLI-first with internal functions. | Define stable JSON-RPC or stdio protocol for external UI. | Enables desktop/web/VS Code without rewriting agent core. | Large maintenance surface and versioning burden. |
| Thread/turn/item persistence model | Codex app-server uses explicit primitives. | Grawkus sessions are conversation snapshots. | Migrate session storage toward thread/turn/item event log. | Better resume, fork, export, and UI sync. | Migration risk; current history bugs must be fixed first. |
| Thread fork | Codex supports thread fork. | Grawkus has `/save`/resume, no fork command. | Add `/fork [name]` copying session plus interruption marker. | Lets users branch approaches. | Could multiply storage and confuse current session identity. |
| Thread archive/unarchive/name/search | Codex app-server includes these lifecycle operations. | Grawkus has `/sessions`, `/resume`, names. | Add archive flag, filters, search, rename. | Keeps session list usable. | Requires UI picker polish and storage migration. |
| Context reset boundaries | Mux ADR separates active context from transcript history. | Grawkus has `/clear` and compaction, but boundary semantics can be clearer. | Add soft reset boundary distinct from hard clear and compaction summary. | Prevents history leakage after mode/task switches. | Request assembly must be carefully tested. |
| Compaction boundary metadata | Mux models compaction boundaries; Grawkus has rolling summaries. | Present but not as first-class transcript item. | Store compaction boundary objects in sessions. | Better resume/debug of context state. | Migration and display complexity. |
| Runtime RPC between TUI and agent | Codelia uses TS runtime plus Rust TUI over JSON-RPC. | Grawkus is Node CLI/TUI in one process. | Split renderer/input from agent runtime gradually. | Terminal UI becomes more reliable and testable. | Big refactor; current UX bugs should be stabilized first. |
| Fixed terminal viewport with scrollable transcript | User requested Mux/Codelia-like bottom always visible. | Grawkus footer/input exists but PowerShell corruption was observed. | Build a bounded renderer with transcript region plus fixed footer. | Directly addresses current user pain. | Terminal control is fragile across Windows terminals and screen readers. |
| VS Code extension integration | Mux has VS Code extension; Codex has app-server backing rich interfaces. | Grawkus has CLI only. | Requires app-server or command protocol first. | Great developer workflow. | Not worth starting until terminal reliability is fixed. |
| Image generation/editing tools | Mux documents experimental image tools. | Grawkus has optional Stitch but not image provider tools. | Add explicit image tool integrations only behind config. | Useful for frontend/design tasks. | Upload privacy, cost, and non-code scope creep. |
| AGENTS/skills marketplace | Codex and WOZCODE expose plugin/marketplace metadata. | Grawkus bundles ECC and has local skills. | Add marketplace manifest support for skill/plugin packages. | Easier ecosystem growth. | Trust, versioning, and update security problems. |
| Plugin install/update/reload lifecycle | WOZCODE plugin flow has install/update/reload commands. | Grawkus has bundled skills and auto-update. | Generalize plugin install lifecycle separate from npm update. | Users can add capabilities safely. | Plugin compatibility and malicious plugins. |
| Project secrets for runtimes | Mux has project secrets for SSH/Docker/GH token. | Grawkus reads env/config tokens. | Add encrypted or file-backed secret references with redaction. | Safer runtime credential handoff. | Secret storage is security-critical. |
| Usage pricing provider cache | Codelia proposes pricing provider with one-day cache. | Grawkus has provider usage/cost when returned; OpenRouter prices available through catalog. | Add normalized pricing cache for providers lacking usage. | Better cost estimates. | Estimated costs can be wrong; must be labeled. |
| Tool output ref IDs | Codelia requires unique ref IDs for cached outputs. | Grawkus archives by files but tool result refs could be more consistent. | Add stable `ref_id` to large outputs and footer/trace. | Users and agents can request exact logs later. | Requires careful cleanup and redaction. |
| Permission split on shell operators | Codelia splits `|`, `&&`, redirects while respecting quotes. | Grawkus shell policy exists but could be stronger. | Add tested parser for PowerShell and POSIX separately. | Blocks dangerous compound commands more reliably. | Shell grammar is complex; false positives can annoy users. |
| Provider fast mode | Codelia has `/fast`; Mux has thinking-level overrides. | Grawkus has model/max-token/context controls. | Add provider-specific reasoning/verbosity/fast fields. | Users can trade quality for speed explicitly. | Provider-specific semantics age quickly. |
| First-token watchdog per model | Grawkus has model watchdog work; user saw stalls. | Present for known flaky OpenRouter models. | Generalize to provider/model health profiles and user-configured thresholds. | Prevents 5-minute no-output hangs. | Too aggressive timeouts can abort slow-but-valid models. |

### Rank 4 - Hard Integrations

| Feature | Top repo evidence | Grawkus today | Plug-in work | Benefit | Downfalls |
| --- | --- | --- | --- | --- | --- |
| Automated harness evolution loop | AHE evaluates, analyzes, improves, and loops across generations. | Grawkus has benchmark traces and source mining but no autonomous harness mutation loop. | Build experiment runner, eval matrix, patch workspace, falsification tracking, and safety gates. | Could systematically improve Grawkus over Terminal-Bench instead of ad hoc fixes. | High compute cost; overfitting and benchmark contamination risk. |
| Trace debugger over 10M-token rollouts | AHE distills huge traces into sourced reports. | Grawkus traces are compact but not a full debugger UI. | Build trace indexer, summarizer, source links, and drilldown viewer. | Makes failures diagnosable at scale. | Summarization can hallucinate unless linked to raw events. |
| E2B sandbox template build pipeline | AHE uses prebuilt E2B templates per dataset. | Grawkus uses local/Docker benchmark setup, not E2B templates. | Add optional E2B provider, template build/resume, dataset mapping. | Faster cloud benchmark isolation. | External dependency, keys, cost, and self-host complexity. |
| Batch experiment launcher/resumer | AHE uses tmux launch/resume and experiment overlays. | Grawkus can run benchmarks, not full experiment batches. | Add batch runner with queue, resume, logs, and score aggregation. | Useful for model/harness comparisons. | Easy to spend money or API quota accidentally. |
| Multi-agent dynamic planner/executor groups | LemonAgent routes tasks to subagent groups by complexity and compute. | Grawkus swarm picks roles but workers are analysis-only. | Needs task substrate, isolation, budget routing, merge arbitration. | Better long tasks and product-building workflows. | Complex orchestration; more opportunities for invisible failures. |
| Skill memory write-back self-evolution | LemonAgent writes valuable execution knowledge back to skill memory. | Grawkus MemPalace and skills exist, but skill creation is manual. | Add reviewed skill proposal pipeline, not automatic writes. | Turns repeated lessons into reusable procedures. | Automatic memory/skill writes can poison future runs. |
| Cost-aware model/router optimization | LemonAgent emphasizes performance x compute cost and reasoning-depth control. | Grawkus has key rotation, fallback, model picker, config. | Build policy engine choosing model/effort per step. | Faster and cheaper responses. | Bad routing can degrade quality or produce inconsistent style. |
| Environment/energy-aware scheduling | LemonAgent discusses energy/carbon constraints. | Grawkus does not track energy. | Requires runtime metrics and scheduling policy. | Nice enterprise/research story. | Low direct value for current user pain. |
| AgentCortex-style framework modularization | LemonAgent frames an industrial modular agent framework. | Grawkus is a CLI with many modules but not a general framework. | Would require public plugin/runtime API and module contracts. | Easier extension and testing. | Framework abstraction can slow product fixes. |
| Full desktop/browser multiplexer | Mux is a desktop/browser app for parallel agentic development. | Grawkus is terminal-first. | Requires app server, UI, workspace runtime, auth, packaging. | Very strong product direction. | Multi-quarter project; distracts from CLI reliability. |
| Central git divergence dashboard | Mux centralizes worktree divergence. | Grawkus has git status/checkpoints but no dashboard. | Needs worktree runtime plus UI. | Makes parallel agent outputs reviewable. | Depends on hard worktree isolation first. |
| Remote Coder workspace integration | Mux integrates remote runtime and Coder workspaces. | Grawkus is local. | Requires remote runtime abstraction and auth. | Powerful for teams. | Enterprise integration burden. |
| JSON-RPC app protocol with bounded queues | Codex app-server has transport, overload, notifications, thread lifecycle. | Grawkus lacks stable external protocol. | Design and version a protocol, then build adapters. | Unlocks rich UIs and external clients. | Backwards compatibility commitment. |
| Cross-platform hardened sandbox | Codex documents macOS/Linux/Windows sandbox behavior. | Grawkus has partial OS sandbox and permission mode. | Build/test platform backends and policy translation. | Highest safety payoff. | Very hard, especially Windows and network policies. |
| Plugin marketplace security model | Codex/WOZCODE use plugin manifests. | Grawkus has skills but no marketplace trust model. | Need signing/trust prompts, version pins, update policy, sandboxed plugin execution. | Ecosystem growth. | High supply-chain risk. |
| Real-time terminal renderer with scrollback model | User design asks top scrollable, footer fixed; Codelia/Mux use richer UIs. | Grawkus footer is not yet robust enough on Windows. | Likely requires a screen model, diff renderer, resize handling, accessibility mode. | Fixes the visible conversation/input corruption problem. | Can break screen readers and dumb terminals if not mode-gated. |

### Rank 5 - Research Or Prototype First

| Feature | Top repo evidence | Grawkus today | Plug-in work | Benefit | Downfalls |
| --- | --- | --- | --- | --- | --- |
| Benchmark-driven self-improving harness | AHE is built around automatic evolution and falsification. | Grawkus has the measurement pieces, not autonomous improvement. | Prototype offline on internal tasks with strict anti-contamination rules. | Could materially improve benchmark performance. | High risk of overfitting, leakage, runaway cost, and unreviewed prompt/tool changes. |
| Full agent operating system | LemonAgent/AgentCortex and Mux point toward platform-scale modular agents. | Grawkus is powerful but product-critical CLI reliability is not done. | Define stable extension boundaries first. | Long-term platform value. | Premature platformization would slow fixes users need now. |
| Multi-agent implementation with distributed writes | Mux/Lemon suggest many agents doing real work in parallel. | Grawkus intentionally centralizes writes. | Requires isolation, locks, diff arbitration, review UI, rollback. | Big productivity upside. | High chance of merge conflicts and user data loss without strong safeguards. |
| Provider-neutral rich interface suite | Codex app-server plus Mux desktop/VS Code suggest CLI, desktop, browser, IDE. | Grawkus only has terminal. | App protocol first, then one client at a time. | Larger audience and better UX. | Maintaining multiple UIs before core stability is expensive. |
| Fully automated skill/memory evolution | LemonAgent self-evolution and AHE optimizer both suggest automatic learning. | Grawkus has MemPalace and skills. | Keep human-reviewed proposals before writes. | Could compound quality over time. | Bad memories/skills can silently corrupt future sessions. |

## Grawkus Feature-by-Feature Fit Against The Top Repos

### Provider, Model, And Routing

Grawkus is already strong here: it supports OpenRouter and OpenAI-compatible endpoints, key rotation, fallback, OpenAI OAuth, per-run model overrides, and OpenRouter catalog lookup. Mux is stronger on model aliases, one-shot model prefixes, and thinking-level syntax. Codelia is stronger on explicit provider config docs and fast-mode toggles. LemonAgent provides the best conceptual target: task-performance versus compute-cost routing.

Recommended path: implement model aliases and one-shot overrides first, then add a visible routing policy. Avoid hidden fallback. The user specifically asked that fallback be selected/configured, so fallback must stay explicit.

### Terminal UX And Input Reliability

Grawkus has the right direction with the fixed footer, active-turn cancellation, and queued input restoration, but user reports show PowerShell rendering and no-output states are still product-critical. Codelia's documented TUI composer behavior and Mux's richer app UX both point to a real screen model: fixed input/footer, scrollable transcript, robust resize handling, and explicit accessibility fallback.

Recommended path: finish the terminal renderer before any large platform work. A pretty spinner is useful only if paired with first-token watchdogs, accurate timers, and cancellation that works.

### Session, Context, And History

Grawkus has session snapshots, resume, compaction, repo-map context, and memory. Codex's thread/turn/item primitives and Mux's context boundary ADR are the strongest models. Codelia's session resume picker is the easiest UX reference.

Recommended path: preserve history array identity and session persistence first, then add soft context reset boundaries. Fork/archive/search can follow after `/resume` is stable.

### Permissions And Sandboxing

Grawkus has permission modes and partial OS sandboxing. Codelia's key contribution is vocabulary: approval policy and sandbox backend are independent axes. Codex has the most serious platform sandbox story, especially Windows, but that is hard to copy safely.

Recommended path: make Grawkus UI honest: permission mode is not sandboxing, and Windows sandbox is policy-only unless a real backend is configured. Add command-rule explanations before attempting a new sandbox backend.

### Benchmark And Source Research

Grawkus is already unusually strong here: benchmark traces, `benchmark_context`, component observability, root-cause/failure-onset/change-evaluation signals, source research, repo catalog, and adapters. AHE and Meta-Harness validate this direction. AHE goes further with automated evolution, trace debugging, and falsification loops.

Recommended path: improve observability UX before automating evolution. The next practical win is an operator-facing trace viewer or `/last-run` summary, not autonomous mutation.

### Multi-Agent And Swarm

Grawkus has `/swarm`, but it is intentionally analysis-only. Mux shows the right safety answer: isolated workspaces plus central divergence review. LemonAgent shows the planning answer: role selection, task routing, and skill memory. WOZCODE shows the cheap read-only delegation answer with `explore`.

Recommended path: add a read-only explore subagent first. Then add task-backed background workers. Only after that should Grawkus attempt write-capable swarm agents in worktrees.

### Skills, Plugins, And Instructions

Grawkus has ECC skills, progressive disclosure, and MemPalace. Codelia and Mux document similar skill/instruction ideas; Codex and WOZCODE show plugin packaging/marketplace surfaces.

Recommended path: formalize AGENTS.md layering and tool/model scoped instructions first. Plugin marketplace comes later because it introduces supply-chain risk.

### Runtime And External Interfaces

Codex app-server is the clearest target for rich clients: JSON-RPC, thread/turn/item events, approvals, health, overloaded backpressure, and multiple transports. Codelia also splits TUI and runtime. Mux proves the value of desktop/browser/VS Code surfaces.

Recommended path: do not build a desktop app yet. Define a small local JSON-RPC or JSONL protocol only after terminal reliability and session storage are stable.

### Cost, Usage, And Performance

Grawkus already tracks costs/tokens, but user reports show footer labels and timers were inaccurate. Codelia's usage tracking spec and WOZCODE's savings report both reinforce that usage display is a trust surface.

Recommended path: implement accurate session totals, first-token latency, total turn latency, retry/fallback reason, and per-model usage. Avoid marketing-style savings until there is a measured baseline.

## Prioritized Implementation Queue

1. Finish input/session reliability: message-array identity, save/resume, fixed footer redraw, timer, Esc/F5 cancel, queued input.
2. Add `/benchmark-repos --top-open-source` docs to benchmark prompts and keep docs-only source-mining default.
3. Add `/usage` and accurate footer fields: model, provider, first-token latency, turn latency, tokens, cost, version.
4. Add `/context brief` outside benchmark mode using the cheap Meta-Harness-style preflight subset.
5. Add `/perm why` and clearer permission-versus-sandbox UI.
6. Add AGENTS.md discovery plus model/tool scoped instruction sections.
7. Add model aliases and one-shot model/effort overrides.
8. Add read-only `/explore` subagent using existing repo-map/search/source tools.
9. Add task registry for background shell services and future subagents.
10. Add worktree runtime for write-capable swarm experiments.
11. Add MCP manager after config precedence and secret storage are clean.
12. Prototype app-server protocol only after the session/event model is stable.

## Features To Avoid For Now

- Full autonomous AHE-style harness evolution: too risky until trace review and anti-contamination discipline are automated.
- Write-capable parallel swarm without worktree isolation: too much user-data risk.
- Desktop/browser app before terminal is stable: splits attention from the current product-critical failure.
- Auto memory/skill writes without review: high long-term poisoning risk.
- Hidden free fallback routing: the user explicitly wants fallback to be selected/configured.
- Cosmetic animation that masks no-output API stalls: animation must be tied to watchdogs and real elapsed time.
