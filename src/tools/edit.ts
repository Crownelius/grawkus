import { readFileSync, writeFileSync } from 'node:fs';
import { resolveUserPath } from './path-utils.js';
import type { Tool, ToolResult } from './types.js';

export const EditTool: Tool = {
  name: 'edit_file',
  description:
    'Perform a find-and-replace edit on a file. Provide the exact old_string to find and the new_string to replace it with. The old_string must be unique in the file unless replace_all is true.',
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to the file to edit',
      },
      old_string: {
        type: 'string',
        description: 'The exact text to find (must match including whitespace)',
      },
      new_string: {
        type: 'string',
        description: 'The replacement text',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences (default false)',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  isReadOnly: false,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const filePath = resolveUserPath(cwd, input.file_path as string);
      const oldStr = input.old_string as string;
      const newStr = input.new_string as string;
      const replaceAll = (input.replace_all as boolean) || false;

      let content = readFileSync(filePath, 'utf-8');

      const occurrences = content.split(oldStr).length - 1;
      if (occurrences === 0) {
        return { output: `Error: old_string not found in ${filePath}`, isError: true };
      }
      if (occurrences > 1 && !replaceAll) {
        // Show context around first occurrence
        const idx = content.indexOf(oldStr);
        const contextStart = Math.max(0, idx - 200);
        const contextEnd = Math.min(content.length, idx + oldStr.length + 200);
        const context = content.slice(contextStart, contextEnd);
        const preview = context
          .split('\n')
          .slice(0, 5)
          .map((line) => (line.length > 80 ? line.slice(0, 77) + '...' : line))
          .join('\n');

        return {
          output: `Error: old_string found ${occurrences} times — set replace_all=true or provide more context to make it unique.\n\nContext around first match:\n\`\`\`\n${preview}\n\`\`\``,
          isError: true,
        };
      }

      if (replaceAll) {
        content = content.split(oldStr).join(newStr);
      } else {
        content = content.replace(oldStr, newStr);
      }

      writeFileSync(filePath, content, 'utf-8');
      const replaced = replaceAll ? occurrences : 1;
      return {
        output: `Replaced ${replaced} occurrence${replaced > 1 ? 's' : ''} in ${filePath}`,
        isError: false,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: `Error editing file: ${msg}`, isError: true };
    }
  },
};
