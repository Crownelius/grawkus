# Terminal-Bench Top-20 Source Lessons

Reviewed: 2026-05-28

Scope: official Terminal-Bench 2.0 top-20 leaderboard entries, public repositories only. Source-code excerpts are intentionally out of scope; use READMEs, docs, manifests, metadata, and public benchmark claims first.

## Verified Public Targets

Only seven unique public repo targets were verified from the top 20 after removing duplicates, release-only repos, and no-public-source gaps:

- `china-qijizhifeng/agentic-harness-engineering` - NexAU-AHE, rank 3.
- `Open-Lemon/LemonAgent` - LemonHarness, rank 4 and rank 10.
- `openai/codex` - Codex CLI, rank 6; also the public source behind related Simple Codex at rank 17.
- `WithWoz/wozcode-plugin` - public WOZCODE plugin repo, rank 9. A separate full-source repo was not verified.
- `stanford-iris-lab/meta-harness-tbench2-artifact` - Meta-Harness artifact, rank 13; public artifact, not clearly full product source.
- `kousw/codelia` - Codelia, rank 15.
- `coder/mux` - Mux, rank 20.

Skipped top-20 entries: `vix` is release-only; `JJAgent`, `Capy`, `Polaris`, `TongAgents`, `SageAgent`, `Droid`, `CodeBrain-1.5`, and `Terminus-KIRA` did not have a verified reusable public implementation repository in the packaged catalog.

## Applicable Patterns

1. Observability is the main lever. NexAU-AHE frames high-scoring harnesses around component, experience, and decision observability. For Grawkus, benchmark traces should keep separating prompt/tool/middleware/provider/memory failures, preserve compact prior-run cards, and make "why this edit" visible before changing files.

2. Preflight context saves turns. Meta-Harness documents environment bootstrapping before the agent loop: cwd, listings, installed tools, language/package-manager availability, and memory. Grawkus's `benchmark_context` should remain cheap, read-only, and early, especially for Terminal-Bench and long terminal workflows.

3. Token economy is a product feature. WOZCODE's public plugin positions smarter file tools as a way to reduce token use and round trips. Grawkus should keep moving heavy repo inspection into bounded local tools and digests instead of streaming large raw files into the model.

4. Multi-agent work needs isolation. Mux emphasizes isolated workspaces and central visibility over divergence. Grawkus swarm should keep writes centralized until per-agent workspace isolation, diff review, and merge arbitration are real.

5. Hybrid runtimes need explicit contracts. Codelia describes a TypeScript runtime communicating with a Rust TUI over JSON-RPC and warns that policy-only command safety is not OS isolation. Grawkus should keep terminal UI, agent runtime, permissions, and sandbox claims explicit and testable.

6. Cost/performance routing should be configured, not hidden. LemonAgent describes compute-aware selection, planner/executor separation, and reusable memory/tooling. Grawkus should expose fallback, model routing, swarm budget, and memory behavior through `/config` and command-specific settings.

## Grawkus Changes Backed By This Review

- `/benchmark-repos --top-open-source --from-top 20 --limit 10` now returns the verified top-20 public repo targets and explicitly says when fewer than ten exist.
- `/benchmark-repos --top-open-source --repos-only` gives a clean owner/repo list for scripts.
- `/repo-digest <repo> --docs-only` inspects docs, manifests, trees, and metadata while skipping source-code excerpts.
- The catalog now records leaderboard rank, model, score, and date evidence for current top-20 mapped entries.

Use this flow before future source-mining work:

```text
/benchmark-repos --top-open-source --from-top 20 --limit 10
/repo-digest <owner/repo> --files 500 --docs-only
```
