import { describe, expect, it } from 'vitest';
import {
  buildSwarmAgentTask,
  buildSwarmHandoffPrompt,
  buildSwarmPlan,
  chooseSwarmAgentSlugs,
  decodeSwarmSentinel,
  encodeSwarmSentinel,
  formatSwarmResults,
  parseSwarmCommandArgs,
} from '../src/swarm.js';

describe('swarm command redesign', () => {
  it('treats natural task text as the default swarm interface', () => {
    const parsed = parseSwarmCommandArgs('Build a working web-game with keyboard controls');

    expect(parsed).toEqual({
      payload: {
        mode: 'auto',
        task: 'Build a working web-game with keyboard controls',
        execute: true,
      },
    });
  });

  it('supports plan-only swarm runs without auto-executing the handoff', () => {
    const parsed = parseSwarmCommandArgs('--plan-only Build a working web-game with keyboard controls');

    expect(parsed).toEqual({
      payload: {
        mode: 'auto',
        task: 'Build a working web-game with keyboard controls',
        execute: false,
      },
    });
  });

  it('keeps the legacy agent CSV expert shortcut', () => {
    const parsed = parseSwarmCommandArgs('code-architect,silent-failure-hunter audit auth');

    expect(parsed).toEqual({
      payload: {
        mode: 'legacy',
        agents: ['code-architect', 'silent-failure-hunter'],
        task: 'audit auth',
        execute: true,
      },
    });
  });

  it('round-trips the sentinel payload without delimiter ambiguity', () => {
    const payload = {
      mode: 'auto' as const,
      task: 'Build this ||| without breaking JSON',
    };

    expect(decodeSwarmSentinel(encodeSwarmSentinel(payload))).toEqual({ ...payload, execute: true });
  });

  it('selects roles automatically for product, research, and repair tasks', () => {
    expect(chooseSwarmAgentSlugs('Build a React browser game')).toEqual(
      expect.arrayContaining(['planner', 'code-architect', 'typescript-reviewer', 'e2e-runner']),
    );
    expect(chooseSwarmAgentSlugs('Research papers and compare approaches')).toEqual(
      expect.arrayContaining(['planner', 'docs-lookup']),
    );
    expect(chooseSwarmAgentSlugs('Fix the failing CI build regression')).toEqual(
      expect.arrayContaining(['build-error-resolver', 'silent-failure-hunter']),
    );
  });

  it('applies configured role caps and setup defaults to natural tasks', () => {
    expect(chooseSwarmAgentSlugs('Build a React browser game with auth and database', 3)).toHaveLength(3);
    expect(chooseSwarmAgentSlugs('Build a React browser game with auth and database', 99)).toHaveLength(7);

    const plan = buildSwarmPlan(
      { mode: 'auto', task: 'Build a React admin console' },
      {
        maxAgents: 3,
        defaultBudget: 'one focused afternoon',
        defaultTarget: 'Windows PowerShell plus Vite React',
        defaultAssets: 'current workspace only',
        defaultQuality: 'local build and smoke test must pass',
      },
    );

    expect(plan.agents).toHaveLength(3);
    expect(plan.setup).toMatchObject({
      budget: 'one focused afternoon',
      target: 'Windows PowerShell plus Vite React',
      assets: 'current workspace only',
      quality: 'local build and smoke test must pass',
    });
  });

  it('builds a setup-aware analysis task and handoff prompt', () => {
    const plan = buildSwarmPlan({ mode: 'auto', task: 'Ship a tested Vite game MVP' });
    const task = buildSwarmAgentTask(plan);
    const handoff = buildSwarmHandoffPrompt(plan, [
      { agent: 'planner', text: 'Plan output', durationMs: 100 },
    ]);

    expect(task).toContain('Setup wizard snapshot');
    expect(task).toContain('Do not write files');
    expect(task).toContain('Quality bar/release target');
    expect(handoff).toContain('Execution phases');
    expect(handoff).toContain('Now execute the task end-to-end');
  });

  it('formats attributed results plus a main-agent handoff', () => {
    const plan = buildSwarmPlan({ mode: 'legacy', agents: ['planner'], task: 'Plan work' });
    const output = formatSwarmResults([
      { agent: 'planner', text: 'Do these steps.', durationMs: 1234 },
    ], plan);

    expect(output).toContain('Swarm setup');
    expect(output).toContain('planner (1.2s');
    expect(output).toContain('Main-agent handoff prompt');
  });
});
