import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectStateDir } from './config.js';
import {
  compactLargeToolOutput,
  QUICK_TOOL_OUTPUT_TRIGGER_CHARS,
} from './compaction.js';

export interface ArchivedToolOutput {
  output: string;
  archived: boolean;
  logPath?: string;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toolOutputLogPath(cwd: string, toolName: string): string {
  const dir = join(getProjectStateDir(cwd), 'tool-output');
  mkdirSync(dir, { recursive: true });
  const safeTool = toolName.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'tool';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(dir, `${stamp}-${safeTool}-${randomBytes(3).toString('hex')}.txt`);
}

export function archiveLargeToolOutput(
  cwd: string,
  toolName: string,
  output: unknown,
): ArchivedToolOutput {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
  const trigger = envNumber('GRAWKUS_TOOL_OUTPUT_ARCHIVE_CHARS', QUICK_TOOL_OUTPUT_TRIGGER_CHARS);
  if (text.length <= trigger) {
    return { output: text, archived: false };
  }

  const logPath = toolOutputLogPath(cwd, toolName);
  writeFileSync(
    logPath,
    [
      '[grawkus tool output]',
      `tool: ${toolName}`,
      `cwd: ${cwd}`,
      `chars: ${text.length}`,
      `savedAt: ${new Date().toISOString()}`,
      '',
      text,
    ].join('\n'),
    'utf-8',
  );

  const compacted = compactLargeToolOutput(text, trigger);
  return {
    output:
      compacted +
      `\n\n[full tool output saved to ${logPath}; use read_file or bash grep on this path if the omitted middle is needed.]`,
    archived: true,
    logPath,
  };
}
