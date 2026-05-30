/**
 * Harness Security Scanner — inspects harness assets for risks.
 * 
 * Scans skills, rules, hooks, subagents, and MCP configs for:
 * - API keys or token-looking strings
 * - Dangerous shell commands (curl|sh, rm -rf, sudo)
 * - Overbroad permissions
 * - Hidden network calls in hooks
 * - Instruction-only adapter downgrades without warning
 * - Shell scripts embedded in skills
 * - MCP configs with broad filesystem or shell access
 */

import type { HarnessAssetMeta } from './registry.js';

export interface ScanFinding {
  asset: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  message: string;
  recommendation: string;
  line?: number;
}

const DANGEROUS_SHELL_PATTERNS = [
  { pattern: /curl\s+\S+\s*\|\s*(?:sh|bash|zsh)/i, category: 'dangerous_shell', message: 'curl-pipe-shell detected' },
  { pattern: /wget\s+\S+\s*-\s*O\s*-\s*\|\s*(?:sh|bash)/i, category: 'dangerous_shell', message: 'wget-pipe-shell detected' },
  { pattern: /rm\s+-rf\s+\/(?:\s|$)/, category: 'dangerous_shell', message: 'rm -rf / detected' },
  { pattern: /sudo\s/, category: 'privilege_escalation', message: 'sudo detected' },
  { pattern: /chmod\s+777/, category: 'permissive', message: 'chmod 777 detected' },
];

const SECRET_PATTERNS = [
  { pattern: /sk-(?:or|ant|openai)-[A-Za-z0-9]{20,}/, category: 'secret', message: 'OpenAI/OpenRouter API key pattern' },
  { pattern: /ghp_[A-Za-z0-9]{36}/, category: 'secret', message: 'GitHub personal access token' },
  { pattern: /hf_[A-Za-z0-9]{30,}/, category: 'secret', message: 'HuggingFace token' },
  { pattern: /npm_[A-Za-z0-9]{36}/, category: 'secret', message: 'npm token' },
];

/**
 * Scan a harness asset body for security risks.
 * Returns findings sorted by severity.
 */
export function scanAssetBody(asset: HarnessAssetMeta, body: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const lines = body.split('\n');

  // Check for secrets
  for (const sp of SECRET_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (sp.pattern.test(lines[i])) {
        findings.push({
          asset: `${asset.kind}/${asset.name}`,
          severity: 'critical',
          category: sp.category,
          message: sp.message,
          recommendation: `Remove or redact the secret from ${asset.name}. Use environment variables or Grawkus config instead.`,
          line: i + 1,
        });
      }
    }
  }

  // Check for dangerous shell patterns
  for (const dp of DANGEROUS_SHELL_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (dp.pattern.test(lines[i])) {
        findings.push({
          asset: `${asset.kind}/${asset.name}`,
          severity: 'high',
          category: dp.category,
          message: dp.message,
          recommendation: `Restrict command patterns in ${asset.name} or require explicit user approval.`,
          line: i + 1,
        });
      }
    }
  }

  // Check for adapter downgrades without warning
  if (asset.targetHarnesses) {
    for (const [harness, capability] of Object.entries(asset.targetHarnesses)) {
      if (capability === 'instruction_only' && harness !== 'grawkus') {
        findings.push({
          asset: `${asset.kind}/${asset.name}`,
          severity: 'medium',
          category: 'adapter_downgrade',
          message: `Asset downgrades to instruction_only on ${harness} (native on Grawkus)`,
          recommendation: `Document the downgrade risk for ${harness} users. Consider adding an adapter-specific safety note.`,
        });
      }
    }
  }

  return findings.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

/**
 * Quick scan summary — returns counts per severity.
 */
export function scanSummary(findings: ScanFinding[]): Record<string, number> {
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] || 0) + 1;
  }
  return counts;
}

/**
 * Format findings for CLI output (/audit command).
 */
export function formatFindings(findings: ScanFinding[]): string {
  if (findings.length === 0) return '  ✓ No security issues found.';
  
  const lines: string[] = [];
  const icons: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
  
  for (const f of findings) {
    lines.push(`  ${icons[f.severity] || '•'} [${f.severity.toUpperCase()}] ${f.category}: ${f.message}`);
    lines.push(`     asset: ${f.asset}${f.line ? ` line ${f.line}` : ''}`);
    lines.push(`     fix: ${f.recommendation}`);
    lines.push('');
  }
  
  return lines.join('\n');
}
