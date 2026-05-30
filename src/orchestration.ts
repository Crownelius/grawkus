/**
 * Multi-agent orchestration — spawn parallel sub-tasks with different models.
 * Each sub-agent gets its own API call and can use a different model.
 * Results are collected and merged back into the main conversation.
 */
import chalk from 'chalk';
import type { Message, GrawkusConfig } from './types.js';
import { streamChat } from './api.js';
import { ALL_TOOLS } from './tools/index.js';

export interface SubAgent {
  id: string;
  name: string;
  model: string;       // can be different from main model
  task: string;         // what this agent should do
  status: 'pending' | 'running' | 'done' | 'error';
  result?: string;
  startedAt?: number;
  finishedAt?: number;
  tokenCount?: number;
}

export interface OrchestrationPlan {
  mainTask: string;
  agents: SubAgent[];
  strategy: 'parallel' | 'sequential' | 'cascade';
}

let agentCounter = 0;

function createSubAgent(name: string, task: string, model: string): SubAgent {
  return {
    id: `agent-${++agentCounter}`,
    name,
    model,
    task,
    status: 'pending',
  };
}

/**
 * Run a single sub-agent to completion.
 */
async function runSubAgent(
  agent: SubAgent,
  config: GrawkusConfig,
  contextMessages: Message[],
): Promise<void> {
  agent.status = 'running';
  agent.startedAt = Date.now();

  console.log(chalk.cyan(`  [${agent.name}] Starting: ${agent.task.slice(0, 80)}...`));

  const subConfig: GrawkusConfig = { ...config, model: agent.model };
  const messages: Message[] = [
    ...contextMessages.slice(-5), // last 5 messages for context
    { role: 'user', content: agent.task },
  ];

  try {
    let result = '';
    for await (const event of streamChat(subConfig, messages, ALL_TOOLS)) {
      if (event.type === 'text' && event.content) {
        result += event.content;
      }
      if (event.type === 'done' && event.usage) {
        agent.tokenCount = event.usage.total;
      }
    }

    agent.result = result;
    agent.status = 'done';
    agent.finishedAt = Date.now();

    const elapsed = ((agent.finishedAt - agent.startedAt!) / 1000).toFixed(1);
    console.log(chalk.green(`  [${agent.name}] Done (${elapsed}s, ${agent.tokenCount || '?'} tokens)`));
  } catch (err: unknown) {
    agent.status = 'error';
    agent.result = `Error: ${err instanceof Error ? err.message : String(err)}`;
    agent.finishedAt = Date.now();
    console.log(chalk.red(`  [${agent.name}] Error: ${agent.result}`));
  }
}

/**
 * Run multiple sub-agents in parallel.
 */
export async function runParallel(
  agents: SubAgent[],
  config: GrawkusConfig,
  contextMessages: Message[],
): Promise<SubAgent[]> {
  console.log(chalk.cyan(`\n  Orchestrating ${agents.length} agents in parallel...\n`));
  await Promise.all(agents.map((a) => runSubAgent(a, config, contextMessages)));
  return agents;
}

/**
 * Run sub-agents sequentially, each seeing prior results.
 */
export async function runSequential(
  agents: SubAgent[],
  config: GrawkusConfig,
  contextMessages: Message[],
): Promise<SubAgent[]> {
  console.log(chalk.cyan(`\n  Orchestrating ${agents.length} agents sequentially...\n`));
  const messages = [...contextMessages];

  for (const agent of agents) {
    await runSubAgent(agent, config, messages);
    if (agent.result) {
      messages.push(
        { role: 'assistant', content: agent.result },
      );
    }
  }
  return agents;
}

/**
 * Cascade: run fast model first, escalate to powerful if needed.
 */
export async function runCascade(
  task: string,
  config: GrawkusConfig,
  contextMessages: Message[],
  fastModel: string,
  powerModel: string,
): Promise<SubAgent[]> {
  console.log(chalk.cyan('\n  Cascade: trying fast model first...\n'));

  const fast = createSubAgent('fast-pass', task, fastModel);
  await runSubAgent(fast, config, contextMessages);

  // If fast result is short or contains "I don't know" / error signals, escalate
  const needsEscalation =
    !fast.result ||
    fast.result.length < 50 ||
    /i('m| am) not sure|i don't know|cannot|unable to/i.test(fast.result);

  if (needsEscalation) {
    console.log(chalk.yellow('  Escalating to powerful model...'));
    const power = createSubAgent('power-pass', task, powerModel);
    await runSubAgent(power, config, contextMessages);
    return [fast, power];
  }

  return [fast];
}

/**
 * Build an orchestration prompt for the AI to decompose a task.
 */
export function buildOrchestrationPrompt(task: string): string {
  return `Decompose this task into 2-4 parallel sub-tasks that can be executed independently:

Task: ${task}

For each sub-task, specify:
1. A short name (e.g., "frontend-changes")
2. The specific task description
3. Whether it needs a "fast" model (simple/lookup) or "powerful" model (complex/creative)

Format as JSON array:
[
  {"name": "sub-task-name", "task": "description", "tier": "fast|powerful"},
  ...
]

Only output the JSON, no explanation.`;
}

export function mergeResults(agents: SubAgent[]): string {
  const parts: string[] = [];
  for (const a of agents) {
    if (a.result && a.status === 'done') {
      parts.push(`## ${a.name}\n${a.result}`);
    }
  }
  return parts.join('\n\n---\n\n');
}

export function printOrchestrationStatus(agents: SubAgent[]): void {
  console.log(chalk.cyan('\n  Agent Status:'));
  for (const a of agents) {
    const icon = a.status === 'done' ? chalk.green('✓') :
      a.status === 'error' ? chalk.red('✗') :
      a.status === 'running' ? chalk.yellow('⟳') : chalk.dim('○');
    const elapsed = a.startedAt && a.finishedAt
      ? `${((a.finishedAt - a.startedAt) / 1000).toFixed(1)}s`
      : '';
    console.log(`  ${icon} ${a.name.padEnd(20)} ${a.model.padEnd(30)} ${elapsed}`);
  }
  console.log();
}

export { createSubAgent };
