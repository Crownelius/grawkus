import { exec } from 'node:child_process';
import { resolveUserPath } from './path-utils.js';
import type { Tool, ToolResult } from './types.js';

export const GrepTool: Tool = {
  name: 'grep',
  description:
    'Search file contents using a regex pattern (powered by ripgrep if available, else grep). Returns matching lines with file paths and line numbers.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'Directory or file to search in (default: cwd)',
      },
      include: {
        type: 'string',
        description: 'Glob pattern for files to include (e.g. "*.ts")',
      },
      ignore_case: {
        type: 'boolean',
        description: 'Case-insensitive search (default false)',
      },
      max_results: {
        type: 'number',
        description: 'Max results to return (default 100)',
      },
    },
    required: ['pattern'],
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchPath = input.path ? resolveUserPath(cwd, input.path as string) : cwd;
    const include = input.include as string | undefined;
    const ignoreCase = (input.ignore_case as boolean) || false;
    const maxResults = (input.max_results as number) || 100;

    // Try ripgrep first, fall back to grep
    const iFlag = ignoreCase ? '-i ' : '';
    const globFlag = include ? `--glob "${include}" ` : '';

    const rgCmd = `rg -n ${iFlag}${globFlag}--max-count ${maxResults} -- "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null`;
    const grepCmd = `grep -rn ${iFlag}${include ? `--include="${include}" ` : ''}-- "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -${maxResults}`;

    return new Promise((res) => {
      exec(rgCmd, { cwd, maxBuffer: 5 * 1024 * 1024, timeout: 30_000 }, (err, stdout) => {
        if (stdout && stdout.trim()) {
          res({ output: stdout.trim().slice(0, 80_000), isError: false });
          return;
        }
        // Fallback to grep
        exec(grepCmd, { cwd, maxBuffer: 5 * 1024 * 1024, timeout: 30_000 }, (_err2, stdout2) => {
          if (stdout2 && stdout2.trim()) {
            res({ output: stdout2.trim().slice(0, 80_000), isError: false });
          } else {
            res({ output: 'No matches found.', isError: false });
          }
        });
      });
    });
  },
};
