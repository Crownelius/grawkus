#!/usr/bin/env node
/**
 * Smoke test: verify multi-turn operation works in Grawkus.
 * Sends two consecutive prompts in non-interactive mode and checks
 * both receive responses without timing out.
 */
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const GRAWKUS = 'node bin/grawkus.js';

// Load config for API key
const config = JSON.parse(readFileSync(join(homedir(), '.grawkus', 'config.json'), 'utf-8'));

function runPrompt(prompt, label) {
  const start = Date.now();
  try {
    const out = execFileSync('node', [
      'bin/grawkus.js',
      '--prompt', prompt,
      '--non-interactive',
      '--max-turns', '3',
      '--output-format', 'text',
      '--perm', 'yolo',
    ], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 60_000,
      env: {
        ...process.env,
        GRAWKUS_API_KEY: config.apiKey,
        GRAWKUS_BASE_URL: config.baseURL,
        GRAWKUS_MODEL: config.model || 'openrouter/free',
        GRAWKUS_PROVIDER: 'OpenRouter',
        GRAWKUS_NON_INTERACTIVE: '1',
      },
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  ${label}: OK (${elapsed}s, ${out.length} chars)`);
    return out;
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`  ${label}: FAILED after ${elapsed}s`);
    if (e.stdout) console.error('  stdout:', String(e.stdout).slice(-200));
    if (e.stderr) console.error('  stderr:', String(e.stderr).slice(-500));
    return null;
  }
}

console.log('Grawkus Multi-Turn Smoke Test');
console.log('============================\n');

// Test 1: Simple text prompt
const r1 = runPrompt('Write a single sentence about a dog.', 'Turn 1 (simple)');

// Test 2: Another simple prompt (should work same as first)
const r2 = runPrompt('Write a single sentence about a cat.', 'Turn 2 (simple)');

// Test 3: Prompt that might trigger tool calls
const r3 = runPrompt('What is 2+2? Just answer with the number.', 'Turn 3 (math)');

console.log('\nResults:');
console.log(`  Turn 1: ${r1 ? 'PASS' : 'FAIL'}`);
console.log(`  Turn 2: ${r2 ? 'PASS' : 'FAIL'}`);
console.log(`  Turn 3: ${r3 ? 'PASS' : 'FAIL'}`);

const allPass = r1 && r2 && r3;
console.log(`\n${allPass ? '✓ ALL PASS' : '✗ SOME FAILED'}`);
process.exit(allPass ? 0 : 1);
