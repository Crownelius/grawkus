"""Exgentic/Open Agent Leaderboard adapter for Grawkus."""

from __future__ import annotations

import json
import os
import shlex
import subprocess
from pathlib import Path
from typing import Any, ClassVar

from pydantic import Field

from exgentic.core.agent import Agent
from exgentic.core.agent_instance import AgentInstance
from exgentic.core.types import Action, ActionType, Observation
from exgentic.utils.cost import UpdatableCostReport

from .utils import (
    ActionPayload,
    extract_action_payload,
    fallback_exgentic_action_payload,
    fold_exgentic_history,
    json_dumps,
    repair_exgentic_action_payload,
    redact,
    safe_id,
    shortlist_exgentic_actions,
    truncate,
)


class GrawkusAgent(Agent):
    """Host-side Exgentic config for Grawkus."""

    display_name: ClassVar[str] = "Grawkus"
    slug_name: ClassVar[str] = "grawkus_agent"

    model: str = "openrouter/free"
    provider: str | None = None
    command: str = Field(default_factory=lambda: os.environ.get("GRAWKUS_EXGENTIC_COMMAND") or os.environ.get("GRAWKUS_EXGENTIC_COMMAND", "grawkus"))
    permission: str = "yolo"
    max_steps: int = 50
    max_turns: int | None = None
    max_tokens: int | None = None
    context_window_tokens: int | None = None
    temperature: float | None = None
    output_format: str = "text"
    timeout_sec: int = 1800
    memory: bool = False
    workdir: str | None = None
    grawkus_home: str | None = None
    extra_args: list[str] = Field(default_factory=list)
    extra_env: dict[str, str] = Field(default_factory=dict)

    @classmethod
    def _get_instance_class(cls):
        return GrawkusAgentInstance

    @classmethod
    def _get_instance_class_ref(cls) -> str:
        return f"{cls.__module__}:GrawkusAgentInstance"

    @property
    def model_name(self) -> str:  # type: ignore[override]
        return self.model

    def get_models_names(self) -> list[str]:  # type: ignore[override]
        return [self.model]

    def _get_instance_kwargs(self, session_id: str) -> dict[str, Any]:
        return {
            "session_id": session_id,
            "model": self.model,
            "provider": self.provider,
            "command": self.command,
            "permission": self.permission,
            "max_steps": self.max_steps,
            "max_turns": self.max_turns,
            "max_tokens": self.max_tokens,
            "context_window_tokens": self.context_window_tokens,
            "temperature": self.temperature,
            "output_format": self.output_format,
            "timeout_sec": self.timeout_sec,
            "memory": self.memory,
            "workdir": self.workdir,
            "grawkus_home": self.grawkus_home,
            "extra_args": self.extra_args,
            "extra_env": self.extra_env,
        }


class GrawkusAgentInstance(AgentInstance):
    """Per-session Exgentic runtime that asks Grawkus for the next action."""

    def __init__(
        self,
        session_id: str,
        model: str = "openrouter/free",
        provider: str | None = None,
        command: str = "grawkus",
        permission: str = "yolo",
        max_steps: int = 50,
        max_turns: int | None = None,
        max_tokens: int | None = None,
        context_window_tokens: int | None = None,
        temperature: float | None = None,
        output_format: str = "text",
        timeout_sec: int = 1800,
        memory: bool = False,
        workdir: str | None = None,
        grawkus_home: str | None = None,
        extra_args: list[str] | None = None,
        extra_env: dict[str, str] | None = None,
    ) -> None:
        super().__init__(session_id=session_id)
        self.model = model
        self.provider = provider
        self.command = command
        self.permission = permission
        self.max_steps = max_steps
        self.max_turns = max_turns
        self.max_tokens = max_tokens
        self.context_window_tokens = context_window_tokens
        self.temperature = temperature
        self.output_format = output_format
        self.timeout_sec = timeout_sec
        self.memory = memory
        self.workdir = workdir
        self.grawkus_home = grawkus_home
        self.extra_args = list(extra_args or [])
        self.extra_env = dict(extra_env or {})
        self._step = 0
        self._history: list[dict[str, Any]] = []
        self._cost_usd = 0.0

    def react(self, observation: Observation | None) -> Action | None:
        if self._step >= int(self.max_steps or 0):
            return None

        if observation is not None and not _observation_is_empty(observation):
            self._history.append({"role": "observation", "content": _observation_to_data(observation)})

        self._step += 1
        prompt = self._build_prompt()
        run = self._run_grawkus(prompt)
        self._history.append(
            {
                "role": "grawkus",
                "returncode": run["returncode"],
                "stdout": truncate(run["stdout"], limit=16000),
                "stderr": truncate(run["stderr"], limit=8000),
            }
        )

        combined = "\n".join(part for part in [run["stdout"], run["stderr"]] if part)
        payload = extract_action_payload(combined)
        action = self._action_from_payload(payload) if payload is not None else None
        if action is not None:
            self._history.append({"role": "selected_action", "content": _single_action_to_data(action)})
            return action

        fallback = self._fallback_action(combined or "Grawkus produced no output")
        if fallback is not None:
            self._history.append({"role": "selected_action", "content": _single_action_to_data(fallback)})
        return fallback

    def get_cost(self) -> UpdatableCostReport:
        report = UpdatableCostReport.initialize_empty(model_name=self.model)
        if self._cost_usd:
            report.add_cost(self._cost_usd)
        return report

    def close(self) -> None:
        return None

    def _build_prompt(self) -> str:
        action_docs = [_action_type_to_doc(action) for action in getattr(self, "actions", [])]
        context = getattr(self, "context", {}) or {}
        task = getattr(self, "task", "")
        profile = _profile_for_exgentic(task, context, action_docs)
        action_names = [str(doc.get("name", "")) for doc in action_docs if doc.get("name")]
        action_shortlist = shortlist_exgentic_actions(
            action_docs,
            task=task,
            context=context,
            history=self._history,
            profile=profile,
        )
        lines = [
            f"/benchmark {profile} Exgentic task",
            "",
            "You are running inside Exgentic/Open Agent Leaderboard.",
            "Work from the current task, context, latest observation, and the available action schemas.",
            "Choose exactly one available action. Do not invent action names.",
            "Prefer the recommended action shortlist when it matches the latest observation; use the full schemas only when the current state clearly requires another available action.",
            "For shortlisted actions, include every required_argument_key; when available_required_hints lists an exact value from latest observation or context, copy that value into the matching argument.",
            "The benchmark may count malformed JSON, unknown action names, or schema-mismatched arguments as invalid actions.",
            "End your response with one JSON object on its own line using this exact shape:",
            '{"name":"<action name>","arguments":{}}',
            "",
            "If the benchmark exposes environment actions, return the next action to execute.",
            "If the task is complete, use a finish/message action when one is available.",
            _profile_guidance(profile),
            "",
            "## Task",
            truncate(task),
            "",
            "## Context",
            json_dumps(context),
            "",
            "## Recommended action shortlist",
            json_dumps(action_shortlist),
            "",
            "## Available action names",
            json_dumps(action_names),
            "",
            "## Available actions",
            json_dumps(action_docs),
        ]
        if self._history:
            lines.extend(["", "## Folded session state", json_dumps(fold_exgentic_history(self._history, profile=profile), limit=24000)])
        return "\n".join(lines)

    def _run_grawkus(self, prompt: str) -> dict[str, Any]:
        step_dir = self.paths.agent_dir / "grawkus" / f"step-{self._step:03d}"
        trace_dir = step_dir / "trace"
        step_dir.mkdir(parents=True, exist_ok=True)
        trace_dir.mkdir(parents=True, exist_ok=True)
        prompt_path = step_dir / "prompt.txt"
        prompt_path.write_text(prompt, encoding="utf-8")

        args = _split_command(self.command)
        args.extend(["--prompt-file", str(prompt_path), "--perm", self.permission, "--benchmark-trace-dir", str(trace_dir)])
        _append_flag(args, "--model", self.model)
        _append_flag(args, "--provider", self.provider)
        _append_flag(args, "--max-turns", self.max_turns)
        _append_flag(args, "--max-tokens", self.max_tokens)
        _append_flag(args, "--context-window-tokens", self.context_window_tokens)
        _append_flag(args, "--temperature", self.temperature)
        _append_flag(args, "--output-format", self.output_format)
        args.extend(self.extra_args)

        env = os.environ.copy()
        env.update({str(key): str(value) for key, value in self.extra_env.items()})
        env.setdefault("GRAWKUS_ENV_CONFIG", "1")
        env.setdefault("GRAWKUS_THEME", "minimal")
        env.setdefault("GRAWKUS_SHOW_THINKING", "0")
        env.setdefault("GRAWKUS_BASH_TIMEOUT_MS", "300000")
        env["GRAWKUS_MEMORY"] = "1" if self.memory else "0"
        if self.grawkus_home:
            env["GRAWKUS_HOME"] = self.grawkus_home

        cwd = self._resolve_workdir()
        try:
            completed = subprocess.run(
                args,
                cwd=str(cwd),
                env=env,
                text=True,
                capture_output=True,
                timeout=self.timeout_sec,
                check=False,
            )
            stdout = redact(completed.stdout)
            stderr = redact(completed.stderr)
            returncode = completed.returncode
        except subprocess.TimeoutExpired as exc:
            stdout = redact(exc.stdout)
            stderr = redact(exc.stderr) + f"\ngrawkus timed out after {self.timeout_sec}s"
            returncode = 124
        except Exception as exc:
            stdout = ""
            stderr = f"grawkus launch failed: {redact(exc)}"
            returncode = 127

        (step_dir / "argv.json").write_text(
            json.dumps([redact(arg) for arg in args], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (step_dir / "stdout.txt").write_text(stdout, encoding="utf-8")
        (step_dir / "stderr.txt").write_text(stderr, encoding="utf-8")
        self._load_cost(trace_dir)
        return {"returncode": returncode, "stdout": stdout, "stderr": stderr, "trace_dir": str(trace_dir)}

    def _load_cost(self, trace_dir: Path) -> None:
        summaries = sorted(trace_dir.rglob("summary.json"), key=lambda item: item.stat().st_mtime)
        if not summaries:
            return
        try:
            summary = json.loads(summaries[-1].read_text(encoding="utf-8"))
        except Exception:
            return
        usage = summary.get("usage") if isinstance(summary, dict) else None
        if not isinstance(usage, dict):
            return
        try:
            self._cost_usd += float(usage.get("estimatedCostUsd") or 0.0)
        except Exception:
            return

    def _resolve_workdir(self) -> Path:
        if self.workdir:
            return Path(self.workdir).expanduser()
        context = getattr(self, "context", {}) or {}
        for key in ("workdir", "working_dir", "workspace", "repo_path", "cwd"):
            value = context.get(key)
            if isinstance(value, str) and value.strip():
                return Path(value).expanduser()
        return Path.cwd()

    def _action_from_payload(self, payload: ActionPayload) -> Action | None:
        actions = list(getattr(self, "actions", []) or [])
        action_docs = [_action_type_to_doc(action) for action in actions]
        repair = repair_exgentic_action_payload(
            payload,
            action_docs,
            argument_hints={
                "latest_observation": self._latest_observation_data(),
                "context": getattr(self, "context", {}) or {},
            },
        )
        if repair.diagnostics.get("status") != "unchanged":
            self._history.append({"role": "action_repair", "content": repair.diagnostics})

        repaired_payload = repair.payload
        action_type = _find_action_type(actions, repaired_payload.name)
        if action_type is None:
            return None
        args = _normalize_arguments(action_type, repaired_payload.arguments, fallback_text=json_dumps(repaired_payload.arguments))
        try:
            return action_type.build_action(args)
        except Exception as exc:
            self._history.append(
                {
                    "role": "action_repair",
                    "content": {
                        "status": "build_failed",
                        "action": repaired_payload.name,
                        "error": truncate(exc, limit=1200),
                    },
                }
            )
            return None

    def _fallback_action(self, text: str) -> Action | None:
        actions = list(getattr(self, "actions", []) or [])
        if not actions:
            return None
        action_docs = [_action_type_to_doc(action) for action in actions]
        profile = _profile_for_exgentic(getattr(self, "task", ""), getattr(self, "context", {}) or {}, action_docs)
        fallback = fallback_exgentic_action_payload(
            action_docs,
            task=getattr(self, "task", ""),
            context=getattr(self, "context", {}) or {},
            history=self._history,
            profile=profile,
            reason="no_valid_action_json",
        )
        if fallback is not None:
            self._history.append({"role": "action_repair", "content": fallback.diagnostics})
            action = self._action_from_payload(fallback.payload)
            if action is not None:
                return action

        preferred = _first_matching_action(actions, lambda action: bool(getattr(action, "is_finish", False)))
        if preferred is None:
            preferred = _first_matching_action(actions, lambda action: bool(getattr(action, "is_message", False)))
        if preferred is None:
            preferred = _first_matching_action(actions, lambda action: action.name.lower() in {"finish", "final", "done"})
        if preferred is None and len(actions) == 1:
            preferred = actions[0]
        if preferred is None:
            return None
        args = _normalize_arguments(preferred, {}, fallback_text=truncate(text, limit=20000))
        try:
            return preferred.build_action(args)
        except Exception:
            return None

    def _latest_observation_data(self) -> Any:
        for item in reversed(self._history):
            if isinstance(item, dict) and item.get("role") == "observation":
                return item.get("content")
        return None


def _split_command(command: str) -> list[str]:
    parts = shlex.split(command, posix=os.name != "nt")
    return parts or ["grawkus"]


def _append_flag(args: list[str], flag: str, value: Any) -> None:
    if value is None:
        return
    text = str(value).strip()
    if not text:
        return
    args.extend([flag, text])


def _action_type_to_doc(action: ActionType) -> dict[str, Any]:
    args_type = getattr(action, "arguments", None)
    schema: Any = None
    if args_type is not None:
        try:
            schema = args_type.model_json_schema()
        except Exception:
            schema = str(args_type)
    return {
        "name": action.name,
        "description": getattr(action, "description", ""),
        "is_finish": bool(getattr(action, "is_finish", False)),
        "is_message": bool(getattr(action, "is_message", False)),
        "arguments_schema": schema,
    }


def _profile_for_exgentic(task: Any, context: Any, action_docs: list[dict[str, Any]]) -> str:
    text = " ".join(
        [
            str(task or ""),
            json.dumps(context or {}, ensure_ascii=False, default=str),
            json.dumps(action_docs or [], ensure_ascii=False, default=str),
        ]
    ).lower()
    if any(token in text for token in ("appworld", "app-world", "app world")):
        return "appworld"
    if any(token in text for token in ("browsecomp", "browsecomp+", "browse-comp", "deep research", "web research")):
        return "browsecomp"
    if any(token in text for token in ("tau2", "tau 2", "tau-bench", "tau_bench", "taubench", "customer support", "customer-service")):
        return "tau2"
    if any(token in text for token in ("terminalworld", "terminal-world", "tw_", "asciinema")) or (
        "instruction.md" in text and "solve.sh" in text
    ):
        return "terminalworld"
    if any(token in text for token in ("swe-bench mobile", "xcode", "swift", "objective-c", "simulator", "figma")):
        return "swe-bench-mobile"
    if any(token in text for token in ("swe-webdevbench", "swe-webdev-bench", "webdevbench", "webdev-bench", "vibe coding", "virtual software agency", "canary requirement", "frontend-backend", "production readiness")):
        return "webdevbench"
    if any(token in text for token in ("swe-cycle", "swecycle", "swe cycle", "swe-judge", "swejudge", "fullcycle", "codeimpl", "testgen", "run_script", "parsing_script", "selected_test_files_to_run", "environment_setup_commit", "before_repo_set_cmd", "bare repository")):
        return "swe-cycle"
    if any(token in text for token in ("swe-ci", "sweci", "swe ci", "run_tests", "define_requirements", "modify_code", "test gap", "current_sha", "target_sha", "ci-loop", "continuous integration loop")):
        return "swe-ci"
    if any(token in text for token in ("swe-prbench", "swe prbench", "swe-pr", "prbench", "pull request review", "code review quality", "human_review_comments", "diff_patch", "type2_contextual")):
        return "swe-prbench"
    if any(token in text for token in ("tml-bench", "tmlbench", "tabular ml", "kaggle-style", "kaggle style", "sample_submission", "private holdout", "train.csv", "test.csv")):
        return "tml-bench"
    if any(token in text for token in ("pi-bench", "pibench", "proactive personal assistant", "proactive assistant", "hidden intent", "latent intent", "user profile", "message history", "current app", "proactivity score", "completion score")):
        return "pi-bench"
    if any(token in text for token in ("saasbench", "saas-bench", "enterprise saas", "tenant", "migration")):
        return "saasbench"
    if any(token in text for token in ("roadmapbench", "roadmap-bench", "long-horizon", "version upgrade")):
        return "roadmapbench"
    if any(token in text for token in ("arc-agi", "arc prize", "kaggle arc")):
        return "arc-agi"
    return "generic"


def _profile_guidance(profile: str) -> str:
    if profile == "appworld":
        return "AppWorld discipline: track app/API state from observations, preserve record IDs and permissions, and finish only after the requested state change is confirmed."
    if profile == "browsecomp":
        return "BrowseComp+ discipline: decompose the research question, prefer primary/high-authority sources, cross-check facts, and include auditable source attribution in finish/message arguments."
    if profile == "tau2":
        return "tau2 discipline: read policy/context first, take only policy-supported tool actions, and confirm observations before promising customer outcomes."
    if profile == "terminalworld":
        return "TerminalWorld discipline: extract required artifacts from instruction.md/task text, avoid solve.sh/reference material, execute real CLI steps, and verify persistent files/services before finishing."
    if profile == "swe-bench-mobile":
        return "Mobile discipline: respect PRD/design/platform constraints and prefer platform validation evidence when the harness exposes it."
    if profile == "webdevbench":
        return "WebDevBench discipline: preserve canary business requirements, verify frontend-backend coupling, and seek production/security evidence before completion."
    if profile == "swe-cycle":
        return "SWE-Cycle discipline: carry lifecycle phase, environment setup state, implementation requirements, generated/selected tests, and static/dynamic judge evidence through each action."
    if profile == "swe-ci":
        return "SWE-CI discipline: carry current/target commits, test gaps, inferred requirements, code changes, and CI-loop validation deltas through each action."
    if profile == "swe-prbench":
        return "SWE-PRBench discipline: review diff first, expand only to evidence-needed context, and produce severity-rated findings with file/line evidence rather than patching unless explicitly requested."
    if profile == "tml-bench":
        return "TML-Bench discipline: establish data contract, avoid hidden-label leakage, validate an honest baseline, and produce a schema-valid submission artifact."
    if profile == "pi-bench":
        return "Pi-Bench discipline: build the user/workspace/app context contract, infer hidden intent with evidence, ask only necessary clarifying questions, and verify state after proactive actions."
    if profile == "saasbench":
        return "SaaS discipline: preserve tenant, auth, migration, and cross-component workflow integrity."
    if profile == "roadmapbench":
        return "Roadmap discipline: keep milestones explicit and avoid claiming completion while roadmap items remain unverified."
    if profile == "arc-agi":
        return "ARC discipline: infer environment dynamics with small experiments and avoid hardcoding hidden answers."
    return "Generic discipline: use the available actions exactly, observe after state-changing actions, and finish only with benchmark-visible evidence."


def _find_action_type(actions: list[ActionType], name: str) -> ActionType | None:
    for action in actions:
        if action.name == name:
            return action
    lowered = name.lower()
    for action in actions:
        if action.name.lower() == lowered:
            return action
    return None


def _first_matching_action(actions: list[ActionType], predicate: Any) -> ActionType | None:
    for action in actions:
        if predicate(action):
            return action
    return None


def _normalize_arguments(action: ActionType, provided: dict[str, Any], fallback_text: str) -> dict[str, Any]:
    args = dict(provided or {})
    fields = _argument_fields(action)
    if not fields:
        return args
    if any(key in args for key in fields):
        return args

    for key in ("answer", "final_answer", "response", "content", "message", "text", "result", "output"):
        if key in fields:
            args[key] = fallback_text
            return args

    for key, field in fields.items():
        if _field_required(field):
            args[key] = _fallback_value_for_field(field, fallback_text)
            return args
    return args


def _argument_fields(action: ActionType) -> dict[str, Any]:
    args_type = getattr(action, "arguments", None)
    return dict(getattr(args_type, "model_fields", {}) or getattr(args_type, "__fields__", {}) or {})


def _field_required(field: Any) -> bool:
    method = getattr(field, "is_required", None)
    if callable(method):
        return bool(method())
    return bool(getattr(field, "required", False))


def _fallback_value_for_field(field: Any, text: str) -> Any:
    annotation = getattr(field, "annotation", None) or getattr(field, "type_", None)
    if annotation is bool:
        return False
    if annotation is int:
        return 0
    if annotation is float:
        return 0.0
    if annotation is list:
        return []
    if annotation is dict:
        return {}
    return text


def _observation_is_empty(observation: Observation) -> bool:
    try:
        return bool(observation.is_empty())
    except Exception:
        return False


def _observation_to_data(observation: Observation) -> Any:
    try:
        items = observation.to_observation_list()
    except Exception:
        return str(observation)
    data: list[Any] = []
    for item in items:
        result = getattr(item, "result", item)
        data.append(result)
    return data


def _single_action_to_data(action: Action) -> Any:
    try:
        values = []
        for item in action.to_action_list():
            args = getattr(item, "arguments", {})
            if hasattr(args, "model_dump"):
                args = args.model_dump()
            values.append({"name": getattr(item, "name", ""), "arguments": args, "id": getattr(item, "id", "")})
        return values
    except Exception:
        return {"id": safe_id(str(action)), "text": str(action)}


class GrawkusAgentInstance(GrawkusAgentInstance):
    """Preferred Exgentic runtime class name for Grawkus."""


class GrawkusAgent(GrawkusAgent):
    """Preferred Exgentic host class name for Grawkus."""

    display_name: ClassVar[str] = "Grawkus"
    slug_name: ClassVar[str] = "grawkus_agent"

    @classmethod
    def _get_instance_class(cls):
        return GrawkusAgentInstance

    @classmethod
    def _get_instance_class_ref(cls) -> str:
        return f"{cls.__module__}:GrawkusAgentInstance"
