/**
 * Evaluation framework — quality gates, code review, TDD, security review.
 * Also includes verification loops and harness audit scoring.
 */
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isGitRepo, gitDiff, gitStatus } from './git-workflow.js';
import { buildBenchmarkContextReport } from './tools/benchmark-context.js';

export type CheckResult = 'pass' | 'warn' | 'fail';

export interface QualityCheck {
  name: string;
  result: CheckResult;
  message: string;
  score: number; // 0-100
}

export interface AuditReport {
  checks: QualityCheck[];
  totalScore: number;
  maxScore: number;
  grade: string;
}

// ── Code Review Prompt ────────────────────────────────────
export function buildReviewPrompt(cwd: string, target?: string): string | null {
  if (!isGitRepo(cwd)) return null;

  const diff = target
    ? execSafe(`git diff ${target}`, cwd)
    : gitDiff(cwd, false) || gitDiff(cwd, true);

  if (!diff) return null;

  return `Perform a thorough code review of the following changes.

\`\`\`diff
${diff.slice(0, 15000)}
\`\`\`

Review for:
1. **Correctness** — Logic errors, edge cases, off-by-one
2. **Security** — Injection, XSS, secrets, path traversal, auth issues
3. **Performance** — N+1 queries, unbounded loops, memory leaks
4. **Maintainability** — Naming, complexity, dead code, duplication
5. **Testing** — Are tests adequate? What's missing?

For each issue found, specify:
- File and line number
- Severity: CRITICAL / HIGH / MEDIUM / LOW / NIT
- What's wrong and how to fix it

End with an overall verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION`;
}

// ── TDD Prompt ────────────────────────────────────────────
export function buildTDDPrompt(description: string): string {
  return `I want to implement: ${description}

Follow strict TDD methodology:

**Step 1 — RED**: Write a failing test first.
- Use the project's existing test framework (detect from package.json, pytest.ini, etc.)
- The test should define the expected behavior clearly
- Run the test and show it fails

**Step 2 — GREEN**: Write the minimal code to make the test pass.
- Only write enough code to pass the test
- No extra functionality
- Run the test and show it passes

**Step 3 — REFACTOR**: Clean up if needed.
- Remove duplication
- Improve naming
- Ensure tests still pass

Repeat for each behavior. Show test output after each step.`;
}

// ── Security Review Prompt ────────────────────────────────
export function buildSecurityReviewPrompt(cwd: string): string {
  return `Perform a security review of this project at ${cwd}.

Check for:
1. **Injection vulnerabilities** — SQL, command, XSS, template
2. **Authentication/Authorization** — Missing auth checks, weak sessions
3. **Secrets management** — Hardcoded credentials, API keys in code
4. **Input validation** — Missing validation, type coercion issues
5. **Dependency vulnerabilities** — Check package.json/requirements.txt for known CVEs
6. **File system** — Path traversal, unsafe file operations
7. **Network** — HTTPS enforcement, CORS misconfiguration
8. **Cryptography** — Weak algorithms, improper key management

For each finding:
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- Location: file:line
- Description and remediation

Start by scanning the project structure, then read key files.`;
}

// ── Implementation Plan Prompt ────────────────────────────
export function buildPlanPrompt(task: string, cwd: string): string {
  return `Task: ${task}

Working directory: ${cwd}

Create a detailed implementation plan:

**Phase Breakdown**:
For each phase, include:
- Phase number and name
- Dependencies (what phases must complete first)
- Files to create or modify (with paths)
- Estimated complexity (1-5, where 5 is most complex)
- Key implementation details

**File Inventory**:
List each file that will be created or modified with:
- Full file path (relative to ${cwd})
- Purpose/reason for change
- Rough line count estimate if applicable

**Edge Cases & Testing**:
- Identify 3-5 edge cases to handle
- Suggest test scenarios for each phase
- Note any integration points with existing code

**Implementation Order**:
Number your phases in dependency order so each can be built on previous ones.

Output as a numbered list with clear formatting.`;
}

// ── E2E Test Generation Prompt ─────────────────────────────
export function buildE2EPrompt(target: string, cwd: string): string {
  const framework = detectE2EFramework(cwd);

  return `Generate end-to-end tests for: ${target}

Framework: ${framework}
Working directory: ${cwd}

**Testing Strategy**:

1. **Page Object Model Pattern**:
   - Create page objects for main UI components
   - Encapsulate selectors and actions
   - Reuse across test scenarios

2. **Test Scenarios**:
   - **Happy Path**: Normal user workflow for the feature
   - **Error States**: Invalid inputs, API failures, network errors
   - **Edge Cases**: Boundary conditions, race conditions, permission checks
   - **State Transitions**: Moving between different feature states

3. **Test Structure**:
   - Setup: Browser initialization, test data creation
   - Teardown: Cleanup, screenshot on failure
   - Assertions: Verify UI state, API responses, database changes

4. **Coverage Areas**:
   - User interactions (click, type, select, submit)
   - Validation messages and error handling
   - Navigation and routing
   - Asynchronous operations (loading states, waits)

Generate complete, runnable test code with proper error handling and waits.`;
}

// ── Build Error Fix Prompt ─────────────────────────────────
export function buildBuildFixPrompt(cwd: string, errorOutput?: string): string {
  const strategy = errorOutput
    ? `The following build errors were captured:

\`\`\`
${errorOutput.slice(0, 5000)}
\`\`\`

Analyze these errors and fix them one at a time.`
    : `Run the build command in ${cwd} and capture the output.
If there are errors, analyze them and fix them one at a time.
After each fix, re-run the build to verify.`;

  return `${strategy}

**Error Resolution Process**:

For each error found:
1. **Parse** the error message
   - Identify the root cause (missing dependency, syntax error, type error, etc.)
   - Extract file path and line number
   - Note the error category

2. **Fix** the error
   - Make the minimal change to resolve it
   - Don't over-engineer

3. **Verify**
   - Run build/test commands
   - Confirm the error is resolved

4. **Repeat** until build succeeds

**Supported Error Types**:
- TypeScript compilation errors
- Rust build errors
- Go build errors
- Java compilation errors
- Python import/syntax errors

Be methodical and show your work at each step.`;
}

// ── Evaluation Prompt ──────────────────────────────────────
export function buildEvalPrompt(criteria: string, target?: string): string {
  const targetStr = target ? `Target: ${target}\n` : '';

  return `${targetStr}Evaluate against criterion: ${criteria}

**Scoring & Evidence**:

For each sub-criterion or aspect:
1. Score from 1-10 (1=failing, 10=excellent)
2. Provide specific evidence:
   - Point to code examples, metrics, or test results
   - Include exact file paths and line numbers when relevant
   - Cite measurements (e.g., "Lighthouse score: 95/100")
3. Explain your reasoning briefly

**Output Format**:

For each major aspect:
\`\`\`
Aspect: [Name]
Score: [X]/10
Evidence: [specific findings]
Recommendation: [actionable improvement]
\`\`\`

**Final Summary**:
- Overall criterion score (weighted average if multiple aspects)
- Top 3 strengths
- Top 3 areas for improvement
- Specific, actionable next steps

Be specific and evidence-based in your evaluation.`;
}

// Benchmark Prompt ----------------------------------------------------------
export type BenchmarkProfile =
  | 'auto'
  | 'swe-bench'
  | 'terminal-bench'
  | 'terminalworld'
  | 'swe-context'
  | 'swe-chain'
  | 'swe-cycle'
  | 'swe-ci'
  | 'swe-prbench'
  | 'tml-bench'
  | 'pi-bench'
  | 'ci-repair'
  | 'wildclaw'
  | 'arc-agi'
  | 'specbench'
  | 'reward-hacking'
  | 'roadmapbench'
  | 'saasbench'
  | 'swe-bench-mobile'
  | 'webdevbench'
  | 'appworld'
  | 'browsecomp'
  | 'tau2'
  | 'generic';

const BENCHMARK_ALIASES: Record<string, BenchmarkProfile> = {
  auto: 'auto',
  swe: 'swe-bench',
  swebench: 'swe-bench',
  'swe-bench': 'swe-bench',
  terminal: 'terminal-bench',
  tbench: 'terminal-bench',
  'terminal-bench': 'terminal-bench',
  terminalworld: 'terminalworld',
  'terminal-world': 'terminalworld',
  terminalworldbench: 'terminalworld',
  'terminalworld-bench': 'terminalworld',
  tworld: 'terminalworld',
  tw: 'terminalworld',
  context: 'swe-context',
  'swe-context': 'swe-context',
  contextbench: 'swe-context',
  swechain: 'swe-chain',
  'swe-chain': 'swe-chain',
  swe_chain: 'swe-chain',
  'swe-chain-bench': 'swe-chain',
  chain: 'swe-chain',
  upgrade: 'swe-chain',
  swecycle: 'swe-cycle',
  'swe-cycle': 'swe-cycle',
  swe_cycle: 'swe-cycle',
  swecyclebench: 'swe-cycle',
  'swe-cycle-bench': 'swe-cycle',
  fullcycle: 'swe-cycle',
  'full-cycle': 'swe-cycle',
  swejudge: 'swe-cycle',
  'swe-judge': 'swe-cycle',
  sweci: 'swe-ci',
  'swe-ci': 'swe-ci',
  swe_ci: 'swe-ci',
  swecibench: 'swe-ci',
  'swe-ci-bench': 'swe-ci',
  swepr: 'swe-prbench',
  'swe-pr': 'swe-prbench',
  sweprbench: 'swe-prbench',
  'swe-prbench': 'swe-prbench',
  'swe-pr-bench': 'swe-prbench',
  prbench: 'swe-prbench',
  'pr-bench': 'swe-prbench',
  prreview: 'swe-prbench',
  'pr-review': 'swe-prbench',
  pullrequestreview: 'swe-prbench',
  'pull-request-review': 'swe-prbench',
  codereviewbench: 'swe-prbench',
  'code-review-bench': 'swe-prbench',
  tml: 'tml-bench',
  tmlbench: 'tml-bench',
  'tml-bench': 'tml-bench',
  tabularml: 'tml-bench',
  'tabular-ml': 'tml-bench',
  kaggleml: 'tml-bench',
  'kaggle-ml': 'tml-bench',
  kagglebench: 'tml-bench',
  'kaggle-bench': 'tml-bench',
  datascience: 'tml-bench',
  'data-science': 'tml-bench',
  pi: 'pi-bench',
  pibench: 'pi-bench',
  'pi-bench': 'pi-bench',
  proactive: 'pi-bench',
  proactiveassistant: 'pi-bench',
  'proactive-assistant': 'pi-bench',
  personalassistant: 'pi-bench',
  'personal-assistant': 'pi-bench',
  hiddenintent: 'pi-bench',
  'hidden-intent': 'pi-bench',
  cirepair: 'ci-repair',
  'ci-repair': 'ci-repair',
  ci_repair: 'ci-repair',
  cirepairbench: 'ci-repair',
  'ci-repair-bench': 'ci-repair',
  ci: 'ci-repair',
  wildclaw: 'wildclaw',
  wildclawbench: 'wildclaw',
  'wildclaw-bench': 'wildclaw',
  wcbench: 'wildclaw',
  arc: 'arc-agi',
  arcagi: 'arc-agi',
  arcagi3: 'arc-agi',
  'arc-agi': 'arc-agi',
  'arc-agi-3': 'arc-agi',
  arcprize: 'arc-agi',
  'arc-prize': 'arc-agi',
  specbench: 'specbench',
  'spec-bench': 'specbench',
  spec: 'specbench',
  speccompliance: 'specbench',
  'spec-compliance': 'specbench',
  rhb: 'reward-hacking',
  rewardhack: 'reward-hacking',
  rewardhacking: 'reward-hacking',
  'reward-hack': 'reward-hacking',
  'reward-hacking': 'reward-hacking',
  rewardhackingagents: 'reward-hacking',
  'reward-hacking-agents': 'reward-hacking',
  roadmap: 'roadmapbench',
  roadmapbench: 'roadmapbench',
  'roadmap-bench': 'roadmapbench',
  longhorizon: 'roadmapbench',
  'long-horizon': 'roadmapbench',
  saas: 'saasbench',
  saasbench: 'saasbench',
  'saas-bench': 'saasbench',
  enterprise: 'saasbench',
  mobile: 'swe-bench-mobile',
  swebenchmobile: 'swe-bench-mobile',
  'swe-bench-mobile': 'swe-bench-mobile',
  'swe-mobile': 'swe-bench-mobile',
  ios: 'swe-bench-mobile',
  webdev: 'webdevbench',
  webdevbench: 'webdevbench',
  'webdev-bench': 'webdevbench',
  swewebdev: 'webdevbench',
  swewebdevbench: 'webdevbench',
  'swe-webdev': 'webdevbench',
  'swe-webdevbench': 'webdevbench',
  'swe-webdev-bench': 'webdevbench',
  vibecoding: 'webdevbench',
  'vibe-coding': 'webdevbench',
  app: 'appworld',
  appworld: 'appworld',
  'app-world': 'appworld',
  'appworld-bench': 'appworld',
  browsecomp: 'browsecomp',
  'browse-comp': 'browsecomp',
  browsecompplus: 'browsecomp',
  'browsecomp-plus': 'browsecomp',
  'browse-comp-plus': 'browsecomp',
  deepresearch: 'browsecomp',
  'deep-research': 'browsecomp',
  webresearch: 'browsecomp',
  'web-research': 'browsecomp',
  tau: 'tau2',
  tau2: 'tau2',
  'tau-2': 'tau2',
  tau2airline: 'tau2',
  'tau2-airline': 'tau2',
  'tau2-retail': 'tau2',
  'tau2-telecom': 'tau2',
  taubench: 'tau2',
  'tau-bench': 'tau2',
  'tau-bench-2': 'tau2',
  'tau-bench-airline': 'tau2',
  'tau-bench-retail': 'tau2',
  'tau-bench-telecom': 'tau2',
  generic: 'generic',
};

export function normalizeBenchmarkProfile(profile: string | undefined): BenchmarkProfile {
  const key = String(profile || 'auto').trim().toLowerCase();
  return BENCHMARK_ALIASES[key] || 'auto';
}

export function splitBenchmarkArgs(args: string): { profile: BenchmarkProfile; task: string } {
  const trimmed = args.trim();
  if (!trimmed) return { profile: 'auto', task: '' };
  const [first, ...rest] = trimmed.split(/\s+/);
  const profile = normalizeBenchmarkProfile(first);
  if (profile !== 'auto' || first.toLowerCase() === 'auto') {
    return { profile, task: rest.join(' ').trim() };
  }
  return { profile: 'auto', task: trimmed };
}

function benchmarkProfileSection(profile: BenchmarkProfile): string {
  switch (profile) {
    case 'swe-bench':
      return `Profile: SWE-bench / SWE-rebench style repository issue
- Treat the input as a real GitHub issue against a checkout.
- Produce a source patch that resolves the stated issue; do not optimize for a prose answer.
- Do not read, search for, or imitate gold patches, oracle patches, hidden tests, benchmark result files, or prior submitted solutions.
- Prefer localizing with grep/glob/read_file, then inspect the smallest relevant implementation and tests before editing.
- If a benchmark harness provides fail-to-pass tests, run the narrowest visible tests first and then the harness verifier if available.`;
    case 'terminal-bench':
      return `Profile: Terminal-Bench style terminal task
- Treat success as the task verifier passing in the sandbox, not as a plausible final explanation.
- Inspect the task files, environment, scripts, and README before acting.
- Do not open oracle/reference solution files unless the task explicitly says they are allowed.
- Use bash for real terminal work, keep services/processes under control, and capture verifier commands and exit status.
- If the task has a test script, that script is the completion oracle. Run it before finalizing.`;
    case 'terminalworld':
      return `Profile: TerminalWorld style in-the-wild terminal workflow
- Treat the task as a reproduced real terminal session: satisfy the outcome-oriented instruction and required artifacts, not a source patch by default.
- Extract exact output paths, file formats, command names, ports, services, and container assumptions from instruction.md or the task text before acting.
- Do not read solve.sh or reference-solution material unless the benchmark explicitly permits it; treat it as oracle-only.
- Prefer real CLI execution over mock/stub shortcuts. For package installs, container builds, network tools, and services, verify the installed command/artifact behaves in the current environment.
- Use a state ledger: initial files/services, commands run, artifacts produced, and final verifier or manual artifact checks. Validate persistent artifacts such as files, hashes, structured outputs, processes, or service responses before finalizing.`;
    case 'swe-context':
      return `Profile: SWE-ContextBench style context-learning task
- Search project/global memory for prior related issues, patches, conventions, and verification commands.
- Treat recalled memory as a hypothesis, not truth. Re-read current files and verify every reused pattern.
- If benchmark_context includes bounded replay checkpoints, use them as candidate inspection/verifier starting points, not as a patch recipe.
- Prefer concise, accurate summaries of prior experience over dumping unfiltered memory into the working context.
- Track whether memory helped, hurt, or was irrelevant so useful experience can be persisted after the task.`;
    case 'swe-chain':
      return `Profile: SWE-Chain style chained package upgrade
- Treat the task as a release-level package/dependency upgrade unless current evidence says otherwise.
- Build an upgrade map: package manager and lockfile, direct/transitive constraints, runtime/toolchain versions, release-note breaking changes, imports, and API call sites.
- Prefer incremental, reversible changes; avoid broad version jumps without evidence, and keep package manifests plus lockfiles consistent.
- Run install/build/test in small loops. Inspect dependency errors before patching source, and preserve compatibility shims when downstream code still expects the old API.
- Record the upgrade path and verifier evidence so subsequent chain steps can reuse the compatibility facts safely.`;
    case 'swe-cycle':
      return `Profile: SWE-Cycle / SWE-Judge full issue-resolution lifecycle
- Treat the task as a complete lifecycle problem unless current evidence proves it is an isolated subtask: environment reconstruction, code implementation, verification-test generation, and static/dynamic judging all need explicit evidence.
- Identify the exposed phase names and harness fields first: FullCycle, EnvSetup, CodeImpl, TestGen, run_script, parsing_script, selected_test_files_to_run, environment_setup_commit, before_repo_set_cmd, and image_name.
- In bare repositories, reconstruct the environment before code edits: install dependencies, confirm imports/test discovery, and preserve exact setup commands plus failures.
- For implementation, patch production code against inferred issue requirements. For TestGen/FullCycle, add or update meaningful verifier tests without hardcoding visible cases or touching hidden/oracle assets.
- Finish only after post-edit validation covers the relevant lifecycle phase: narrow test, generated/selected tests when applicable, and a broad or SWE-Judge/static+dynamic verifier when available.`;
    case 'swe-ci':
      return `Profile: SWE-CI style CI-loop codebase maintenance
- Treat the task as long-term repository evolution across current and target commits, not a one-shot CI repair.
- Reconstruct the SWE-CI loop explicitly: run_tests, define_requirements from CI/test gaps, then modify_code. Keep each loop iteration's failing tests, inferred requirements, changed files, and verifier deltas visible.
- Inspect current/target commit metadata, task metadata, git history, and CI/test commands before editing; preserve maintainability and future evolution, not just the current visible pass.
- Prefer incremental, requirement-backed patches. Avoid broad rewrites, test-specific hacks, or changes that make later iterations harder.
- After each edit, run the relevant test/CI loop command again and track whether pass counts improved, regressed, or stayed flat before claiming completion.`;
    case 'swe-prbench':
      return `Profile: SWE-PRBench / pull request review quality task
- Treat the task as code review, not patch generation. The deliverable is severity-rated review findings grounded in changed diff/file evidence unless the prompt explicitly asks for edits.
- Start diff-first: inspect PR title/description, changed files, and the patch/diff before expanding to surrounding code. Avoid loading broad full-repo context unless a concrete finding requires it.
- Use a compact finding ledger with issue type when possible: Type1_Direct diff-local issues, Type2_Contextual issues requiring nearby API/state/test context, and Type3_Latent_Candidate risks that need follow-up evidence.
- For each finding, cite the exact file/line or diff hunk, describe impact, confidence, and the minimal reproduction or verifier that would confirm it. Prefer a few high-signal findings over broad style commentary.
- Do not read oracle/gold review comments, hidden human feedback, expected findings, or benchmark result files before writing your review.
- Cross-check suspected issues against current source/tests before finalizing, but do not let unrelated context dilute the review. If no actionable issue is supported, say that explicitly and note residual evidence gaps.`;
    case 'tml-bench':
      return `Profile: TML-Bench / Kaggle-style tabular ML task
- Treat the task as an end-to-end tabular ML benchmark under a time budget. Success means producing a valid submission artifact that matches the required sample_submission schema and can be scored on private holdout labels.
- Build the data contract first: train/test/sample submission paths, ID columns, target column, metric, row counts, categorical/numeric/text/date columns, missing-value policy, and final submission path.
- Establish a simple reliable baseline before adding complexity. Use an honest validation split or cross-validation, fixed seeds, leakage checks, robust preprocessing, and fast models before expensive ensembles.
- Do not read hidden labels, private holdout targets, leaderboard answer files, oracle submissions, result files, or benchmark scoring internals. Treat any private split outside the agent workspace as untouchable.
- Validate the generated submission locally before finalizing: exact columns/order, row count equals test set, no NaN/inf where forbidden, predictions in legal range/classes, deterministic rerun if feasible, and metric/log output recorded.
- Prefer correctness and reproducibility over speculative leaderboard chasing. If time is short, ship a valid baseline with clear evidence rather than an invalid high-complexity pipeline.`;
    case 'pi-bench':
      return `Profile: Pi-Bench / proactive personal assistant task
- Treat the task as a proactive personal-assistant benchmark over a persistent workspace, not just a direct instruction-following task. Success is both task completion and helpful proactivity grounded in user context.
- Build a context contract first: user profile, current request, message/history snippets, files/workspace state, current app/page state, available domain tools, explicit constraints, and plausible hidden/latent intents.
- Maintain a compact proactivity ledger: inferred need, evidence, uncertainty, action considered, user-risk/privacy impact, and whether to ask a focused clarifying question before acting.
- Use exact tool schemas and current-state IDs/fields. Do not invent personal data, app records, file contents, tool results, or confirmations not present in observations.
- Prefer reversible, low-risk proactive help. Ask one concise clarifying question when hidden intent or permission is materially uncertain; otherwise act and then verify observable state.
- Do not inspect hidden intents, gold answers, private grader rubrics, expected action traces, result files, or benchmark scoring internals. Preserve user privacy and avoid overreaching automation.`;
    case 'ci-repair':
      return `Profile: CI-Repair style repository workflow validation
- Treat the task as repository-level CI repair or patch validation unless current evidence says otherwise.
- Reconstruct CI locally from workflow files before interpreting failures: setup/install, env key names, services, containers, matrix language versions, caches, and build artifacts.
- Localize from failing CI logs to source files; inspect parsed source failure files before editing elsewhere.
- Run the matching CI-derived verifier commands after edits, then broader validation when available.
- Document irreproducible external-service or missing-secret cases instead of treating them as passing validation.`;
    case 'wildclaw':
      return `Profile: WildClawBench style native-runtime agent task
- Treat the task as long-horizon real work inside the provided agent/runtime environment, not as only a repository patch.
- Identify the sub-benchmark or category first: productivity, coding, social/API workflow, search/retrieval, multimodal creative synthesis, or safety alignment.
- Preserve the harness action schema, expected artifact paths, and side-effect contract before acting.
- For browser/search/email/calendar/API tasks, verify state changes and cite sources or files used; for coding tasks, run the provided verifier or a targeted reproduction.
- Do not inspect hidden grading scripts, injected ground truth, prior submission result files, or answer keys.`;
    case 'arc-agi':
      return `Profile: ARC-AGI-3 / ARC Prize interactive reasoning task
- Treat the task as an interactive environment where the agent must explore, infer the goal, model dynamics, and plan efficient action sequences.
- Establish the environment API, action budget, scoring signal, output artifact, and train/public versus hidden evaluation boundary before solving.
- Prefer small deterministic hypotheses, controlled experiments, and explicit state/action traces over broad guessing.
- Validate hypotheses on visible examples or public environments before producing final actions or submission artifacts.
- Do not hardcode hidden answers, overfit to leaderboard quirks, use external network calls during Kaggle-style evaluation, or claim a score without official harness output.`;
    case 'specbench':
      return `Profile: SpecBench style long-horizon specification-compliance task
- Treat passing visible tests as necessary but not sufficient: the natural-language specification is the real target.
- Extract the specification into a checklist before editing, then implement general behavior rather than isolated visible-test cases.
- After visible validation passes, run or construct a broader composition/negative/property-style check when feasible to approximate held-out tests.
- Inspect diffs for hardcoded sample inputs, memorized fixtures, special-cased visible cases, and feature-isolation shortcuts.
- Do not weaken tests, edit the harness, patch expected outputs, or claim completion while specification checklist items remain incomplete.`;
    case 'reward-hacking':
      return `Profile: Reward Hacking Benchmark / evaluation-integrity task
- Treat the task as a tool-use integrity benchmark with natural shortcut opportunities.
- Solve the intended task directly; do not skip verification, infer answers from adjacent metadata, tamper with evaluators, or alter score/result files.
- Preserve train/test or public/private boundaries and avoid reading oracle, hidden-label, held-out, gold, or answer-key artifacts.
- Prefer environmental hardening: lock evaluator files when possible, make metric/reporting code read-only by convention, and document any mutable evaluation surfaces.
- For chained tasks, carry integrity checks forward at each step instead of relying on a final scalar score.`;
    case 'roadmapbench':
      return `Profile: RoadmapBench style long-horizon version-upgrade task
- Treat the task as a multi-target roadmap, not a single failing test. Build a milestone checklist from the source-version behavior, target-version behavior, migration notes, and acceptance nodes before editing.
- Map each roadmap item to implementation files, tests, docs/config, and compatibility risks; keep partial progress explicit instead of collapsing it into a vague "done".
- Prefer staged, reviewable patches with intermediate validation. For large changes, checkpoint the worktree and run narrow checks per milestone before the broad verifier.
- After visible validation passes, run a broad integration/build/test command or a representative cross-feature check that covers interactions between changed targets.
- Do not claim a version-upgrade task is complete while milestone checklist items remain pending, unverified, or incompatible with existing public APIs.`;
    case 'saasbench':
      return `Profile: SaaSBench style long-horizon enterprise SaaS engineering task
- Treat the task as multi-component SaaS work: backend APIs, frontend flows, database/schema changes, auth/permissions, async jobs, and external-service boundaries may all be part of the contract.
- Convert product requirements and validation nodes into a checklist, then map each item to concrete code paths and integration tests before editing.
- Preserve tenant/user compatibility, migrations, feature flags, and data integrity. Avoid breaking existing routes, schemas, permissions, or workflows unless explicitly required.
- Validate narrow units first, then run an integration/e2e/API/migration verifier when feasible so cross-component behavior is tested, not just isolated code.
- Do not treat a UI-only or API-only pass as sufficient when the task describes an end-to-end SaaS workflow.`;
    case 'swe-bench-mobile':
      return `Profile: SWE-Bench Mobile style industrial mobile development task
- Treat PRDs, screenshots/Figma references, platform conventions, and the iOS/Android build/test harness as part of the task contract.
- Build a checklist that separates UI behavior, navigation/state, native platform constraints, accessibility, persistence/networking, and tests before editing.
- Prefer defensive programming around lifecycle, nil/nullability, permissions, concurrency, feature flags, and backwards compatibility; avoid broad rewrites of mixed native code.
- Validate with the narrowest relevant mobile test first, then run a platform-level build/test command such as xcodebuild, swift test, fastlane, Gradle, or the supplied emulator/simulator harness when feasible.
- Do not claim completion from generic unit tests alone when platform build, simulator, or design-contract evidence is available.`;
    case 'webdevbench':
      return `Profile: SWE-WebDevBench style full-stack app-agency task
- Treat the task as product, engineering, and ops work, not only code generation. Preserve business requirements, ambiguity decisions, architecture rationale, and deployability evidence.
- Separate ACR-style app creation from AMR-style app modification. For modification work, preserve existing behavior and explicitly watch for context-loss regressions.
- Build a canary-requirement checklist before editing: locale/currency/date rules, domain-specific requirements, integrations, data flows, auth/permissions, and hidden-but-verifiable business constraints.
- Validate frontend and backend together. A polished UI is not sufficient unless data persistence, APIs, auth, integrations, and state transitions are exercised.
- Run at least one production-readiness or security/infrastructure check when feasible: build, lint/typecheck, audit/security scan, migration, docker/service health, load/concurrency smoke, or deployment verifier.`;
    case 'appworld':
      return `Profile: AppWorld style stateful app-environment task
- Treat the task as a grounded workflow over apps, APIs, and persistent state, not as a prose QA task.
- Identify the allowed actions/tools, current app state, user goal, and success condition before acting; keep a compact action/state ledger.
- Prefer small reversible environment actions. Re-read observations after each action and avoid assuming hidden state changed unless the environment confirms it.
- Preserve user identity, permissions, dates, IDs, and record integrity; do not fabricate database/API state or skip required app interactions.
- Finish only after the environment state satisfies the requested user outcome, using the benchmark's finish/done action when available.`;
    case 'browsecomp':
      return `Profile: BrowseComp+ style difficult web-research task
- Treat the task as source-grounded research with adversarial ambiguity, not as recall.
- Decompose the question into search facets, run targeted searches, open primary/high-authority sources, and cross-check claims across independent evidence.
- Track source URLs, dates, entity names, and disambiguators; prefer exact quoted evidence only when short and necessary.
- Do not overfit snippets, SEO pages, stale mirrors, or single-source claims. Resolve conflicts explicitly before finalizing.
- Return a concise answer with enough source attribution for the grader/user to audit the reasoning path.`;
    case 'tau2':
      return `Profile: tau2 / Tau-Bench style policy-bound customer workflow
- Treat the task as an interactive customer-service workflow constrained by domain policy, tools, and conversation state.
- Read the policy/context before tool calls; identify allowed, required, and forbidden actions for the specific user request.
- Use only available action schemas and exact required arguments. Confirm tool observations before promising outcomes or taking dependent actions.
- Preserve privacy and account integrity: do not infer unavailable IDs, waive policy constraints, invent inventory/status, or take irreversible actions without policy support.
- Finish with the benchmark's message/finish action only after the requested workflow is either completed or clearly blocked by policy/tool evidence.`;
    case 'generic':
      return `Profile: generic benchmark task
- Identify the benchmark contract from local files and task text.
- Optimize for verified end state, reproducibility, and minimal uncontrolled assumptions.
- Record the commands and evidence that prove completion.`;
    case 'auto':
    default:
      return `Profile: auto-detect
- If the task looks like a repository issue or patch challenge, follow the SWE-bench profile.
- If the task drops you into a sandbox with a verifier/test script, follow the Terminal-Bench profile.
- If the task mentions TerminalWorld, in-the-wild terminal recordings, asciinema-derived tasks, tw_ task ids, instruction.md plus solve.sh/Dockerfile artifacts, or required /app output artifacts, follow the TerminalWorld profile.
- If related prior cases or memory are part of the challenge, follow the SWE-ContextBench profile.
- If the task is a chained dependency, release, package, or API upgrade, follow the SWE-Chain profile.
- If the task mentions SWE-Cycle, SWE-Judge, FullCycle, EnvSetup, CodeImpl, TestGen, run_script, parsing_script, selected_test_files_to_run, environment_setup_commit, before_repo_set_cmd, or bare-repo issue resolution, follow the SWE-Cycle profile.
- If the task mentions SWE-CI, current/target commits, test gaps, maintainability over repository evolution, or the run_tests -> define_requirements -> modify_code loop, follow the SWE-CI profile.
- If the task mentions SWE-PRBench, PRBench, pull request review, code review quality, human review comments, changed files plus diff_patch, or Type1/Type2/Type3 review issue classes, follow the SWE-PRBench profile.
- If the task mentions TML-Bench, tabular ML, Kaggle-style competition, sample_submission, private holdout scoring, train/test CSVs, or valid submission artifacts, follow the TML-Bench profile.
- If the task mentions Pi-Bench, proactive personal assistant, hidden/latent intent, user profile plus message history/file system/current app context, or proactivity/completion scoring, follow the Pi-Bench profile.
- If the task centers on a CI failure, GitHub Actions, workflow logs, or repository patch validation, follow the CI-Repair profile.
- If the task mentions WildClawBench, native-runtime agent work, OpenClaw, multimodal/social/search/safety categories, or long-horizon harness comparison, follow the WildClawBench profile.
- If the task mentions ARC Prize, ARC-AGI, Kaggle ARC, grid abstractions, or no-instructions turn-based environments, follow the ARC-AGI profile.
- If the task mentions SpecBench, visible versus held-out validation, or long-horizon specification compliance, follow the SpecBench profile.
- If the task mentions Reward Hacking Benchmark, RHB, evaluator tampering, train/test leakage, or shortcut opportunities, follow the Reward Hacking profile.
- If the task mentions RoadmapBench, version-upgrade roadmaps, multi-target subtasks, or long-horizon repository development, follow the RoadmapBench profile.
- If the task mentions SaaSBench, enterprise SaaS, validation nodes, multi-component app workflows, tenants, migrations, or cross-service integration, follow the SaaSBench profile.
- If the task mentions SWE-Bench Mobile, iOS/mobile feature work, PRDs, Figma, Swift, Objective-C, Xcode, Android, or simulator/emulator validation, follow the SWE-Bench Mobile profile.
- If the task mentions SWE-WebDevBench, web app creation/modification, vibe coding platforms, virtual software agencies, canary requirements, frontend-backend decoupling, or production-readiness/security scoring, follow the SWE-WebDevBench profile.
- If the task mentions AppWorld, app/API state, user records, calendars, mail, spreadsheets, or environment state transitions, follow the AppWorld profile.
- If the task mentions BrowseComp, BrowseComp+, difficult web research, source-grounded browsing, or multi-hop search, follow the BrowseComp+ profile.
- If the task mentions tau2, Tau-Bench, customer support, airline/retail/telecom policy workflows, or policy-bound tool use, follow the tau2 profile.
- Otherwise follow the generic benchmark profile.`;
  }
}

function benchmarkMethodologySection(): string {
  return `## Source-Grounded Method Stack

Use this workflow as the default benchmark strategy:

1. Localize with issue-relevance.
   - Build a small candidate set of files/functions before editing.
   - Traverse imports, call sites, stack traces, and tests depth-first only while they stay relevant to the issue.
   - Keep a short localization dossier: suspected files, evidence, and why unrelated areas were ruled out.

2. Reproduce before repair.
   - Run the narrowest visible failing command or create a minimal local reproduction when no test is provided.
   - Capture exact command, exit status, and the failing assertion/error.
   - If reproduction is impossible, state what was attempted and fall back to a targeted static diagnosis.

3. Plan the patch with checkpoints.
   - Write/update a todo list before the first edit.
   - For risky or multi-file edits, inspect git state first and keep changes reviewable so failed paths can be reverted without losing unrelated user work.
   - Prefer one coherent root-cause patch over broad speculative rewrites.
   - If benchmark_context shows prior \`replay=\` checkpoints, treat them as a ranked hypothesis trail: verify the current task still matches, retry only the relevant read/search/verifier steps, and ignore any prior pattern listed under warnings.
   - For long-horizon roadmap, SaaS, mobile, WebDevBench, SWE-Cycle, or SWE-CI tasks, keep the checklist milestone-based so partially completed acceptance nodes, canaries, lifecycle phases, CI-loop requirements, and production-readiness gaps stay visible.
   - For SWE-PRBench or PR-review tasks, keep a diff-first finding ledger and resist broad context expansion unless a specific suspected issue needs nearby source, tests, or API contract evidence.
   - For TML-Bench/Kaggle tabular ML tasks, keep a data-contract and submission-validity ledger before modeling so hidden-label leakage and invalid submissions are caught early.
   - For Pi-Bench/proactive assistant tasks, keep a context contract plus proactivity ledger so hidden-intent inference, privacy risk, and clarification decisions stay auditable.
   - For AppWorld, BrowseComp+, and tau2 tasks, keep an action/source/policy ledger so environment changes and citations are auditable.

4. Validate like a verifier.
   - After each patch, run the narrowest relevant test again.
   - Then run the broad verifier/build/test command available in the task.
   - Treat failures as feedback for the next localization loop; do not final-answer on plausible-but-unverified changes.

5. Use current science only when it helps the task.
   - For benchmark-methodology, agent-improvement, model, dataset, or leaderboard work, call \`research_sources\` before synthesis with source-specific coverage: arXiv papers; GitHub \`github_kind:"all"\` for repos/issues/PRs/code; Hugging Face \`kind:"all"\` for papers/models/datasets; Kaggle \`kaggle_kind:"both"\` for datasets/competitions; \`recent_days:90\`; and \`format:"json"\` unless older historical evidence or prose output is explicitly needed.
   - Check the structured source digest before relying on research: if hits are zero, errors are nonzero, or a source family is missing, refine the query or call out the coverage gap.
   - For Terminal-Bench public-agent comparisons, call \`benchmark_repo_catalog\` first to identify known public competitor/source repos, then call \`github_repo_digest\` on the relevant repo(s).
   - If source research returns public GitHub repos that could serve as implementation demonstrations, call \`github_repo_digest\` on the most relevant repo(s), compare manifests, likely commands, CI files, and component surface signals, then verify exact local files before importing any pattern.
   - For local repository repair, prioritize the checkout and verifier over external popularity signals.

6. Guard against contamination.
   - Fresh local task evidence beats memory or recalled benchmark patterns.
   - Do not inspect gold/oracle/answer/hidden-result files unless explicitly allowed.
   - Record evidence, not benchmark claims, in the final answer.`;
}

export function buildBenchmarkPrompt(task: string, cwd: string, profile: BenchmarkProfile = 'auto'): string {
  const normalizedProfile = normalizeBenchmarkProfile(profile);
  const preflight = buildBenchmarkContextReport({ path: cwd, max_files: 400 }, cwd);
  const preflightSnapshot = preflight.isError
    ? `Preflight snapshot unavailable: ${preflight.output}`
    : preflight.output.slice(0, 9000);
  return `# Benchmark-Grade Agent Run

Working directory: ${cwd}

Task:
${task}

${benchmarkProfileSection(normalizedProfile)}

${benchmarkMethodologySection()}

## Automatic Preflight Snapshot

The launcher gathered this read-only snapshot before the agent loop to save early environment-discovery turns. Treat it as orientation, not proof: re-read task-relevant files before editing.

${preflightSnapshot}

## Operating Loop

1. Establish the success oracle.
   - Use the automatic preflight snapshot above. Call \`benchmark_context\` only if the environment changes or the snapshot is incomplete.
   - Find the verifier, test command, hidden/visible test boundary, or expected artifact.
   - For WildClawBench or ARC-AGI work, first identify the sub-benchmark, action/output contract, scoring signal, and public/hidden boundary before assuming this is a patch task.
   - For TerminalWorld work, first identify instruction.md/task text, required \`/app\` artifacts, Docker/service assumptions, visible verifier/tests, and whether solve.sh/reference material is present before assuming this is a source-patch task.
   - For SpecBench or reward-hacking work, distinguish the natural-language specification from the visible validation suite, then plan a broad/generalization check after visible tests pass.
   - For RoadmapBench/SaaSBench/SWE-Bench Mobile/SWE-WebDevBench/SWE-Cycle/SWE-CI work, identify roadmap milestones, validation nodes, canary requirements, lifecycle phases, current/target commit boundaries, test gaps, platform/integration verifiers, production-readiness/security checks, and any version-upgrade or product-flow compatibility boundary before treating this as a local bug fix.
   - For AppWorld/BrowseComp+/tau2 work, identify available actions, required source/policy evidence, finish action, and state-observation loop before taking environment actions.
   - If this is a benchmark-research, agent-improvement, model/dataset, or leaderboard question, use \`research_sources\` before synthesis with targeted kinds: GitHub \`github_kind:"all"\`, Hugging Face \`kind:"all"\`, Kaggle \`kaggle_kind:"both"\`, \`recent_days:90\`, and \`format:"json"\`.
   - For Terminal-Bench source mining, query \`benchmark_repo_catalog\` before ad hoc web discovery.
   - When that research identifies relevant public GitHub repos, use \`github_repo_digest\` before relying on repo-level implementation patterns.

2. Localize before editing.
   - Map relevant files with glob/list_dir/grep.
   - Read the current implementation and nearby tests.
   - Follow issue-relevant dependency/call-site paths; stop traversing when the evidence no longer connects to the task.
   - Keep a short localization dossier before the first edit.
   - Separate task-relevant instructions from distractors before following environmental cues.
   - Avoid broad rewrites until the fault is localized.

3. Reproduce and use memory carefully.
   - Run the narrowest failing command, visible test, or local reproduction before patching when feasible.
   - Search memory for related project conventions or prior fixes when relevant.
   - Use recalled context only after validating it against current files.
   - If the preflight has prior \`replay=\` checkpoints, replay only the relevant read/search/verifier steps as hypotheses; never copy an old patch or ignore current task files.
   - Do not use memory as a substitute for reading the present checkout.

4. Patch minimally with checkpoint discipline.
   - Update the todo list before the first edit and after verification milestones.
   - Inspect git state before risky edits; preserve unrelated user changes.
   - Change production code unless the issue is truly in tests/docs/config.
   - Do not weaken tests, skip verifiers, hardcode benchmark answers, or special-case hidden cases.
   - Preserve public APIs and user compatibility unless the task requires a breaking change.

5. Verify under benchmark pressure.
   - Run the narrowest meaningful test first.
   - For installs, model loads, training, builds, emulators, or broad test suites that can legitimately exceed the default shell timeout, call bash with \`timeoutMs\` (up to 1800000). Do not retry the exact same timed-out command without changing the timeout or strategy.
   - For services, servers, watchers, and daemons, call bash with \`background:true\`, then inspect the returned log path before assuming readiness.
   - Then run the broad verifier or build/test command available in the task.
   - For roadmap/SaaS/mobile/WebDevBench/SWE-Cycle tasks, prefer at least one broad integration, platform, migration, e2e, frontend-backend, production-readiness, security, lifecycle judge, or full build/test verifier after the final edit.
   - For AppWorld/tau2 tasks, verify the latest observation or tool response reflects the intended state; for BrowseComp+, cross-check final claims against opened source evidence.
   - If a verifier fails, diagnose from output and iterate. Do not final-answer on unverified edits.

6. Final response.
   - State changed files and the behavioral fix.
   - List exact verification commands and pass/fail status.
   - Call out unresolved risks honestly if any verifier could not be run.

## Anti-Leakage Rules

- Do not inspect gold patches, oracle solutions, hidden tests, benchmark answer keys, result JSONL from prior submissions, or upstream PR diffs unless the benchmark task explicitly permits it.
- For TerminalWorld-style tasks, treat \`solve.sh\` and reference-solution scripts as oracle material unless explicitly permitted.
- Do not claim leaderboard performance from this run unless the official harness output proves it.
- Do not rely on remembered benchmark solutions. Treat all prior knowledge as potentially contaminated until verified locally.`;
}

// Documentation Update Prompt ----------------------------------------------
export function buildUpdateDocsPrompt(cwd: string): string {
  return `Update project documentation at ${cwd}.

**Documentation Review**:

1. **Find docs**:
   - README.md
   - API documentation (docs/, wiki/, etc.)
   - CHANGELOG.md
   - Code comments and inline docs

2. **Compare with code**:
   - Read the current code
   - Check if docs match implementation
   - Identify outdated sections

3. **Update**:
   - Fix inaccurate sections
   - Add missing features or APIs
   - Update examples with current code
   - Improve unclear explanations

4. **Add**:
   - Document new features not yet documented
   - Add examples for complex features
   - Document configuration options
   - Add troubleshooting sections if missing

Be thorough and ensure all public APIs and features are documented.`;
}

// ── Harness Audit ─────────────────────────────────────────
export function runAudit(cwd: string): AuditReport {
  const checks: QualityCheck[] = [];

  // 1. Git repo check
  checks.push(isGitRepo(cwd)
    ? { name: 'Git Repository', result: 'pass', message: 'Project is version controlled', score: 10 }
    : { name: 'Git Repository', result: 'fail', message: 'Not a git repo — version control recommended', score: 0 },
  );

  // 2. Clean working tree
  if (isGitRepo(cwd)) {
    const status = gitStatus(cwd);
    checks.push(!status
      ? { name: 'Clean Working Tree', result: 'pass', message: 'No uncommitted changes', score: 10 }
      : { name: 'Clean Working Tree', result: 'warn', message: `${status.split('\n').length} uncommitted changes`, score: 5 },
    );
  }

  // 3. Package manager lock file
  const hasLockFile = fileExists(cwd, 'package-lock.json') || fileExists(cwd, 'yarn.lock') ||
    fileExists(cwd, 'pnpm-lock.yaml') || fileExists(cwd, 'bun.lock') ||
    fileExists(cwd, 'Cargo.lock') || fileExists(cwd, 'go.sum') ||
    fileExists(cwd, 'poetry.lock') || fileExists(cwd, 'Pipfile.lock');
  checks.push(hasLockFile
    ? { name: 'Lock File', result: 'pass', message: 'Dependency lock file present', score: 10 }
    : { name: 'Lock File', result: 'warn', message: 'No lock file — builds may not be reproducible', score: 3 },
  );

  // 4. Tests exist
  const hasTests = dirExists(cwd, 'test') || dirExists(cwd, 'tests') || dirExists(cwd, '__tests__') ||
    dirExists(cwd, 'spec') || fileExists(cwd, 'jest.config.js') || fileExists(cwd, 'pytest.ini') ||
    fileExists(cwd, 'vitest.config.ts');
  checks.push(hasTests
    ? { name: 'Test Suite', result: 'pass', message: 'Test directory/config found', score: 15 }
    : { name: 'Test Suite', result: 'fail', message: 'No tests found — testing is essential', score: 0 },
  );

  // 5. .gitignore
  checks.push(fileExists(cwd, '.gitignore')
    ? { name: '.gitignore', result: 'pass', message: '.gitignore present', score: 5 }
    : { name: '.gitignore', result: 'warn', message: 'No .gitignore — may commit unwanted files', score: 2 },
  );

  // 6. README
  const hasReadme = fileExists(cwd, 'README.md') || fileExists(cwd, 'README.txt') || fileExists(cwd, 'README');
  checks.push(hasReadme
    ? { name: 'README', result: 'pass', message: 'README found', score: 5 }
    : { name: 'README', result: 'warn', message: 'No README — documentation recommended', score: 2 },
  );

  // 7. CI/CD
  const hasCI = dirExists(cwd, '.github/workflows') || fileExists(cwd, '.gitlab-ci.yml') ||
    fileExists(cwd, 'Jenkinsfile') || fileExists(cwd, '.circleci/config.yml');
  checks.push(hasCI
    ? { name: 'CI/CD', result: 'pass', message: 'CI/CD configuration found', score: 10 }
    : { name: 'CI/CD', result: 'warn', message: 'No CI/CD — automated testing/deployment recommended', score: 3 },
  );

  // 8. No secrets in repo
  const secretsCheck = checkForSecrets(cwd);
  checks.push(secretsCheck);

  // 9. Linter/formatter config
  const hasLinter = fileExists(cwd, '.eslintrc.json') || fileExists(cwd, '.eslintrc.js') ||
    fileExists(cwd, 'biome.json') || fileExists(cwd, '.prettierrc') ||
    fileExists(cwd, 'rustfmt.toml') || fileExists(cwd, '.golangci.yml') ||
    fileExists(cwd, 'setup.cfg') || fileExists(cwd, 'pyproject.toml');
  checks.push(hasLinter
    ? { name: 'Linter/Formatter', result: 'pass', message: 'Code quality tool configured', score: 10 }
    : { name: 'Linter/Formatter', result: 'warn', message: 'No linter/formatter — code consistency at risk', score: 3 },
  );

  // 10. TypeScript strict (if applicable)
  if (fileExists(cwd, 'tsconfig.json')) {
    const tsCheck = checkTSStrict(cwd);
    checks.push(tsCheck);
  }

  // Calculate totals
  const totalScore = checks.reduce((s, c) => s + c.score, 0);
  const maxScore = checks.length * 15; // max 15 per check
  const pct = (totalScore / maxScore) * 100;
  const grade = pct >= 90 ? 'A' : pct >= 75 ? 'B' : pct >= 60 ? 'C' : pct >= 40 ? 'D' : 'F';

  return { checks, totalScore, maxScore, grade };
}

export function printAuditReport(report: AuditReport): void {
  const gradeColor = { A: chalk.green, B: chalk.cyan, C: chalk.yellow, D: chalk.red, F: chalk.bgRed.white };
  const gc = gradeColor[report.grade as keyof typeof gradeColor] || chalk.white;

  console.log(chalk.cyan('\n  Harness Audit Report'));
  console.log(gc(`  Grade: ${report.grade} (${report.totalScore}/${report.maxScore})\n`));

  for (const c of report.checks) {
    const icon = c.result === 'pass' ? chalk.green('✓') : c.result === 'warn' ? chalk.yellow('⚠') : chalk.red('✗');
    console.log(`  ${icon} ${c.name.padEnd(20)} ${chalk.dim(c.message)}`);
  }
  console.log();
}

// ── Helpers ───────────────────────────────────────────────
function fileExists(cwd: string, name: string): boolean {
  try {
    return existsSync(join(cwd, name));
  } catch { return false; }
}

function dirExists(cwd: string, name: string): boolean {
  try {
    return statSync(join(cwd, name)).isDirectory();
  } catch { return false; }
}

function execSafe(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10_000, stdio: 'pipe' }).trim();
  } catch { return ''; }
}

function checkForSecrets(cwd: string): QualityCheck {
  const dangerous = ['.env', '.env.local', '.env.production'];
  const found: string[] = [];
  for (const f of dangerous) {
    if (fileExists(cwd, f)) {
      // Check if it's gitignored
      const ignored = execSafe(`git check-ignore ${f}`, cwd);
      if (!ignored) found.push(f);
    }
  }

  if (found.length > 0) {
    return {
      name: 'Secrets Safety',
      result: 'fail',
      message: `Unignored secret files: ${found.join(', ')}`,
      score: 0,
    };
  }
  return { name: 'Secrets Safety', result: 'pass', message: 'No exposed secret files', score: 10 };
}

function checkTSStrict(cwd: string): QualityCheck {
  try {
    const content = readFileSync(join(cwd, 'tsconfig.json'), 'utf-8');
    const isStrict = content.includes('"strict": true') || content.includes('"strict":true');
    return isStrict
      ? { name: 'TS Strict Mode', result: 'pass', message: 'TypeScript strict mode enabled', score: 10 }
      : { name: 'TS Strict Mode', result: 'warn', message: 'TypeScript strict mode not enabled', score: 3 };
  } catch {
    return { name: 'TS Strict Mode', result: 'warn', message: 'Could not read tsconfig.json', score: 3 };
  }
}

// ── E2E Framework Detection ────────────────────────────────
export function detectE2EFramework(cwd: string): string {
  try {
    const content = readFileSync(join(cwd, 'package.json'), 'utf-8');

    if (content.includes('"playwright"') || content.includes("'playwright'")) {
      return 'playwright';
    }
    if (content.includes('"cypress"') || content.includes("'cypress'")) {
      return 'cypress';
    }
    if (content.includes('"puppeteer"') || content.includes("'puppeteer'")) {
      return 'puppeteer';
    }

    // Default to Playwright
    return 'playwright';
  } catch {
    // Default to Playwright if package.json cannot be read
    return 'playwright';
  }
}
