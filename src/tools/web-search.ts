/**
 * web_search — keyword web search backed by DuckDuckGo's HTML endpoint.
 *
 * Free, no API key, no rate-limit signup. Returns up to N results as a
 * structured plain-text list (title, URL, snippet) the model can read and
 * then follow up with `web_fetch` for the full page.
 *
 * Why this exists: free models routinely hallucinate `web_search_exa` /
 * `google_search` tool calls. This gives them a real tool of the right shape
 * so the call succeeds.
 */
import type { Tool, ToolResult } from './types.js';
import { htmlToText } from '../html-parser.js';

// DDG Lite (GET) is the most reliable free backend — the POST endpoints
// (html.duckduckgo.com, lite POST) are aggressively bot-blocked.
const DDG_LITE = 'https://lite.duckduckgo.com/lite/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeDdgRedirect(href: string): string {
  // DDG wraps result links as: //duckduckgo.com/l/?uddg=<encoded>&rut=...
  // Sometimes they're absolute, sometimes scheme-relative.
  try {
    const normalized = href.startsWith('//') ? `https:${href}` : href;
    const u = new URL(normalized);
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return normalized;
  } catch {
    return href;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&hellip;/g, '…');
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function parseDdgLite(html: string, limit: number): SearchResult[] {
  // DDG Lite layout (simplified):
  //   <a href="REDIRECT_URL" class='result-link'>TITLE</a>
  //   ...
  //   <td class='result-snippet'>SNIPPET</td>
  // Quoting is single quotes for class, double quotes for href.
  const results: SearchResult[] = [];

  // Capture title + redirect URL. Then find the nearest following snippet td.
  const linkRe = /<a[^>]*href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g;

  // Collect all snippets with their offsets so we can pair them with links.
  const snippets: { offset: number; text: string }[] = [];
  for (const m of html.matchAll(snippetRe)) {
    snippets.push({ offset: m.index ?? 0, text: stripTags(m[1]) });
  }

  for (const m of html.matchAll(linkRe)) {
    if (results.length >= limit) break;
    const url = decodeDdgRedirect(m[1]);
    const title = stripTags(m[2]);
    if (!title || !url) continue;
    if (url.includes('duckduckgo.com/y.js')) continue; // skip ads/internal

    const linkOffset = m.index ?? 0;
    // Find the first snippet that appears after this link
    const matchedSnippet = snippets.find((s) => s.offset > linkOffset);
    const snippet = matchedSnippet?.text ?? '';

    results.push({ title, url, snippet });
  }

  return results;
}

function formatResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `No results for "${query}". Try a different query, or use web_fetch directly if you know the URL.`;
  }
  const lines: string[] = [`Search results for "${query}" (${results.length}):`, ''];
  results.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.url}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
    lines.push('');
  });
  lines.push('To read a result fully, call web_fetch with its URL.');
  return lines.join('\n');
}

export const WebSearchTool: Tool = {
  name: 'web_search',
  description:
    'Search the web by keyword. Returns a ranked list of title/URL/snippet results from DuckDuckGo. Use this for discovery; use web_fetch to read a specific URL in full. No API key required.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query — natural language or keywords.',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default 5, max 15).',
      },
    },
    required: ['query'],
  },
  isReadOnly: true,
  isDestructive: false,

  async call(input): Promise<ToolResult> {
    const query = String(input.query || '').trim();
    if (!query) {
      return { output: 'web_search: missing required parameter "query"', isError: true };
    }
    const limit = Math.max(1, Math.min(15, Number(input.limit) || 5));

    try {
      const url = `${DDG_LITE}?q=${encodeURIComponent(query)}&kl=us-en`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(20_000),
      });

      if (!resp.ok) {
        return { output: `web_search HTTP ${resp.status}: ${resp.statusText}`, isError: true };
      }

      const html = await resp.text();
      const results = parseDdgLite(html, limit);

      if (results.length === 0 && /captcha|automated|blocked/i.test(html)) {
        return {
          output: `web_search: DuckDuckGo returned an anti-bot page. Try again in a few minutes, or use web_fetch on a specific URL.`,
          isError: true,
        };
      }

      return { output: formatResults(query, results), isError: false };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: `web_search error: ${msg}`, isError: true };
    }
  },
};

// Internal export for tests
export const _internal = { parseDdgLite, decodeDdgRedirect, htmlToText };
