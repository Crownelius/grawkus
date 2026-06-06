# Grawkus NHE

Grawkus NHE is the Grawkus-branded 3.0.0 base for observability-driven coding-agent harness evolution.

This repo is based on the Agentic Harness Engineering project from `china-qijizhifeng/agentic-harness-engineering`, with the Grawkus identity, package metadata, and command surface layered on top.

## What This Is

- A Python/uv harness-evolution workspace, not the old npm TypeScript CLI.
- A NexAU-based loop for evaluating, analyzing, and improving coding-agent harness components.
- A reproducible base for evolving prompts, tools, middleware, skills, sub-agents, and long-term memory.
- A Grawkus 3.0.0 reset point for future benchmark and harness work.

## Install

Requirements:

- Python 3.13 or newer
- `uv`
- `tmux` for the upstream shell launch scripts
- E2B credentials for sandboxed rollouts

```bash
uv sync
```

Create local environment config:

```bash
cp .env.example .env
```

At minimum, configure:

- `LLM_API_KEY`
- `LLM_BASE_URL`
- `E2B_API_KEY`
- `SERPER_API_KEY`

## Commands

After installation, the package exposes:

```bash
grawkus
grawkus-nhe
agentic-harness-engineering
```

Each entry point runs the same evolution orchestrator in `evolve.py`.

## Base Provenance

See `BASE_MODEL.md` for the exact upstream commit and local import notes.

## Upstream Credit

This fork preserves the Agentic Harness Engineering architecture and upstream attribution. The original project is available at:

https://github.com/china-qijizhifeng/agentic-harness-engineering
