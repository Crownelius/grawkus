/**
 * Normalize suppressed type-ahead text into the single-line REPL prompt.
 * readline's prompt is one line, so Enter typed during an active chain is
 * preserved as spacing rather than being auto-submitted behind the user.
 */
export function normalizeTypeaheadDraftForPrompt(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
    .replace(/\n/g, ' ');
}

export interface QueuedInputChunkResult {
  mutated: boolean;
  ignoredEscape: boolean;
}

export function queuedInputBytesToText(bytes: number[]): string {
  return Buffer.from(bytes).toString('utf-8').replace(/\r\n?/g, '\n');
}

export function drainQueuedInputBytes(bytes: number[]): string {
  const text = queuedInputBytesToText(bytes);
  bytes.length = 0;
  return text.replace(/\n+$/, '');
}

export function applyQueuedInputChunk(
  bytes: number[],
  chunk: Buffer,
  maxBytes = 4096,
): QueuedInputChunkResult {
  if (chunk.length === 0) return { mutated: false, ignoredEscape: false };
  if (chunk[0] === 0x1B) return { mutated: false, ignoredEscape: true };

  let mutated = false;
  for (const byte of chunk) {
    if (byte === 0x08 || byte === 0x7F) {
      if (bytes.length > 0) {
        bytes.pop();
        mutated = true;
      }
      continue;
    }
    if ((byte >= 0x20 && byte < 0x7F) || byte === 0x0A || byte === 0x0D) {
      bytes.push(byte);
      mutated = true;
    }
  }
  if (bytes.length > maxBytes) bytes.splice(0, bytes.length - maxBytes);
  return { mutated, ignoredEscape: false };
}
