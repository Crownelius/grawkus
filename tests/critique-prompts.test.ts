/**
 * Coverage for F5+ DeCRIM 3-stage critique prompts in src/query.ts.
 *
 * The 3 prompts encode the DeCRIM (Decompose-Critique-Refine)
 * structure from arxiv 2410.06458. Each stage has a specific
 * leverage point:
 *
 *   decompose — Forces explicit enumeration of requirements from
 *               the ORIGINAL task before any self-judgment. Without
 *               this, weak models confirm their own confidence.
 *
 *   critique  — Per-item PASS/FAIL with concrete evidence demanded.
 *               "I implemented it" doesn't count; "I ran X and saw
 *               Y" does.
 *
 *   refine    — Only the FAIL items get redone, plus weak-PASS
 *               re-verifications.
 *
 * These tests pin the prompts to their essential characteristics so
 * a careless tweak doesn't quietly turn the gate back into the
 * generic-critique flavor from v1.34.0.
 */
import { afterEach, describe, it, expect } from 'vitest';
import {
  buildEmptyEngagementReminder,
  critiquePromptFor,
  minimumToolCallsBeforeDone,
} from '../src/query.js';

const ORIGINAL_MIN_TOOLS = process.env.GRAWKUS_MIN_TOOL_CALLS_BEFORE_DONE;

afterEach(() => {
  if (ORIGINAL_MIN_TOOLS === undefined) {
    delete process.env.GRAWKUS_MIN_TOOL_CALLS_BEFORE_DONE;
  } else {
    process.env.GRAWKUS_MIN_TOOL_CALLS_BEFORE_DONE = ORIGINAL_MIN_TOOLS;
  }
});

describe('critiquePromptFor', () => {
  describe('decompose stage', () => {
    const prompt = critiquePromptFor('decompose');

    it('mentions the original task as the source of truth', () => {
      expect(prompt.toLowerCase()).toContain('original task');
    });

    it('asks for a numbered list of requirements', () => {
      expect(prompt.toLowerCase()).toMatch(/numbered/);
      expect(prompt.toLowerCase()).toContain('list');
    });

    it('demands quotes from the task, not paraphrase', () => {
      expect(prompt.toLowerCase()).toContain('quote');
      expect(prompt.toLowerCase()).toContain('do not paraphrase');
    });

    it('asks how the requirement is verifiable', () => {
      expect(prompt.toLowerCase()).toMatch(/verif/);
    });

    it('calls out exact paths, formats, services, and environment assumptions', () => {
      const lower = prompt.toLowerCase();
      expect(lower).toContain('exact file names');
      expect(lower).toContain('output paths');
      expect(lower).toContain('service/process');
      expect(lower).toContain('environment/toolchain');
      expect(lower).toContain('network/offline');
    });

    it('does not yet ask the model to judge — only to enumerate', () => {
      // The judgment step comes in stage 2. Stage 1 should not
      // contain PASS/FAIL framing.
      expect(prompt).not.toMatch(/\bPASS\b/);
      expect(prompt).not.toMatch(/\bFAIL\b/);
    });
  });

  describe('critique stage', () => {
    const prompt = critiquePromptFor('critique');

    it('demands PASS or FAIL per item', () => {
      expect(prompt).toContain('PASS');
      expect(prompt).toContain('FAIL');
    });

    it('demands concrete evidence', () => {
      expect(prompt.toLowerCase()).toContain('evidence');
      expect(prompt.toLowerCase()).toMatch(/file path|command output|test/);
    });

    it('explicitly rejects "I implemented it" as evidence', () => {
      expect(prompt.toLowerCase()).toContain('"i implemented it"');
      expect(prompt.toLowerCase()).toMatch(/not evidence/);
    });

    it('encourages honesty over false confidence', () => {
      // The "social cost" framing is empirically important for weak
      // models — they default to self-confirmation otherwise.
      expect(prompt.toLowerCase()).toMatch(/honest|honestly/);
    });

    it('says when uncertain, mark FAIL', () => {
      expect(prompt.toLowerCase()).toMatch(/uncertain.*fail|when in doubt|if you are uncertain/);
    });

    it('requires evidence from the real runtime and persistent services', () => {
      const lower = prompt.toLowerCase();
      expect(lower).toContain('package manager');
      expect(lower).toMatch(/virtualenv|interpreter/);
      expect(lower).toContain('network/offline');
      expect(lower).toContain('service process');
      expect(lower).toContain('persistently');
    });
  });

  describe('refine stage', () => {
    const prompt = critiquePromptFor('refine');

    it('only targets FAIL items + weak-evidence PASSes', () => {
      expect(prompt.toLowerCase()).toContain('fail');
      expect(prompt.toLowerCase()).toMatch(/weak|reflection/);
    });

    it('does not re-do every item — only the failing ones', () => {
      // Critical anti-pattern guard: if this prompt drifts to "redo
      // everything", it becomes Reflexion (known to hurt weak
      // models). DeCRIM only refines failures.
      const lower = prompt.toLowerCase();
      expect(lower).toMatch(/each fail|fail item|failing/);
      expect(lower).not.toContain('redo everything');
      expect(lower).not.toContain('rewrite all');
    });

    it('allows exit when everything is genuinely PASS', () => {
      expect(prompt.toLowerCase()).toMatch(/summar/);
      expect(prompt.toLowerCase()).toContain('stop');
    });

    it('pushes environment mismatch and service persistence recovery', () => {
      const lower = prompt.toLowerCase();
      expect(lower).toContain('project-native toolchain');
      expect(lower).toContain('nohup');
      expect(lower).toContain('tmux');
      expect(lower).toContain('process/port');
    });
  });

  describe('stage discipline (regression guards)', () => {
    it('decompose does not leak into critique', () => {
      // Stage 1 prompt should NOT include the verdict step
      const decompose = critiquePromptFor('decompose');
      expect(decompose).not.toMatch(/\bPASS \|\| FAIL\b/);
    });

    it('all 3 prompts are non-empty and distinct', () => {
      const a = critiquePromptFor('decompose');
      const b = critiquePromptFor('critique');
      const c = critiquePromptFor('refine');
      expect(a.length).toBeGreaterThan(100);
      expect(b.length).toBeGreaterThan(100);
      expect(c.length).toBeGreaterThan(50);
      expect(a).not.toBe(b);
      expect(b).not.toBe(c);
      expect(a).not.toBe(c);
    });
  });
});

describe('minimumToolCallsBeforeDone', () => {
  it('defaults benchmark mode to two concrete tool calls', () => {
    expect(minimumToolCallsBeforeDone('benchmark', {} as NodeJS.ProcessEnv)).toBe(2);
  });

  it('defaults non-benchmark modes to one concrete tool call', () => {
    expect(minimumToolCallsBeforeDone('dev', {} as NodeJS.ProcessEnv)).toBe(1);
  });

  it('supports an explicit env override including zero', () => {
    expect(minimumToolCallsBeforeDone('benchmark', {
      GRAWKUS_MIN_TOOL_CALLS_BEFORE_DONE: '0',
    } as NodeJS.ProcessEnv)).toBe(0);
    expect(minimumToolCallsBeforeDone('dev', {
      GRAWKUS_MIN_TOOL_CALLS_BEFORE_DONE: '4',
    } as NodeJS.ProcessEnv)).toBe(4);
  });
});

describe('buildEmptyEngagementReminder', () => {
  it('tells the model to do concrete tool work before finalizing', () => {
    const reminder = buildEmptyEngagementReminder(0, 2, 'benchmark').toLowerCase();
    expect(reminder).toContain('without enough concrete tool work');
    expect(reminder).toContain('observed tool calls this chain: 0');
    expect(reminder).toContain('minimum expected');
    expect(reminder).toContain('use tools');
    expect(reminder).toContain('purely answer-only');
  });
});
