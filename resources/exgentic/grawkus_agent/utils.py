"""Stdlib helpers for the grawkus Exgentic adapter."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any


SECRET_REPLACEMENTS = [
    (re.compile(r"sk-or-v1-[A-Za-z0-9_-]+"), "sk-or-v1-[REDACTED]"),
    (re.compile(r"sk-[A-Za-z0-9_-]{16,}"), "sk-[REDACTED]"),
    (re.compile(r"hf_[A-Za-z0-9]{16,}"), "hf_[REDACTED]"),
    (re.compile(r"KGAT_[A-Za-z0-9]{16,}"), "KGAT_[REDACTED]"),
    (re.compile(r"npm_[A-Za-z0-9]{16,}"), "npm_[REDACTED]"),
]

STOPWORDS = {
    "about",
    "after",
    "again",
    "also",
    "and",
    "any",
    "are",
    "available",
    "been",
    "before",
    "being",
    "can",
    "context",
    "could",
    "current",
    "does",
    "for",
    "from",
    "has",
    "have",
    "into",
    "latest",
    "need",
    "needs",
    "not",
    "observation",
    "only",
    "requested",
    "should",
    "task",
    "that",
    "the",
    "then",
    "this",
    "use",
    "user",
    "with",
    "you",
}


@dataclass(frozen=True)
class ActionPayload:
    """Machine-readable action selected by grawkus."""

    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ActionRepairResult:
    """Deterministic repair result for benchmark action JSON."""

    payload: ActionPayload
    changed: bool
    diagnostics: dict[str, Any]


def redact(value: Any) -> str:
    text = str(value or "")
    for pattern, replacement in SECRET_REPLACEMENTS:
        text = pattern.sub(replacement, text)
    return text


def truncate(value: Any, limit: int = 80000) -> str:
    text = redact(value)
    if len(text) <= limit:
        return text
    omitted = len(text) - limit
    return text[:limit] + f"\n...[truncated {omitted} chars]"


def json_dumps(value: Any, *, limit: int = 80000) -> str:
    try:
        text = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, default=str)
    except Exception:
        text = str(value)
    return truncate(text, limit=limit)


def fold_exgentic_history(
    history: list[dict[str, Any]],
    *,
    profile: str = "generic",
    max_items: int = 16,
    item_limit: int = 1200,
) -> dict[str, Any]:
    """Build a compact task-relevant ledger for long Exgentic sessions.

    The adapter keeps the full raw history in memory. This folded view is what
    goes back into the next model call, so noisy stdout does not crowd out the
    latest app state, policy evidence, source evidence, or selected actions.
    """

    observations: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []
    action_counts: dict[str, int] = {}

    for idx, item in enumerate(history or [], start=1):
        role = str(item.get("role", ""))
        if role == "observation":
            observations.append(
                {
                    "turn": idx,
                    "summary": truncate(json_dumps(item.get("content"), limit=item_limit), limit=item_limit),
                }
            )
        elif role == "selected_action":
            compact_actions = _compact_selected_actions(item.get("content"), item_limit=item_limit)
            for action in compact_actions:
                name = action.get("name") or "unknown"
                action_counts[name] = action_counts.get(name, 0) + 1
            actions.append({"turn": idx, "actions": compact_actions})
        elif role == "grawkus":
            diagnostic = _compact_grawkus_diagnostic(item, item_limit=item_limit)
            if diagnostic is not None:
                diagnostics.append({"turn": idx, **diagnostic})
        elif role == "action_repair":
            diagnostics.append(
                {
                    "turn": idx,
                    "kind": "action_repair",
                    "evidence": truncate(json_dumps(item.get("content"), limit=item_limit), limit=item_limit),
                }
            )

    latest_observation = observations[-1] if observations else None
    latest_action = actions[-1] if actions else None
    return {
        "format": "grawkus-exgentic-folded-history-v1",
        "profile": profile,
        "turns_seen": len(history or []),
        "latest_observation": latest_observation,
        "latest_action": latest_action,
        "no_effect_repeat_actions": _recent_no_effect_action_names(history or []),
        "recent_observations": observations[-max_items:],
        "recent_actions": actions[-max_items:],
        "diagnostics": diagnostics[-max_items:],
        "action_counts": action_counts,
        "discipline": _folding_discipline(profile),
    }


def repair_exgentic_action_payload(
    payload: ActionPayload,
    action_docs: list[dict[str, Any]],
    *,
    argument_hints: Any = None,
) -> ActionRepairResult:
    """Repair near-miss action names and argument keys before ActionType build.

    This is intentionally deterministic and conservative. It fixes common model
    output drift such as camelCase action names, case-only mismatches, and
    schema-key casing/separator mistakes, while leaving unresolved names intact
    so the caller can still fail or fallback explicitly.
    """

    docs = [doc for doc in action_docs or [] if isinstance(doc, dict) and doc.get("name")]
    matched_doc, match_reason, match_score = _resolve_action_doc(payload.name, docs)
    repaired_name = str(matched_doc.get("name")) if matched_doc else payload.name
    repaired_args, arg_diagnostics = _repair_action_arguments(
        payload.arguments,
        matched_doc.get("arguments_schema") if matched_doc else None,
        argument_hints=argument_hints,
    )

    changed = repaired_name != payload.name or repaired_args != payload.arguments
    if matched_doc is None:
        status = "unresolved_action_name"
    elif changed:
        status = "repaired"
    else:
        status = "unchanged"

    diagnostics = {
        "status": status,
        "original_name": payload.name,
        "repaired_name": repaired_name,
        "name_match_reason": match_reason,
        "name_match_score": round(match_score, 3),
        **arg_diagnostics,
    }
    return ActionRepairResult(
        payload=ActionPayload(name=repaired_name, arguments=repaired_args),
        changed=changed,
        diagnostics=diagnostics,
    )


def fallback_exgentic_action_payload(
    action_docs: list[dict[str, Any]],
    *,
    task: Any = None,
    context: Any = None,
    history: list[dict[str, Any]] | None = None,
    profile: str = "generic",
    reason: str = "no_valid_action_json",
) -> ActionRepairResult | None:
    """Select a conservative fallback action when the model emits no valid JSON.

    The old adapter bias was finish/message first. That is dangerous for
    multi-step benchmarks because a transient malformed response can become a
    premature stop. This selector reuses the same shortlist and exact required
    argument hints as the main prompt, preferring viable non-finish actions
    while the latest observation is not completion-ready.
    """

    docs = [doc for doc in action_docs or [] if isinstance(doc, dict) and doc.get("name")]
    if not docs:
        return None

    history_items = history or []
    latest_observation = _latest_history_content(history_items, "observation")
    argument_hints = {
        "latest_observation": latest_observation,
        "context": context or {},
    }
    shortlist = shortlist_exgentic_actions(
        docs,
        task=task,
        context=context,
        history=history_items,
        profile=profile,
    )
    completion_ready = bool(shortlist.get("completion_ready"))
    no_effect_repeat_actions = [
        str(name)
        for name in shortlist.get("avoid_no_effect_repeat_actions") or []
        if str(name)
    ]
    candidate_names = _fallback_candidate_names(
        shortlist,
        docs,
        completion_ready=completion_ready,
        avoid_names=no_effect_repeat_actions,
    )
    skipped: list[dict[str, Any]] = []

    for name in candidate_names:
        doc = _doc_by_name(docs, name)
        if doc is None:
            continue
        is_completion = bool(doc.get("is_finish") or doc.get("is_message"))
        if not completion_ready and is_completion:
            skipped.append({"name": name, "reason": "completion_not_ready"})
            continue
        repair = repair_exgentic_action_payload(
            ActionPayload(name=name, arguments={}),
            docs,
            argument_hints=argument_hints,
        )
        missing = _missing_required_arguments(repair.payload.arguments, doc.get("arguments_schema"))
        if missing and not (completion_ready and is_completion):
            skipped.append({"name": name, "reason": "missing_required_arguments", "missing": missing})
            continue
        diagnostics = {
            "status": "fallback_selected",
            "fallback_reason": reason,
            "selected_name": repair.payload.name,
            "completion_ready": completion_ready,
            "avoid_no_effect_repeat_actions": no_effect_repeat_actions,
            "candidate_names": candidate_names[:12],
            "skipped_candidates": skipped[:8],
            "shortlist": shortlist,
            "repair": repair.diagnostics,
        }
        return ActionRepairResult(payload=repair.payload, changed=True, diagnostics=diagnostics)

    return None


def shortlist_exgentic_actions(
    action_docs: list[dict[str, Any]],
    *,
    task: Any = None,
    context: Any = None,
    history: list[dict[str, Any]] | None = None,
    profile: str = "generic",
    limit: int = 8,
) -> dict[str, Any]:
    """Rank available actions into a compact shortlist for the next step.

    Exgentic still receives the full action schema list below this shortlist.
    The shortlist is a deterministic scaffold: it narrows attention to likely
    actions and finish/message timing without hiding benchmark capabilities.
    """

    docs = [doc for doc in action_docs or [] if isinstance(doc, dict) and doc.get("name")]
    safe_limit = max(1, min(16, int(limit or 8)))
    latest_observation = _latest_history_content(history or [], "observation")
    latest_observation_text = json_dumps(latest_observation, limit=6000) if latest_observation is not None else ""
    argument_hints = {
        "latest_observation": latest_observation,
        "context": context or {},
    }
    target_text = " ".join(
        [
            str(task or ""),
            json_dumps(context or {}, limit=6000),
            latest_observation_text,
        ]
    ).lower()
    tokens = _keyword_tokens(target_text)
    completion_ready = _completion_ready(latest_observation_text)
    latest_action_name = _latest_selected_action_name(history or [])
    has_recent_error = _has_recent_action_error(history or [])
    no_effect_repeat_actions = _recent_no_effect_action_names(history or [])
    no_effect_repeat_set = {name.lower() for name in no_effect_repeat_actions}

    scored: list[tuple[float, str, dict[str, Any], list[str], list[str], list[str], list[dict[str, str]]]] = []
    for doc in docs:
        name = str(doc.get("name") or "")
        action_text = _action_doc_text(doc)
        schema = doc.get("arguments_schema")
        schema_keys = _schema_property_keys(schema)
        required_keys = _schema_required_keys(schema)
        required_hints = _required_argument_hints(required_keys, argument_hints)
        score = 0.0
        reasons: list[str] = []

        token_hits = [token for token in tokens if token in action_text][:6]
        if token_hits:
            score += min(12, len(token_hits) * 2)
            reasons.append(f"matches task/observation tokens: {', '.join(token_hits)}")

        schema_hits = [key for key in schema_keys if key.lower() in target_text][:6]
        if schema_hits:
            score += min(10, len(schema_hits) * 2)
            reasons.append(f"schema keys appear in current state: {', '.join(schema_hits)}")

        if required_hints:
            score += min(8, len(required_hints) * 3)
            reasons.append(
                "required args available in current state: "
                + ", ".join(item["key"] for item in required_hints[:4])
            )

        prior_score, prior_reason = _profile_action_prior(profile, name, action_text)
        if prior_score:
            score += prior_score
            reasons.append(prior_reason)

        name_tokens = [token for token in _keyword_tokens(name.replace("_", " ")) if token not in {"action"}]
        if name_tokens and all(token in latest_observation_text.lower() for token in name_tokens):
            score += 8
            reasons.append("action name matches explicit latest-observation cue")

        is_completion = bool(doc.get("is_finish") or doc.get("is_message"))
        if is_completion:
            if completion_ready:
                score += 8
                reasons.append("latest observation suggests completion is ready")
            else:
                score -= 7
                reasons.append("defer finish/message until benchmark-visible completion evidence")

        if latest_action_name and name.lower() == latest_action_name.lower():
            score -= 2
            reasons.append("same as previous selected action")
            if has_recent_error:
                score -= 4
                reasons.append("avoid repeating after recent action/schema error")
        if not completion_ready and name.lower() in no_effect_repeat_set:
            score -= 10
            reasons.append("avoid repeating no-effect action; latest observation did not change")

        scored.append((score, name.lower(), doc, reasons, schema_keys, required_keys, required_hints))

    scored.sort(key=lambda item: (-item[0], item[1]))
    shortlisted = [
        _shortlist_item(doc, score, reasons, schema_keys, required_keys, required_hints)
        for score, _name, doc, reasons, schema_keys, required_keys, required_hints in scored[:safe_limit]
    ]
    shortlisted_names = {str(item.get("name", "")).lower() for item in shortlisted}
    deferred_completion = [
        str(doc.get("name"))
        for doc in docs
        if (doc.get("is_finish") or doc.get("is_message"))
        and str(doc.get("name", "")).lower() not in shortlisted_names
        and not completion_ready
    ]

    return {
        "format": "grawkus-exgentic-action-shortlist-v1",
        "profile": profile,
        "action_count": len(docs),
        "shortlist_limit": safe_limit,
        "completion_ready": completion_ready,
        "avoid_no_effect_repeat_actions": no_effect_repeat_actions,
        "shortlisted_actions": shortlisted,
        "deferred_completion_actions": deferred_completion,
        "discipline": "Prefer shortlisted actions when they fit the latest observation; use full schemas below if the current state clearly requires a non-shortlisted action. If avoid_no_effect_repeat_actions is non-empty, change strategy unless no other viable action has its required arguments.",
    }


def safe_id(value: Any, default: str = "session") -> str:
    raw = str(value or default)
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", raw).strip("-")
    return safe or default


def _compact_selected_actions(value: Any, *, item_limit: int) -> list[dict[str, Any]]:
    actions = value if isinstance(value, list) else [value]
    compact: list[dict[str, Any]] = []
    for action in actions:
        if not isinstance(action, dict):
            compact.append({"name": "unknown", "summary": truncate(action, limit=item_limit)})
            continue
        raw_args = action.get("arguments", {})
        args = raw_args if isinstance(raw_args, dict) else {"value": raw_args}
        compact.append(
            {
                "name": str(action.get("name") or "unknown"),
                "argument_keys": sorted(str(key) for key in args.keys()),
                "arguments": truncate(json_dumps(args, limit=item_limit), limit=item_limit),
            }
        )
    return compact


def _compact_grawkus_diagnostic(item: dict[str, Any], *, item_limit: int) -> dict[str, Any] | None:
    returncode = item.get("returncode")
    stderr = str(item.get("stderr") or "")
    stdout = str(item.get("stdout") or "")
    text = "\n".join(part for part in [stderr, stdout] if part)
    if returncode in (None, 0) and not re.search(
        r"\b(error|invalid|unknown action|schema|malformed|permission|timed out|timeout|failed)\b",
        text,
        flags=re.IGNORECASE,
    ):
        return None
    return {
        "returncode": returncode,
        "evidence": truncate(text, limit=item_limit),
    }


def _folding_discipline(profile: str) -> str:
    if profile == "appworld":
        return "Use latest_observation as authoritative app/API state; preserve IDs, dates, permissions, and record integrity."
    if profile == "browsecomp":
        return "Carry forward verified sources and unresolved search facets; do not treat snippets or stale single-source claims as final evidence."
    if profile == "tau2":
        return "Carry forward policy constraints, customer intent, tool results, and pending confirmations before selecting the next action."
    if profile == "terminalworld":
        return "TerminalWorld discipline: carry forward instruction.md/task artifact requirements, generated files/services, command outputs, verifier status, and any solve.sh/reference-solution avoidance before selecting the next action."
    if profile == "webdevbench":
        return "Carry forward canary requirements, frontend/backend state, integration evidence, and production/security gaps before selecting the next action."
    if profile == "swe-cycle":
        return "Carry forward lifecycle phase, bare-repo environment setup state, implementation requirements, generated/selected tests, judge commands, and unresolved phase gaps before selecting the next action."
    if profile == "swe-ci":
        return "Carry forward current/target commits, test gaps, inferred requirements, touched files, verifier deltas, and unresolved regressions before selecting the next action."
    if profile == "swe-prbench":
        return "Carry forward PR title/description, changed files, diff hunks, suspected findings, evidence gaps, and context-expansion reasons before selecting the next action."
    if profile == "tml-bench":
        return "Carry forward train/test/sample submission paths, ID/target columns, metric, validation split, leakage checks, model artifacts, submission path, and validity evidence before selecting the next action."
    if profile == "pi-bench":
        return "Carry forward user profile, current request, message/file/app context, available domain tools, hidden-intent hypotheses, clarification state, privacy risk, selected actions, and observable completion evidence before selecting the next action."
    return "Use the folded ledger as orientation, then rely on the latest observation and available action schemas for the next action."


def _resolve_action_doc(
    name: str,
    docs: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, str, float]:
    raw = str(name or "")
    if not raw:
        return None, "empty", 0.0

    for doc in docs:
        candidate = str(doc.get("name") or "")
        if candidate == raw:
            return doc, "exact", 1.0

    lowered = raw.lower()
    for doc in docs:
        candidate = str(doc.get("name") or "")
        if candidate.lower() == lowered:
            return doc, "case_insensitive", 1.0

    normalized = _normalized_identifier(raw)
    for doc in docs:
        candidate = str(doc.get("name") or "")
        if _normalized_identifier(candidate) == normalized:
            return doc, "normalized_identifier", 1.0

    best_doc: dict[str, Any] | None = None
    best_score = 0.0
    second_score = 0.0
    for doc in docs:
        candidate = str(doc.get("name") or "")
        candidate_norm = _normalized_identifier(candidate)
        score = SequenceMatcher(None, normalized, candidate_norm).ratio() if normalized and candidate_norm else 0.0
        if normalized and candidate_norm and (normalized in candidate_norm or candidate_norm in normalized):
            score = max(score, 0.82)
        if score > best_score:
            second_score = best_score
            best_score = score
            best_doc = doc
        elif score > second_score:
            second_score = score

    if best_doc is not None and best_score >= 0.82 and best_score - second_score >= 0.04:
        return best_doc, "fuzzy_identifier", best_score
    return None, "unresolved", best_score


def _repair_action_arguments(
    arguments: dict[str, Any],
    schema: Any,
    *,
    argument_hints: Any = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    args = dict(arguments or {})
    schema_keys = _schema_property_keys(schema)
    if not schema_keys:
        return args, {
            "argument_key_repairs": [],
            "dropped_argument_keys": [],
            "filled_required_arguments": [],
            "schema_keys": [],
        }

    key_by_normalized = {_normalized_identifier(key): key for key in schema_keys}
    repaired: dict[str, Any] = {}
    key_repairs: list[dict[str, str]] = []
    dropped: list[str] = []

    for key, value in args.items():
        text_key = str(key)
        if text_key in schema_keys:
            repaired[text_key] = value
            continue
        canonical = key_by_normalized.get(_normalized_identifier(text_key))
        if canonical is not None:
            repaired[canonical] = value
            key_repairs.append({"from": text_key, "to": canonical})
        else:
            dropped.append(text_key)

    filled = _fill_required_arguments(repaired, schema, argument_hints)
    return repaired, {
        "argument_key_repairs": key_repairs,
        "dropped_argument_keys": dropped,
        "filled_required_arguments": filled,
        "schema_keys": schema_keys[:24],
    }


def _fill_required_arguments(
    repaired: dict[str, Any],
    schema: Any,
    argument_hints: Any,
) -> list[dict[str, str]]:
    if not isinstance(schema, dict):
        return []
    required = [str(key) for key in schema.get("required") or [] if str(key)]
    if not required:
        return []
    hint_index = _argument_hint_index(argument_hints)
    filled: list[dict[str, str]] = []
    existing = {_normalized_identifier(key) for key in repaired.keys()}

    for key in required:
        norm = _normalized_identifier(key)
        if not norm or norm in existing:
            continue
        match = hint_index.get(norm)
        if match is None:
            continue
        value, source = match
        if value is None:
            continue
        repaired[key] = value
        existing.add(norm)
        filled.append({"key": key, "source": source})
    return filled


def _argument_hint_index(value: Any) -> dict[str, tuple[Any, str]]:
    index: dict[str, tuple[Any, str]] = {}

    def visit(item: Any, path: str) -> None:
        if isinstance(item, dict):
            for key, child in item.items():
                key_text = str(key)
                child_path = f"{path}.{key_text}" if path else key_text
                norm = _normalized_identifier(key_text)
                if norm and norm not in index and _hint_value_is_usable(child):
                    index[norm] = (child, child_path)
                visit(child, child_path)
        elif isinstance(item, list):
            for idx, child in enumerate(item[:50]):
                visit(child, f"{path}[{idx}]" if path else f"[{idx}]")

    visit(value, "")
    return index


def _hint_value_is_usable(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (bool, int, float)):
        return True
    if isinstance(value, (dict, list)):
        return bool(value)
    return True


def _normalized_identifier(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _latest_history_content(history: list[dict[str, Any]], role: str) -> Any | None:
    for item in reversed(history or []):
        if isinstance(item, dict) and item.get("role") == role:
            return item.get("content")
    return None


def _latest_selected_action_name(history: list[dict[str, Any]]) -> str | None:
    content = _latest_history_content(history, "selected_action")
    actions = content if isinstance(content, list) else [content]
    for action in actions:
        if isinstance(action, dict) and action.get("name"):
            return str(action.get("name"))
    return None


def _recent_no_effect_action_names(history: list[dict[str, Any]]) -> list[str]:
    latest_observation_idx: int | None = None
    previous_observation_idx: int | None = None
    for idx in range(len(history or []) - 1, -1, -1):
        item = history[idx]
        if not isinstance(item, dict) or item.get("role") != "observation":
            continue
        if latest_observation_idx is None:
            latest_observation_idx = idx
        else:
            previous_observation_idx = idx
            break

    if latest_observation_idx is None or previous_observation_idx is None:
        return []

    latest = history[latest_observation_idx].get("content")
    previous = history[previous_observation_idx].get("content")
    latest_text = json_dumps(latest, limit=4000).lower()
    unchanged = (
        _observation_fingerprint(latest) == _observation_fingerprint(previous)
        or bool(
            re.search(
                r"\b(no change|no changes|unchanged|same state|nothing changed|no effect|still pending|"
                r"did not (?:change|update|move|complete|resolve)|not (?:changed|updated|completed|resolved))\b",
                latest_text,
            )
        )
    )
    if not unchanged:
        return []

    names: list[str] = []
    for item in history[previous_observation_idx + 1:latest_observation_idx]:
        if not isinstance(item, dict) or item.get("role") != "selected_action":
            continue
        for name in _selected_action_names(item.get("content")):
            push_unique(names, name)
    return names


def _selected_action_names(value: Any) -> list[str]:
    actions = value if isinstance(value, list) else [value]
    names: list[str] = []
    for action in actions:
        if isinstance(action, dict) and action.get("name"):
            push_unique(names, str(action.get("name")))
    return names


def _observation_fingerprint(value: Any) -> str:
    text = json_dumps(value, limit=8000).lower()
    return re.sub(r"\s+", " ", text).strip()


def _has_recent_action_error(history: list[dict[str, Any]]) -> bool:
    for item in reversed((history or [])[-4:]):
        if not isinstance(item, dict) or item.get("role") != "grawkus":
            continue
        diagnostic = _compact_grawkus_diagnostic(item, item_limit=600)
        if diagnostic is not None:
            return True
    return False


def _keyword_tokens(text: str) -> list[str]:
    seen: set[str] = set()
    tokens: list[str] = []
    for raw in re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", text or ""):
        token = raw.lower().strip("-_")
        if token in STOPWORDS or len(token) < 3 or token in seen:
            continue
        seen.add(token)
        tokens.append(token)
        if len(tokens) >= 80:
            break
    return tokens


def _completion_ready(latest_observation_text: str) -> bool:
    text = (latest_observation_text or "").lower()
    if not text:
        return False
    if re.search(r"\b(pending|missing|need|needs|required|error|failed|invalid|not complete|unresolved)\b", text):
        return False
    return bool(re.search(r"\b(done|complete|completed|success|succeeded|confirmed|final answer|resolved)\b", text))


def _action_doc_text(doc: dict[str, Any]) -> str:
    parts = [
        str(doc.get("name") or ""),
        str(doc.get("description") or ""),
        " ".join(_schema_property_keys(doc.get("arguments_schema"))),
        json_dumps(doc.get("arguments_schema") or {}, limit=4000),
    ]
    return " ".join(parts).lower()


def _schema_property_keys(schema: Any) -> list[str]:
    if not isinstance(schema, dict):
        return []
    keys: list[str] = []
    properties = schema.get("properties")
    if isinstance(properties, dict):
        keys.extend(str(key) for key in properties.keys())
    for nested_key in ("$defs", "definitions"):
        nested = schema.get(nested_key)
        if isinstance(nested, dict):
            for value in nested.values():
                keys.extend(_schema_property_keys(value))
    seen: set[str] = set()
    deduped: list[str] = []
    for key in keys:
        lowered = key.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(key)
    return deduped


def _schema_required_keys(schema: Any) -> list[str]:
    if not isinstance(schema, dict):
        return []
    required = schema.get("required")
    if not isinstance(required, list):
        return []
    seen: set[str] = set()
    keys: list[str] = []
    for key in required:
        text = str(key or "").strip()
        lowered = text.lower()
        if not text or lowered in seen:
            continue
        seen.add(lowered)
        keys.append(text)
    return keys


def _required_argument_hints(required_keys: list[str], argument_hints: Any) -> list[dict[str, str]]:
    if not required_keys:
        return []
    hint_index = _argument_hint_index(argument_hints)
    hints: list[dict[str, str]] = []
    for key in required_keys:
        match = hint_index.get(_normalized_identifier(key))
        if match is None:
            continue
        value, source = match
        if not _hint_value_is_usable(value):
            continue
        hints.append(
            {
                "key": key,
                "source": source,
                "value_preview": truncate(json_dumps(value, limit=360), limit=360),
            }
        )
    return hints


def _missing_required_arguments(arguments: dict[str, Any], schema: Any) -> list[str]:
    required = _schema_required_keys(schema)
    if not required:
        return []
    present = {
        _normalized_identifier(key)
        for key, value in (arguments or {}).items()
        if _hint_value_is_usable(value)
    }
    return [key for key in required if _normalized_identifier(key) not in present]


def _fallback_candidate_names(
    shortlist: dict[str, Any],
    docs: list[dict[str, Any]],
    *,
    completion_ready: bool,
    avoid_names: list[str] | None = None,
) -> list[str]:
    names: list[str] = []
    delayed: list[str] = []
    avoid = {str(name).lower() for name in avoid_names or [] if str(name)}

    def add_candidate(value: Any) -> None:
        name = str(value or "")
        if not name:
            return
        if not completion_ready and name.lower() in avoid:
            push_unique(delayed, name)
            return
        push_unique(names, name)

    if completion_ready:
        for doc in docs:
            if (doc.get("is_finish") or doc.get("is_message")) and doc.get("name"):
                add_candidate(doc.get("name"))
        for doc in docs:
            name = str(doc.get("name") or "")
            if name.lower() in {"finish", "final", "done"}:
                add_candidate(name)

    for item in shortlist.get("shortlisted_actions") or []:
        if isinstance(item, dict) and item.get("name"):
            add_candidate(item.get("name"))

    if not completion_ready:
        for doc in docs:
            if not (doc.get("is_finish") or doc.get("is_message")) and doc.get("name"):
                add_candidate(doc.get("name"))

    for doc in docs:
        if (completion_ready or len(docs) == 1) and doc.get("name"):
            add_candidate(doc.get("name"))
    for name in delayed:
        push_unique(names, name)
    return names


def _doc_by_name(docs: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    for doc in docs:
        if str(doc.get("name") or "") == name:
            return doc
    lowered = str(name or "").lower()
    for doc in docs:
        if str(doc.get("name") or "").lower() == lowered:
            return doc
    return None


def push_unique(values: list[str], value: str) -> None:
    if value not in values:
        values.append(value)


def _profile_action_prior(profile: str, name: str, action_text: str) -> tuple[float, str]:
    text = f"{name} {action_text}".lower()
    if profile == "appworld":
        if re.search(r"\b(get|lookup|list|search|find|query|read|fetch|load|inspect)\b", text):
            return 5, "AppWorld prior: inspect app/API state before mutating records"
        if re.search(r"\b(create|update|set|delete|cancel|submit|send)\b", text):
            return 3, "AppWorld prior: likely state-changing app action"
    elif profile == "browsecomp":
        if re.search(r"\b(search|query|browse|web|open|read|fetch|source|cite|visit)\b", text):
            return 6, "BrowseComp prior: gather and verify source evidence"
        if re.search(r"\b(answer|final|finish|message|respond)\b", text):
            return 2, "BrowseComp prior: final answer action when evidence is sufficient"
    elif profile == "tau2":
        if re.search(r"\b(policy|lookup|search|get|list|read|check|verify|order|customer|account|ticket)\b", text):
            return 5, "tau2 prior: check policy/customer/tool state before commitments"
        if re.search(r"\b(update|create|cancel|refund|transfer|confirm|submit|send)\b", text):
            return 3, "tau2 prior: policy-supported customer-service action"
    elif profile == "webdevbench":
        if re.search(r"\b(requirements?|canar(?:y|ies)|spec|product|plan|architecture|read|inspect|list|search|get|query)\b", text):
            return 6, "WebDevBench prior: preserve product/canary requirements before building"
        if re.search(r"\b(e2e|integration|api|browser|playwright|cypress|security|audit|build|deploy|migration|load|concurrency|health)\b", text):
            return 5, "WebDevBench prior: verify full-stack, production, or security evidence"
        if re.search(r"\b(create|update|modify|deploy|submit|send)\b", text):
            return 3, "WebDevBench prior: app creation/modification action"
    elif profile == "swe-cycle":
        if re.search(r"\b(fullcycle|envsetup|codeimpl|testgen|phase|requirements?|issue|read|inspect|list|search|get|query|run_script|parsing_script|selected_test_files_to_run|environment_setup_commit|before_repo_set_cmd|image_name)\b", text):
            return 6, "SWE-Cycle prior: identify lifecycle phase, harness fields, and issue requirements"
        if re.search(r"\b(setup|install|bootstrap|dependencies|env|environment|import|collect|discover|build)\b", text):
            return 6, "SWE-Cycle prior: reconstruct bare-repo environment before code/test edits"
        if re.search(r"\b(testgen|test|tests|pytest|jest|vitest|selected|judge|swe[-_ ]?judge|static|dynamic|verify|check)\b", text):
            return 5, "SWE-Cycle prior: generate/validate tests and preserve judge evidence"
        if re.search(r"\b(codeimpl|modify|patch|edit|update|change|implement|repair)\b", text):
            return 3, "SWE-Cycle prior: implementation action after lifecycle context is established"
    elif profile == "swe-ci":
        if re.search(r"\b(current|target|commit|sha|history|log|diff|status|read|inspect|list|search|get|query)\b", text):
            return 6, "SWE-CI prior: establish current/target commits, test gaps, and repo evolution context"
        if re.search(r"\b(run[_ -]?tests?|test|ci|verify|check|tox|nox|act|pytest|unittest)\b", text):
            return 6, "SWE-CI prior: run the CI/test loop and preserve verifier deltas"
        if re.search(r"\b(requirements?|define[_ -]?requirements?|test[_ -]?gap|failure|attribution|plan|locali[sz]e)\b", text):
            return 5, "SWE-CI prior: derive requirements from CI/test gaps before modifying code"
        if re.search(r"\b(modify[_ -]?code|patch|edit|update|change|implement|repair)\b", text):
            return 3, "SWE-CI prior: incremental requirement-backed code modification"
    elif profile == "swe-prbench":
        if re.search(r"\b(pr|pull|request|diff|patch|hunk|changed|files?|review|comment|read|inspect|list|search|get|query)\b", text):
            return 6, "SWE-PRBench prior: inspect PR metadata and changed diff before broad context"
        if re.search(r"\b(test|verify|repro|run|check|typecheck|lint|unit)\b", text):
            return 4, "SWE-PRBench prior: verify suspected review findings when feasible"
        if re.search(r"\b(finish|message|answer|respond|final|review)\b", text):
            return 3, "SWE-PRBench prior: deliver severity-rated review findings once evidence is sufficient"
        if re.search(r"\b(edit|patch|modify|update|write|apply)\b", text):
            return -3, "SWE-PRBench prior: defer code edits unless the review task explicitly asks for patches"
    elif profile == "tml-bench":
        if re.search(r"\b(data|dataset|train|test|sample[_ -]?submission|schema|columns?|target|id|metric|read|inspect|list|search|get|query)\b", text):
            return 6, "TML-Bench prior: establish data contract and submission schema before modeling"
        if re.search(r"\b(validate|validation|split|cv|cross[-_ ]?validation|leakage|baseline|score|metric|check)\b", text):
            return 6, "TML-Bench prior: honest validation and leakage checks before submission"
        if re.search(r"\b(train|fit|model|pipeline|preprocess|feature|predict)\b", text):
            return 4, "TML-Bench prior: build a reliable tabular baseline before complex ensembling"
        if re.search(r"\b(submit|submission|save|write|export|finish|answer|final)\b", text):
            return 4, "TML-Bench prior: produce and validate a schema-compatible submission artifact"
    elif profile == "pi-bench":
        if re.search(r"\b(profile|user|history|message|file|workspace|app|context|state|read|inspect|list|search|get|query)\b", text):
            return 6, "Pi-Bench prior: establish personal/workspace/app context before proactive action"
        if re.search(r"\b(intent|implicit|hidden|latent|need|preference|constraint|policy|privacy|permission|clarif(?:y|ication)|ask)\b", text):
            return 6, "Pi-Bench prior: resolve hidden intent, privacy, and permission uncertainty"
        if re.search(r"\b(tool|action|schedule|send|update|create|modify|book|message|email|calendar|file)\b", text):
            return 4, "Pi-Bench prior: take reversible proactive action only after context is grounded"
        if re.search(r"\b(verify|confirm|observe|check|finish|answer|final|done)\b", text):
            return 4, "Pi-Bench prior: verify observable completion and communicate concise outcome"
    else:
        if re.search(r"\b(observe|read|search|list|get|lookup|inspect|query)\b", text):
            return 4, "generic prior: inspect available state before irreversible actions"
    return 0, ""


def _shortlist_item(
    doc: dict[str, Any],
    score: float,
    reasons: list[str],
    schema_keys: list[str],
    required_keys: list[str],
    required_hints: list[dict[str, str]],
) -> dict[str, Any]:
    return {
        "name": str(doc.get("name") or ""),
        "score": round(score, 2),
        "reason": "; ".join(reasons[:4]) or "available action",
        "argument_keys": schema_keys[:12],
        "required_argument_keys": required_keys[:12],
        "available_required_hints": required_hints[:8],
        "is_finish": bool(doc.get("is_finish", False)),
        "is_message": bool(doc.get("is_message", False)),
    }


def extract_action_payload(text: str) -> ActionPayload | None:
    """Return the last valid action payload from grawkus output.

    Supported shapes:
      {"name": "finish", "arguments": {"answer": "..."}}
      {"action": "finish", "arguments": {"answer": "..."}}
      {"action": {"name": "finish", "arguments": {"answer": "..."}}}
    """

    for candidate in reversed(_json_candidates(text)):
        payload = _coerce_action_payload(candidate)
        if payload is not None:
            return payload
    return None


def _json_candidates(text: str) -> list[Any]:
    candidates: list[Any] = []

    for block in re.findall(r"```(?:json|JSON)?\s*(.*?)```", text or "", flags=re.DOTALL):
        value = _parse_json(block.strip())
        if value is not None:
            candidates.append(value)

    marker_re = re.compile(r"grawkus-exgentic action JSON\s*:\s*(\{.*?\})\s*$", re.IGNORECASE | re.DOTALL)
    marker = marker_re.search(text or "")
    if marker:
        value = _parse_json(marker.group(1))
        if value is not None:
            candidates.append(value)

    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", text or ""):
        try:
            value, _ = decoder.raw_decode(text[match.start() :])
        except Exception:
            continue
        candidates.append(value)

    return candidates


def _parse_json(text: str) -> Any | None:
    try:
        return json.loads(text)
    except Exception:
        return None


def _coerce_action_payload(value: Any) -> ActionPayload | None:
    if not isinstance(value, dict):
        return None

    nested = value.get("action")
    if isinstance(nested, dict):
        nested_args = nested.get("arguments")
        if nested_args is None:
            nested_args = nested.get("args")
        value = {
            "name": nested.get("name") or nested.get("action") or nested.get("tool"),
            "arguments": nested_args,
        }

    name = value.get("name") or value.get("action") or value.get("tool")
    if not isinstance(name, str) or not name.strip():
        return None

    arguments = value.get("arguments")
    if arguments is None:
        arguments = value.get("args")
    if arguments is None:
        arguments = value.get("action_input")
    if arguments is None:
        arguments = {}
    if not isinstance(arguments, dict):
        arguments = {"value": arguments}

    return ActionPayload(name=name.strip(), arguments=arguments)
