# Grawkus vs. claude-code, Aider, and single-vendor CLIs

claude-code-style terminal UX, but the transport is OpenAI-compatible — so the agent runs on OpenRouter, NVIDIA NIM, DeepSeek, GLM, a local Ollama model, or anything else that speaks Chat Completions. Add multiple keys for the same provider and the agent round-robins through them with per-key cool-down on rate-limit / quota errors.

```bash
npm install -g grawkus
grawkus
```

## The problem these tools share

Agentic coding CLIs are converging on a similar shape: a REPL with slash commands, modes, skills, file-edit tools, and a planner. The catch is the backend.

- **claude-code** runs only on Anthropic's API. Pricing, weights, and rate limits are Anthropic's.
- **Aider** is provider-flexible but is a code-editing assistant, not a full agent surface — no modes, no skill library, no learning loop, no parallel agent fan-out.
- **Cursor / Copilot CLIs** route through their own gateways. You don't pick the model; they do.

If you want to use a $0.14/M-token open model, a local Ollama checkpoint on your own GPU, rotate providers per task, or pool several free-tier keys, none of the above lets you do that without leaving the agent behind.

## The naive fix fails

The obvious workaround is to wrap a different SDK per provider. That means re-implementing tool-calling, prompt assembly, streaming, retries, and mode wiring for each backend — and you still can't switch mid-task without dropping context.

Grawkus puts the entire agent surface behind one OpenAI-compatible transport. Swap models with `/model`, swap providers with `/provider`, add a second key with `/keys add`, and the tools, modes, and skills come with you.

## Side by side

| Capability | Grawkus | claude-code | Aider | Cursor CLI |
| :--- | :--- | :--- | :--- | :--- |
| Install | `npm i -g grawkus` | vendor CLI | `pip install aider-chat` | vendor CLI |
| Backend | Any OpenAI-compatible API | Anthropic only | Multi-provider via LiteLLM | Vendor gateway |
| Switch model mid-session | `/model`, `/provider`, `/route` | model only, same vendor | restart | restricted |
| Run local models (Ollama, LM Studio) | yes | no | yes | no |
| Multi-key pool with cool-down | yes (`/keys`) | n/a — single vendor | no | no |
| Parallel multi-agent swarm | yes (`/swarm`) | no | no | no |
| OS sandbox (Seatbelt / bwrap) | yes (`/sandbox`) | no | no | no |
| Operation modes | 9 (dev, review, tdd, research, plan, debug, architect, hermes, design) | limited | edit-focused | edit-focused |
| Slash commands | 130+ | yes | small set | small set |
| Bundled skill library | 228 skills, 60 agents, 81 commands (ECC v2.0) | n/a | n/a | n/a |
| User-defined skills | `/skill-create`, `/evolve` | n/a | custom prompts | n/a |
| Cross-session learning | Hermes mode | no | no | partial |
| Voice + screen-reader | Whisper + ElevenLabs + screen-reader mode | no | no | no |
| Persistent input box | yes (ANSI scroll-region) | no | no | no |
| Telemetry | zero — only calls go to the chosen LLM provider | vendor telemetry | minimal | vendor telemetry |
| State location | local `~/.grawkus/` | vendor cloud + local | local | vendor cloud |
| License | MIT | no LICENSE file | Apache-2.0 | proprietary |
| Stack | TypeScript, Node 18+ | proprietary | Python | proprietary |

## Mechanism → developer benefit

| Mechanism | What it lets you do |
| :--- | :--- |
| OpenAI-compatible transport | Point at OpenRouter, NVIDIA NIM, DeepSeek, GLM, Ollama, LM Studio, or a custom gateway without forking the agent. |
| `/model`, `/provider`, `/route` mid-session | Start a plan on a cheap model, escalate to a stronger one for the tricky diff, stay in the same REPL with full context. |
| `/keys add` multi-key pool | Pool several free-tier keys for the same provider. Round-robin with 60s cool-down on 429, 1h on quota / auth. 404 and 5xx don't burn a key. |
| `/swarm <agents> <task>` | Fan out the same task to N specialized ECC agents in parallel via `Promise.allSettled`. One agent failing doesn't kill the others. |
| `/sandbox standard\|strict` | Wrap bash tool calls in `sandbox-exec` (macOS) or `bwrap` (Linux). Independent of permission mode — defense in depth. |
| 9 operation modes | Pick the right loop for the task — `tdd` for red-green cycles, `review` for PRs, `architect` for design passes — instead of one generic chat. |
| Hermes mode | Recalls prior sessions before answering, models how you work, parallelizes independent subtasks, distills new skills from experience, suggests what's worth banking. |
| Bundled ECC v2.0 | 228 skills, 60 agents, 81 workflow commands, 18 language rule sets ship with the install. Auto-installed on first launch. |
| Voice + screen-reader | Push-to-talk Whisper dictation (`F5`), ElevenLabs TTS readout, screen-reader-friendly output mode. None of the listed competitors ship this. |
| Persistent input box | ANSI scroll-region keeps your queued input visible while the model is streaming. Type a follow-up during a long turn; it lands as soon as the model finishes. |
| Zero telemetry, local state | Code stays between you and the provider you chose. Nothing phones home. |
| MIT + TypeScript | Read it, fork it, contribute. No closed agent core. |

## When to pick which

- Pick **claude-code** if you're committed to Anthropic and want the first-party experience.
- Pick **Aider** if you mainly want a code-editing pair-programmer with git integration and don't need modes, skills, planning, or parallel agents.
- Pick a **vendor CLI** (Cursor, Copilot) if you want the IDE-integrated path and are fine with vendor routing.
- Pick **Grawkus** if you want the full agent surface but need to choose your own backend — local model, open weights, cheaper provider, or several rotated per task.

## Next steps

- Install: `npm install -g grawkus`
- Run: `grawkus`
- Commands reference: [../COMMANDS.md](../COMMANDS.md)
- Install notes: [../INSTALL.md](../INSTALL.md)
- License: MIT
