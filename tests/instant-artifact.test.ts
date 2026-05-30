import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { maybeCreateInstantArtifact } from '../src/instant-artifact.js';

describe('instant local artifacts', () => {
  it('creates a named portfolio website without a model call', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-instant-artifact-'));
    try {
      const result = maybeCreateInstantArtifact(
        'I need you to make a website for Harry Tubman, he is a software engineer. This is hypothetical so make me something incredible.',
        cwd,
      );

      expect(result).not.toBeNull();
      expect(result?.filePath).toMatch(/harry-tubman-portfolio\.html$/);
      const html = readFileSync(result!.filePath, 'utf8');
      expect(html).toContain('<title>Harry Tubman | Software Engineer</title>');
      expect(html).toContain('Harry Tubman');
      expect(html).toContain('Software Engineer');
      expect(result?.message).toContain('Created a single-file portfolio website');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('uses the Desktop directory when requested', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-instant-artifact-cwd-'));
    const home = mkdtempSync(join(tmpdir(), 'grawkus-instant-artifact-home-'));
    try {
      const env = { ...process.env, USERPROFILE: home, HOME: home };
      const result = maybeCreateInstantArtifact(
        'create a portfolio website for Mara Vale and save it to desktop',
        cwd,
        env,
      );

      expect(result?.filePath).toContain(join(home, 'Desktop'));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('does not intercept existing app or repo work', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-instant-artifact-skip-'));
    try {
      expect(maybeCreateInstantArtifact('make a portfolio page in this React app for the team', cwd)).toBeNull();
      expect(maybeCreateInstantArtifact('fix the website in the current project', cwd)).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('can be disabled by environment variable', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grawkus-instant-artifact-off-'));
    try {
      expect(maybeCreateInstantArtifact(
        'make a website for Harry Tubman',
        cwd,
        { ...process.env, GRAWKUS_INSTANT_ARTIFACTS: '0' },
      )).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
