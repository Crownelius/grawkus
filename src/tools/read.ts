import { readFileSync, statSync } from 'node:fs';
import { resolveUserPath } from './path-utils.js';
import type { Tool, ToolResult } from './types.js';

export const ReadTool: Tool = {
  name: 'read_file',
  description:
    'Read the contents of a file. Returns numbered lines. For large files, use offset and limit to read a portion.',
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute or relative path to the file',
      },
      offset: {
        type: 'number',
        description: 'Line number to start from (0-based, default 0)',
      },
      limit: {
        type: 'number',
        description: 'Max lines to read (default 2000)',
      },
    },
    required: ['file_path'],
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const filePath = resolveUserPath(cwd, input.file_path as string);
      const stat = statSync(filePath);

      if (stat.isDirectory()) {
        return { output: `Error: "${filePath}" is a directory, not a file.`, isError: true };
      }

      if (stat.size > 5 * 1024 * 1024) {
        return { output: `Error: File is ${(stat.size / 1024 / 1024).toFixed(1)}MB — too large. Use offset/limit.`, isError: true };
      }

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const offset = (input.offset as number) || 0;
      const limit = (input.limit as number) || 2000;
      const slice = lines.slice(offset, offset + limit);

      const numbered = slice
        .map((line, i) => `${(offset + i + 1).toString().padStart(5)}\t${line}`)
        .join('\n');

      let result = numbered;
      if (lines.length > offset + limit) {
        result += `\n\n... (${lines.length - offset - limit} more lines)`;
      }
      return { output: result || '(empty file)', isError: false };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: `Error reading file: ${msg}`, isError: true };
    }
  },
};
