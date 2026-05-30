/**
 * skill_view tool — the Level-1 step in the progressive-disclosure
 * skill schema (M2 item 3, from the Sentience audit).
 *
 * Background. The system prompt used to inject the FULL prompt body of
 * the best-matching ECC skill on every turn (up to 4KB). With 228
 * skills bundled, even injecting only one match costs a lot of tokens
 * for every interaction. Sentience mode solves this with three loading
 * levels:
 *
 *   Level 0 — names + one-line descriptions ONLY in system prompt
 *             (~30-60 chars per skill × top-3 = ~200 char overhead)
 *   Level 1 — full prompt body, loaded on demand by skill_view(name)
 *   Level 2 — referenced sub-files inside a skill (not implemented;
 *             our skills are flat one-file SKILL.md units)
 *
 * The model sees Level 0 candidates and decides whether to escalate.
 * If a skill name looks irrelevant, it skips the lookup entirely. If
 * a skill clearly fits, one tool call gets the full text. Net effect
 * for most turns: lower system-prompt cost, occasional one-turn
 * expansion when a skill is actually needed.
 *
 * skill_view is read-only and non-destructive, so it bypasses every
 * permission gate.
 */

import type { Tool, ToolResult } from './types.js';
import { findEccSkillByName } from '../ecc.js';

export const SkillViewTool: Tool = {
  name: 'skill_view',
  description:
    'Load the FULL prompt body of a bundled skill by name. The system prompt ' +
    'lists relevant skills as names + one-line descriptions (Level 0 disclosure); ' +
    'call this tool to read the full skill content (Level 1) when one of those ' +
    'names looks like it applies to the current request. Returns the skill\'s ' +
    'description + full prompt text. Use the exact name from the system prompt ' +
    'or any unique substring.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Skill name (exact or unique substring, case-insensitive)',
      },
    },
    required: ['name'],
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input): Promise<ToolResult> {
    try {
      const name = String(input.name || '').trim();
      if (!name) return { output: 'Error: name required.', isError: true };
      const skill = findEccSkillByName(name);
      if (!skill) {
        return { output: `No skill matches "${name}". Check the Level-0 list in the system prompt for available names.`, isError: false };
      }
      const out: string[] = [
        `# ${skill.name}`,
        '',
        `**Category:** ${skill.category}`,
        `**Triggers:** ${skill.triggers.slice(0, 8).join(', ')}${skill.triggers.length > 8 ? '…' : ''}`,
        `**Description:** ${skill.description}`,
        '',
        '## Fit check',
        '',
        '- Apply this skill only when the current task and local repo evidence match its domain and triggers.',
        '- For benchmark or leaderboard runs, prefer one strongly-fit skill and avoid loading additional generic skills unless new evidence requires them.',
        '- Treat examples as patterns, not version-authoritative instructions; local files, benchmark_context, and verifier output override this prompt.',
        '',
        '---',
        '',
        skill.prompt,
      ];
      return { output: out.join('\n'), isError: false };
    } catch (e) {
      return { output: `Error loading skill: ${e instanceof Error ? e.message : e}`, isError: true };
    }
  },
};
