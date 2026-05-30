import { describe, expect, it } from 'vitest';
import { SkillViewTool } from '../src/tools/skill.js';

describe('skill_view tool', () => {
  it('adds fit guidance before the full skill prompt body', async () => {
    const result = await SkillViewTool.call({ name: 'error-handling' });

    expect(result.isError).toBe(false);
    expect(result.output).toContain('## Fit check');
    expect(result.output).toContain('benchmark_context');
    expect(result.output.indexOf('## Fit check')).toBeLessThan(result.output.indexOf('---'));
  });
});
