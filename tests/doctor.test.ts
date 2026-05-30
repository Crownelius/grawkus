import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDoctorReport, formatDoctorReport } from '../src/doctor.js';
import pkg from '../package.json' with { type: 'json' };

const tempDirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'grawkus-doctor-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('doctor readiness checks', () => {
  it('builds a non-secret readiness report without registry access', () => {
    const secret = 'sensitive-provider-token-value';
    const report = buildDoctorReport({
      includeRegistry: false,
      env: {
        ...process.env,
        GRAWKUS_HOME: tempHome(),
        GRAWKUS_PROVIDER: 'openrouter',
        GRAWKUS_MODEL: 'openrouter/free',
        GRAWKUS_API_KEY: secret,
        GITHUB_TOKEN: secret,
        HF_TOKEN: secret,
        KAGGLE_USERNAME: 'tester',
        KAGGLE_KEY: secret,
      },
    });

    const text = `${JSON.stringify(report)}\n${formatDoctorReport(report)}`;
    expect(report.version).toBe(pkg.version);
    expect(text).toContain('Grawkus Doctor');
    expect(report.checks.some((check) => check.id === 'benchmark_adapters' && check.status === 'pass')).toBe(true);
    expect(report.checks.some((check) => check.id === 'openrouter_free_tier' && check.status === 'pass')).toBe(true);
    const researchAuth = report.checks.find((check) => check.id === 'research_auth');
    expect(researchAuth?.status).toBe('pass');
    expect(researchAuth?.detail).toContain('GitHub auth found');
    expect(researchAuth?.detail).toContain('Kaggle competitions enabled');
    expect(text).not.toContain(secret);
  });

  it('warns when source-research auth is incomplete without printing secrets', () => {
    const emptyKaggleDir = tempHome();
    const report = buildDoctorReport({
      includeRegistry: false,
      env: {
        ...process.env,
        GRAWKUS_HOME: tempHome(),
        GRAWKUS_PROVIDER: 'openrouter',
        GRAWKUS_MODEL: 'openrouter/free',
        GRAWKUS_API_KEY: 'test-token-value',
        GITHUB_TOKEN: '',
        GH_TOKEN: '',
        GITHUB_API_TOKEN: '',
        KAGGLE_API_TOKEN: '',
        KAGGLE_TOKEN: '',
        KAGGLE_USERNAME: '',
        KAGGLE_KEY: '',
        KAGGLE_CONFIG_DIR: emptyKaggleDir,
      },
    });

    const researchAuth = report.checks.find((check) => check.id === 'research_auth');
    expect(researchAuth?.status).toBe('warn');
    expect(researchAuth?.detail).toContain('arXiv public access available');
    expect(researchAuth?.detail).toContain('GitHub auth missing');
    expect(researchAuth?.detail).toContain('Kaggle auth missing');
    expect(researchAuth?.detail).toContain('Kaggle competitions disabled');
    expect(researchAuth?.hint).toContain('GITHUB_TOKEN');
    expect(formatDoctorReport(report)).not.toContain('test-token-value');
  });

  it('prints JSON from the CLI wrapper before first-time setup', () => {
    const out = execFileSync('node', ['bin/grawkus.js', '--doctor-json', '--doctor-no-registry'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      env: {
        ...process.env,
        GRAWKUS_HOME: tempHome(),
        GRAWKUS_PROVIDER: 'openrouter',
        GRAWKUS_MODEL: 'openrouter/free',
        GRAWKUS_API_KEY: 'test-token-value',
      },
    });
    const parsed = JSON.parse(out);
    expect(parsed.version).toBe(pkg.version);
    expect(parsed.checks.some((check: { id: string }) => check.id === 'registry_latest')).toBe(true);
    expect(parsed.summary.fail).toBe(0);
  });
});
