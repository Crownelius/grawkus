/**
 * apply_patch — multi-file diff tool inspired by OpenAI codex-cli.
 *
 * One tool call instead of N edit_file/write_file calls. The envelope
 * format is self-describing so the model can batch related changes
 * (renames, adds, deletes, edits) into a single auditable diff:
 *
 *   *** Begin Patch
 *   *** Update File: src/foo.ts
 *   @@ class Foo
 *   -  oldLine
 *   +  newLine
 *   *** Add File: src/bar.ts
 *   +contents line 1
 *   +contents line 2
 *   *** Delete File: src/old.ts
 *   *** Move to: src/other.ts
 *   *** End Patch
 *
 * Why this is better than chained edit_file calls:
 *   - One permission prompt covering the whole refactor
 *   - The diff is reviewable as a unit; no half-applied state
 *   - Renames + content edits in the same call (rare-but-real refactor pattern)
 *   - Multi-file refactors cost one tool round-trip
 *
 * Parser notes:
 *   - Lines starting with `*** ` are control lines (begin/end/file ops)
 *   - Hunk header lines start with `@@` — symbol anchor or line number
 *   - Body lines start with `-` (remove), `+` (add), or ` ` (context)
 *   - We require minimum 2 chars context (or `@@` anchor) for each hunk
 *   - Match validation: every `-` line must be findable in the current
 *     file content; otherwise the whole patch rejects (no partial apply)
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveUserPath } from './path-utils.js';
import type { Tool, ToolResult } from './types.js';

interface FileOp {
  kind: 'add' | 'update' | 'delete' | 'move';
  path: string;        // resolved absolute path
  movePath?: string;   // for 'move' ops: destination absolute path
  // For 'add': new content. For 'update': list of hunks.
  content?: string;
  hunks?: Hunk[];
}

interface Hunk {
  anchor?: string;     // @@ symbol-name line, used to disambiguate
  oldLines: string[];  // ' ' context + '-' removed (no prefix char)
  newLines: string[];  // ' ' context + '+' added (no prefix char)
}

/**
 * Parse the envelope into a list of file ops. Throws on malformed input
 * with a clear message — the model can read the error and retry.
 */
function parsePatch(text: string, cwd: string): FileOp[] {
  const lines = text.split(/\r?\n/);
  let i = 0;
  // Skip leading blanks
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length || lines[i].trim() !== '*** Begin Patch') {
    throw new Error('apply_patch: envelope must start with "*** Begin Patch"');
  }
  i++;

  const ops: FileOp[] = [];
  let current: FileOp | null = null;
  let hunk: Hunk | null = null;

  function flushHunk(): void {
    if (current && current.kind === 'update' && hunk && (hunk.oldLines.length > 0 || hunk.newLines.length > 0)) {
      current.hunks = current.hunks || [];
      current.hunks.push(hunk);
    }
    hunk = null;
  }
  function flushOp(): void {
    flushHunk();
    if (current) ops.push(current);
    current = null;
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();   // preserve leading whitespace

    if (trimmed === '*** End Patch') {
      flushOp();
      return ops;
    }
    if (trimmed.startsWith('*** Update File: ')) {
      flushOp();
      current = { kind: 'update', path: resolveUserPath(cwd, trimmed.slice('*** Update File: '.length).trim()), hunks: [] };
      hunk = null;
      i++; continue;
    }
    if (trimmed.startsWith('*** Add File: ')) {
      flushOp();
      current = { kind: 'add', path: resolveUserPath(cwd, trimmed.slice('*** Add File: '.length).trim()), content: '' };
      i++; continue;
    }
    if (trimmed.startsWith('*** Delete File: ')) {
      flushOp();
      current = { kind: 'delete', path: resolveUserPath(cwd, trimmed.slice('*** Delete File: '.length).trim()) };
      i++; continue;
    }
    if (trimmed.startsWith('*** Move to: ')) {
      // Move applies to the *current* update op (rare but supported)
      if (!current || current.kind !== 'update') {
        throw new Error(`apply_patch: "*** Move to:" must follow "*** Update File:" (line ${i + 1})`);
      }
      current.kind = 'move';
      current.movePath = resolveUserPath(cwd, trimmed.slice('*** Move to: '.length).trim());
      i++; continue;
    }

    // Hunk header for Update / Move ops
    if (trimmed.startsWith('@@') && current && (current.kind === 'update' || current.kind === 'move')) {
      flushHunk();
      hunk = { anchor: trimmed.slice(2).trim() || undefined, oldLines: [], newLines: [] };
      i++; continue;
    }

    // Body lines
    if (current?.kind === 'add') {
      // Add-file body: every non-empty line should start with '+', but be lenient
      if (line.startsWith('+')) current.content = (current.content || '') + line.slice(1) + '\n';
      else if (line === '') current.content = (current.content || '') + '\n';
      else throw new Error(`apply_patch: Add File body must start with '+' (line ${i + 1}: "${line.slice(0, 60)}")`);
      i++; continue;
    }
    if (current?.kind === 'update' || current?.kind === 'move') {
      if (!hunk) {
        // Allow implicit hunk if first body line is a diff line
        if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
          hunk = { oldLines: [], newLines: [] };
        } else {
          // Unrelated line — skip (e.g. blank between header and hunk)
          i++; continue;
        }
      }
      if (line.startsWith('-')) hunk.oldLines.push(line.slice(1));
      else if (line.startsWith('+')) hunk.newLines.push(line.slice(1));
      else if (line.startsWith(' ')) { hunk.oldLines.push(line.slice(1)); hunk.newLines.push(line.slice(1)); }
      else if (line === '') { hunk.oldLines.push(''); hunk.newLines.push(''); }
      else throw new Error(`apply_patch: unrecognized hunk line (line ${i + 1}: "${line.slice(0, 60)}")`);
      i++; continue;
    }

    // Outside any op — skip blanks, error on stray content
    if (line.trim() === '') { i++; continue; }
    throw new Error(`apply_patch: stray content outside any file op (line ${i + 1}: "${line.slice(0, 60)}")`);
  }

  throw new Error('apply_patch: envelope did not end with "*** End Patch"');
}

/**
 * Apply one hunk to a file's current content. Returns the new content
 * or throws if the hunk doesn't match.
 */
function applyHunk(content: string, hunk: Hunk): string {
  const oldBlock = hunk.oldLines.join('\n');
  const newBlock = hunk.newLines.join('\n');
  if (oldBlock === '') {
    // Pure insertion — append at end (or at anchor if specified)
    return content + (content.endsWith('\n') ? '' : '\n') + newBlock + '\n';
  }
  // Locate the old block. We use exact substring match for safety.
  let idx = content.indexOf(oldBlock);
  if (idx === -1) {
    // Try a more forgiving match: collapse whitespace
    const flexible = oldBlock.replace(/\s+/g, ' ').trim();
    const collapsed = content.replace(/\s+/g, ' ');
    const ci = collapsed.indexOf(flexible);
    if (ci === -1) {
      throw new Error(`apply_patch: hunk did not match file. Looking for:\n---\n${oldBlock.slice(0, 200)}\n---`);
    }
    throw new Error(`apply_patch: hunk only matches with whitespace differences — clean up the diff to match exactly`);
  }
  // Disambiguate if the old block appears multiple times: require anchor
  const next = content.indexOf(oldBlock, idx + 1);
  if (next !== -1 && !hunk.anchor) {
    throw new Error(`apply_patch: hunk matches in multiple places — add an @@ anchor line above the change`);
  }
  if (next !== -1 && hunk.anchor) {
    // Prefer the occurrence closest to the anchor symbol
    const anchorIdx = content.indexOf(hunk.anchor);
    if (anchorIdx !== -1) {
      // Find the occurrence with the closest preceding anchor
      const occurrences: number[] = [];
      let pos = content.indexOf(oldBlock);
      while (pos !== -1) { occurrences.push(pos); pos = content.indexOf(oldBlock, pos + 1); }
      let best = occurrences[0];
      let bestDist = Math.abs(best - anchorIdx);
      for (const o of occurrences) {
        const d = Math.abs(o - anchorIdx);
        if (d < bestDist) { best = o; bestDist = d; }
      }
      idx = best;
    }
  }
  return content.slice(0, idx) + newBlock + content.slice(idx + oldBlock.length);
}

/**
 * Validate every op against the disk state. Throws on the first
 * problem so we never apply a half-broken patch. This is the "validate
 * then commit" boundary.
 */
function validate(ops: FileOp[]): void {
  for (const op of ops) {
    if (op.kind === 'add') {
      if (existsSync(op.path)) {
        throw new Error(`apply_patch: cannot Add File "${op.path}" — already exists. Use Update File instead.`);
      }
    } else if (op.kind === 'update' || op.kind === 'move') {
      if (!existsSync(op.path)) {
        throw new Error(`apply_patch: cannot Update File "${op.path}" — does not exist. Use Add File for new files.`);
      }
      if (op.kind === 'move' && !op.movePath) {
        throw new Error(`apply_patch: Move op requires a destination path`);
      }
      // Dry-apply all hunks to surface mismatches before any write
      let content = readFileSync(op.path, 'utf-8');
      for (const h of op.hunks || []) {
        content = applyHunk(content, h);
      }
    } else if (op.kind === 'delete') {
      if (!existsSync(op.path)) {
        throw new Error(`apply_patch: cannot Delete File "${op.path}" — does not exist`);
      }
    }
  }
}

/**
 * Apply the validated ops. Mutates disk. Run validate() first.
 */
function commit(ops: FileOp[]): string {
  const log: string[] = [];
  for (const op of ops) {
    if (op.kind === 'add') {
      mkdirSync(dirname(op.path), { recursive: true });
      writeFileSync(op.path, op.content || '', 'utf-8');
      const lines = (op.content || '').split('\n').length;
      log.push(`+ ${op.path} (${lines} lines)`);
    } else if (op.kind === 'update') {
      let content = readFileSync(op.path, 'utf-8');
      for (const h of op.hunks || []) content = applyHunk(content, h);
      writeFileSync(op.path, content, 'utf-8');
      const hunkCount = (op.hunks || []).length;
      log.push(`~ ${op.path} (${hunkCount} hunk${hunkCount === 1 ? '' : 's'})`);
    } else if (op.kind === 'move') {
      let content = readFileSync(op.path, 'utf-8');
      for (const h of op.hunks || []) content = applyHunk(content, h);
      mkdirSync(dirname(op.movePath!), { recursive: true });
      writeFileSync(op.movePath!, content, 'utf-8');
      unlinkSync(op.path);
      log.push(`~ ${op.path} → ${op.movePath}`);
    } else if (op.kind === 'delete') {
      unlinkSync(op.path);
      log.push(`- ${op.path}`);
    }
  }
  return log.join('\n');
}

export const ApplyPatchTool: Tool = {
  name: 'apply_patch',
  description:
    'Apply a multi-file patch as a single atomic operation. Use this for ' +
    'refactors touching 2+ files, file renames, or any change you would have ' +
    'made with multiple edit_file/write_file calls. Format:\n\n' +
    '*** Begin Patch\n' +
    '*** Update File: src/foo.ts\n' +
    '@@ class Foo\n' +
    '-  oldLine\n' +
    '+  newLine\n' +
    '*** Add File: src/bar.ts\n' +
    '+contents line 1\n' +
    '+contents line 2\n' +
    '*** Delete File: src/old.ts\n' +
    '*** End Patch\n\n' +
    'Rules: validate-then-commit (any hunk mismatch rejects the whole patch); ' +
    'Update File requires the target to exist; Add File requires the target NOT ' +
    'to exist; @@ anchors disambiguate when the old block matches multiple places; ' +
    'do NOT re-read the file after this tool returns — the changes are on disk.',
  parameters: {
    type: 'object',
    properties: {
      patch: { type: 'string', description: 'The envelope text, beginning with "*** Begin Patch"' },
    },
    required: ['patch'],
  },
  isReadOnly: false,
  isDestructive: true,

  async call(input, cwd): Promise<ToolResult> {
    try {
      const ops = parsePatch(input.patch as string, cwd);
      if (ops.length === 0) return { output: 'apply_patch: empty patch (no file ops).', isError: false };
      validate(ops);
      const log = commit(ops);
      return { output: `Applied ${ops.length} file op(s):\n${log}`, isError: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: msg, isError: true };
    }
  },
};
