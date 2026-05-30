/**
 * HTML to text parser — converts HTML to readable plain text without external dependencies.
 * Used internally by the web_fetch tool to extract readable content from web pages.
 */

/**
 * Convert HTML to readable plain text.
 * - Strips HTML tags
 * - Converts HTML entities (&amp; &lt; &gt; &quot; &nbsp; &#NNN; &#xHHH;)
 * - Preserves paragraph breaks
 * - Removes script, style, nav, footer, header blocks entirely
 * - Extracts title separately
 * - Collapses multiple blank lines
 * - Trims whitespace
 *
 * @param html - Raw HTML string
 * @returns Plain text with preserved structure
 */
export function htmlToText(html: string): string {
  // Extract title before stripping tags
  let title = '';
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].trim();
  }

  let text = html;

  // Remove entire blocks: script, style, nav, footer, header
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '');

  // Convert block-level tags to newlines (before stripping tags)
  text = text.replace(/<\/?(?:p|div|section|article|main|aside|blockquote)\b[^>]*>/gi, '\n');
  text = text.replace(/<(?:h[1-6])\b[^>]*>/gi, '\n');
  text = text.replace(/<\/(?:h[1-6])\b[^>]*>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n');
  text = text.replace(/<li\b[^>]*>/gi, '\n');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Collapse multiple newlines to max 2 (max 1 blank line)
  text = text.replace(/\n\n\n+/g, '\n\n');

  // Trim each line
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  // Remove leading/trailing empty lines
  text = text.replace(/^\n+|\n+$/g, '');

  // Prepend title if found
  if (title) {
    text = title + '\n\n' + text;
  }

  return text;
}

/**
 * Decode HTML entities in a string.
 * Handles: &amp; &lt; &gt; &quot; &nbsp; &#NNN; &#xHHH;
 */
function decodeHtmlEntities(str: string): string {
  // Common named entities
  const namedEntities: { [key: string]: string } = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    copy: '©',
    reg: '®',
    deg: '°',
  };

  // Replace named entities
  let result = str.replace(/&([a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    return namedEntities[lower] || match;
  });

  // Replace decimal numeric entities (&#123;)
  result = result.replace(/&#(\d+);/g, (match, code) => {
    try {
      return String.fromCharCode(parseInt(code, 10));
    } catch {
      return match;
    }
  });

  // Replace hexadecimal numeric entities (&#x1F;)
  result = result.replace(/&#x([0-9a-f]+);/gi, (match, code) => {
    try {
      return String.fromCharCode(parseInt(code, 16));
    } catch {
      return match;
    }
  });

  return result;
}
