/**
 * Smart compaction suggestions — monitors conversation and suggests compaction at optimal points.
 */
import type { GrawkusConfig, Message } from './types.js';
import { compactionTriggerTokens, estimateTokens } from './compaction.js';

export interface CompactionSuggestion {
  reason: string;
  strategy: 'full' | 'quick' | 'selective';
  estimatedTokens: number;
  estimatedSavings: number;
}

/**
 * Detect natural break points in conversation (e.g., task completion, mode switch).
 */
function findBreakPoints(messages: Message[]): number[] {
  const breaks: number[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant' && typeof msg.content === 'string') {
      const text = msg.content.toLowerCase();
      // Patterns that indicate task completion or natural break
      if (
        text.includes('done') ||
        text.includes('complete') ||
        text.includes('all set') ||
        text.includes('next') ||
        text.includes('ready for') ||
        text.match(/^(great|nice|alright|perfect)\b/i)
      ) {
        breaks.push(i);
      }
    }
  }

  return breaks;
}

/**
 * Check if there's been a task mode switch (e.g., from "code review" to "refactoring").
 */
function detectModeSwitch(messages: Message[]): boolean {
  const modes = ['code review', 'refactoring', 'debugging', 'design', 'optimization', 'testing'];
  let lastModeIdx = -1;

  for (const msg of messages) {
    if (msg.role === 'user' && typeof msg.content === 'string') {
      const text = msg.content.toLowerCase();
      for (const mode of modes) {
        if (text.includes(mode)) {
          if (lastModeIdx >= 0 && lastModeIdx !== modes.indexOf(mode)) {
            return true; // Mode switched
          }
          lastModeIdx = modes.indexOf(mode);
        }
      }
    }
  }

  return false;
}

/**
 * Suggest compaction at optimal points.
 * Returns null if no compaction needed, or a suggestion with reason.
 */
export function shouldSuggestCompaction(
  messages: Message[],
  lastCompactionAt: number,
  config: Pick<GrawkusConfig, 'model' | 'contextWindowTokens'> = { model: '' },
): CompactionSuggestion | null {
  const tokens = estimateTokens(messages);
  const timeSinceLastCompaction = Date.now() - lastCompactionAt;
  const minutesSinceCompaction = timeSinceLastCompaction / (1000 * 60);

  const suggestThreshold = compactionTriggerTokens(config);
  const warnThreshold = Math.floor(suggestThreshold * 0.75);

  // Strategy thresholds
  const quickThreshold = 100_000;
  const selectiveThreshold = 150_000;

  // Never suggest if recently compacted (within 30 min)
  if (minutesSinceCompaction < 30) return null;

  // Reason 1: High token count with natural break point
  if (tokens > suggestThreshold) {
    const breaks = findBreakPoints(messages);
    if (breaks.length > 0) {
      const strategy = tokens > selectiveThreshold ? 'full' : tokens > quickThreshold ? 'selective' : 'quick';
      return {
        reason: `Token count (${tokens.toLocaleString()}) exceeds threshold at natural break point`,
        strategy,
        estimatedTokens: tokens,
        estimatedSavings: Math.round(tokens * 0.4), // Estimate 40% reduction
      };
    }
  }

  // Reason 2: Mode switch (task type changed)
  if (tokens > warnThreshold && detectModeSwitch(messages)) {
    const strategy = tokens > selectiveThreshold ? 'full' : 'selective';
    return {
      reason: 'Task mode switched (good time to compact before new context)',
      strategy,
      estimatedTokens: tokens,
      estimatedSavings: Math.round(tokens * 0.35),
    };
  }

  // Reason 3: Just hit warning threshold
  if (tokens > suggestThreshold && tokens < suggestThreshold + 5_000) {
    const strategy = tokens > selectiveThreshold ? 'full' : tokens > quickThreshold ? 'selective' : 'quick';
    return {
      reason: `Token count (${tokens.toLocaleString()}) reached compaction threshold`,
      strategy,
      estimatedTokens: tokens,
      estimatedSavings: Math.round(tokens * 0.35),
    };
  }

  // Reason 4: Long time since last compaction + substantial message count
  if (minutesSinceCompaction > 90 && messages.length > 50 && tokens > warnThreshold) {
    return {
      reason: 'Periodic compaction recommended (90+ minutes since last compaction)',
      strategy: 'selective',
      estimatedTokens: tokens,
      estimatedSavings: Math.round(tokens * 0.3),
    };
  }

  return null;
}

/**
 * Pre-build a summary of what would be compacted.
 * Shows which messages/ranges would be affected.
 */
export function buildCompactionSummary(messages: Message[]): string {
  const recentCount = 10;
  const oldMessages = messages.slice(0, -recentCount);
  const recentMessages = messages.slice(-recentCount);

  const toolCalls = oldMessages.filter((m) => m.role === 'assistant' && m.tool_calls).length;
  const userMsgs = oldMessages.filter((m) => m.role === 'user').length;
  const toolResults = oldMessages.filter((m) => m.role === 'tool').length;

  const lines = [
    `Summary of compaction:`,
    `  Old messages to summarize: ${oldMessages.length}`,
    `    - User messages: ${userMsgs}`,
    `    - Assistant messages with tool calls: ${toolCalls}`,
    `    - Tool results: ${toolResults}`,
    `  Recent messages to keep: ${recentMessages.length}`,
  ];

  return lines.join('\n');
}

/**
 * Determine optimal compaction strategy based on token count and message characteristics.
 */
export function getCompactionStrategy(messages: Message[]): 'full' | 'quick' | 'selective' {
  const tokens = estimateTokens(messages);

  // 'quick': just truncate tool outputs (under 100k tokens)
  if (tokens < 100_000) {
    return 'quick';
  }

  // 'selective': summarize old messages but keep important ones (100-150k)
  if (tokens < 150_000) {
    return 'selective';
  }

  // 'full': full AI-powered summarization (over 150k)
  return 'full';
}
