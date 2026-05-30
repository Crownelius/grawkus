/**
 * Conversation export functionality.
 * Supports exporting conversations to Markdown, JSON, and plain text formats.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Message } from './types.js';

export type ExportFormat = 'md' | 'json' | 'txt';

/**
 * Format messages as Markdown with nice headers and code block preservation.
 */
export function formatAsMarkdown(messages: Message[]): string {
  const lines: string[] = [];

  lines.push('# Conversation Export\n');
  lines.push(`Exported: ${new Date().toISOString()}\n`);
  lines.push('---\n');

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const roleLabel = msg.role.toUpperCase();

    lines.push(`## ${roleLabel}\n`);

    if (msg.content) {
      lines.push(`${msg.content}\n`);
    }

    // Include tool calls if present
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      lines.push('### Tool Calls\n');
      for (const toolCall of msg.tool_calls) {
        lines.push(`- **${toolCall.function.name}**`);
        if (toolCall.function.arguments) {
          lines.push(`\n  \`\`\`json\n  ${toolCall.function.arguments}\n  \`\`\``);
        }
        lines.push('\n');
      }
    }

    // Include tool_call_id if present
    if (msg.tool_call_id) {
      lines.push(`**Tool Call ID:** \`${msg.tool_call_id}\`\n`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format messages as JSON.
 */
export function formatAsJSON(messages: Message[]): string {
  return JSON.stringify(messages, null, 2);
}

/**
 * Format messages as plain text with minimal formatting.
 */
export function formatAsText(messages: Message[]): string {
  const lines: string[] = [];

  lines.push(`CONVERSATION EXPORT - ${new Date().toISOString()}`);
  lines.push('='.repeat(80));
  lines.push('');

  for (const msg of messages) {
    const roleLabel = msg.role.toUpperCase();
    lines.push(`[${roleLabel}]`);

    if (msg.content) {
      lines.push(msg.content);
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      lines.push('TOOL CALLS:');
      for (const toolCall of msg.tool_calls) {
        lines.push(`  - ${toolCall.function.name}`);
        if (toolCall.function.arguments) {
          lines.push(`    Args: ${toolCall.function.arguments}`);
        }
      }
    }

    if (msg.tool_call_id) {
      lines.push(`Tool Call ID: ${msg.tool_call_id}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format messages in the specified format.
 */
export function formatMessages(messages: Message[], format: ExportFormat): string {
  switch (format) {
    case 'md':
      return formatAsMarkdown(messages);
    case 'json':
      return formatAsJSON(messages);
    case 'txt':
      return formatAsText(messages);
    default:
      throw new Error(`Unknown export format: ${format}`);
  }
}

/**
 * Get the file extension for a format.
 */
function getExtension(format: ExportFormat): string {
  return format;
}

/**
 * Save exported conversation to a file in the current working directory.
 */
export function saveExport(messages: Message[], format: ExportFormat): string {
  const formatted = formatMessages(messages, format);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `grawkus-export-${timestamp}.${getExtension(format)}`;
  const filepath = path.join(process.cwd(), filename);

  fs.writeFileSync(filepath, formatted, 'utf-8');

  return filepath;
}
