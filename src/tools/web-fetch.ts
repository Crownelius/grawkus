import type { Tool, ToolResult } from './types.js';
import { htmlToText } from '../html-parser.js';

export const WebFetchTool: Tool = {
  name: 'web_fetch',
  description:
    'Fetch a URL and return its text content (HTML converted to plain text). Useful for reading docs, APIs, or web pages.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch',
      },
    },
    required: ['url'],
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input): Promise<ToolResult> {
    try {
      const url = input.url as string;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'grawkus/1.x (+https://github.com/Crownelius/grawkus)' },
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        return { output: `HTTP ${resp.status}: ${resp.statusText}`, isError: true };
      }

      const contentType = resp.headers.get('content-type') || '';
      let text = await resp.text();

      // Convert HTML to readable plain text
      if (contentType.includes('html')) {
        text = htmlToText(text);
      }

      return { output: text.slice(0, 80_000), isError: false };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: `Fetch error: ${msg}`, isError: true };
    }
  },
};
