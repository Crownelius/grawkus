# Grawkus x Terminal-Bench

Adapter that plugs Grawkus into the [Terminal-Bench](https://www.tbench.ai/)
harness for end-to-end benchmarking.

**Status**: ✅ verified passing on `hello-world` (100% accuracy, 2m43s
agent time, 0 failures) as of 2026-05-25 with the legacy grawkus 1.33.7 +
terminal-bench 0.2.18 on Windows 11 + Docker Desktop. The full v0.1.1
dataset (~80 tasks) is runnable; the bigger task batches need a few
hours of wall clock.

## What you need on the host

- Python 3.10+
- [`uv`](https://docs.astral.sh/uv/) (the bench harness runs under it)
- Docker (one container per task — the harness handles all the
  lifecycle)
- `OPENROUTER_API_KEY` exported in your shell (or `OPENAI_API_KEY` if
  you're routing through OpenAI / another OAI-compatible gateway)

## Setup

```bash
# from the bench/ directory
uv venv --python 3.12         # terminal-bench requires Python >= 3.12
source .venv/bin/activate     # .venv\Scripts\activate on Windows
uv pip install terminal-bench
```

Then export your API key in the same shell:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...        # bash / zsh
$env:OPENROUTER_API_KEY = "sk-or-v1-..."      # PowerShell
```

Some terminal-bench codepaths still read `OPENAI_API_KEY` directly:

```bash
export OPENAI_API_KEY="$OPENROUTER_API_KEY"
```

**Windows-only: also set `PYTHONUTF8=1`.** terminal-bench writes agent
output (which contains arrow chars `→`, `▶`, Braille spinner glyphs,
etc.) to disk using the host's default encoding. Python 3 on Windows
defaults to cp1252 which doesn't cover most of Grawkus's UI
glyphs — without UTF-8 mode, the harness crashes with
`UnicodeEncodeError` after the agent has actually completed:

```bash
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
```

On Linux/Mac this is the default — no action needed.

## Get the dataset (Windows workaround)

terminal-bench's built-in `--dataset name==version` flow has a path
bug on Windows: it clones the dataset repo into a Windows tempdir,
then looks for `<tempdir>/tasks/` — which doesn't exist on the
default `main` branch of the upstream repo (the tasks live on a
separate `dataset/terminal-bench-core/v0.1.x` branch).

Workaround: clone the dataset branch manually and pass `--dataset-path`:

```bash
git clone --depth 1 https://github.com/laude-institute/terminal-bench tb-repo
cd tb-repo
git fetch origin dataset/terminal-bench-core/v0.1.x
git checkout 91e10457b5410f16c44364da1a34cb6de8c488a5  # v0.1.1 pin
cd ..
```

Now `tb-repo/tasks/hello-world/` exists with the canonical Terminal-
Bench Core task layout.

## Run a smoke test (one task)

```bash
tb run \
    --dataset-path tb-repo/tasks \
    --agent-import-path grawkus_agent_adapter:GrawkusAgent \
    --task-id hello-world \
    --global-agent-timeout-sec 1200
```

`--global-agent-timeout-sec 1200` (20 min) overrides the per-task
default of 360s. The first invocation in a fresh container has to
`apt-get install nodejs` + `npm i -g grawkus` before the agent
can run; that install alone eats 1–2 minutes, leaving the 360s task
budget too tight for anything but trivial work. 1200s gives breathing
room for both install and agent reasoning. Bump to `1800` (30 min)
for hard tasks.

## Run the full v0.1.1 dataset

```bash
tb run \
    --dataset-path tb-repo/tasks \
    --agent-import-path grawkus_agent_adapter:GrawkusAgent \
    --global-agent-timeout-sec 1800
```

~80 tasks × variable runtime. Expect 1.5–7 hours wall clock depending
on Docker concurrency + model latency. Use `--n-tasks 5` to subset
the first few tasks for a faster sanity check.

## Docker on Windows: known issues

Two things to confirm before invoking `tb run`:

1. **Docker Desktop is running** — `docker version` should return both
   client AND server version. If only the client responds, start
   Docker Desktop from the Start menu and wait for the whale icon to
   stop animating.

2. **Docker context** — `docker context ls` should show `desktop-linux *`
   (with an asterisk) as the active context. If it shows `default *`,
   run:

   ```powershell
   docker context use desktop-linux
   ```

If `tb run` errors with `Error while fetching server API version:
(2, 'CreateFile', 'The system cannot find the file specified.')`,
that's the Python docker SDK failing to connect to the Windows named
pipe. Restart Docker Desktop, confirm `docker version` returns both
versions, then re-run.

**Recommended for serious benchmark runs:** use WSL2 instead of
PowerShell. The harness was developed on Linux and the Python docker
client's npipe code path on Windows has assorted compatibility
issues. From a WSL2 Ubuntu shell:

```bash
sudo apt install docker.io   # or use Docker Desktop's WSL2 integration
cd /mnt/c/Users/.../grawkus/bench
uv venv --python 3.12
source .venv/bin/activate
uv pip install terminal-bench
git clone --depth 1 https://github.com/laude-institute/terminal-bench tb-repo
# ...same checkout commands...
export OPENROUTER_API_KEY=sk-or-v1-...
export OPENAI_API_KEY="$OPENROUTER_API_KEY"
tb run --dataset-path tb-repo/tasks --agent-import-path grawkus_agent_adapter:GrawkusAgent --task-id hello-world
```

This pulls the `hello-world` task, builds its Docker container,
installs Node 20 + `grawkus@latest` inside, and runs the agent
against the task. Logs land under `runs/<timestamp>/`.

## Run the full v2 dataset

```bash
uv run tb run \
    --agent-import-path grawkus_agent_adapter:GrawkusAgent \
    --dataset-name terminal-bench-core --dataset-version 2.0
```

89 tasks × ~1–5 min each = expect a 1.5–7 hour wall-clock run. Each
task spins up its own container in parallel up to your Docker concurrency
limit; set `--concurrency 4` if you want to cap that.

## Swap the model

Default is `openrouter/owl-alpha` (free + fast). For a quality run:

```bash
uv run tb run \
    --agent-import-path grawkus_agent_adapter:GrawkusAgent \
    --agent-kwargs-json '{"model": "deepseek/deepseek-v4-flash"}' \
    --dataset-name terminal-bench-core --dataset-version 2.0
```

## How it works

The adapter (`grawkus_agent_adapter.py`, legacy filename) is a Python module that:

1. **Installs** — writes a shell script the harness copies into each
   task container. The script installs Node 20 and `npm i -g grawkus`
   at a pinned version, then seeds a minimal `~/.grawkus/config.json`
   so the setup wizard doesn't block on stdin.
2. **Runs** — the harness execs `grawkus --non-interactive --perm yolo`
   with the task description piped via heredoc on stdin. Grawkus
   runs autonomously (yolo perms → no permission prompts, agentic loop
   until it stops calling tools).
3. **Reports** — the harness scores by the post-run filesystem state of
   the container against task expectations. Grawkus's exit code
   doesn't matter; what matters is whether the files / commands / state
   match what the task wanted.

## How --prompt mode works (under the hood)

Grawkus ships these CLI flags for harness drivers:

| Flag                       | Effect                                                      |
| -------------------------- | ----------------------------------------------------------- |
| `--prompt "<text>"`        | Run one chain with this prompt, then exit                   |
| `--prompt-file <path>`     | Same, but read the prompt from a file (multi-line safe)     |
| `--non-interactive`        | Skip wizard / banner / hotkey listener (implied by --prompt)|
| `--perm ask\|auto\|yolo`   | Per-invocation permission mode (doesn't mutate saved config)|

When `--prompt-file` is set, Grawkus:

1. Refuses to start if `~/.grawkus/config.json` is missing
   (a wizard would block forever in a piped/headless environment).
2. Skips the banner and the keypress hotkey listener.
3. Pushes the prompt text as one user message.
4. Runs a single `runQuery` chain — agentic tool-use loop until the
   model stops calling tools, or the 10-error loop detector fires.
5. Exits 0 on success, 1 on chain error.

The adapter writes the task description to `/tmp/tb_task.txt` inside
the container, then invokes:

```
grawkus --prompt-file /tmp/tb_task.txt --perm yolo
```

`--perm yolo` is what makes the agent actually agentic in a benchmark:
without it, every tool call would block on a permission prompt that
the harness can't answer.

## Other caveats

- **API cost** — owl-alpha is free; other models bill per-token. The
  v2 dataset can easily run 1M+ tokens of context across 89 tasks.
  Estimate $5–$50 depending on model + task verbosity.
- **Windows hosts** — Docker Desktop must be running. The harness
  works under WSL2 / PowerShell but you'll want WSL2 for performance.
