"""HAL custom-agent adapter for Grawkus.

HAL expects a module-level run(input, **kwargs) function. This adapter keeps
Grawkus framework-agnostic by launching the installed CLI in headless
benchmark mode, then returning the artifact shape expected by common HAL tasks.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SECRET_REPLACEMENTS = [
    (re.compile(r"sk-or-v1-[A-Za-z0-9_-]+"), "sk-or-v1-[REDACTED]"),
    (re.compile(r"sk-[A-Za-z0-9_-]{16,}"), "sk-[REDACTED]"),
    (re.compile(r"hf_[A-Za-z0-9]{16,}"), "hf_[REDACTED]"),
    (re.compile(r"KGAT_[A-Za-z0-9]{16,}"), "KGAT_[REDACTED]"),
    (re.compile(r"npm_[A-Za-z0-9]{16,}"), "npm_[REDACTED]"),
]

ORACLE_FIELD_RE = re.compile(
    r"(^|_)(patch|test_patch|solution|answer|gold|fail_to_pass|pass_to_pass)($|_)",
    re.IGNORECASE,
)

SAFE_FIELD_ORDER = [
    "instance_id",
    "task_id",
    "repo",
    "base_commit",
    "version",
    "created_at",
    "problem_statement",
    "hints_text",
    "description",
    "description_no_samples",
    "samples",
    "num_tests",
    "num_samples",
    "problem_link",
    "problem_level",
    "cp_id",
    "problem_id",
    "runtime_limit",
    "memory_limit",
    "runtime_limit_sentences",
    "memory_limit_sentences",
    "task_inst",
    "dataset_path",
    "dataset_folder_tree",
    "dataset_preview",
    "output_fname",
    "domain_knowledge",
]


@dataclass
class AgentRun:
    returncode: int
    stdout: str
    stderr: str
    trace_dir: Path


def _redact(text: Any) -> str:
    value = str(text or "")
    for pattern, replacement in SECRET_REPLACEMENTS:
        value = pattern.sub(replacement, value)
    return value


def _truncate(text: str, limit: int = 50000) -> str:
    clean = _redact(text)
    if len(clean) <= limit:
        return clean
    omitted = len(clean) - limit
    return clean[:limit] + f"\n...[truncated {omitted} chars]"


def _safe_task_id(task_id: Any) -> str:
    raw = str(task_id or "task")
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", raw).strip("-")
    return safe or "task"


def _include_oracle_fields() -> bool:
    return os.environ.get("GRAWKUS_HAL_INCLUDE_ORACLE_FIELDS", "").lower() in {"1", "true", "yes", "on"}


def _safe_task_view(task: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    if _include_oracle_fields():
        return task, []

    allowed: dict[str, Any] = {}
    omitted: list[str] = []
    ordered_keys = [key for key in SAFE_FIELD_ORDER if key in task]
    ordered_keys.extend(sorted(key for key in task if key not in ordered_keys))
    for key in ordered_keys:
        if ORACLE_FIELD_RE.search(key):
            omitted.append(key)
            continue
        allowed[key] = task[key]
    return allowed, omitted


def _is_patch_task(task: dict[str, Any]) -> bool:
    return bool(
        task.get("problem_statement")
        and (task.get("repo") or task.get("base_commit") or task.get("instance_id"))
    )


def _is_science_agent_task(task: dict[str, Any]) -> bool:
    return bool(
        task.get("task_inst")
        and (task.get("dataset_path") or task.get("output_fname") or task.get("dataset_folder_tree"))
    )


def _is_appworld_task(task: dict[str, Any]) -> bool:
    keys = set(task.keys())
    return bool(task.get("task_id") and keys.issubset({"task_id", "instance_id"}))


def _is_usaco_task(task: dict[str, Any]) -> bool:
    return bool(
        task.get("description")
        and (task.get("samples") or task.get("cp_id") or task.get("problem_id") or task.get("problem_link"))
    )


def _profile_for_task(task: dict[str, Any]) -> str:
    task_text = json.dumps(task, ensure_ascii=False).lower()
    if _is_appworld_task(task) or "appworld" in task_text or "app-world" in task_text:
        return "appworld"
    if (
        "browsecomp" in task_text
        or "browsecomp+" in task_text
        or "browse-comp" in task_text
        or "deep research" in task_text
        or "web research" in task_text
    ):
        return "browsecomp"
    if (
        "tau2" in task_text
        or "tau 2" in task_text
        or "tau-bench" in task_text
        or "tau_bench" in task_text
        or "taubench" in task_text
        or "customer support" in task_text
    ):
        return "tau2"
    if (
        "roadmapbench" in task_text
        or "roadmap-bench" in task_text
        or "long-horizon" in task_text
        or "long horizon" in task_text
        or "version upgrade" in task_text
        or "multi-target" in task_text
    ):
        return "roadmapbench"
    if (
        "swe-cycle" in task_text
        or "swecycle" in task_text
        or "swe cycle" in task_text
        or "swe-judge" in task_text
        or "swejudge" in task_text
        or "fullcycle" in task_text
        or "codeimpl" in task_text
        or "testgen" in task_text
        or "run_script" in task_text
        or "parsing_script" in task_text
        or "selected_test_files_to_run" in task_text
        or "environment_setup_commit" in task_text
        or "before_repo_set_cmd" in task_text
        or "bare repository" in task_text
    ):
        return "swe-cycle"
    if (
        "swe-ci" in task_text
        or "sweci" in task_text
        or "swe ci" in task_text
        or "run_tests" in task_text
        or "define_requirements" in task_text
        or "modify_code" in task_text
        or "test gap" in task_text
        or "current_sha" in task_text
        or "target_sha" in task_text
        or ("codebase maintenance" in task_text and "continuous integration" in task_text)
    ):
        return "swe-ci"
    if (
        "swe-prbench" in task_text
        or "swe prbench" in task_text
        or "swe-pr" in task_text
        or "prbench" in task_text
        or "pull request review" in task_text
        or "code review quality" in task_text
        or "human_review_comments" in task_text
        or "diff_patch" in task_text
        or "type2_contextual" in task_text
    ):
        return "swe-prbench"
    if (
        "tml-bench" in task_text
        or "tmlbench" in task_text
        or "tabular ml" in task_text
        or "kaggle-style" in task_text
        or "kaggle style" in task_text
        or "sample_submission" in task_text
        or "private holdout" in task_text
        or ("train.csv" in task_text and "test.csv" in task_text and "submission" in task_text)
    ):
        return "tml-bench"
    if (
        "pi-bench" in task_text
        or "pibench" in task_text
        or "proactive personal assistant" in task_text
        or "proactive assistant" in task_text
        or "hidden intent" in task_text
        or "latent intent" in task_text
        or "user profile" in task_text
        or "message history" in task_text
        or "current app" in task_text
        or "proactivity score" in task_text
        or "completion score" in task_text
    ):
        return "pi-bench"
    if (
        "saasbench" in task_text
        or "saas-bench" in task_text
        or "enterprise saas" in task_text
        or "validation nodes" in task_text
        or "tenant" in task_text
        or "migration" in task_text
    ):
        return "saasbench"
    if (
        "swe-bench mobile" in task_text
        or "swebench mobile" in task_text
        or "xcode" in task_text
        or "swift" in task_text
        or "objective-c" in task_text
        or "figma" in task_text
        or "simulator" in task_text
    ):
        return "swe-bench-mobile"
    if (
        "swe-webdevbench" in task_text
        or "swe-webdev-bench" in task_text
        or "webdevbench" in task_text
        or "webdev-bench" in task_text
        or "vibe coding" in task_text
        or "virtual software agency" in task_text
        or "canary requirement" in task_text
        or "frontend-backend" in task_text
        or "production readiness" in task_text
    ):
        return "webdevbench"
    if _is_patch_task(task):
        return "swe-bench"
    if (
        "terminalworld" in task_text
        or "terminal-world" in task_text
        or "tw_" in task_text
        or "asciinema" in task_text
    ):
        return "terminalworld"
    if "terminal-bench" in task_text or "terminalbench" in task_text:
        return "terminal-bench"
    if (
        "wildclaw" in task_text
        or "openclaw" in task_text
        or "browsecomp" in task_text
        or "ossworld" in task_text
        or "bfcl" in task_text
        or "webwalkerqa" in task_text
    ):
        return "wildclaw"
    if (
        "arc-agi" in task_text
        or "arc_agi" in task_text
        or "arc prize" in task_text
        or "arc-prize" in task_text
        or "kaggle arc" in task_text
    ):
        return "arc-agi"
    if (
        "specbench" in task_text
        or "spec-bench" in task_text
        or "spec compliance" in task_text
        or "visible tests" in task_text
        or "held-out" in task_text
        or "holdout" in task_text
    ):
        return "specbench"
    if (
        "reward hacking benchmark" in task_text
        or "reward-hacking" in task_text
        or "reward_hacking" in task_text
        or "rhb" in task_text
        or "evaluator tamper" in task_text
    ):
        return "reward-hacking"
    return "generic"


def _build_prompt(task_id: str, task: dict[str, Any]) -> str:
    profile = _profile_for_task(task)
    safe_task, omitted = _safe_task_view(task)
    body = json.dumps(safe_task, ensure_ascii=False, indent=2, sort_keys=True)

    lines = [
        f"/benchmark {profile} HAL task {task_id}",
        "",
        "You are running inside the Holistic Agent Leaderboard harness.",
        "Use Grawkus benchmark discipline: inspect local files, patch only what is needed, run targeted verification, and preserve trace evidence.",
    ]
    if profile == "swe-bench":
        lines.extend([
            "This is a SWE-bench-style patch task. Modify the checked-out repository; the HAL adapter will collect the git patch after the run.",
            "Do not edit tests or harness files unless the task explicitly asks for that.",
        ])
    elif profile == "terminalworld":
        lines.append("This is a TerminalWorld-style terminal workflow. Treat instruction.md/task text as the contract, avoid solve.sh/reference material, produce required persistent artifacts, and verify files/services in the environment.")
    elif _is_science_agent_task(task):
        lines.append("This is a ScienceAgentBench-style task. Produce a concise solution trajectory and any required output/program artifact in the final response.")
    elif profile == "appworld" or _is_appworld_task(task):
        lines.append("This is an AppWorld-style environment task. Interact with the environment as needed, then complete the task through the environment API.")
    elif profile == "browsecomp":
        lines.append("This is a BrowseComp+-style research task. Use source-grounded browsing/retrieval evidence, cross-check claims, and return the answer with auditable attribution.")
    elif profile == "tau2":
        lines.append("This is a tau2/Tau-Bench-style policy workflow. Follow the domain policy, use only available action schemas, and verify tool observations before completing.")
    elif profile == "webdevbench":
        lines.append("This is a SWE-WebDevBench-style full-stack app-agency task. Preserve canary business requirements, verify frontend-backend coupling, and collect production/security evidence when feasible.")
    elif profile == "swe-cycle":
        lines.append("This is a SWE-Cycle/SWE-Judge-style issue-resolution lifecycle task. Track environment setup, code implementation, verification-test generation when required, and post-edit static/dynamic judge evidence.")
    elif profile == "swe-ci":
        lines.append("This is a SWE-CI-style repository evolution task. Track current/target commits, test gaps, requirement derivation, and CI-loop validation across run_tests -> define_requirements -> modify_code.")
    elif profile == "swe-prbench":
        lines.append("This is a SWE-PRBench-style pull request review task. Inspect PR metadata and diff first, expand context only for concrete suspected issues, and return severity-rated review findings with file/line evidence instead of patching unless explicitly requested.")
    elif profile == "tml-bench":
        lines.append("This is a TML-Bench/Kaggle-style tabular ML task. Build the data contract first, avoid hidden-label leakage, train an honest baseline, and produce a sample_submission-compatible artifact with validation evidence.")
    elif profile == "pi-bench":
        lines.append("This is a Pi-Bench-style proactive personal assistant task. Build the user/workspace/app context contract, infer hidden intents carefully, ask one focused clarification when needed, and verify observable state after proactive actions.")
    elif _is_usaco_task(task):
        lines.append("This is a USACO-style programming task. Produce the final code solution in the final response.")
    else:
        lines.append("Return the final task response clearly; the HAL adapter will store it in the task response field.")

    if omitted:
        lines.append("Oracle-like task fields omitted from the prompt by default: " + ", ".join(sorted(omitted)) + ".")

    lines.extend(["", "## HAL task data", _truncate(body)])
    return "\n".join(lines)


def _base_command() -> list[str]:
    command = os.environ.get("GRAWKUS_HAL_COMMAND") or os.environ.get("GRAWKUS_HAL_COMMAND", "grawkus")
    parts = shlex.split(command, posix=os.name != "nt")
    return parts or ["grawkus"]


def _append_flag(args: list[str], flag: str, value: Any) -> None:
    if value is None:
        return
    text = str(value).strip()
    if not text:
        return
    args.extend([flag, text])


def _run_grawkus(task_id: str, prompt: str, kwargs: dict[str, Any]) -> AgentRun:
    trace_root = Path(os.environ.get("GRAWKUS_HAL_TRACE_DIR", ".grawkus/hal-trace"))
    trace_dir = trace_root / _safe_task_id(task_id)
    trace_dir.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env.setdefault("GRAWKUS_ENV_CONFIG", "1")
    env.setdefault("GRAWKUS_THEME", "minimal")
    env.setdefault("GRAWKUS_SHOW_THINKING", "0")
    env.setdefault("GRAWKUS_MEMORY", "0")
    env.setdefault("GRAWKUS_BASH_TIMEOUT_MS", "300000")

    args = _base_command()
    args.extend([
        "--prompt",
        prompt,
        "--perm",
        "yolo",
        "--benchmark-trace-dir",
        str(trace_dir),
    ])
    _append_flag(args, "--model", kwargs.get("model_name") or kwargs.get("model"))
    _append_flag(args, "--provider", kwargs.get("provider"))
    _append_flag(args, "--max-turns", kwargs.get("max_turns"))
    _append_flag(args, "--max-tokens", kwargs.get("max_tokens"))
    _append_flag(args, "--temperature", kwargs.get("temperature"))
    _append_flag(args, "--output-format", kwargs.get("output_format"))

    timeout = int(os.environ.get("GRAWKUS_HAL_TIMEOUT_SEC", "1800"))
    try:
        completed = subprocess.run(
            args,
            cwd=os.getcwd(),
            env=env,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
        stdout = _redact(completed.stdout)
        stderr = _redact(completed.stderr)
        returncode = completed.returncode
    except subprocess.TimeoutExpired as exc:
        stdout = _redact(exc.stdout)
        stderr = _redact(exc.stderr) + f"\nGrawkus timed out after {timeout}s"
        returncode = 124

    (trace_dir / "hal-stdout.txt").write_text(stdout, encoding="utf-8")
    (trace_dir / "hal-stderr.txt").write_text(stderr, encoding="utf-8")
    return AgentRun(returncode=returncode, stdout=stdout, stderr=stderr, trace_dir=trace_dir)


def _run_git(args: list[str], cwd: Path | None = None) -> str:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=str(cwd) if cwd else None,
            text=True,
            capture_output=True,
            check=False,
            timeout=60,
        )
    except Exception:
        return ""
    if completed.returncode not in {0, 1}:
        return ""
    return _redact(completed.stdout)


def _latest_trace_patch(trace_dir: Path) -> str:
    patches = sorted(
        trace_dir.rglob("worktree.patch"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for patch in patches:
        try:
            text = _redact(patch.read_text(encoding="utf-8", errors="replace"))
            if text.strip():
                return text
        except OSError:
            continue
    return ""


def _collect_git_patch(trace_dir: Path) -> str:
    trace_patch = _latest_trace_patch(trace_dir)
    if trace_patch:
        return trace_patch

    parts = [
        _run_git(["diff", "--binary", "--no-ext-diff"]),
        _run_git(["diff", "--cached", "--binary", "--no-ext-diff"]),
    ]
    if os.name != "nt":
        raw_untracked = _run_git(["ls-files", "--others", "--exclude-standard", "-z"])
        for filename in raw_untracked.split("\0"):
            if filename:
                parts.append(_run_git(["diff", "--no-index", "--binary", "--no-ext-diff", "--", "/dev/null", filename]))
    return "".join(part for part in parts if part)


def _latest_summary(trace_dir: Path) -> dict[str, Any]:
    summaries = sorted(
        trace_dir.rglob("summary.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for summary in summaries:
        try:
            return json.loads(summary.read_text(encoding="utf-8"))
        except Exception:
            continue
    return {}


def _response_text(run_result: AgentRun) -> str:
    summary = _latest_summary(run_result.trace_dir)
    final = summary.get("finalAssistant")
    if isinstance(final, str) and final.strip():
        return _truncate(final, 20000)
    combined = "\n".join(part for part in [run_result.stdout, run_result.stderr] if part)
    return _truncate(combined, 20000)


def _submission_for_task(task: dict[str, Any], run_result: AgentRun) -> Any:
    response = _response_text(run_result)
    if _is_science_agent_task(task):
        return response
    if _is_appworld_task(task):
        return "Completed" if run_result.returncode == 0 else response

    updated = dict(task)
    updated["response"] = response
    return updated


def run(input: dict[str, dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
    """Run Grawkus for HAL.

    Patch-style tasks return {task_id: patch}. ScienceAgentBench-style tasks
    return a trajectory string. AppWorld-style tasks return "Completed" after
    a successful run. Other text/code tasks return the original task dict with
    a response field, matching HAL's USACO-style pattern.
    """
    if not isinstance(input, dict):
        raise TypeError("Grawkus HAL adapter expects input to be a dictionary")

    patch_task_ids = [
        str(task_id)
        for task_id, task in input.items()
        if isinstance(task, dict) and _is_patch_task(task)
    ]
    if len(patch_task_ids) > 1:
        raise ValueError("Grawkus HAL adapter expects one patch-style task per checked-out worktree")

    output: dict[str, Any] = {}
    for task_id, task in input.items():
        if not isinstance(task, dict):
            output[str(task_id)] = task
            continue

        prompt = _build_prompt(str(task_id), task)
        run_result = _run_grawkus(str(task_id), prompt, kwargs)

        if _is_patch_task(task):
            output[str(task_id)] = _collect_git_patch(run_result.trace_dir)
        else:
            output[str(task_id)] = _submission_for_task(task, run_result)

    return output
