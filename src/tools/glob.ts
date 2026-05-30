import { glob } from 'glob';
import { resolveUserPath } from './path-utils.js';
import type { Tool, ToolResult } from './types.js';

export const GlobTool: Tool = {
  name: 'glob',
  description:
    'Find files matching a glob pattern (e.g. "**/*.ts", "src/**/*.js"). Returns file paths sorted by modification time.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern (e.g. "**/*.py", "src/**/test_*.ts")',
      },
      path: {
        type: 'string',
        description: 'Base directory to search in (default: cwd)',
      },
      max_results: {
        type: 'number',
        description: 'Max files to return (default 200)',
      },
    },
    required: ['pattern'],
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const pattern = input.pattern as string;
      const base = input.path ? resolveUserPath(cwd, input.path as string) : cwd;
      const maxResults = (input.max_results as number) || 200;

      const files = await glob(pattern, {
        cwd: base,
        nodir: true,
        absolute: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
        maxDepth: 20,
      });

      if (files.length === 0) {
        return { output: 'No files matched the pattern.', isError: false };
      }

      const result = files.slice(0, maxResults).join('\n');
      let output = result;
      if (files.length > maxResults) {
        output += `\n\n... (${files.length - maxResults} more files)`;
      }
      return { output, isError: false };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: `Error: ${msg}`, isError: true };
    }
  },
};
