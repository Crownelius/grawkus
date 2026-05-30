export interface AheManifestInput {
  task: string;
}

export function parseAheManifestArgs(args: string): AheManifestInput {
  return {
    task: args.replace(/\s+/g, ' ').trim(),
  };
}

function valueOrPlaceholder(value: string, placeholder: string): string {
  return value.trim() || placeholder;
}

export function buildAheManifest(input: AheManifestInput): string {
  const task = valueOrPlaceholder(input.task, '<task or edit target>');
  return [
    'AHE change manifest',
    '',
    `Task/Edit target: ${task}`,
    'Component: <prompt | tool-description | tool-implementation | middleware | skill | memory | adapter | cli-ux | verifier | source-code>',
    'Evidence: <current file/log/test/source observation that justifies the edit>',
    'Root cause: <why the current behavior fails>',
    'Targeted fix: <the smallest harness/code change intended to address that cause>',
    'Prediction: <this change should make which behavior/verifier pass, and why>',
    'At-risk regression: <what could break because of this change>',
    'Verification: <narrow check first; broader/CI check if risk justifies it>',
    'Rollback criteria: <what evidence would prove the edit should be reverted or revised>',
    '',
    'Use before non-trivial edits. After verification, compare the observed result against Prediction and At-risk regression.',
  ].join('\n');
}
