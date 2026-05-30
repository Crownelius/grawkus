# Grawkus Architecture

Grawkus is a terminal-native coding agent harness — not a bare chat wrapper. It provides the runtime, tools, policies, memory, skills, subagents, verification, traces, and benchmark adapters around a language model.

## Architecture Layers

### 1. Runtime Kernel
The runtime owns TUI rendering, input handling, model streaming, tool-call execution, subprocess execution, filesystem operations, patch application, approvals, sandbox controls, session persistence, event logs, and resumability. One canonical runtime, many surfaces.

### 2. Protocol Layer
Stable protocol types: Thread, Turn, Item, ToolEvent, FileEdit, ApprovalRequest, PolicyDecision, VerifierPlan, VerificationResult, HarnessAsset, AssetLoadDecision, AdapterCapability, ChangePrediction, ExperienceCard, TaskContract.

### 3. Harness Asset Registry
Canonical asset registry for system prompts, tool descriptions, tool implementations, middleware, skills, subagents, rules, hooks, MCP configs, memory policies, benchmark profiles, and verifier contracts. Each asset has metadata; full content loads only when selected (progressive disclosure).

### 4. Adapter Layer
Exports harness assets into other agent environments (Codex, Claude Code, OpenCode, Cursor, Gemini, etc.) with explicit capability labels: native, adapted, instruction_only, unsupported.

### 5. Control Plane
Multi-session and multi-agent orchestration with session objects, worktree-aware sessions, named agent roles, scoped tool permissions, subagent output contracts, status dashboards, risk scoring, handoff summaries, verifier agents, merge/review gates, and replayable session history.

### 6. Security and Policy Layer
Policy engine for tool calls, deterministic command blocking, secret redaction, hook scanner, MCP config scanner, skill/subagent/rule scanner, permission audit, prompt-injection detection, dangerous shell-pattern detection, adapter downgrade warnings, and sandbox status reporting. The runtime enforces boundaries — never rely on the model alone for safety.

### 7. Evaluation and Observability Layer
Every harness change has trace evidence, change prediction, regression risk, verification plan, rollback plan, experience card, and benchmark or local regression test. Grawkus records which assets loaded, why they loaded, which tools ran, which edits happened, which verifiers ran, which passed/failed, which subagents participated, which policy decisions were made, what the agent predicted, and what actually happened.

## Agent Loop

1. **Classify task contract** — goal, scope, constraints, risk, expected deliverable, success verifier.
2. **Load minimal context** — repo map, relevant files, matching asset metadata, relevant project memory.
3. **Select assets** — skills, rules, subagents, memory, verifier contracts.
4. **Plan with verification** — define tests/checks before editing.
5. **Execute under policy** — tool calls pass deterministic checks.
6. **Delegate bounded work** — subagents with narrow scope, limited tools, output contracts.
7. **Edit and record predictions** — significant edits include predicted effect and possible regression.
8. **Verify** — run the verifier contract; if it fails, loop using evidence.
9. **Summarize** — explain files changed, checks run, what passed/failed, next risks.
10. **Bank experience only with evidence** — promote repeated lessons to memory or skill updates only when trace-backed.

## Subagents

Core Grawkus subagents: forge-architect, repo-cartographer, build-error-resolver, silent-failure-hunter, security-reviewer, test-smith, ui-polisher, migration-keeper, benchmark-runner, harness-librarian.

## Memory System

Four memory classes: project (repo-specific facts), user (preferences, standing instructions), harness (lessons about tools/skills/policy), benchmark (task patterns, failure modes). Progressive disclosure — retrieve by trigger and scope. Never dump memory into every prompt.

## Verification-First Behavior

Every task type has a verifier contract when possible. Build fix: rerun the failed build command. TypeScript: `npm run build`. Tests: repo test command. Lint: repo lint command. Never claim success without stating what was verified.

## ECC Integration

Bundled everything-claude-code: 228 skills, 60 agents, 81 commands, 18 rule sets. Auto-installed on first launch. ECC is the reusable workflow layer; Grawkus is the execution surface.
