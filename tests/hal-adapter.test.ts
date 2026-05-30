import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';

describe('HAL adapter packaging', () => {
  const adapterDir = join(process.cwd(), 'resources', 'hal', 'grawkus_agent');
  const mainPath = join(adapterDir, 'main.py');
  const requirementsPath = join(adapterDir, 'requirements.txt');

  it('ships a HAL-style custom agent adapter', () => {
    expect(existsSync(mainPath)).toBe(true);
    expect(existsSync(requirementsPath)).toBe(true);

    const adapter = readFileSync(mainPath, 'utf-8');
    expect(adapter).toContain('def run(input: dict[str, dict[str, Any]], **kwargs: Any)');
    expect(adapter).toContain('/benchmark {profile} HAL task');
    expect(adapter).toContain('GRAWKUS_HAL_COMMAND');
    expect(adapter).toContain('GRAWKUS_HAL_TRACE_DIR');
    expect(adapter).toContain('GRAWKUS_HAL_INCLUDE_ORACLE_FIELDS');
    expect(adapter).toContain('--benchmark-trace-dir');
    expect(adapter).toContain('worktree.patch');
    expect(adapter).toContain('["diff", "--binary", "--no-ext-diff"]');
    expect(adapter).toContain('finalAssistant');
    expect(adapter).toContain('ORACLE_FIELD_RE');
    expect(adapter).toContain('return "wildclaw"');
    expect(adapter).toContain('return "arc-agi"');
    expect(adapter).toContain('return "specbench"');
    expect(adapter).toContain('return "reward-hacking"');
    expect(adapter).toContain('return "roadmapbench"');
    expect(adapter).toContain('return "saasbench"');
    expect(adapter).toContain('return "swe-bench-mobile"');
    expect(adapter).toContain('return "swe-cycle"');
    expect(adapter).toContain('return "swe-ci"');
    expect(adapter).toContain('return "swe-prbench"');
    expect(adapter).toContain('return "tml-bench"');
    expect(adapter).toContain('return "pi-bench"');
    expect(adapter).toContain('return "webdevbench"');
    expect(adapter).toContain('return "appworld"');
    expect(adapter).toContain('return "browsecomp"');
    expect(adapter).toContain('return "tau2"');
    expect(adapter).toContain('return "terminalworld"');
  });

  it('prints the packaged HAL agent directory from the CLI wrapper', () => {
    const out = execFileSync('node', ['bin/grawkus.js', '--print-hal-agent'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    }).trim();
    expect(normalize(out)).toBe(normalize(adapterDir));
  });

  it('accepts common harness CLI flags before the HAL utility flag', () => {
    const out = execFileSync('node', [
      'bin/grawkus.js',
      '--model',
      'openrouter/free',
      '--max-turns=3',
      '--output-format',
      'text',
      '--benchmark-trace-dir',
      'artifacts',
      '--print-hal-agent',
    ], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    }).trim();
    expect(normalize(out)).toBe(normalize(adapterDir));
  });

  it('executes the HAL run contract for SWE patch tasks without oracle leakage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grawkus-hal-swe-'));
    try {
      writeFileSync(join(dir, 'fake_agent.py'), [
        'import json, sys',
        'from pathlib import Path',
        'args = sys.argv[1:]',
        'trace_dir = Path(args[args.index("--benchmark-trace-dir") + 1])',
        'prompt = args[args.index("--prompt") + 1]',
        'Path("fake-argv.json").write_text(json.dumps({"args": args, "prompt": prompt}), encoding="utf-8")',
        'run_dir = trace_dir / "fake-run"',
        'run_dir.mkdir(parents=True, exist_ok=True)',
        'run_dir.joinpath("worktree.patch").write_text("diff --git a/app.py b/app.py\\n+fixed sk-or-v1-secretvalue\\n", encoding="utf-8")',
        'run_dir.joinpath("summary.json").write_text(json.dumps({"finalAssistant": "patch complete"}), encoding="utf-8")',
        'print("stdout hf_abcdefghijklmnop")',
      ].join('\n'), 'utf-8');

      const script = [
        'import json, sys',
        `sys.path.insert(0, ${JSON.stringify(adapterDir)})`,
        'import main',
        'result = main.run({"case-1": {"repo": "owner/repo", "instance_id": "case-1", "base_commit": "abc", "problem_statement": "Fix the bug", "patch": "GOLD_PATCH", "test_patch": "GOLD_TEST", "FAIL_TO_PASS": ["test_a"]}}, model_name="openrouter/free", max_turns=3)',
        'print(json.dumps(result, sort_keys=True))',
      ].join('\n');

      const out = execFileSync('python', ['-c', script], {
        cwd: dir,
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
          GRAWKUS_HAL_COMMAND: 'python fake_agent.py',
          GRAWKUS_HAL_TRACE_DIR: join(dir, 'trace'),
          GRAWKUS_HAL_TIMEOUT_SEC: '10',
        },
        encoding: 'utf-8',
      }).trim();
      const result = JSON.parse(out);
      expect(result['case-1']).toContain('diff --git');
      expect(result['case-1']).toContain('sk-or-v1-[REDACTED]');

      const invocation = JSON.parse(readFileSync(join(dir, 'fake-argv.json'), 'utf-8'));
      expect(invocation.args).toContain('--model');
      expect(invocation.args).toContain('openrouter/free');
      expect(invocation.args).toContain('--max-turns');
      expect(invocation.args).toContain('3');
      expect(invocation.prompt).toContain('/benchmark swe-bench HAL task case-1');
      expect(invocation.prompt).toContain('Oracle-like task fields omitted');
      expect(invocation.prompt).not.toContain('GOLD_PATCH');
      expect(invocation.prompt).not.toContain('GOLD_TEST');
      expect(invocation.prompt).not.toContain('test_a');

      const halStdout = readFileSync(join(dir, 'trace', 'case-1', 'hal-stdout.txt'), 'utf-8');
      expect(halStdout).toContain('hf_[REDACTED]');
      expect(halStdout).not.toContain('hf_abcdefghijklmnop');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns HAL benchmark-specific response shapes for text tasks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grawkus-hal-text-'));
    try {
      writeFileSync(join(dir, 'fake_agent.py'), [
        'import json, sys',
        'from pathlib import Path',
        'args = sys.argv[1:]',
        'trace_dir = Path(args[args.index("--benchmark-trace-dir") + 1])',
        'run_dir = trace_dir / "fake-run"',
        'run_dir.mkdir(parents=True, exist_ok=True)',
        'run_dir.joinpath("summary.json").write_text(json.dumps({"finalAssistant": "final response"}), encoding="utf-8")',
      ].join('\n'), 'utf-8');

      const script = [
        'import json, sys',
        `sys.path.insert(0, ${JSON.stringify(adapterDir)})`,
        'import main',
        'science = main.run({"sab-1": {"task_inst": "Analyze the dataset", "dataset_path": "data.csv", "output_fname": "answer.py", "gold_program_name": "gold.py"}})',
        'usaco = main.run({"usaco-1": {"description": "Solve it", "samples": [{"input": "1", "output": "1"}], "solution": "secret solution"}})',
        'appworld = main.run({"app-1": {"task_id": "app-1"}})',
        'print(json.dumps({"science": science, "usaco": usaco, "appworld": appworld}, sort_keys=True))',
      ].join('\n');

      const out = execFileSync('python', ['-c', script], {
        cwd: dir,
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
          GRAWKUS_HAL_COMMAND: 'python fake_agent.py',
          GRAWKUS_HAL_TRACE_DIR: join(dir, 'trace'),
          GRAWKUS_HAL_TIMEOUT_SEC: '10',
        },
        encoding: 'utf-8',
      }).trim();
      const result = JSON.parse(out);
      expect(result.science['sab-1']).toBe('final response');
      expect(result.usaco['usaco-1']).toMatchObject({
        description: 'Solve it',
        response: 'final response',
      });
      expect(result.usaco['usaco-1']).not.toHaveProperty('grawkus_agent_returncode');
      expect(result.appworld['app-1']).toBe('Completed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
