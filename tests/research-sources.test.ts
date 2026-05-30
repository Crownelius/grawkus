import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResearchSourcesTool, _internal } from '../src/tools/research-sources.js';
import { getToolNames } from '../src/tools/index.js';
import { buildSourceResearchPrompt } from '../src/search-first.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('research_sources tool', () => {
  it('is registered as a read-only tool', () => {
    expect(getToolNames()).toContain('research_sources');
    expect(ResearchSourcesTool.isReadOnly).toBe(true);
    expect(ResearchSourcesTool.isDestructive).toBe(false);
  });

  it('builds arXiv queries with field terms and optional recency', () => {
    expect(_internal.buildArxivQuery('coding agents')).toBe('all:coding+AND+all:agents');
    const recent = _internal.buildArxivQuery('cat:cs.AI agent', 30);
    expect(recent).toContain('cat:cs.AI agent');
    expect(recent).toContain('submittedDate:[');
  });

  it('parses arXiv Atom entries into compact source hits', () => {
    const xml = `
      <feed>
        <entry>
          <id>https://arxiv.org/abs/2501.00001v1</id>
          <published>2025-01-02T00:00:00Z</published>
          <title> Agent Verification &amp; Coding </title>
          <summary> A paper about verifying coding agents. </summary>
          <author><name>Ada Lovelace</name></author>
          <category term="cs.SE" />
        </entry>
      </feed>`;
    const [hit] = _internal.parseArxivFeed(xml, 5);
    expect(hit.title).toBe('Agent Verification & Coding');
    expect(hit.url).toBe('https://arxiv.org/abs/2501.00001v1');
    expect(hit.date).toBe('2025-01-02');
    expect(hit.meta).toContain('cs.SE');
    expect(hit.summary).toContain('verifying coding agents');
  });

  it('parses GitHub, Hugging Face, and Kaggle JSON shapes', () => {
    const [repo] = _internal.parseGitHubRepos({
      items: [{
        full_name: 'owner/agent',
        html_url: 'https://github.com/owner/agent',
        stargazers_count: 1234,
        forks_count: 56,
        language: 'TypeScript',
        pushed_at: '2026-05-20T00:00:00Z',
        description: 'Coding agent',
      }],
    }, 5);
    expect(repo.meta).toContain('1,234 stars');
    expect(repo.date).toBe('2026-05-20');

    const [issue] = _internal.parseGitHubIssues({
      items: [{
        html_url: 'https://github.com/owner/agent/issues/7',
        title: 'Benchmark failure',
        number: 7,
        state: 'open',
        comments: 3,
        updated_at: '2026-05-20T00:00:00Z',
        repository_url: 'https://api.github.com/repos/owner/agent',
        body: 'Fails on SWE-bench task.',
        labels: [{ name: 'bug' }],
      }],
    }, 5, 'issue');
    expect(issue.source).toBe('GitHub issue');
    expect(issue.title).toContain('owner/agent');
    expect(issue.meta).toContain('3 comments');
    expect(issue.date).toBe('2026-05-20');

    const [code] = _internal.parseGitHubCode({
      items: [{
        path: 'src/agent.py',
        html_url: 'https://github.com/owner/agent/blob/main/src/agent.py',
        repository: { full_name: 'owner/agent', language: 'Python' },
        score: 2.5,
      }],
    }, 5);
    expect(code.source).toBe('GitHub code');
    expect(code.title).toBe('owner/agent:src/agent.py');
    expect(code.meta).toContain('Python');

    const [model] = _internal.parseHuggingFaceRepos([{
      id: 'org/model',
      downloads: 42,
      likes: 7,
      pipeline_tag: 'text-generation',
      lastModified: '2026-05-01T00:00:00.000Z',
    }], 'HF model', 5);
    expect(model.url).toBe('https://huggingface.co/org/model');
    expect(model.meta).toContain('updated 2026-05-01');
    expect(model.date).toBe('2026-05-01');

    const [paper] = _internal.parseHuggingFacePapers([{
      paper: {
        id: '2601.00001',
        title: 'Agent Verification for SWE-bench',
        summary: 'A software engineering agent benchmark paper.',
        ai_keywords: ['coding agents'],
        authors: [{ name: 'Grace Hopper' }],
        publishedAt: '2026-01-01T00:00:00.000Z',
        submittedOnDailyAt: '2026-01-02T00:00:00.000Z',
        upvotes: 12,
        githubRepo: 'https://github.com/example/agent',
      },
    }], 'SWE-bench agent', 5);
    expect(paper.source).toBe('HF paper');
    expect(paper.url).toBe('https://huggingface.co/papers/2601.00001');
    expect(paper.meta).toContain('Grace Hopper');
    expect(paper.meta).toContain('12 upvotes');
    expect(paper.date).toBe('2026-01-01');

    const [dataset] = _internal.parseKaggleDatasets([{
      titleNullable: 'Agent Bench Data',
      urlNullable: '/datasets/user/agent-bench-data',
      downloadCountNullable: 100,
      subtitleNullable: 'Benchmark dataset',
    }], 5);
    expect(dataset.url).toBe('https://www.kaggle.com/datasets/user/agent-bench-data');
    expect(_internal.normalizeKaggleUrl('https://www.kaggle.com/datasets/user/full-url'))
      .toBe('https://www.kaggle.com/datasets/user/full-url');

    const [competition] = _internal.parseKaggleCompetitions([{
      ref: 'agent-bench',
      title: 'Agent Benchmark',
      category: 'Featured',
      reward: '$10,000',
      deadline: '2026-06-01T00:00:00Z',
      teamCount: 321,
      evaluationMetric: 'Accuracy',
      enabledDate: '2026-05-01T00:00:00Z',
      tagNames: ['llm', 'agents'],
      description: 'A competition for agent benchmarks.',
    }], 5);
    expect(competition.source).toBe('Kaggle competition');
    expect(competition.url).toBe('https://www.kaggle.com/competitions/agent-bench');
    expect(competition.meta).toContain('321 teams');
    expect(competition.meta).toContain('metric Accuracy');
    expect(competition.date).toBe('2026-05-01');
  });

  it('resolves Hugging Face tokens from common env names and token files', () => {
    expect(_internal.resolveHuggingFaceToken({ HF_TOKEN: 'hf_env' } as NodeJS.ProcessEnv)).toBe('hf_env');
    expect(_internal.resolveHuggingFaceToken({ HUGGING_FACE_HUB_TOKEN: 'hf_hub' } as NodeJS.ProcessEnv)).toBe('hf_hub');
    expect(_internal.resolveHuggingFaceToken({ HUGGINGFACE_API_KEY: 'hf_api' } as NodeJS.ProcessEnv)).toBe('hf_api');

    const dir = mkdtempSync(join(tmpdir(), 'grawkus-hf-'));
    try {
      const tokenPath = join(dir, 'token');
      writeFileSync(tokenPath, 'hf_file\n');
      expect(_internal.resolveHuggingFaceToken({ HF_TOKEN_PATH: tokenPath } as NodeJS.ProcessEnv)).toBe('hf_file');

      const hfHome = join(dir, 'hf-home');
      mkdirSync(hfHome);
      writeFileSync(join(hfHome, 'token'), 'hf_home\n');
      expect(_internal.resolveHuggingFaceToken({ HF_HOME: hfHome } as NodeJS.ProcessEnv)).toBe('hf_home');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves Kaggle bearer and legacy auth without exposing secrets', () => {
    expect(_internal.resolveKaggleAuthHeaders({ KAGGLE_API_TOKEN: 'kg_token' } as NodeJS.ProcessEnv))
      .toEqual({ Authorization: 'Bearer kg_token' });

    const basic = _internal.resolveKaggleAuthHeaders({
      KAGGLE_USERNAME: 'alice',
      KAGGLE_KEY: 'secret',
    } as NodeJS.ProcessEnv).Authorization;
    expect(basic).toMatch(/^Basic /);
    expect(basic).not.toContain('alice');
    expect(basic).not.toContain('secret');

    const dir = mkdtempSync(join(tmpdir(), 'grawkus-kaggle-'));
    try {
      writeFileSync(join(dir, 'access_token'), 'kg_file\n');
      expect(_internal.resolveKaggleApiToken({ KAGGLE_CONFIG_DIR: dir } as NodeJS.ProcessEnv)).toBe('kg_file');

      rmSync(join(dir, 'access_token'), { force: true });
      writeFileSync(join(dir, 'kaggle.json'), JSON.stringify({ username: 'bob', key: 'file-secret' }));
      expect(_internal.resolveKaggleLegacyCredentials({ KAGGLE_CONFIG_DIR: dir } as NodeJS.ProcessEnv))
        .toEqual({ username: 'bob', key: 'file-secret' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('calls all source endpoints and formats results', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'gh_test_token');
    vi.stubEnv('HF_TOKEN', 'hf_test_token');
    vi.stubEnv('KAGGLE_API_TOKEN', 'kg_test_token');
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (url.includes('export.arxiv.org')) {
        return new Response('<feed><entry><id>https://arxiv.org/abs/1</id><published>2026-05-20T00:00:00Z</published><title>Paper</title><summary>Summary</summary></entry></feed>', {
          status: 200,
        });
      }
      if (url.includes('api.github.com')) {
        expect(headers.get('Authorization')).toBe('Bearer gh_test_token');
        return Response.json({ items: [{ full_name: 'o/r', html_url: 'https://github.com/o/r', stargazers_count: 1, pushed_at: '2026-05-21T00:00:00Z' }] });
      }
      if (url.includes('huggingface.co/api/models')) {
        expect(headers.get('Authorization')).toBe('Bearer hf_test_token');
        return Response.json([{ id: 'o/m', downloads: 2, lastModified: '2026-05-22T00:00:00.000Z' }]);
      }
      if (url.includes('huggingface.co/api/datasets')) {
        expect(headers.get('Authorization')).toBe('Bearer hf_test_token');
        return Response.json([{ id: 'o/d', downloads: 3, lastModified: '2026-05-23T00:00:00.000Z' }]);
      }
      if (url.includes('huggingface.co/api/daily_papers')) {
        expect(headers.get('Authorization')).toBe('Bearer hf_test_token');
        return Response.json([{
          paper: {
            id: '2601.00001',
            title: 'Agent Paper',
            ai_summary: 'Current coding agent paper',
            ai_keywords: ['agent'],
            publishedAt: '2026-01-01T00:00:00.000Z',
          },
        }]);
      }
      if (url.includes('kaggle.com/api/v1/competitions/list')) {
        expect(headers.get('Authorization')).toBe('Bearer kg_test_token');
        return Response.json([{
          ref: 'agent-competition',
          title: 'Agent Competition',
          teamCount: 7,
          deadline: '2026-06-01T00:00:00Z',
          enabledDate: '2026-05-24T00:00:00Z',
        }]);
      }
      if (url.includes('kaggle.com/api/v1/datasets/list')) {
        expect(headers.get('Authorization')).toBe('Bearer kg_test_token');
        return Response.json([{ titleNullable: 'Data', urlNullable: '/datasets/o/d', lastUpdatedNullable: '2026-05-25T00:00:00Z' }]);
      }
      return new Response('', { status: 404 });
    }));

    const result = await ResearchSourcesTool.call({ query: 'agent', source: 'all', limit: 1 }, process.cwd());
    expect(result.isError).toBe(false);
    expect(result.output).toContain('Coverage notes');
    expect(result.output).toContain('Source digest');
    expect(result.output).toContain('- hits: 7');
    expect(result.output).toContain('- errors: 0');
    expect(result.output).toContain('- sources: arXiv=1 | GitHub=1 | HF model=1 | HF dataset=1 | HF paper=1 | Kaggle=1 | Kaggle competition=1');
    expect(result.output).toContain('- dated_hits: 7');
    expect(result.output).toContain('- date_range: 2026-01-01..2026-05-25');
    expect(result.output).toContain('arXiv papers requested');
    expect(result.output).toContain('GitHub repositories requested');
    expect(result.output).toContain('GitHub auth found');
    expect(result.output).toContain('Hugging Face all requested');
    expect(result.output).toContain('Kaggle both requested; competitions enabled by auth');
    expect(result.output).toContain('arXiv: Paper');
    expect(result.output).toContain('GitHub: o/r');
    expect(result.output).toContain('HF model: o/m');
    expect(result.output).toContain('HF dataset: o/d');
    expect(result.output).toContain('HF paper: Agent Paper');
    expect(result.output).toContain('Kaggle: Data');
    expect(result.output).toContain('Kaggle competition: Agent Competition');
    expect(result.output).toContain('## Suggested next actions');
    expect(result.output).toContain('/context dossier "agent"');
    expect(result.output).toContain('/repo-digest o/r --files 500 --text-files 6');
    expect(result.output).toContain('/manifest "agent planned edit"');
    expect(result.output.indexOf('## arXiv: Paper')).toBeLessThan(result.output.indexOf('## GitHub: o/r'));
    expect(result.output.indexOf('## GitHub: o/r')).toBeLessThan(result.output.indexOf('## HF model: o/m'));
    expect(result.output.indexOf('## HF paper: Agent Paper')).toBeLessThan(result.output.indexOf('## Kaggle: Data'));
    expect(result.output).not.toContain('hf_test_token');
    expect(result.output).not.toContain('kg_test_token');
    expect(result.output).not.toContain('gh_test_token');
  });

  it('emits machine-readable source research JSON without credential leakage', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-27T12:00:00Z'));
    vi.stubEnv('GITHUB_TOKEN', 'gh_json_token');
    vi.stubEnv('HF_TOKEN', 'hf_json_token');
    vi.stubEnv('KAGGLE_API_TOKEN', 'kg_json_token');
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (url.includes('export.arxiv.org')) {
        return new Response('<feed><entry><id>https://arxiv.org/abs/2604.25850</id><published>2026-05-01T00:00:00Z</published><title>AHE</title><summary>Harness observability.</summary></entry></feed>', {
          status: 200,
        });
      }
      if (url.includes('api.github.com')) {
        return Response.json({ items: [{ full_name: 'o/harness', html_url: 'https://github.com/o/harness', stargazers_count: 10, pushed_at: '2026-05-02T00:00:00Z' }] });
      }
      if (url.includes('huggingface.co/api/models')) {
        expect(headers.get('Authorization')).toBe('Bearer hf_json_token');
        return Response.json([{ id: 'o/m', downloads: 2, lastModified: '2026-05-03T00:00:00.000Z' }]);
      }
      if (url.includes('huggingface.co/api/datasets')) {
        expect(headers.get('Authorization')).toBe('Bearer hf_json_token');
        return Response.json([{ id: 'o/d', downloads: 3, lastModified: '2026-05-04T00:00:00.000Z' }]);
      }
      if (url.includes('huggingface.co/api/daily_papers')) {
        expect(headers.get('Authorization')).toBe('Bearer hf_json_token');
        return Response.json([{
          paper: {
            id: '2605.15221',
            title: 'Effective Harness Engineering',
            summary: 'Harness design and hack detection.',
            publishedAt: '2026-05-13T00:00:00.000Z',
          },
        }]);
      }
      if (url.includes('kaggle.com/api/v1/competitions/list')) {
        expect(headers.get('Authorization')).toBe('Bearer kg_json_token');
        return Response.json([{ ref: 'agent-leaderboard', title: 'Agent Leaderboard', enabledDate: '2026-05-05T00:00:00Z' }]);
      }
      if (url.includes('kaggle.com/api/v1/datasets/list')) {
        expect(headers.get('Authorization')).toBe('Bearer kg_json_token');
        return Response.json([{ titleNullable: 'Agent Data', urlNullable: '/datasets/o/agent-data', lastUpdatedNullable: '2026-05-06T00:00:00Z' }]);
      }
      return new Response('', { status: 404 });
    }));

    const result = await ResearchSourcesTool.call({
      query: 'agent harness',
      source: 'all',
      github_kind: 'all',
      kind: 'all',
      kaggle_kind: 'both',
      recent_days: 90,
      limit: 1,
      format: 'json',
    }, process.cwd());

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.output);
    expect(parsed.format).toBe('grawkus-research-sources-v1');
    expect(parsed.query).toBe('agent harness');
    expect(parsed.requested).toMatchObject({
      source: 'all',
      githubKind: 'all',
      huggingFaceKind: 'all',
      kaggleKind: 'both',
      limit: 1,
      recentDays: 90,
    });
    expect(parsed.digest).toMatchObject({
      hitCount: 7,
      errorCount: 0,
      recencyWindowDays: 90,
      datedHitCount: 7,
      freshHitCount: 7,
      staleHitCount: 0,
      unknownDateHitCount: 0,
      oldestDate: '2026-05-01',
      newestDate: '2026-05-13',
    });
    expect(parsed.digest.sources).toMatchObject({
      arXiv: 1,
      GitHub: 1,
      'HF model': 1,
      'HF dataset': 1,
      'HF paper': 1,
      Kaggle: 1,
      'Kaggle competition': 1,
    });
    expect(parsed.digest.topUrls).toContain('https://arxiv.org/abs/2604.25850');
    expect(parsed.auth).toMatchObject({
      arxivPublic: true,
      githubAuth: true,
      githubUnauthenticatedRateLimit: false,
      huggingFaceAuth: true,
      kaggleAuth: true,
      kaggleCompetitionsRequested: true,
      kaggleCompetitionsEnabled: true,
      missingCredentialHints: [],
    });
    expect(parsed.coverageNotes).toContain('Targeted benchmark coverage requested: arXiv + GitHub all + Hugging Face all + Kaggle both.');
    expect(parsed.redaction).toMatchObject({
      secretsIncluded: false,
      credentialHeadersIncluded: false,
    });
    expect(parsed.nextActions).toContain('/context dossier "agent harness"');
    expect(parsed.nextActions).toContain('/repo-digest o/harness --files 500 --text-files 6');
    expect(parsed.nextActions).toContain('/manifest "agent harness planned edit"');
    expect(parsed.hits[0]).toMatchObject({
      source: 'arXiv',
      title: 'AHE',
      url: 'https://arxiv.org/abs/2604.25850',
      date: '2026-05-01',
    });
    expect(result.output).not.toContain('hf_json_token');
    expect(result.output).not.toContain('kg_json_token');
    expect(result.output).not.toContain('gh_json_token');
  });

  it('can query GitHub repositories, issues, pulls, and code explicitly', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('/search/repositories')) {
        return Response.json({ items: [{ full_name: 'o/r', html_url: 'https://github.com/o/r', stargazers_count: 5 }] });
      }
      if (url.includes('/search/issues')) {
        const decoded = decodeURIComponent(url);
        if (decoded.includes('is:pull-request')) {
          return Response.json({ items: [{
            html_url: 'https://github.com/o/r/pull/2',
            title: 'Fix agent verifier',
            number: 2,
            state: 'open',
            comments: 4,
            updated_at: '2026-05-20T00:00:00Z',
            repository_url: 'https://api.github.com/repos/o/r',
            pull_request: { html_url: 'https://github.com/o/r/pull/2' },
          }] });
        }
        return Response.json({ items: [{
          html_url: 'https://github.com/o/r/issues/1',
          title: 'Agent verifier bug',
          number: 1,
          state: 'open',
          comments: 2,
          updated_at: '2026-05-19T00:00:00Z',
          repository_url: 'https://api.github.com/repos/o/r',
          body: 'Need better benchmark validation.',
        }] });
      }
      if (url.includes('/search/code')) {
        return Response.json({ items: [{
          path: 'src/verifier.ts',
          html_url: 'https://github.com/o/r/blob/main/src/verifier.ts',
          repository: { full_name: 'o/r', language: 'TypeScript' },
          score: 1.2,
        }] });
      }
      return new Response('', { status: 404 });
    }));

    const result = await ResearchSourcesTool.call({
      query: 'agent verifier',
      source: 'github',
      github_kind: 'all',
      recent_days: 7,
      limit: 1,
    }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('GitHub: o/r');
    expect(result.output).toContain('GitHub issue: o/r #1 Agent verifier bug');
    expect(result.output).toContain('GitHub pull: o/r #2 Fix agent verifier');
    expect(result.output).toContain('GitHub code: o/r:src/verifier.ts');

    const decodedUrls = urls.map((url) => decodeURIComponent(url));
    expect(decodedUrls.some((url) => url.includes('/search/repositories') && url.includes('pushed:>='))).toBe(true);
    expect(decodedUrls.some((url) => url.includes('/search/issues') && url.includes('is:issue') && url.includes('updated:>='))).toBe(true);
    expect(decodedUrls.some((url) => url.includes('/search/issues') && url.includes('is:pull-request') && url.includes('updated:>='))).toBe(true);
    expect(decodedUrls.some((url) => url.includes('/search/code'))).toBe(true);
  });

  it('can query only Kaggle competitions when auth is configured', async () => {
    const urls: string[] = [];
    vi.stubEnv('KAGGLE_API_TOKEN', 'kg_competition_token');
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer kg_competition_token');
      return Response.json([{
        ref: 'coding-agent-leaderboard',
        title: 'Coding Agent Leaderboard',
        category: 'Featured',
        teamCount: 42,
        deadline: '2026-07-01T00:00:00Z',
      }]);
    }));

    const result = await ResearchSourcesTool.call({
      query: 'coding agent',
      source: 'kaggle',
      kaggle_kind: 'competitions',
      limit: 1,
    }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('Kaggle competition: Coding Agent Leaderboard');
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/api/v1/competitions/list?');
    expect(urls[0]).toContain('search=coding+agent');
    expect(urls[0]).not.toContain('/api/v1/datasets/list');
    expect(result.output).not.toContain('kg_competition_token');
  });

  it('sorts and filters Hugging Face and Kaggle date metadata when recent_days is requested', async () => {
    const fresh = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const stale = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const urls: string[] = [];

    vi.stubEnv('KAGGLE_API_TOKEN', 'kg_recent_token');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('huggingface.co/api/models')) {
        return Response.json([
          { id: 'org/fresh-model', lastModified: fresh, downloads: 10 },
          { id: 'org/stale-model', lastModified: stale, downloads: 999 },
        ]);
      }
      if (url.includes('huggingface.co/api/datasets')) {
        return Response.json([
          { id: 'org/fresh-dataset', lastModified: fresh, downloads: 5 },
          { id: 'org/stale-dataset', lastModified: stale, downloads: 500 },
        ]);
      }
      if (url.includes('kaggle.com/api/v1/datasets/list')) {
        return Response.json([
          { titleNullable: 'Fresh Data', urlNullable: '/datasets/o/fresh', lastUpdatedNullable: fresh },
          { titleNullable: 'Old Data', urlNullable: '/datasets/o/old', lastUpdatedNullable: stale },
        ]);
      }
      if (url.includes('kaggle.com/api/v1/competitions/list')) {
        return Response.json([
          { ref: 'fresh-comp', title: 'Fresh Competition', enabledDate: fresh },
          { ref: 'old-comp', title: 'Old Competition', enabledDate: stale },
        ]);
      }
      return new Response('', { status: 404 });
    }));

    const hf = await ResearchSourcesTool.call({
      query: 'agent benchmark',
      source: 'huggingface',
      kind: 'both',
      recent_days: 30,
      limit: 1,
    }, process.cwd());

    expect(hf.isError).toBe(false);
    expect(hf.output).toContain('HF model: org/fresh-model');
    expect(hf.output).toContain('HF dataset: org/fresh-dataset');
    expect(hf.output).not.toContain('stale-model');
    expect(hf.output).not.toContain('stale-dataset');

    const kaggle = await ResearchSourcesTool.call({
      query: 'agent benchmark',
      source: 'kaggle',
      kaggle_kind: 'both',
      recent_days: 30,
      limit: 1,
    }, process.cwd());

    expect(kaggle.isError).toBe(false);
    expect(kaggle.output).toContain('Kaggle: Fresh Data');
    expect(kaggle.output).toContain('Kaggle competition: Fresh Competition');
    expect(kaggle.output).not.toContain('Old Data');
    expect(kaggle.output).not.toContain('Old Competition');

    const decodedUrls = urls.map((url) => decodeURIComponent(url));
    expect(decodedUrls.some((url) => url.includes('/api/models') && url.includes('sort=lastModified') && url.includes('full=true') && url.includes('limit=5'))).toBe(true);
    expect(decodedUrls.some((url) => url.includes('/api/datasets') && url.includes('sort=lastModified') && url.includes('full=true') && url.includes('limit=5'))).toBe(true);
    expect(decodedUrls.some((url) => url.includes('/api/v1/datasets/list') && url.includes('sortBy=updated') && url.includes('pageSize=5'))).toBe(true);
    expect(decodedUrls.some((url) => url.includes('/api/v1/competitions/list') && url.includes('sortBy=recentlyCreated') && url.includes('pageSize=5'))).toBe(true);
  });

  it('keeps unauthenticated Kaggle default searches on datasets only', async () => {
    const urls: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), 'grawkus-kaggle-empty-'));
    vi.stubEnv('KAGGLE_CONFIG_DIR', dir);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      return Response.json([{ titleNullable: 'Public Data', urlNullable: '/datasets/o/public' }]);
    }));

    try {
      const result = await ResearchSourcesTool.call({
        query: 'agent',
        source: 'kaggle',
        limit: 1,
      }, process.cwd());

      expect(result.isError).toBe(false);
      expect(result.output).toContain('Kaggle both requested; competitions require auth');
      expect(result.output).toContain('Kaggle unauthenticated fallback: competitions skipped, datasets queried only');
      expect(result.output).toContain('Kaggle: Public Data');
      expect(urls).toEqual([expect.stringContaining('/api/v1/datasets/list?')]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('can query only Hugging Face papers and apply recent-day date windows', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      return Response.json([{
        paper: {
          id: '2601.00002',
          title: 'Coding Agent Trajectory Analysis',
          summary: 'Trajectory analysis for coding agents.',
          ai_keywords: ['trajectory', 'agent'],
        },
      }]);
    }));

    const result = await ResearchSourcesTool.call({
      query: 'coding agent trajectory',
      source: 'huggingface',
      kind: 'papers',
      limit: 1,
      recent_days: 2,
    }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('HF paper: Coding Agent Trajectory Analysis');
    expect(result.output).toContain('Hugging Face papers requested');
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes('/api/daily_papers?date='))).toBe(true);
    expect(urls.some((url) => url.includes('/api/models'))).toBe(false);
    expect(urls.some((url) => url.includes('/api/datasets'))).toBe(false);
  });

  it('keeps partial Hugging Face hits when one HF endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('huggingface.co/api/models')) {
        return new Response('temporary model endpoint failure', { status: 503 });
      }
      if (url.includes('huggingface.co/api/datasets')) {
        return Response.json([{ id: 'org/agent-dataset', downloads: 12 }]);
      }
      if (url.includes('huggingface.co/api/daily_papers')) {
        return Response.json([{
          paper: {
            id: '2605.00001',
            title: 'Coding Agent Verification',
            summary: 'Paper about coding agent verification.',
            ai_keywords: ['coding', 'agent'],
          },
        }]);
      }
      return new Response('', { status: 404 });
    }));

    const result = await ResearchSourcesTool.call({
      query: 'coding agent verification',
      source: 'huggingface',
      kind: 'all',
      limit: 2,
    }, process.cwd());

    expect(result.isError).toBe(false);
    expect(result.output).toContain('HF dataset: org/agent-dataset');
    expect(result.output).toContain('HF paper: Coding Agent Verification');
    expect(result.output).not.toContain('temporary model endpoint failure');
  });

  it('prints recency coverage notes when recent_days is requested', () => {
    const notes = _internal.buildCoverageNotes(['arxiv', 'github', 'huggingface'], 'all', 'all', 'datasets', 90);

    expect(notes).toContain('Recency filter requested: recent_days=90.');
    expect(notes).toContain('GitHub code search has no supported pushed/updated date qualifier; treat code hits as implementation examples, not freshness proof.');
    expect(notes).toContain('Hugging Face daily papers are checked across the most recent available daily pages, capped at 30 days.');
    expect(notes).toContain('Hugging Face model/dataset searches are sorted by lastModified and stale dated hits are filtered client-side when metadata is available.');
    const output = _internal.formatHits('agent benchmark', [], [], notes);
    expect(output).toContain('recent_days=90');
  });

  it('builds source follow-up actions from GitHub and Kaggle hits', () => {
    const actions = _internal.buildSourceNextActions('agent "benchmark"', [
      {
        source: 'GitHub code',
        title: 'owner/agent:src/main.ts',
        url: 'https://github.com/owner/agent/blob/main/src/main.ts',
      },
      {
        source: 'HF paper',
        title: 'Paper',
        url: 'https://huggingface.co/papers/2601.1',
        meta: 'code https://github.com/example/runner',
      },
      {
        source: 'Kaggle competition',
        title: 'Agent Bench',
        url: 'https://www.kaggle.com/competitions/agent-bench',
      },
    ], ['github: rate limit']);

    expect(actions).toContain('/context dossier "agent \\"benchmark\\""');
    expect(actions).toContain('/repo-digest owner/agent --files 500 --text-files 6');
    expect(actions).toContain('/repo-digest example/runner --files 500 --text-files 6');
    expect(actions.some((action) => action.includes('GitHub code hits'))).toBe(true);
    expect(actions.some((action) => action.includes('Kaggle competitions'))).toBe(true);
    expect(actions.some((action) => action.includes('source errors'))).toBe(true);
    expect(actions).toContain('/manifest "agent \\"benchmark\\" planned edit"');
  });

  it('builds a prompt that forces source-backed synthesis', () => {
    const prompt = buildSourceResearchPrompt('coding agent verification');
    expect(prompt).toContain('research_sources');
    expect(prompt).toContain('source:"arxiv"');
    expect(prompt).toContain('recent_days:90');
    expect(prompt).toContain('format:"json"');
    expect(prompt).toContain('source:"github"');
    expect(prompt).toContain('github_kind:"all"');
    expect(prompt).toContain('source:"huggingface"');
    expect(prompt).toContain('kind:"all"');
    expect(prompt).toContain('source:"kaggle"');
    expect(prompt).toContain('kaggle_kind:"both"');
    expect(prompt).toContain('benchmark_repo_catalog');
    expect(prompt).toContain('github_repo_digest');
    expect(prompt).toContain('component surface signals');
  });

  it('formats targeted benchmark coverage notes without leaking credentials', () => {
    vi.stubEnv('GITHUB_TOKEN', 'gh_note_secret');
    vi.stubEnv('HF_TOKEN', 'hf_note_secret');
    vi.stubEnv('KAGGLE_API_TOKEN', 'kg_note_secret');
    const notes = _internal.buildCoverageNotes(['arxiv', 'github', 'huggingface', 'kaggle'], 'all', 'all', 'both');
    expect(notes).toContain('Targeted benchmark coverage requested: arXiv + GitHub all + Hugging Face all + Kaggle both.');
    expect(notes.join('\n')).toContain('Kaggle both requested; competitions enabled by auth');
    expect(notes.join('\n')).toContain('GitHub auth found');
    expect(notes.join('\n')).not.toContain('kg_note_secret');
    expect(notes.join('\n')).not.toContain('gh_note_secret');
    expect(notes.join('\n')).not.toContain('hf_note_secret');
    const output = _internal.formatHits('agent benchmark', [], [], notes);
    expect(output).toContain('Coverage notes');
    expect(output).toContain('Source digest');
    expect(output).toContain('- hits: 0');
    expect(output).toContain('Targeted benchmark coverage requested');
  });

  it('records missing source credentials as readiness metadata without leaking values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grawkus-source-auth-empty-'));
    try {
      vi.stubEnv('GITHUB_TOKEN', '');
      vi.stubEnv('GH_TOKEN', '');
      vi.stubEnv('GITHUB_API_TOKEN', '');
      vi.stubEnv('KAGGLE_API_TOKEN', '');
      vi.stubEnv('KAGGLE_TOKEN', '');
      vi.stubEnv('KAGGLE_USERNAME', '');
      vi.stubEnv('KAGGLE_KEY', '');
      vi.stubEnv('KAGGLE_CONFIG_DIR', dir);
      const auth = _internal.buildSourceAuthReadiness(['github', 'kaggle'], 'both', process.env);
      expect(auth).toMatchObject({
        githubAuth: false,
        githubUnauthenticatedRateLimit: true,
        kaggleAuth: false,
        kaggleCompetitionsRequested: true,
        kaggleCompetitionsEnabled: false,
      });
      expect(auth.missingCredentialHints).toContain('GITHUB_TOKEN or GH_TOKEN');
      expect(auth.missingCredentialHints).toContain('KAGGLE_API_TOKEN or KAGGLE_USERNAME/KAGGLE_KEY');
      const notes = _internal.buildCoverageNotes(['github', 'kaggle'], 'all', 'all', 'both', undefined, auth);
      expect(notes.join('\n')).toContain('GitHub auth missing');
      expect(notes.join('\n')).toContain('Kaggle auth missing');
      expect(notes.join('\n')).not.toContain('gh_');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unsupported research source output formats', async () => {
    const result = await ResearchSourcesTool.call({
      query: 'agent',
      format: 'xml',
    }, process.cwd());

    expect(result.isError).toBe(true);
    expect(result.output).toContain('unsupported format');
  });
});
