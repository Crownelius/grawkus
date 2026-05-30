import type { Tool, ToolResult } from './types.js';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

const TODO_STATE = new Map<string, TodoItem[]>();

function normalizeStatus(value: unknown): TodoStatus {
  const raw = String(value ?? '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (['done', 'complete', 'completed', 'x', 'checked'].includes(raw)) return 'completed';
  if (['active', 'current', 'doing', 'in_progress', 'inprogress'].includes(raw)) return 'in_progress';
  return 'pending';
}

function normalizeStringItem(value: string): TodoItem | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const checkbox = trimmed.match(/^\s*[-*]?\s*\[( |x|X|-)\]\s*(.+)$/);
  if (checkbox) {
    const status = checkbox[1].toLowerCase() === 'x'
      ? 'completed'
      : checkbox[1] === '-'
        ? 'in_progress'
        : 'pending';
    return { content: checkbox[2].trim(), status };
  }
  return { content: trimmed, status: 'pending' };
}

export function normalizeTodoItems(items: unknown): TodoItem[] {
  if (!Array.isArray(items)) return [];
  const out: TodoItem[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const normalized = normalizeStringItem(item);
      if (normalized) out.push(normalized);
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const content = String(obj.content ?? obj.task ?? obj.text ?? '').trim();
      if (!content) continue;
      out.push({ content, status: normalizeStatus(obj.status) });
    }
  }
  return out.slice(0, 40);
}

function renderTodoLine(item: TodoItem): string {
  const marker =
    item.status === 'completed'
      ? '[x]'
      : item.status === 'in_progress'
        ? '[-]'
        : '[ ]';
  return `- ${marker} ${item.content}`;
}

export function renderTodoList(items: TodoItem[]): string {
  return items.map(renderTodoLine).join('\n');
}

export function getTodoItems(cwd: string): TodoItem[] {
  return TODO_STATE.get(cwd) ?? [];
}

export function setTodoItems(cwd: string, items: TodoItem[]): void {
  if (items.length === 0) {
    TODO_STATE.delete(cwd);
    return;
  }
  TODO_STATE.set(cwd, items);
}

export function clearTodoItems(cwd: string): void {
  TODO_STATE.delete(cwd);
}

export function buildTodoStateBlock(cwd: string): string | null {
  const items = getTodoItems(cwd);
  if (items.length === 0) return null;
  return [
    '<current_plan>',
    'Working todo list from todo_write. Keep it current as work progresses; do not treat completed items as pending.',
    renderTodoList(items),
    '</current_plan>',
  ].join('\n');
}

export const TodoWriteTool: Tool = {
  name: 'todo_write',
  description:
    'Update the persistent working todo list for this task. Use it on multi-step work, uncertain scope, or benchmark tasks to track pending, active, and completed steps. The list is reinjected before every turn and survives context compaction.',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description:
          'Array of todo items. Each item may be a string, a markdown checkbox string, or an object like {"content":"Run tests","status":"pending|in_progress|completed"}.',
        items: {
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: {
                content: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['content'],
            },
          ],
        },
      },
    },
    required: ['items'],
  },
  isReadOnly: false,
  isDestructive: false,

  async call(input: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const items = normalizeTodoItems(input.items);
    setTodoItems(cwd, items);
    if (items.length === 0) {
      return {
        output: 'Todo list cleared. Add items with todo_write when the task has multiple concrete steps.',
        isError: false,
      };
    }
    return {
      output: `Todo list updated (${items.length} item${items.length === 1 ? '' : 's'}):\n${renderTodoList(items)}`,
      isError: false,
    };
  },
};
