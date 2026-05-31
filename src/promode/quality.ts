import type { PromodeQuality } from '../types.js';

const RELAXED = `
## Quality (relaxed)
Be thorough and evidence-backed, but do not block on impossible gates. Prefer running relevant tests and showing diffs before claiming done.
`;

const STANDARD = `
## Quality (standard)
Before claiming work is complete:
- Run relevant tests or verification commands and cite output.
- Fix linter issues you introduce.
- Update docs when behavior or CLI changes.
Do not claim "finished" without verification evidence.
`;

const STRICT = `
## Quality (strict — ProMode submission gates)
You CANNOT submit code, commit, PR, or say you are "finished" until:
1. Code review left NO unresolved critical issues
2. Lints show NO new bugs you introduced
3. All tests pass with meaningful coverage of changed behavior
4. Visual/game testing approved when applicable
Use fresh subagent-style re-review after substantive fixes.
`;

export function getQualityPromptAddition(quality: PromodeQuality = 'standard'): string {
  switch (quality) {
    case 'relaxed': return RELAXED;
    case 'strict': return STRICT;
    default: return STANDARD;
  }
}
