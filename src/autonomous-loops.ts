/**
 * Autonomous loop execution system for iterative workflows.
 * Inspired by everything-claude-code: enables VerificationLoop, PRReviewLoop,
 * SequentialPipeline, and DAGOrchestration patterns.
 */

import chalk from 'chalk';

// ── Loop Configuration ────────────────────────────────────────────────

export interface LoopConfig {
  maxIterations: number;
  stopCondition: 'success' | 'no-change' | 'manual';
  timeout: number; // ms
}

// ── Pipeline Step ─────────────────────────────────────────────────────

export interface PipelineStep {
  id: string;
  name: string;
  task: string;
  dependsOn: string[]; // step IDs
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  result?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

// ── DAG Definition ────────────────────────────────────────────────────

export interface DAG {
  steps: PipelineStep[];
  strategy: 'parallel-max' | 'sequential' | 'topological';
}

// ── Verification Loop ─────────────────────────────────────────────────

export interface VerificationLoopState {
  iteration: number;
  testsPassed: boolean;
  lastError?: string;
  fixHistory: string[];
}

// ── PR Review Loop ────────────────────────────────────────────────────

export interface PRReviewState {
  iteration: number;
  approved: boolean;
  comments: string[];
  reviewHistory: string[];
}

/**
 * Build a prompt for iterative PR review.
 * Instructs the agent to review the PR, address comments, and re-review until approved.
 */
export function buildPRLoopPrompt(cwd: string): string {
  return `You are a thorough code reviewer in an autonomous PR review loop.

Working directory: ${cwd}

Your task is to:
1. Review the current PR changes
2. Identify issues, improvements, or feedback
3. Suggest fixes or clarifications
4. After fixes are applied, re-review until you approve

Loop Instructions:
- On each iteration, provide clear, actionable feedback
- Mark feedback as CRITICAL, MAJOR, or MINOR
- Track which issues have been resolved
- When all issues are resolved, respond with: "PR_APPROVED"
- If no changes are made after feedback, respond with: "NO_CHANGES_DETECTED"
- Maximum 5 iterations allowed

Format your response as:
\`\`\`
## Review Iteration [N]
### Issues Found:
- [issue]: [description]

### Approved: [yes/no]
### Next Steps: [what needs fixing]
\`\`\``;
}

/**
 * Build a prompt for sequential pipeline execution.
 * Each task can reference the output of prior tasks.
 */
export function buildSequentialPipelinePrompt(tasks: string[]): string {
  const taskList = tasks
    .map((task, i) => `${i + 1}. ${task}`)
    .join('\n');

  return `Execute the following tasks sequentially. Each task can reference the output of prior tasks.

## Tasks:
${taskList}

## Execution Rules:
- Run tasks in the specified order
- Each task sees all prior outputs
- After completing each task, summarize the result
- If a task fails, explain the error and attempt recovery
- Continue to the next task even if recovery is partial (unless critical)

For each task, format your response:
\`\`\`
## Task [N]: [name]
### Input from prior tasks: [summary or "none"]
### Execution:
[your work here]

### Result:
[clear summary of what was accomplished]

### Status: [success/partial/failed]
\`\`\`

After all tasks, provide a final summary of the entire pipeline.`;
}

/**
 * Build a prompt for DAG (directed acyclic graph) execution.
 * Steps run in dependency order, potentially in parallel where possible.
 */
export function buildDAGPrompt(dag: DAG): string {
  const stepList = dag.steps
    .map(
      (step) =>
        `- ${step.id} (${step.name}): ${step.task}${
          step.dependsOn.length > 0 ? ` [depends on: ${step.dependsOn.join(', ')}]` : ''
        }`,
    )
    .join('\n');

  const strategyDescription =
    dag.strategy === 'parallel-max'
      ? 'Run steps in parallel whenever dependencies allow.'
      : dag.strategy === 'sequential'
        ? 'Run steps one at a time in dependency order.'
        : 'Run steps in topological layers for optimal parallelism.';

  return `Execute the following task graph (DAG). Each step may depend on prior steps.

## Task Graph:
${stepList}

## Strategy: ${dag.strategy}
${strategyDescription}

## Execution Rules:
- Respect all dependency relationships
- Skip a step if its dependency failed (mark as skipped)
- For parallel execution, run independent steps concurrently
- Capture the result of each step for dependent steps to use
- On error, log clearly and continue (unless critical)

For each step, format your response:
\`\`\`
## Step: [id] - [name]
### Dependencies: [list of completed prior steps or "none"]
### Execution:
[your work here]

### Result:
[clear output]

### Status: [success/skipped/failed]
\`\`\`

After all steps, provide a final summary of the DAG execution.`;
}

/**
 * Topological sort of PipelineStep array.
 * Returns an array of arrays, where each inner array is an execution layer.
 * Steps in the same layer have no inter-dependencies and can run in parallel.
 */
export function topologicalSort(steps: PipelineStep[]): PipelineStep[][] {
  const layers: PipelineStep[][] = [];
  const stepMap = new Map<string, PipelineStep>(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const inProgress = new Set<string>();

  function visit(step: PipelineStep, depth: number): number {
    if (visited.has(step.id)) {
      // Already processed; find which layer it's in
      for (let i = 0; i < layers.length; i++) {
        if (layers[i].some((s) => s.id === step.id)) {
          return i;
        }
      }
      return 0;
    }

    if (inProgress.has(step.id)) {
      throw new Error(`Circular dependency detected at step ${step.id}`);
    }

    inProgress.add(step.id);

    // Visit all dependencies first
    let maxDepth = depth;
    for (const depId of step.dependsOn) {
      const dep = stepMap.get(depId);
      if (dep) {
        const depDepth = visit(dep, depth + 1);
        maxDepth = Math.max(maxDepth, depDepth + 1);
      }
    }

    inProgress.delete(step.id);
    visited.add(step.id);

    // Ensure we have enough layers
    while (layers.length <= maxDepth) {
      layers.push([]);
    }

    // Add this step to its layer
    layers[maxDepth].push(step);

    return maxDepth;
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      visit(step, 0);
    }
  }

  return layers;
}

/**
 * Pretty-print the status of a DAG using chalk colors.
 */
export function printDAGStatus(dag: DAG): void {
  console.log(chalk.cyan('\n  ═══ DAG Execution Status ═══\n'));

  const stepMap = new Map<string, PipelineStep>(dag.steps.map((s) => [s.id, s]));
  const layers = topologicalSort(dag.steps);

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const layer = layers[layerIdx];
    console.log(chalk.blue(`  Layer ${layerIdx + 1}:`));

    for (const step of layer) {
      const icon =
        step.status === 'done'
          ? chalk.green('✓')
          : step.status === 'error'
            ? chalk.red('✗')
            : step.status === 'running'
              ? chalk.yellow('⟳')
              : step.status === 'skipped'
                ? chalk.dim('─')
                : chalk.dim('○');

      const elapsed =
        step.startedAt && step.finishedAt
          ? `${((step.finishedAt - step.startedAt) / 1000).toFixed(1)}s`
          : '';

      const deps = step.dependsOn.length > 0 ? ` [deps: ${step.dependsOn.join(', ')}]` : '';

      console.log(
        `    ${icon} ${step.id.padEnd(20)} ${step.name.padEnd(25)} ${elapsed.padEnd(8)}${deps}`,
      );

      if (step.error) {
        console.log(chalk.red(`       Error: ${step.error.slice(0, 60)}`));
      }
    }
    console.log();
  }
}

/**
 * Build a prompt for multi-agent task decomposition.
 * Instructs the agent to break down a task into subtasks for parallel/sequential execution.
 */
export function buildMultiPlanPrompt(task: string): string {
  return `Decompose the following task into 2-5 independent subtasks that can be executed in parallel or sequence:

Task: ${task}

For each subtask, provide:
1. Subtask ID (e.g., "backend-setup")
2. Subtask name
3. Clear description of what to do
4. Any dependencies on other subtasks (or "none")
5. Estimated complexity: low/medium/high

Format as JSON array:
[
  {
    "id": "subtask-id",
    "name": "Subtask Name",
    "description": "What this subtask does",
    "dependsOn": ["other-id"] or [],
    "complexity": "low|medium|high"
  },
  ...
]

Only output the JSON, no explanation.`;
}

/**
 * Build a prompt for executing a multi-agent plan.
 * Takes a JSON plan and generates execution instructions.
 */
export function buildMultiExecutePrompt(plan: string): string {
  return `Execute the following task plan. Each subtask may have dependencies.

## Plan:
${plan}

## Execution Instructions:
1. Parse the plan to understand subtask dependencies
2. Execute subtasks in order (respecting dependencies)
3. For independent subtasks, you may mention running them in parallel
4. After completing each subtask, summarize its result
5. If a subtask fails, attempt recovery or skip dependent tasks
6. Provide a final summary of all subtask results

Format each subtask execution as:
\`\`\`
## Subtask: [id] - [name]
### Execution:
[your work]

### Result:
[output]

### Status: [success/failed/skipped]
\`\`\``;
}

/**
 * Build a prompt for orchestrating backend service changes.
 * Useful for coordinating changes across multiple backend services.
 */
export function buildMultiBackendPrompt(services: string[]): string {
  const serviceList = services.map((s, i) => `${i + 1}. ${s}`).join('\n');

  return `You are orchestrating changes across multiple backend services.

## Services to coordinate:
${serviceList}

## Coordination Rules:
1. Identify dependencies between services (if service A depends on service B, B must be updated first)
2. Group changes by update type (API changes, database migrations, configuration)
3. Create a safe update sequence that minimizes downtime
4. For each service, specify:
   - What changes are needed
   - Any pre-requisites or migrations
   - Testing strategy
   - Rollback plan

5. Consider:
   - API compatibility (version gates if needed)
   - Database schema compatibility
   - Gradual rollout vs. big bang
   - Health checks and monitoring

Format your response:
\`\`\`
## Update Plan

### Phase 1: Preparation
- Service changes to make
- Migrations to run
- Infrastructure checks

### Phase 2: Gradual Rollout
- Service update order
- Health checks between updates
- Rollback triggers

### Phase 3: Validation
- Integration tests to run
- Metrics to monitor
- Success criteria
\`\`\``;
}

/**
 * Build a prompt for orchestrating frontend component changes.
 * Useful for coordinating changes across multiple frontend components.
 */
export function buildMultiFrontendPrompt(components: string[]): string {
  const componentList = components.map((c, i) => `${i + 1}. ${c}`).join('\n');

  return `You are orchestrating changes across multiple frontend components.

## Components to coordinate:
${componentList}

## Coordination Rules:
1. Map component dependencies (if ComponentA uses ComponentB, B must be updated first)
2. Identify shared state or context that multiple components use
3. Plan the update sequence to maintain app stability
4. For each component, specify:
   - Props/API changes needed
   - State management updates
   - CSS/styling updates
   - Test coverage needed

5. Consider:
   - Backward compatibility (graceful degradation)
   - Build system impact
   - Bundle size implications
   - Visual regression testing

Format your response:
\`\`\`
## Component Update Plan

### Dependency Graph
[List component dependencies]

### Update Sequence
[Order of component updates]

### Per-Component Changes
For each component:
- Props/API changes
- State updates
- Styling updates
- Tests to add/update

### Integration Testing
[How to verify components work together]

### Rollback Plan
[If something breaks]
\`\`\``;
}

/**
 * Build a general autonomous loop prompt.
 * Supports various loop types: verification, review, exploration, convergence, etc.
 */
export function buildLoopOperatorPrompt(task: string, loopType: string): string {
  const loopInstructions = getLoopTypeInstructions(loopType);

  return `You are running an autonomous loop of type: ${loopType}

Task: ${task}

## Loop Operating System:
${loopInstructions}

## General Loop Rules:
1. Each iteration, perform the loop action and evaluate the stopping condition
2. If the stopping condition is met, output "LOOP_COMPLETE" and summarize
3. If the stopping condition is not met, iterate again
4. Maximum 10 iterations allowed (unless specified otherwise)
5. After each iteration, provide a status update

Format each iteration as:
\`\`\`
## Iteration [N]
### Action:
[what you did]

### Evaluation:
[did the stopping condition pass?]

### Status:
[continue/complete]
\`\`\`

After loop completion, provide a final summary.`;
}

/**
 * Helper function to generate loop-type-specific instructions.
 */
function getLoopTypeInstructions(loopType: string): string {
  const instructions: Record<string, string> = {
    verification: `
This is a VERIFICATION LOOP:
1. Run tests for the target code
2. If tests pass, stopping condition is met (LOOP_COMPLETE)
3. If tests fail, identify the issue and propose a fix
4. Apply the fix and re-run tests
5. Iterate until tests pass or max iterations reached
    `,

    review: `
This is a REVIEW LOOP:
1. Review the current state/code/design
2. Identify issues, gaps, or improvements
3. If no issues found, stopping condition is met (LOOP_COMPLETE)
4. If issues found, address them one by one
5. Re-review after fixes and iterate until all issues resolved
    `,

    exploration: `
This is an EXPLORATION LOOP:
1. Explore the current state to understand it
2. Ask clarifying questions or gather information
3. If sufficient understanding is achieved, stopping condition is met (LOOP_COMPLETE)
4. If gaps remain, dig deeper or investigate specific areas
5. Repeat until you have a complete mental model
    `,

    convergence: `
This is a CONVERGENCE LOOP:
1. Generate or refine a solution
2. Evaluate it against criteria
3. If it meets all criteria, stopping condition is met (LOOP_COMPLETE)
4. If gaps remain, identify what needs improvement
5. Refine the solution and re-evaluate
6. Iterate until solution converges to acceptable quality
    `,

    debugging: `
This is a DEBUGGING LOOP:
1. Identify the symptom or error
2. Form a hypothesis about the root cause
3. Test the hypothesis with evidence
4. If confirmed, stopping condition is met (LOOP_COMPLETE)
5. If not confirmed, form a new hypothesis
6. Iterate until root cause is identified and explained
    `,

    optimization: `
This is an OPTIMIZATION LOOP:
1. Measure the current performance or quality metric
2. Identify opportunities to improve
3. Apply an optimization
4. Re-measure and check for improvement
5. If metric reaches target, stopping condition is met (LOOP_COMPLETE)
6. If not, apply another optimization
7. Iterate until target is reached or diminishing returns found
    `,

    default: `
This is a GENERIC AUTONOMOUS LOOP:
1. On each iteration, work toward the task goal
2. Evaluate progress: Are you closer to completion?
3. If task is complete, stopping condition is met (LOOP_COMPLETE)
4. If not, identify next steps and continue
5. Iterate until task is complete or max iterations reached
    `,
  };

  return instructions[loopType] || instructions['default'];
}

/**
 * Helper function to compute the status of all steps in a DAG.
 * Returns a summary string for logging.
 */
export function summarizeDAGStatus(dag: DAG): string {
  const totalSteps = dag.steps.length;
  const doneSteps = dag.steps.filter((s) => s.status === 'done').length;
  const errorSteps = dag.steps.filter((s) => s.status === 'error').length;
  const skippedSteps = dag.steps.filter((s) => s.status === 'skipped').length;
  const runningSteps = dag.steps.filter((s) => s.status === 'running').length;
  const pendingSteps = dag.steps.filter((s) => s.status === 'pending').length;

  const parts: string[] = [];
  if (doneSteps > 0) parts.push(chalk.green(`${doneSteps} done`));
  if (errorSteps > 0) parts.push(chalk.red(`${errorSteps} error`));
  if (skippedSteps > 0) parts.push(chalk.dim(`${skippedSteps} skipped`));
  if (runningSteps > 0) parts.push(chalk.yellow(`${runningSteps} running`));
  if (pendingSteps > 0) parts.push(chalk.dim(`${pendingSteps} pending`));

  return `DAG: ${totalSteps} total steps [${parts.join(', ')}]`;
}

/**
 * Helper function to check if a DAG has completed successfully.
 */
export function isDAGComplete(dag: DAG): boolean {
  return (
    dag.steps.every((s) => s.status === 'done' || s.status === 'skipped' || s.status === 'error') &&
    dag.steps.some((s) => s.status === 'done')
  );
}

/**
 * Helper function to check if a DAG has failed.
 */
export function hasDAGFailed(dag: DAG): boolean {
  return dag.steps.some((s) => s.status === 'error');
}

/**
 * Helper function to collect all results from a completed DAG.
 */
export function collectDAGResults(dag: DAG): Record<string, string | undefined> {
  const results: Record<string, string | undefined> = {};
  for (const step of dag.steps) {
    results[step.id] = step.result;
  }
  return results;
}

/**
 * Helper function to format a DAG as a readable plan.
 */
export function formatDAGAsPlan(dag: DAG): string {
  const layers = topologicalSort(dag.steps);
  const lines: string[] = ['# Execution Plan\n'];

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    lines.push(`## Layer ${i + 1} (Parallel Execution Possible)\n`);

    for (const step of layer) {
      const deps = step.dependsOn.length > 0 ? ` depends on [${step.dependsOn.join(', ')}]` : '';
      lines.push(`- **${step.id}**: ${step.name}${deps}`);
      lines.push(`  - Task: ${step.task}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
