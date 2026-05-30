"""
Terminal-Bench v2 adapter for Grawkus.

Implements the AbstractInstalledAgent interface so the harness can:
  1. Install Grawkus into the task's Docker container.
  2. Hand the task description to Grawkus on stdin.
  3. Let Grawkus run autonomously (--non-interactive + yolo perms)
     against the task workspace, executing whatever shell commands it
     decides it needs to solve the task.

Run a single task:

    uv run tb run \
        --agent-import-path grawkus_agent_adapter:GrawkusAgent \
        --task-id hello-world

Run the full v2 dataset:

    uv run tb run \
        --agent-import-path grawkus_agent_adapter:GrawkusAgent \
        --dataset-name terminal-bench-core --dataset-version 2.0

Requirements on the host:
  - Python 3.10+
  - uv (https://docs.astral.sh/uv/)
  - Docker (the harness spawns one container per task)
  - terminal-bench installed in the active uv env
  - Network access to npmjs.com (the install step pulls grawkus)
  - OPENROUTER_API_KEY (or whichever provider) in the host environment;
    the adapter forwards it into the container as OPENAI_API_KEY +
    OPENAI_BASE_URL so Grawkus's setup wizard skips on startup.

Model selection: defaults to owl-alpha via OpenRouter (free + fast for
benchmarking). Override per-run with:

    --agent-kwargs-json '{"model": "deepseek/deepseek-v4-flash"}'
"""

from __future__ import annotations

import os
import textwrap
from pathlib import Path

# Correct import paths for terminal-bench 0.2.x. The class lives in
# `terminal_bench.agents.installed_agents.abstract_installed_agent` —
# note the trailing `.abstract_installed_agent` submodule, NOT the
# `installed_agents` package itself. TerminalCommand is the type
# `_run_agent_commands` must return (was: plain list of strings in
# pre-release notes; reality: pydantic model with per-command
# timeout knobs).
from terminal_bench.agents.installed_agents.abstract_installed_agent import (
    AbstractInstalledAgent,
    TerminalCommand,
)


# Pinned to a known-working Grawkus release. Bump as new versions
# ship; the bench results depend on the exact agent build, so we want
# this reproducible.
#
# 1.35.58 is the Grawkus rebrand baseline with --prompt-file,
# grawkus/grawkus bin aliases, and benchmark trace support.
GRAWKUS_VERSION = "1.35.58"

# Default model. owl-alpha is free on OpenRouter and tends to be fast
# enough for benchmark turnaround. Swap to claude-sonnet-4 or
# deepseek-v4 for a quality run.
DEFAULT_MODEL = "openrouter/owl-alpha"

# Install script — runs INSIDE the task container. The harness mounts
# the script and execs it once at container startup, before any task
# command runs. We:
#   1. install Node 20 (Grawkus needs node>=18)
#   2. npm install -g grawkus@<version>
#   3. seed a minimal config so the setup wizard doesn't prompt
#
# The harness expects an executable shell script at the path we return
# from _install_agent_script_path. We materialize it on disk once per
# task invocation (the harness reads it then copies into the container).
INSTALL_SCRIPT = """\
#!/usr/bin/env bash
set -euo pipefail

# The t-bench base images (e.g. ghcr.io/laude-institute/t-bench/python-3-13)
# are intentionally minimal — no curl, no gnupg, no node. Install the
# prerequisites first, THEN the NodeSource setup script, THEN node, THEN
# Grawkus. Each layer guards against the previous already being
# installed so re-running the script is idempotent.
if ! command -v curl >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y --no-install-recommends curl ca-certificates gnupg
fi

# Node 20 (Grawkus's engines field requires >=18). The setup_20.x
# script writes /etc/apt/sources.list.d/nodesource.list + key, then
# apt-get install -y nodejs pulls a single deb that includes npm.
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y --no-install-recommends nodejs
fi

# Install Grawkus globally so it's on PATH.
npm install -g grawkus@__GRAWKUS_VERSION__

# Seed Grawkus config so the setup wizard skips and the agent
# launches straight into a working state. The wizard would block on
# stdin otherwise — terminal-bench drives the agent via piped stdin
# only for the task description, not for setup.
#
# CRITICAL: bake the API key into the config file. Grawkus's
# configExists() check returns false when cfg.apiKey is empty (even
# if OPENAI_API_KEY is set in the env) because the wizard-skip
# decision is based on the saved config alone. Setting apiKey here
# makes the file self-sufficient and bypasses the wizard.
#
# Heredoc is unquoted so ${OPENAI_API_KEY} and ${MODEL} expand. The
# API key is alphanumeric + dashes so no shell-quoting hazards.
if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "grawkus install failed: OPENAI_API_KEY not in env" >&2
  exit 1
fi
mkdir -p "$HOME/.grawkus"
cat > "$HOME/.grawkus/config.json" <<EOF
{
  "provider": "OpenRouter (Any Model)",
  "baseURL": "https://openrouter.ai/api/v1",
  "model": "__MODEL__",
  "apiKey": "${OPENAI_API_KEY}",
  "permissionMode": "yolo",
  "theme": "minimal",
  "showThinking": false,
  "voice": { "accessibility": { "screenReader": false } },
  "memory": { "enabled": false }
}
EOF

# API key gets forwarded via OPENAI_API_KEY env (set by the harness from
# the host). Grawkus reads OPENAI_API_KEY at startup when the
# baseURL config field is set.
#
# Sanity-check that the binary is on PATH — DO NOT actually exec
# Grawkus here. Grawkus has a --version flag, but the adapter only needs a path check.
# it with any non-recognized argument falls through to REPL mode,
# which blocks forever on stdin in a headless container.
if command -v grawkus >/dev/null 2>&1; then
  echo "grawkus install complete: $(command -v grawkus)"
else
  echo "grawkus install failed: not on PATH"
  exit 1
fi
"""


class GrawkusAgent(AbstractInstalledAgent):
    """Terminal-bench adapter for Grawkus."""

    @staticmethod
    def name() -> str:
        return "grawkus"

    def __init__(self, model: str = DEFAULT_MODEL, version: str = GRAWKUS_VERSION, **kwargs):
        super().__init__(**kwargs)
        self._model = model
        self._version = version
        self._install_script_path: Path | None = None

    @property
    def _install_agent_script_path(self) -> Path:
        """Write the install script to a temp path and hand it to the harness.

        The harness's contract is: this path must exist, must be readable,
        and must be a self-contained shell script. We materialize it on
        first access using the currently-configured model + version.
        """
        if self._install_script_path is None:
            tmpdir = Path("/tmp" if os.name != "nt" else os.environ.get("TEMP", "."))
            self._install_script_path = tmpdir / "grawkus_agent_install.sh"
            content = (
                INSTALL_SCRIPT
                .replace("__GRAWKUS_VERSION__", self._version)
                .replace("__MODEL__", self._model)
            )
            # Force LF line endings — bash inside the Linux container
            # chokes on Windows CRLF (`bash: $'\r': command not found`).
            # write_text with newline='' bypasses the universal-newlines
            # translation that converts \n -> \r\n on Windows hosts.
            self._install_script_path.write_text(content, newline="")
            self._install_script_path.chmod(0o755)
        return self._install_script_path

    def _run_agent_commands(self, task_description: str) -> list[TerminalCommand]:
        """Return the shell commands the harness will run inside the
        container to actually invoke the agent on this task.

        Two single-line commands (multi-line ones break — see below):

          1. Decode a base64-encoded task description into
             /tmp/tb_task.txt. Base64 because every other approach
             clashed with the harness's command-injection mechanism:
               - Heredocs broke because terminal-bench appends
                 `; tmux wait -S done` to the LAST line of the command
                 it sends, turning `__TB_TASK_EOF__` into
                 `__TB_TASK_EOF__; tmux wait -S done` — no longer a
                 valid heredoc marker, so the shell hung in heredoc
                 mode forever.
               - Single-quoted echoes broke when the task description
                 contained an apostrophe (very common in natural-
                 language instructions).
               - $'...' bash strings broke on backslash escapes.
             Base64 is opaque, single-line, and survives the
             harness's mangling.

          2. Invoke `grawkus --prompt-file /tmp/tb_task.txt --perm yolo`.
             Reads the prompt verbatim, runs one runQuery chain with
             permission gates auto-approved (yolo), exits 0 on success
             or 1 on chain failure.

        max_timeout_sec is bumped to 30 minutes per command because
        some terminal-bench tasks require long-running compilation /
        test runs that legitimately take > 3 minutes.
        """
        import base64

        # Single-line base64 round-trip. The whole task description —
        # apostrophes, quotes, newlines, backticks, dollar signs —
        # passes through unchanged. The trailing newline ensures
        # Grawkus reads a clean prompt.
        b64 = base64.b64encode(task_description.encode("utf-8")).decode("ascii")
        write_task = (
            'export PATH="$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH" && '
            f"echo {b64} | base64 -d > /tmp/tb_task.txt"
        )
        return [
            TerminalCommand(command=write_task, max_timeout_sec=10.0, block=True),
            TerminalCommand(
                command="grawkus --prompt-file /tmp/tb_task.txt --perm yolo",
                max_timeout_sec=1800.0,  # 30 minutes per task
                block=True,
            ),
        ]

    @property
    def _env(self) -> dict[str, str]:
        """Environment variables forwarded into the container.

        Forward the API key from the host. The harness already isolates
        the container from the host filesystem, so a leaked key doesn't
        cross containers, but it's still your real key — only run the
        benchmark with a key you've budgeted for.
        """
        env = {}
        # Grawkus reads OPENAI_API_KEY when baseURL is configured.
        # OpenRouter, NVIDIA, DeepSeek, etc all key off this same env.
        key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not key:
            raise RuntimeError(
                "grawkus benchmark requires OPENROUTER_API_KEY (or OPENAI_API_KEY) "
                "in the host environment. Set it before invoking `tb run`."
            )
        env["OPENAI_API_KEY"] = key
        # GRAWKUS_ANIMATIONS=0 disables in-place ANSI repaints so
        # the harness's log capture stays readable (no spinner garbage).
        env["GRAWKUS_ANIMATIONS"] = "0"
        return env


if __name__ == "__main__":
    # Sanity check the install script renders cleanly when this file is
    # run directly: `python grawkus_agent_adapter.py` prints the script
    # the harness will inject into containers.
    agent = GrawkusAgent()
    print(agent._install_agent_script_path.read_text())
