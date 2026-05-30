import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveUserPath } from './path-utils.js';
import type { Tool, ToolResult } from './types.js';

export const ListDirTool: Tool = {
  name: 'list_dir',
  description: 'List files and directories at a given path. Shows type (file/dir), size, and name.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list (default: cwd)',
      },
    },
    required: [],
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const dirPath = input.path ? resolveUserPath(cwd, input.path as string) : cwd;
      const entries = readdirSync(dirPath, { withFileTypes: true });

      const lines = entries.slice(0, 500).map((entry) => {
        const fullPath = join(dirPath, entry.name);
        try {
          const stat = statSync(fullPath);
          if (entry.isDirectory()) {
            return `[dir]  ${entry.name}/`;
          }
          const size = formatSize(stat.size);
          return `[file] ${entry.name} (${size})`;
        } catch {
          return `[???]  ${entry.name}`;
        }
      });

      return { output: lines.join('\n') || '(empty directory)', isError: false };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: `Error listing directory: ${msg}`, isError: true };
    }
  },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
