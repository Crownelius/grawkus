import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import pkg from '../package.json' with { type: 'json' };

describe('Exgentic adapter packaging', () => {
  const adapterDir = join(process.cwd(), 'resources', 'exgentic', 'grawkus_agent');
  const agentPath = join(adapterDir, 'agent.py');
  const utilsPath = join(adapterDir, 'utils.py');
  const setupPath = join(adapterDir, 'setup.sh');
  const requirementsPath = join(adapterDir, 'requirements.txt');

  it('ships an Exgentic custom agent package', () => {
    expect(existsSync(agentPath)).toBe(true);
    expect(existsSync(utilsPath)).toBe(true);
    expect(existsSync(setupPath)).toBe(true);
    expect(existsSync(requirementsPath)).toBe(true);

    const agent = readFileSync(agentPath, 'utf-8');
    expect(agent).toContain('class GrawkusAgent(GrawkusAgent)');
    expect(agent).toContain('class GrawkusAgentInstance(GrawkusAgentInstance)');
    expect(agent).toContain('class GrawkusAgent(Agent)');
    expect(agent).toContain('class GrawkusAgentInstance(AgentInstance)');
    expect(agent).toContain('slug_name: ClassVar[str] = "grawkus_agent"');
    expect(agent).toContain('def react(self, observation: Observation | None) -> Action | None');
    expect(agent).toContain('GRAWKUS_EXGENTIC_COMMAND');
    expect(agent).toContain('--benchmark-trace-dir');
    expect(agent).toContain('summary.json');
    expect(agent).toContain('{"name":"<action name>","arguments":{}}');
    expect(agent).toContain('def _profile_for_exgentic');
    expect(agent).toContain('/benchmark {profile} Exgentic task');
    expect(agent).toContain('## Available action names');
    expect(agent).toContain('## Recommended action shortlist');
    expect(agent).toContain('shortlist_exgentic_actions');
    expect(agent).toContain('repair_exgentic_action_payload');
    expect(agent).toContain('## Folded session state');
    expect(agent).toContain('fold_exgentic_history');
    expect(agent).toContain('return "appworld"');
    expect(agent).toContain('return "browsecomp"');
    expect(agent).toContain('return "tau2"');
    expect(agent).toContain('return "terminalworld"');
    expect(agent).toContain('return "swe-cycle"');
    expect(agent).toContain('return "swe-ci"');
    expect(agent).toContain('return "swe-prbench"');
    expect(agent).toContain('return "tml-bench"');
    expect(agent).toContain('return "pi-bench"');
    expect(agent).toContain('return "webdevbench"');
    const utils = readFileSync(utilsPath, 'utf-8');
    expect(utils).toContain('SWE-PRBench prior');
    expect(utils).toContain('TML-Bench prior');
    expect(utils).toContain('Pi-Bench prior');
    expect(utils).toContain('swe-prbench');
    expect(utils).toContain('tml-bench');
    expect(utils).toContain('pi-bench');
    expect(utils).toContain('TerminalWorld');
  });

  it('prints the packaged Exgentic agent directory from the CLI wrapper', () => {
    const out = execFileSync('node', ['bin/grawkus.js', '--print-exgentic-agent'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    }).trim();
    expect(normalize(out)).toBe(normalize(adapterDir));
  });

  it('prints CLI help and version without entering first-time setup', () => {
    const help = execFileSync('node', ['bin/grawkus.js', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    expect(help).toContain('Grawkus — terminal coding agents with a mind for the whole repo');
    expect(help).toContain('Usage:');
    expect(help).toContain('grawkus [options]');
    expect(help).toContain('grawkus [options]');
    expect(help).toContain('--prompt <text>');
    expect(help).toContain('--doctor');
    expect(help).not.toContain('First-time Setup');

    const grawkusHelp = execFileSync('node', ['bin/grawkus.js', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    expect(grawkusHelp).toContain('grawkus [options]');
    expect(grawkusHelp).not.toContain('Legacy alias:');

    const version = execFileSync('node', ['bin/grawkus.js', '--version'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    }).trim();
    expect(version).toBe(pkg.version);
    expect(pkg.bin).toMatchObject({
      grawkus: 'bin/grawkus.js',
    });
  });

  it('ships and prints an Open Agent Leaderboard agent card', () => {
    const cardPath = join(process.cwd(), 'resources', 'open_agent_leaderboard', 'grawkus-agent-card.md');
    expect(existsSync(cardPath)).toBe(true);
    const card = readFileSync(cardPath, 'utf-8');
    expect(card).toContain('name: Grawkus');
    expect(card).toContain('## Architecture');
    expect(card).toContain('## Memory');
    expect(card).toContain('## Evaluation Results');
    expect(card).toContain('submissionReady:false');
    expect(card).toContain('grawkus --print-exgentic-agent');

    const out = execFileSync('node', ['bin/grawkus.js', '--print-open-agent-card'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    }).trim();
    expect(normalize(out)).toBe(normalize(cardPath));
  });

  it('accepts common harness CLI flags before the Exgentic utility flag', () => {
    const out = execFileSync('node', [
      'bin/grawkus.js',
      '--model',
      'openrouter/free',
      '--max-turns=3',
      '--output-format',
      'text',
      '--benchmark-trace-dir',
      'artifacts',
      '--print-exgentic-agent',
    ], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    }).trim();
    expect(normalize(out)).toBe(normalize(adapterDir));
  });

  it('parses grawkus action JSON from stdout', () => {
    const samples = [
      'notes\n{"name":"finish","arguments":{"answer":"42"}}',
      '```json\n{"action":"message","arguments":{"content":"done"}}\n```',
      'grawkus-exgentic action JSON: {"action":{"name":"click","arguments":{"x":1}}}',
    ];
    const script = [
      `import json, sys`,
      `sys.path.insert(0, ${JSON.stringify(adapterDir)})`,
      `import utils`,
      `samples = ${JSON.stringify(samples)}`,
      `payloads = [utils.extract_action_payload(sample) for sample in samples]`,
      `print(json.dumps([{"name": p.name, "arguments": p.arguments} for p in payloads], sort_keys=True))`,
    ].join('\n');
    const out = execFileSync('python', ['-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
    }).trim();
    const parsed = JSON.parse(out);
    expect(parsed).toEqual([
      { name: 'finish', arguments: { answer: '42' } },
      { name: 'message', arguments: { content: 'done' } },
      { name: 'click', arguments: { x: 1 } },
    ]);
  });

  it('folds noisy Exgentic history into a compact task ledger', () => {
    const history = [
      { role: 'observation', content: { user: 'Ava', order_id: 'ord-1', status: 'pending' } },
      {
        role: 'grawkus',
        returncode: 0,
        stdout: 'large harmless model transcript '.repeat(100),
        stderr: '',
      },
      {
        role: 'selected_action',
        content: [{ name: 'lookup_order', arguments: { order_id: 'ord-1', verbose: true } }],
      },
      {
        role: 'grawkus',
        returncode: 1,
        stdout: 'unknown action selected',
        stderr: 'schema mismatch for action',
      },
      {
        role: 'action_repair',
        content: {
          status: 'repaired',
          original_name: 'LookupOrder',
          repaired_name: 'lookup_order',
        },
      },
    ];
    const script = [
      `import json, sys`,
      `sys.path.insert(0, ${JSON.stringify(adapterDir)})`,
      `import utils`,
      `history = json.loads(${JSON.stringify(JSON.stringify(history))})`,
      `folded = utils.fold_exgentic_history(history, profile="tau2", item_limit=220)`,
      `print(json.dumps(folded, sort_keys=True))`,
    ].join('\n');
    const out = execFileSync('python', ['-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
    }).trim();
    const folded = JSON.parse(out);
    expect(folded.format).toBe('grawkus-exgentic-folded-history-v1');
    expect(folded.profile).toBe('tau2');
    expect(folded.latest_observation.summary).toContain('ord-1');
    expect(folded.latest_action.actions[0].name).toBe('lookup_order');
    expect(folded.latest_action.actions[0].argument_keys).toEqual(['order_id', 'verbose']);
    expect(folded.action_counts.lookup_order).toBe(1);
    expect(folded.diagnostics[0].evidence).toContain('schema mismatch');
    expect(JSON.stringify(folded.diagnostics)).toContain('LookupOrder');
    expect(JSON.stringify(folded)).not.toContain('large harmless model transcript large harmless model transcript large harmless model transcript');
  });

  it('shortlists Exgentic actions while deferring premature finish actions', () => {
    const actionDocs = [
      {
        name: 'lookup_order',
        description: 'Look up order and customer state',
        is_finish: false,
        is_message: false,
        arguments_schema: {
          properties: { order_id: { type: 'string' } },
          required: ['order_id'],
        },
      },
      {
        name: 'issue_refund',
        description: 'Issue refund for an eligible order',
        is_finish: false,
        is_message: false,
        arguments_schema: {
          properties: { order_id: { type: 'string' }, amount: { type: 'number' } },
          required: ['order_id', 'amount'],
        },
      },
      {
        name: 'finish',
        description: 'Finish with the final answer',
        is_finish: true,
        is_message: false,
        arguments_schema: { properties: { answer: { type: 'string' } } },
      },
    ];
    const script = [
      `import json, sys`,
      `sys.path.insert(0, ${JSON.stringify(adapterDir)})`,
      `import utils`,
      `actions = json.loads(${JSON.stringify(JSON.stringify(actionDocs))})`,
      `pending_history = [{"role": "observation", "content": {"order_id": "ord-1", "status": "pending", "next": "lookup order before refund"}}]`,
      `done_history = [{"role": "observation", "content": {"order_id": "ord-1", "status": "completed", "note": "refund completed and customer confirmed"}}]`,
      `pending = utils.shortlist_exgentic_actions(actions, task="Refund order ord-1", context={"order_id": "stale-context-order", "amount": 12.5}, history=pending_history, profile="tau2", limit=2)`,
      `done = utils.shortlist_exgentic_actions(actions, task="Refund order ord-1", history=done_history, profile="tau2", limit=3)`,
      `print(json.dumps({"pending": pending, "done": done}, sort_keys=True))`,
    ].join('\n');
    const out = execFileSync('python', ['-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
    }).trim();
    const parsed = JSON.parse(out);
    expect(parsed.pending.format).toBe('grawkus-exgentic-action-shortlist-v1');
    expect(parsed.pending.completion_ready).toBe(false);
    expect(parsed.pending.shortlisted_actions[0].name).toBe('lookup_order');
    expect(parsed.pending.shortlisted_actions[0].required_argument_keys).toEqual(['order_id']);
    expect(parsed.pending.shortlisted_actions[0].available_required_hints).toEqual([
      { key: 'order_id', source: 'latest_observation.order_id', value_preview: '"ord-1"' },
    ]);
    const refund = parsed.pending.shortlisted_actions.find((item: { name: string }) => item.name === 'issue_refund');
    expect(refund.available_required_hints).toEqual([
      { key: 'order_id', source: 'latest_observation.order_id', value_preview: '"ord-1"' },
      { key: 'amount', source: 'context.amount', value_preview: '12.5' },
    ]);
    expect(parsed.pending.shortlisted_actions.map((item: { name: string }) => item.name)).not.toContain('finish');
    expect(parsed.pending.deferred_completion_actions).toContain('finish');
    expect(parsed.done.completion_ready).toBe(true);
    expect(parsed.done.shortlisted_actions.map((item: { name: string }) => item.name)).toContain('finish');
  });

  it('selects a viable non-finish fallback when action JSON is missing and work is pending', () => {
    const actionDocs = [
      {
        name: 'lookup_order',
        description: 'Look up order and customer state',
        is_finish: false,
        is_message: false,
        arguments_schema: {
          properties: { order_id: { type: 'string' } },
          required: ['order_id'],
        },
      },
      {
        name: 'finish',
        description: 'Finish with the final answer',
        is_finish: true,
        is_message: false,
        arguments_schema: {
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        },
      },
    ];
    const script = [
      `import json, sys`,
      `sys.path.insert(0, ${JSON.stringify(adapterDir)})`,
      `import utils`,
      `actions = json.loads(${JSON.stringify(JSON.stringify(actionDocs))})`,
      `pending_history = [{"role": "observation", "content": {"order_id": "ord-1", "status": "pending", "next": "lookup order before finishing"}}]`,
      `done_history = [{"role": "observation", "content": {"order_id": "ord-1", "status": "completed", "note": "done and confirmed"}}]`,
      `pending = utils.fallback_exgentic_action_payload(actions, task="Resolve order ord-1", history=pending_history, profile="tau2")`,
      `done = utils.fallback_exgentic_action_payload(actions, task="Resolve order ord-1", history=done_history, profile="tau2")`,
      `print(json.dumps({`,
      `  "pending": {"name": pending.payload.name, "arguments": pending.payload.arguments, "diagnostics": pending.diagnostics},`,
      `  "done": {"name": done.payload.name, "arguments": done.payload.arguments, "diagnostics": done.diagnostics},`,
      `}, sort_keys=True))`,
    ].join('\n');
    const out = execFileSync('python', ['-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
    }).trim();
    const parsed = JSON.parse(out);
    expect(parsed.pending.name).toBe('lookup_order');
    expect(parsed.pending.arguments).toEqual({ order_id: 'ord-1' });
    expect(parsed.pending.diagnostics.status).toBe('fallback_selected');
    expect(parsed.pending.diagnostics.completion_ready).toBe(false);
    expect(parsed.pending.diagnostics.skipped_candidates).toEqual([]);
    expect(parsed.done.name).toBe('finish');
    expect(parsed.done.arguments).toEqual({});
    expect(parsed.done.diagnostics.completion_ready).toBe(true);
  });

  it('avoids repeating an action when the latest Exgentic observation did not change', () => {
    const actionDocs = [
      {
        name: 'lookup_order',
        description: 'Look up order and customer state',
        is_finish: false,
        is_message: false,
        arguments_schema: {
          properties: { order_id: { type: 'string' } },
          required: ['order_id'],
        },
      },
      {
        name: 'issue_refund',
        description: 'Issue refund for an eligible order',
        is_finish: false,
        is_message: false,
        arguments_schema: {
          properties: { order_id: { type: 'string' }, amount: { type: 'number' } },
          required: ['order_id', 'amount'],
        },
      },
      {
        name: 'finish',
        description: 'Finish with the final answer',
        is_finish: true,
        is_message: false,
        arguments_schema: { properties: { answer: { type: 'string' } } },
      },
    ];
    const script = [
      `import json, sys`,
      `sys.path.insert(0, ${JSON.stringify(adapterDir)})`,
      `import utils`,
      `actions = json.loads(${JSON.stringify(JSON.stringify(actionDocs))})`,
      `obs = {"order_id": "ord-1", "status": "pending", "next": "issue refund", "note": "customer still waiting"}`,
      `history = [`,
      `  {"role": "observation", "content": obs},`,
      `  {"role": "selected_action", "content": [{"name": "lookup_order", "arguments": {"order_id": "ord-1"}}]},`,
      `  {"role": "observation", "content": obs},`,
      `]`,
      `shortlist = utils.shortlist_exgentic_actions(actions, task="Refund order ord-1", context={"amount": 12.5}, history=history, profile="tau2", limit=3)`,
      `fallback = utils.fallback_exgentic_action_payload(actions, task="Refund order ord-1", context={"amount": 12.5}, history=history, profile="tau2")`,
      `print(json.dumps({`,
      `  "avoid": shortlist["avoid_no_effect_repeat_actions"],`,
      `  "names": [item["name"] for item in shortlist["shortlisted_actions"]],`,
      `  "fallback": {"name": fallback.payload.name, "arguments": fallback.payload.arguments, "diagnostics": fallback.diagnostics},`,
      `}, sort_keys=True))`,
    ].join('\n');
    const out = execFileSync('python', ['-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
    }).trim();
    const parsed = JSON.parse(out);
    expect(parsed.avoid).toEqual(['lookup_order']);
    expect(parsed.names[0]).toBe('issue_refund');
    expect(parsed.fallback.name).toBe('issue_refund');
    expect(parsed.fallback.arguments).toEqual({ order_id: 'ord-1', amount: 12.5 });
    expect(parsed.fallback.diagnostics.avoid_no_effect_repeat_actions).toEqual(['lookup_order']);
  });

  it('repairs near-miss Exgentic action names and argument keys before dispatch', () => {
    const actionDocs = [
      {
        name: 'lookup_order',
        description: 'Look up order and customer state',
        is_finish: false,
        is_message: false,
        arguments_schema: {
          properties: { order_id: { type: 'string' }, include_history: { type: 'boolean' } },
          required: ['order_id', 'include_history'],
        },
      },
      {
        name: 'finish',
        description: 'Finish with the final answer',
        is_finish: true,
        is_message: false,
        arguments_schema: { properties: { answer: { type: 'string' } } },
      },
    ];
    const script = [
      `import json, sys`,
      `sys.path.insert(0, ${JSON.stringify(adapterDir)})`,
      `import utils`,
      `actions = json.loads(${JSON.stringify(JSON.stringify(actionDocs))})`,
      `payload = utils.ActionPayload(name="LookupOrder", arguments={"includeHistory": True, "debug": "drop"})`,
      `hints = {"latest_observation": {"order_id": "ord-1", "status": "pending"}, "context": {"order_id": "stale-context-order"}}`,
      `repaired = utils.repair_exgentic_action_payload(payload, actions, argument_hints=hints)`,
      `unresolved = utils.repair_exgentic_action_payload(utils.ActionPayload(name="teleport", arguments={"x": 1}), actions)`,
      `print(json.dumps({`,
      `  "payload": {"name": repaired.payload.name, "arguments": repaired.payload.arguments},`,
      `  "changed": repaired.changed,`,
      `  "diagnostics": repaired.diagnostics,`,
      `  "unresolved": unresolved.diagnostics,`,
      `}, sort_keys=True))`,
    ].join('\n');
    const out = execFileSync('python', ['-c', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
    }).trim();
    const parsed = JSON.parse(out);
    expect(parsed.changed).toBe(true);
    expect(parsed.payload).toEqual({
      name: 'lookup_order',
      arguments: { order_id: 'ord-1', include_history: true },
    });
    expect(parsed.diagnostics.status).toBe('repaired');
    expect(parsed.diagnostics.name_match_reason).toBe('normalized_identifier');
    expect(parsed.diagnostics.argument_key_repairs).toEqual([
      { from: 'includeHistory', to: 'include_history' },
    ]);
    expect(parsed.diagnostics.filled_required_arguments).toEqual([
      { key: 'order_id', source: 'latest_observation.order_id' },
    ]);
    expect(parsed.diagnostics.dropped_argument_keys).toEqual(['debug']);
    expect(parsed.unresolved.status).toBe('unresolved_action_name');
  });

  it('compiles the Python adapter files without writing __pycache__ into resources', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grawkus-exgentic-pycompile-'));
    try {
      const script = [
        'import py_compile',
        `py_compile.compile(${JSON.stringify(agentPath)}, cfile=${JSON.stringify(join(dir, 'agent.pyc'))}, doraise=True)`,
        `py_compile.compile(${JSON.stringify(utilsPath)}, cfile=${JSON.stringify(join(dir, 'utils.pyc'))}, doraise=True)`,
      ].join('\n');
      execFileSync('python', ['-c', script], {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
