# Installing Grawkus

Grawkus is terminal coding agents with a mind for the whole repo. After install you
get a `grawkus` command that drops you into an interactive REPL with
80+ slash commands, multi-agent orchestration, a bundled
[everything-claude-code][ecc] skill library, and Hermes self-improving mode.

This guide covers installation, first-run setup, and the basics of pointing
Grawkus at any OpenAI-compatible API.

## TL;DR

**Single command** (Node 18+ required):

```bash
npm install -g grawkus
grawkus --doctor
grawkus
```

`grawkus --doctor` checks the install, registry metadata, config, MemPalace, source-research readiness, and benchmark adapters without printing token values. First run launches the setup wizard.

Inside the REPL, type `/walkthrough` for an agent-led tour, `/help` for a
quick command list, or see [COMMANDS.md](COMMANDS.md) for a complete
reference of every slash command. `Ctrl+C` exits.

## Prerequisites

- **Node.js 18 or newer.** `node --version` to check. We test on 18, 20, 22, 24.
- **An API key for at least one provider.** OpenRouter is the easiest because
  one key works across hundreds of models (including free ones). See the
  [Providers](#providers) section below for alternatives.
- **A POSIX-like shell** (macOS, Linux, WSL, or Git Bash on Windows). PowerShell
  and CMD work too — Grawkus spawns Git Bash for shell commands on Windows.

## Install from npm

```bash
npm install -g grawkus
```

Verify:

```bash
grawkus --help       # show help
grawkus --doctor     # install/config readiness check
grawkus              # launch the REPL
```

The legacy `grawkus` command is still installed as an alias for existing workflows. To uninstall later: `npm uninstall -g grawkus`.

### Pre-publish alternative: install from GitHub

If you want the latest commit before it lands on the registry:

```bash
npm install -g github:Crownelius/grawkus
```

Same package, fetched from the repo's default branch. npm runs the
`prepare` script to compile TypeScript on install.

## Install from source (for development)

If you want to hack on Grawkus itself, clone and link:

```bash
git clone https://github.com/Crownelius/grawkus.git
cd grawkus
npm install            # also runs prepare/tsc automatically
npm link               # global `grawkus` points at this checkout
```

Now edits in `src/` take effect after `npx tsc` (or `npm run build`). To
uninstall the global shim: `npm unlink -g grawkus`.

### Without `npm link`

If you prefer not to touch your global bin:

```bash
node ./bin/grawkus.js                                     # always run from here
alias grawkus='node /full/path/to/grawkus/bin/grawkus.js'   # or alias it
```

## First-run setup

The first time you run `grawkus`, the setup wizard fires. It asks for:

1. **Provider.** OpenRouter is the recommended default — one key, hundreds of
   models, including free tiers. Other options: OpenAI, GLM (ZhipuAI), Ollama,
   LM Studio, DeepSeek, or a custom OpenAI-compatible endpoint.
2. **Base URL.** Pre-filled per provider. Only override if you're using a
   custom endpoint or a proxy.
3. **API key.** Stored plaintext in `~/.grawkus/config.json` — keep that
   file private (it's only readable by you on POSIX).
4. **Model.** Pre-filled with a sensible default; you can paste any model
   slug the provider supports. For OpenRouter free tier, try
   `inclusionai/ring-2.6-1t:free`.
5. **Permission mode.** `ask` (prompt before writes/shell), `auto` (auto-OK
   non-destructive ops), or `yolo` (approve everything — fastest, riskiest).
   Default is `ask`. You can change later with `/perm <mode>`.

Your config is saved to `~/.grawkus/config.json` and Grawkus drops
into the REPL.

To re-run the wizard later: type `/config` inside the REPL.

## Providers

Grawkus talks to anything that speaks the OpenAI Chat Completions API.
Suggested setups:

| Provider | Base URL | Notes |
|---|---|---|
| **[OpenRouter][or]** | `https://openrouter.ai/api/v1` | One key, 300+ models, free tier available. Recommended for new users. |
| **OpenAI** | `https://api.openai.com/v1` | Standard. Pin a model like `gpt-4o`. |
| **DeepSeek** | `https://api.deepseek.com/v1` | Cheap, strong on code. |
| **GLM (ZhipuAI)** | `https://open.bigmodel.cn/api/paas/v4` | Chinese provider. |
| **Ollama** | `http://localhost:11434/v1` | Local models. No API key needed. |
| **LM Studio** | `http://localhost:1234/v1` | Local models. No API key needed. |
| **Custom** | you provide | Anything OpenAI-compatible. |

For Anthropic specifically: the native Anthropic API is **not** OpenAI-compatible.
Use them via OpenRouter (e.g. `anthropic/claude-sonnet-4`) or a translating
proxy.

## Verifying the install

After setup, try:

```
grawkus
```

You should see the splash, banner, and a `❯ ` prompt. Then:

```
❯ /help
❯ /walkthrough          # agent-led tour
❯ /skills               # shows the 33 bundled ECC skills
❯ /audit                # local-only project audit
❯ /doctor               # install/config/benchmark readiness
❯ /exit
```

If `grawkus` isn't found after `npm link`, see [Troubleshooting](#troubleshooting).

## What gets installed

Grawkus is local-first:

```
~/.grawkus/
  config.json          API key, provider, model, permissions
  usage.json           token counts, cost estimates (local only)
  hooks.json           PreToolUse / PostToolUse hook config
  sessions/            saved conversations
  instincts/           learned patterns (`/learn`, `/instincts`)
  skills/              reusable skill templates (33 from ECC + your own)
  memory/              cross-session project context
  rules/               language-specific coding rules
  hooks/               your hook scripts (if any)
  ecc-state.json       ECC install state (auto-managed)
  ecc-commands/        bundled command prompts (/ecc-feature-development etc.)
  ecc-agents/          bundled agent prompts
  checkpoints/         git state checkpoints (`/checkpoint`)
```

The first launch auto-installs the bundled
[everything-claude-code][ecc] library: 33 skills, 16 agents, 9 workflow
commands, 7 language rule bundles, 5 native security hooks. Type `/ecc` to
see the install state.

## ECC: zero-configuration skill bundle

The first time you run Grawkus, you'll see this line during startup:

```
ECC ready: 33 skills, 16 agents, 9 commands, 7 rule sets.
```

That's the bundled [everything-claude-code][ecc] library being installed into
`~/.grawkus/`. It adds:

- High-quality prompts for `/tdd`, `/review`, `/security-review`, `/plan`,
  `/refactor`, `/build-fix` (these use the ECC version automatically when ECC
  is installed).
- Three ECC-only commands: `/ecc-feature-development`,
  `/ecc-add-language-rules`, `/ecc-database-migration`.
- Five default security hooks: block `git --no-verify`, warn on reading
  `.env`/`.key`/`.pem`, warn when an edit leaves `console.*` statements,
  suggest tmux for dev servers.

Refresh anytime with `/ecc-install`. Disable a specific hook by editing
`~/.grawkus/hooks.json`.

## Updating

```bash
npm install -g grawkus@latest            # re-fetches the latest published version
```

If you installed from a source clone:

```bash
cd grawkus
git pull
npm install            # in case dependencies changed
npx tsc                # rebuild
```

## Uninstall

```bash
npm uninstall -g grawkus           # if installed via npm install -g
npm unlink -g grawkus              # if installed via `npm link` from a source clone
rm -rf ~/.grawkus                # local state (config, sessions, instincts, etc.)
```

If you set up hooks or wrote skills, back up `~/.grawkus/skills/` and
`~/.grawkus/hooks.json` first.

## Troubleshooting

### `grawkus: command not found`

`npm link` didn't put the bin shim on PATH. Verify:

```bash
npm prefix -g          # this dir should be on PATH
ls "$(npm prefix -g)/bin/grawkus*"     # POSIX
ls "$(npm prefix -g)/grawkus*"         # Windows
```

If it's there but not on PATH, add `npm prefix -g`'s bin dir to your shell's
PATH. On Windows that's `%APPDATA%\npm` by default.

### `DEP0040 DeprecationWarning: punycode`

Cosmetic. Grawkus's bin already includes a filter that drops this one
specific deprecation. If you still see it, you're running an older build —
`npx tsc` again and retry.

### "Unknown tool: X" errors in mid-session

This is a feature, not a bug. Some free models hallucinate tool names like
`web_search_exa`. The error tells the model what tools actually exist
(`bash, read_file, write_file, edit_file, grep, glob, list_dir, web_fetch,
web_search`) and the model self-corrects on the next iteration.

### Free-tier rate limits (429)

OpenRouter free tier is 20 requests/minute and 200 requests/day. The model
provider sometimes lower-bounds further. Grawkus retries 429s up to 3
times with backoff. If you're hitting limits often, switch to a paid tier
or use a local Ollama model — both are configured via `/config`.

### Permission prompts are noisy

Set `/perm auto` for most cases, or `/perm yolo` to silence them entirely.
`yolo` means the agent can write any file and run any shell command without
asking — fine for sandboxes, dangerous for your main checkout.

### Where do I report bugs?

[github.com/Crownelius/grawkus/issues](https://github.com/Crownelius/grawkus/issues).
Include your Node version, OS, the slash command you ran, and the model.

## Next steps

- Run `/walkthrough` inside Grawkus for an interactive tour.
- See [README.md](README.md) for the feature reference and slash-command list.
- Try `/mode hermes` for self-improving learning-loop mode (search past
  sessions, distill skills from experience, propose what's worth banking
  before finishing a task).

[ecc]: https://github.com/Crownelius/everything-claude-code
[or]: https://openrouter.ai
