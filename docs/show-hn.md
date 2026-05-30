# Show HN draft

## Title

Show HN: Grawkus — terminal coding agents with a mind for the whole repo

## Body

I wanted the claude-code REPL experience — tools, modes, skills, planning — but on the model and provider of my choice. Locking the whole agent surface to one vendor's API ruled out cheap open-weight models, local Ollama runs, NVIDIA NIM, and rotating providers per task. Wrapping a new SDK per backend means re-implementing tools, modes, and streaming for each one, and you still can't switch mid-task without losing context.

Grawkus puts the full agent behind one OpenAI-compatible transport. Point it at OpenRouter, NVIDIA NIM, DeepSeek, GLM, a local Ollama or LM Studio endpoint, or any custom gateway. Swap models with `/model`, providers with `/provider`, mid-session, without losing context.

A few things that aren't in the other agent CLIs:

- **`/keys add`** — pool multiple keys for the same provider. The agent round-robins through them and cools off any key that hits 429 (60s) or quota / auth errors (1h). 404 model-not-found and 5xx server errors aren't treated as key problems — they don't burn a key.
- **`/swarm <agent,agent,...> <task>`** — fan out the same task to N specialized ECC agents in parallel (`Promise.allSettled`). One agent failing doesn't kill the others.
- **`/sandbox standard|strict`** — wrap bash tool calls in `sandbox-exec` (macOS) or `bwrap` (Linux). Independent of permission mode — defense in depth.
- **Voice + screen-reader mode** — Whisper dictation (push-to-talk `F5`), ElevenLabs TTS readout, screen-reader-friendly output for blind / low-vision users. Off by default, opt in with `/voice on`.
- **Persistent bottom-anchored input box** — ANSI scroll-region keeps your queued input visible while the model is streaming. Type during a long turn; it lands when the model finishes.

The rest of the surface:

- 9 operation modes (dev, review, tdd, research, plan, debug, architect, hermes, design)
- 130+ slash commands
- Bundled skill library: 228 skills, 60 agents, 81 workflow commands, 18 language rule sets (ECC v2.0)
- Hermes mode — recalls prior sessions before answering, parallelizes independent subtasks, distills new skills from experience
- Zero telemetry; state in `~/.grawkus/`; MIT, TypeScript, Node 18+

```bash
npm install -g grawkus
grawkus
```

Feedback on the mode set, the provider list, and the swarm fan-out pattern is especially welcome.

GitHub: https://github.com/Crownelius/grawkus
npm: https://www.npmjs.com/package/grawkus
