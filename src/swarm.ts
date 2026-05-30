/**
 * Agentic swarming: run several specialized ECC agents against a task,
 * then return their role-scoped findings to the main agent/user.
 *
 * Filesystem writes stay centralized in the main agent. Swarm workers are
 * analysis-only unless a later coordinator adds explicit write locking.
 */

import type { GrawkusConfig, SwarmConfig } from './types.js';
import { streamChat } from './api.js';
import { findEccSkillByName } from './ecc.js';

export const SWARM_SENTINEL = '__SWARM__';
export const DEFAULT_SWARM_MAX_AGENTS = 5;
export const MIN_SWARM_AGENTS = 2;
export const MAX_SWARM_AGENTS = 8;

export interface SwarmAgent {
  name: string;
  prompt: string;
}

export interface SwarmResult {
  agent: string;
  text: string;
  durationMs: number;
  error?: string;
}

export interface SwarmCommandPayload {
  mode: 'auto' | 'legacy';
  task: string;
  agents?: string[];
  execute?: boolean;
}

export interface SwarmPlan {
  task: string;
  agents: string[];
  phases: string[];
  setup: {
    goal: string;
    budget: string;
    target: string;
    assets: string;
    quality: string;
  };
}

export function clampSwarmMaxAgents(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SWARM_MAX_AGENTS;
  return Math.max(MIN_SWARM_AGENTS, Math.min(MAX_SWARM_AGENTS, Math.floor(parsed)));
}

function cleanDefault(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

export function resolveSwarmConfig(config?: SwarmConfig): Required<Pick<SwarmConfig, 'setupWizard' | 'maxAgents'>> & SwarmConfig {
  return {
    ...config,
    setupWizard: config?.setupWizard !== false,
    maxAgents: clampSwarmMaxAgents(config?.maxAgents),
    defaultBudget: cleanDefault(config?.defaultBudget),
    defaultTarget: cleanDefault(config?.defaultTarget),
    defaultAssets: cleanDefault(config?.defaultAssets),
    defaultQuality: cleanDefault(config?.defaultQuality),
  };
}

export function parseSwarmCommandArgs(args: string): { payload: SwarmCommandPayload } | { error: string } {
  let text = args.trim();
  if (!text) {
    return { error: 'Usage: /swarm <task>  or  /swarm --plan-only <task>' };
  }

  let execute = true;
  text = text.replace(/(?:^|\s)--(?:plan-only|no-execute|analysis-only)(?=\s|$)/gi, () => {
    execute = false;
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  text = text.replace(/(?:^|\s)--execute(?=\s|$)/gi, () => {
    execute = true;
    return ' ';
  }).replace(/\s+/g, ' ').trim();

  if (!text) {
    return { error: 'Usage: /swarm <task>  or  /swarm --plan-only <task>' };
  }

  const legacy = text.match(/^([a-z0-9-]+(?:,[a-z0-9-]+)+)\s+([\s\S]+)$/i);
  if (legacy) {
    const agents = legacy[1].split(',').map((item) => item.trim()).filter(Boolean);
    const task = legacy[2].trim();
    if (!task) return { error: 'Usage: /swarm <agent1,agent2> <task>' };
    return { payload: { mode: 'legacy', agents, task, execute } };
  }

  return { payload: { mode: 'auto', task: text, execute } };
}

export function encodeSwarmSentinel(payload: SwarmCommandPayload): string {
  return SWARM_SENTINEL + encodeURIComponent(JSON.stringify(payload));
}

export function decodeSwarmSentinel(value: string): SwarmCommandPayload | null {
  if (!value.startsWith(SWARM_SENTINEL)) return null;
  const raw = value.slice(SWARM_SENTINEL.length);
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<SwarmCommandPayload>;
    if (parsed.mode !== 'auto' && parsed.mode !== 'legacy') return null;
    if (!parsed.task || typeof parsed.task !== 'string') return null;
    if (parsed.agents !== undefined && !Array.isArray(parsed.agents)) return null;
    return {
      mode: parsed.mode,
      task: parsed.task,
      agents: parsed.agents?.map(String),
      execute: parsed.execute !== false,
    };
  } catch {
    return null;
  }
}

export function chooseSwarmAgentSlugs(task: string, maxAgents = DEFAULT_SWARM_MAX_AGENTS): string[] {
  const t = task.toLowerCase();
  const agents = new Set<string>(['planner', 'code-architect']);

  if (/\b(game|web[- ]?game|frontend|ui|ux|react|vite|browser|canvas|three\.?js|css|html)\b/.test(t)) {
    agents.add('typescript-reviewer');
    agents.add('e2e-runner');
    agents.add('performance-optimizer');
  } else if (/\b(research|compare|survey|paper|papers|source|sources|docs|documentation)\b/.test(t)) {
    agents.add('docs-lookup');
    agents.add('code-explorer');
    agents.add('chief-of-staff');
  } else if (/\b(test|build|ci|error|failing|failure|debug|fix|bug|regression)\b/.test(t)) {
    agents.add('build-error-resolver');
    agents.add('silent-failure-hunter');
    agents.add('pr-test-analyzer');
  } else {
    agents.add('type-design-analyzer');
    agents.add('silent-failure-hunter');
  }

  if (/\b(auth|login|oauth|token|secret|permission|security|payment|admin)\b/.test(t)) {
    agents.add('security-reviewer');
  }
  if (/\b(api|database|sql|schema|backend|server|endpoint)\b/.test(t)) {
    agents.add('database-reviewer');
  }

  return Array.from(agents).slice(0, clampSwarmMaxAgents(maxAgents));
}

export function buildSwarmPlan(payload: SwarmCommandPayload, swarmConfig?: SwarmConfig): SwarmPlan {
  const task = payload.task.trim();
  const resolvedConfig = resolveSwarmConfig(swarmConfig);
  const agents = payload.mode === 'legacy' && payload.agents?.length
    ? payload.agents
    : chooseSwarmAgentSlugs(task, resolvedConfig.maxAgents);

  return {
    task,
    agents,
    phases: [
      'setup: infer the five setup fields and call out blockers only if they materially change execution',
      'role pass: each agent produces role-specific risks, decisions, and concrete next actions',
      'coordination: compare overlapping concerns and surface conflicts',
      'handoff: provide a main-agent implementation prompt with verification criteria',
    ],
    setup: inferSwarmSetup(task, resolvedConfig),
  };
}

function inferSwarmSetup(task: string, config: ReturnType<typeof resolveSwarmConfig>): SwarmPlan['setup'] {
  const t = task.toLowerCase();
  return {
    goal: task,
    budget: config.defaultBudget || (/\b(hour|day|week|budget|\$|token|cheap|fast|quick|mvp)\b/.test(t)
      ? 'use the stated task constraints; keep extra model calls bounded'
      : 'default to a compact MVP pass with focused verification'),
    target: config.defaultTarget || (/\b(react|vite|typescript|node|python|rust|go|browser|web|mobile|desktop|cli)\b/.test(t)
      ? 'infer from named platform/stack in the task'
      : 'infer from the current repository and state assumptions explicitly'),
    assets: config.defaultAssets || (/\b(asset|screenshot|design|figma|repo|file|image|data|dataset|api|docs?)\b/.test(t)
      ? 'use named assets/resources from the task and current workspace'
      : 'start from the current workspace; request assets only if missing assets block execution'),
    quality: config.defaultQuality || (/\b(production|ship|release|polish|test|verified|qa|accessible|a11y)\b/.test(t)
      ? 'meet the stated release/quality bar and verify it directly'
      : 'working, reviewable, tested where risk justifies it'),
  };
}

export function buildSwarmAgentTask(plan: SwarmPlan): string {
  return [
    `Swarm task: ${plan.task}`,
    '',
    'Setup wizard snapshot:',
    `- Goal: ${plan.setup.goal}`,
    `- Budget/time: ${plan.setup.budget}`,
    `- Target platform/stack: ${plan.setup.target}`,
    `- Starting assets/resources: ${plan.setup.assets}`,
    `- Quality bar/release target: ${plan.setup.quality}`,
    '',
    'Coordination rules:',
    '- Do not write files or claim changes were made.',
    '- Produce the best role-specific plan/review/spec for the main agent.',
    '- If a setup field is unclear, state the assumption and continue unless it blocks execution.',
    '- Prefer concrete files, commands, checks, interfaces, and acceptance criteria over generic advice.',
    '',
    'You are a swarm worker. Your system prompt defines your role. Return concise findings under: Role focus, Key decisions, Risks, Recommended actions, Verification.',
  ].join('\n');
}

export function resolveAgents(slugs: string[]): SwarmAgent[] {
  const out: SwarmAgent[] = [];
  for (const raw of slugs) {
    const slug = raw.trim();
    if (!slug) continue;
    const skill = findEccSkillByName(`agent: ${slug}`) ?? findEccSkillByName(slug);
    if (!skill) {
      throw new Error(`Unknown agent: "${slug}". Run /ecc-guide agents to see available agents.`);
    }
    out.push({ name: slug, prompt: skill.prompt });
  }
  return out;
}

export async function runSwarm(
  agents: SwarmAgent[],
  task: string,
  config: GrawkusConfig,
): Promise<SwarmResult[]> {
  const results = await Promise.allSettled(
    agents.map(async (agent): Promise<SwarmResult> => {
      const start = Date.now();
      try {
        const messages = [
          { role: 'system' as const, content: agent.prompt },
          { role: 'user' as const, content: task },
        ];
        let text = '';
        for await (const event of streamChat(config, messages, [])) {
          if (event.type === 'text' && event.content) text += event.content;
        }
        return { agent: agent.name, text, durationMs: Date.now() - start };
      } catch (err) {
        return {
          agent: agent.name,
          text: '',
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return results.map((result) => (result.status === 'fulfilled' ? result.value : {
    agent: 'unknown',
    text: '',
    durationMs: 0,
    error: `swarm task crashed: ${result.reason}`,
  }));
}

export function formatSwarmResults(results: SwarmResult[], plan?: SwarmPlan): string {
  const lines: string[] = [];
  if (plan) {
    lines.push('Swarm setup');
    lines.push(`Task: ${plan.task}`);
    lines.push(`Agents: ${plan.agents.join(', ')}`);
    lines.push(`Quality: ${plan.setup.quality}`);
  }

  for (const result of results) {
    lines.push('');
    lines.push('='.repeat(72));
    lines.push(`${result.agent} (${(result.durationMs / 1000).toFixed(1)}s${result.error ? ', ERROR' : ''})`);
    lines.push('-'.repeat(72));
    if (result.error) {
      lines.push(`error: ${result.error}`);
    } else {
      lines.push(result.text.trim() || '(no output)');
    }
  }

  if (plan) {
    lines.push('');
    lines.push('='.repeat(72));
    lines.push('Main-agent handoff prompt');
    lines.push('-'.repeat(72));
    lines.push(buildSwarmHandoffPrompt(plan, results));
  }
  return lines.join('\n');
}

export function buildSwarmHandoffPrompt(plan: SwarmPlan, results: SwarmResult[]): string {
  const successful = results.filter((result) => !result.error);
  const failed = results.filter((result) => result.error);
  return [
    `Use the swarm findings to execute: ${plan.task}`,
    '',
    'Honor these setup assumptions unless the user corrects them:',
    `- Budget/time: ${plan.setup.budget}`,
    `- Target platform/stack: ${plan.setup.target}`,
    `- Assets/resources: ${plan.setup.assets}`,
    `- Quality bar: ${plan.setup.quality}`,
    '',
    'Execution phases:',
    ...plan.phases.map((phase, index) => `${index + 1}. ${phase}`),
    '',
    `Swarm coverage: ${successful.map((result) => result.agent).join(', ') || 'none'}.`,
    failed.length ? `Failed workers to compensate for: ${failed.map((result) => result.agent).join(', ')}.` : 'No worker failures reported.',
    '',
    'Now execute the task end-to-end. Start with a short checklist, make the required changes in the main agent, run focused verification, and summarize remaining assumptions only if they affect the result.',
  ].join('\n');
}
