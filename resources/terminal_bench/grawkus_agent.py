"""Terminal-Bench adapter for Grawkus.

Usage:
    tb run --agent-import-path resources.terminal_bench.grawkus_agent:GrawkusTerminalBenchAgent ...

The adapter installs the npm package in the task container, then runs
Grawkus in non-interactive benchmark mode with the task instruction.
"""

from __future__ import annotations

import os
import shlex
from pathlib import Path

from terminal_bench.agents.installed_agents.abstract_installed_agent import (
    AbstractInstalledAgent,
)

try:
    from terminal_bench.harness_models import TerminalCommand
except ImportError:  # terminal-bench moved this in newer releases
    from terminal_bench.terminal.models import TerminalCommand


class GrawkusTerminalBenchAgent(AbstractInstalledAgent):
    """Terminal-Bench agent for Grawkus."""

    @staticmethod
    def name() -> str:
        return "grawkus"

    def __init__(
        self,
        model_name: str | None = None,
        provider: str | None = None,
        install_spec: str | None = None,
        max_turns: int | None = None,
        *args,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self._model_name = model_name
        self._provider = provider
        self._install_spec = install_spec
        self._max_turns = max_turns

    @property
    def _env(self) -> dict[str, str]:
        env: dict[str, str] = {
            "GRAWKUS_ENV_CONFIG": "1",
            "GRAWKUS_HOME": "/tmp/grawkus-home",
            "GRAWKUS_THEME": "minimal",
            "GRAWKUS_SHOW_THINKING": "0",
            "GRAWKUS_MEMORY": os.environ.get("GRAWKUS_MEMORY", "0"),
            "GRAWKUS_BASH_TIMEOUT_MS": os.environ.get("GRAWKUS_BASH_TIMEOUT_MS", "300000"),
            "GRAWKUS_INSTALL_SPEC": self._install_spec
            or os.environ.get("GRAWKUS_INSTALL_SPEC", "grawkus@latest"),
        }

        passthrough = [
            "GRAWKUS_API_KEY",
            "GRAWKUS_BASE_URL",
            "GRAWKUS_MODEL",
            "GRAWKUS_FALLBACK_MODEL",
            "GRAWKUS_MAX_TOKENS",
            "GRAWKUS_CONTEXT_WINDOW_TOKENS",
            "GRAWKUS_COMPACTION_TRIGGER_TOKENS",
            "GRAWKUS_COMPACTION_MODEL",
            "GRAWKUS_COMPACTION_MAX_TOKENS",
            "GRAWKUS_COMPACTION_USE_FALLBACK",
            "GRAWKUS_LLM_COMPACTION",
            "GRAWKUS_COMPACTION_MODE",
            "GRAWKUS_LOCAL_COMPACTION_FALLBACK",
            "GRAWKUS_TEMPERATURE",
            "GRAWKUS_BUNDLE_ROOT",
            "GRAWKUS_BUNDLE_TARBALL",
            "OPENROUTER_API_KEY",
            "OPENAI_API_KEY",
            "DEEPSEEK_API_KEY",
            "NVIDIA_API_KEY",
            "GOOGLE_API_KEY",
            "GEMINI_API_KEY",
            "GLM_API_KEY",
            "ZHIPUAI_API_KEY",
        ]
        for key in passthrough:
            if os.environ.get(key):
                env[key] = os.environ[key]

        if self._provider:
            env["GRAWKUS_PROVIDER"] = self._provider
        elif os.environ.get("GRAWKUS_PROVIDER"):
            env["GRAWKUS_PROVIDER"] = os.environ["GRAWKUS_PROVIDER"]

        if self._model_name:
            env["GRAWKUS_MODEL"] = self._model_name
        if self._max_turns:
            env["GRAWKUS_MAX_TURNS"] = str(self._max_turns)
        elif os.environ.get("GRAWKUS_MAX_TURNS"):
            env["GRAWKUS_MAX_TURNS"] = os.environ["GRAWKUS_MAX_TURNS"]

        return env

    @property
    def _install_agent_script_path(self) -> Path:
        return Path(__file__).parent / "setup.sh"

    def _run_agent_commands(self, task_description: str) -> list[TerminalCommand]:
        instruction = "/benchmark terminal-bench " + task_description
        agent_command = (
            "grawkus "
            f"--prompt {shlex.quote(instruction)} "
            "--perm yolo "
            "--benchmark-trace-dir .grawkus/trace"
        )
        script = (
            f"{agent_command}; "
            "status=$?; "
            "mkdir -p .grawkus; "
            "redact_grawkus_artifact() { "
            "sed -E "
            "-e 's/sk-or-v1-[A-Za-z0-9_-]+/sk-or-v1-[REDACTED]/g' "
            "-e 's/sk-[A-Za-z0-9_-]{16,}/sk-[REDACTED]/g' "
            "-e 's/hf_[A-Za-z0-9]{16,}/hf_[REDACTED]/g' "
            "-e 's/KGAT_[A-Za-z0-9]{16,}/KGAT_[REDACTED]/g' "
            "-e 's/npm_[A-Za-z0-9]{16,}/npm_[REDACTED]/g'; "
            "}; "
            "summary=$(find .grawkus/trace -name summary.json -type f 2>/dev/null | sort | tail -n 1 || true); "
            "if [ -n \"$summary\" ] && [ -f \"$summary\" ]; then "
            "cp \"$summary\" .grawkus/benchmark-summary.json; "
            "trace_dir=$(dirname \"$summary\"); "
            "if [ -f \"$trace_dir/trace.jsonl\" ]; then cp \"$trace_dir/trace.jsonl\" .grawkus/benchmark-trace.jsonl; fi; "
            "if [ -f \"$trace_dir/agent-context-compiled.jsonl\" ]; then cp \"$trace_dir/agent-context-compiled.jsonl\" .grawkus/agent-context-compiled.jsonl; fi; "
            "if [ -f \"$trace_dir/change-evaluation.json\" ]; then cp \"$trace_dir/change-evaluation.json\" .grawkus/change-evaluation.json; fi; "
            "if [ -f \"$trace_dir/submission-bundle-manifest.json\" ]; then cp \"$trace_dir/submission-bundle-manifest.json\" .grawkus/submission-bundle-manifest.json; fi; "
            "fi; "
            "if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then "
            "{ git diff --binary --no-ext-diff 2>/dev/null || true; "
            "git diff --cached --binary --no-ext-diff 2>/dev/null || true; "
            "git ls-files --others --exclude-standard -z 2>/dev/null | "
            "while IFS= read -r -d '' f; do "
            "git diff --no-index --binary --no-ext-diff -- /dev/null \"$f\" 2>/dev/null || true; "
            "done; } | redact_grawkus_artifact > .grawkus/benchmark.patch; "
            "git status --short 2>/dev/null | redact_grawkus_artifact > .grawkus/git-status.txt || true; "
            "fi; "
            "if [ -s .grawkus/benchmark.patch ]; then "
            "echo '[grawkus] patch artifact: .grawkus/benchmark.patch'; "
            "fi; "
            "if [ -s .grawkus/benchmark-summary.json ]; then "
            "echo '[grawkus] trace summary: .grawkus/benchmark-summary.json'; "
            "fi; "
            "if [ -s .grawkus/benchmark-trace.jsonl ]; then "
            "echo '[grawkus] tool trace: .grawkus/benchmark-trace.jsonl'; "
            "fi; "
            "if [ -s .grawkus/agent-context-compiled.jsonl ]; then "
            "echo '[grawkus] context compilation: .grawkus/agent-context-compiled.jsonl'; "
            "fi; "
            "if [ -s .grawkus/change-evaluation.json ]; then "
            "echo '[grawkus] change evaluation: .grawkus/change-evaluation.json'; "
            "fi; "
            "if [ -s .grawkus/submission-bundle-manifest.json ]; then "
            "echo '[grawkus] submission bundle: .grawkus/submission-bundle-manifest.json'; "
            "fi; "
            "exit \"$status\""
        )
        command = "bash -lc " + shlex.quote(script)
        return [
            TerminalCommand(
                command=command,
                max_timeout_sec=float("inf"),
                block=True,
            )
        ]
