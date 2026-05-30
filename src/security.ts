/**
 * Security scanner — detect dangerous commands, secrets, and risky operations.
 * Runs before tool execution to catch threats.
 */
import chalk from 'chalk';

export type ThreatLevel = 'critical' | 'high' | 'medium' | 'low' | 'safe';

export interface SecurityScanResult {
  level: ThreatLevel;
  threats: string[];
  blocked: boolean;
}

// ── Dangerous command patterns ────────────────────────────
const DANGEROUS_COMMANDS: { pattern: RegExp; level: ThreatLevel; description: string }[] = [
  // Destructive filesystem
  { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+).*(\*|\/|\~)/i, level: 'critical', description: 'Recursive force delete with wildcard/root path' },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f/i, level: 'critical', description: 'rm -rf detected' },
  { pattern: /\brmdir\s+\/s\s+\/q/i, level: 'critical', description: 'Windows recursive delete' },
  { pattern: /\bformat\s+[a-zA-Z]:/i, level: 'critical', description: 'Disk format command' },
  { pattern: /\bmkfs\b/i, level: 'critical', description: 'Filesystem format command' },
  { pattern: />\s*\/dev\/sda/i, level: 'critical', description: 'Direct write to disk device' },
  { pattern: /\bdd\s+.*of=\/dev\//i, level: 'critical', description: 'dd write to device' },

  // Destructive git
  { pattern: /\bgit\s+push\s+.*--force/i, level: 'high', description: 'Git force push' },
  { pattern: /\bgit\s+push\s+-f\b/i, level: 'high', description: 'Git force push (-f)' },
  { pattern: /\bgit\s+reset\s+--hard/i, level: 'high', description: 'Git hard reset (destroys uncommitted changes)' },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/i, level: 'high', description: 'Git clean -f (deletes untracked files)' },
  { pattern: /\bgit\s+checkout\s+--\s+\./i, level: 'high', description: 'Git checkout -- . (discard all changes)' },
  { pattern: /\bgit\s+branch\s+-D/i, level: 'medium', description: 'Force delete git branch' },

  // Database destruction
  { pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, level: 'critical', description: 'SQL DROP statement' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, level: 'high', description: 'SQL TRUNCATE table' },
  { pattern: /\bDELETE\s+FROM\s+\w+\s*(;|$)/i, level: 'high', description: 'DELETE without WHERE clause' },
  { pattern: /\bALTER\s+TABLE\s+.*DROP\s+COLUMN/i, level: 'medium', description: 'Drop column from table' },

  // System/privilege escalation
  { pattern: /\bchmod\s+777\b/i, level: 'high', description: 'chmod 777 (world-writable)' },
  { pattern: /\bchmod\s+.*\+s\b/i, level: 'high', description: 'Set SUID/SGID bit' },
  { pattern: /\bcurl\s+.*\|\s*(sudo\s+)?bash/i, level: 'critical', description: 'Pipe curl to bash (remote code execution)' },
  { pattern: /\bwget\s+.*\|\s*(sudo\s+)?bash/i, level: 'critical', description: 'Pipe wget to bash (remote code execution)' },
  { pattern: /\beval\s*\(/i, level: 'medium', description: 'eval() usage (code injection risk)' },

  // Process/network
  { pattern: /\bkill\s+-9\s+1\b/i, level: 'critical', description: 'Kill init process' },
  { pattern: /\bkillall\b/i, level: 'medium', description: 'Kill all processes by name' },
  { pattern: /\b:(){ :|:& };:/i, level: 'critical', description: 'Fork bomb detected' },

  // Environment/config destruction
  { pattern: /\bunset\s+(PATH|HOME|USER)\b/i, level: 'high', description: 'Unsetting critical env var' },
  { pattern: /\bexport\s+PATH\s*=\s*$/i, level: 'high', description: 'Clearing PATH variable' },

  // Crypto/ransomware patterns
  { pattern: /\bopenssl\s+enc\s+.*-aes/i, level: 'medium', description: 'File encryption command' },
  { pattern: /\bgpg\s+.*--encrypt\b/i, level: 'low', description: 'GPG encryption' },
];

// ── Secret patterns ───────────────────────────────────────
const SECRET_PATTERNS: { pattern: RegExp; description: string }[] = [
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}/i, description: 'API key detected' },
  { pattern: /(?:secret|token|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}/i, description: 'Secret/password in code' },
  { pattern: /(?:aws_access_key_id|aws_secret_access_key)\s*[:=]/i, description: 'AWS credentials' },
  { pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/i, description: 'AWS access key ID' },
  { pattern: /-----BEGIN\s+(RSA |DSA |EC )?PRIVATE KEY-----/i, description: 'Private key detected' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/i, description: 'GitHub personal access token' },
  { pattern: /sk-[a-zA-Z0-9]{40,}/i, description: 'OpenAI/Stripe secret key' },
  { pattern: /xox[bpoas]-[a-zA-Z0-9\-]+/i, description: 'Slack token' },
  { pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/i, description: 'JWT token' },
];

export function scanCommand(command: string): SecurityScanResult {
  const threats: string[] = [];
  let maxLevel: ThreatLevel = 'safe';

  for (const rule of DANGEROUS_COMMANDS) {
    if (rule.pattern.test(command)) {
      threats.push(`[${rule.level.toUpperCase()}] ${rule.description}`);
      if (severityRank(rule.level) > severityRank(maxLevel)) {
        maxLevel = rule.level;
      }
    }
  }

  return {
    level: maxLevel,
    threats,
    blocked: maxLevel === 'critical',
  };
}

export function scanContent(content: string): SecurityScanResult {
  const threats: string[] = [];
  let maxLevel: ThreatLevel = 'safe';

  for (const rule of SECRET_PATTERNS) {
    if (rule.pattern.test(content)) {
      threats.push(`[SECRET] ${rule.description}`);
      if (severityRank('high') > severityRank(maxLevel)) {
        maxLevel = 'high';
      }
    }
  }

  return {
    level: maxLevel,
    threats,
    blocked: false,
  };
}

export function scanToolCall(
  toolName: string,
  input: Record<string, unknown>,
): SecurityScanResult {
  const allThreats: string[] = [];
  let maxLevel: ThreatLevel = 'safe';

  // Scan bash commands
  if (toolName === 'bash' && typeof input.command === 'string') {
    const cmdScan = scanCommand(input.command);
    allThreats.push(...cmdScan.threats);
    if (severityRank(cmdScan.level) > severityRank(maxLevel)) maxLevel = cmdScan.level;
  }

  // Scan file content for secrets
  if (toolName === 'write_file' && typeof input.content === 'string') {
    const contentScan = scanContent(input.content);
    allThreats.push(...contentScan.threats);
    if (severityRank(contentScan.level) > severityRank(maxLevel)) maxLevel = contentScan.level;
  }

  // Scan file paths for sensitive locations
  const filePath = input.file_path as string | undefined;
  if (filePath) {
    if (/\.(env|pem|key|p12|pfx)$/i.test(filePath)) {
      allThreats.push('[MEDIUM] Accessing sensitive file type');
      if (severityRank('medium') > severityRank(maxLevel)) maxLevel = 'medium';
    }
    if (/\/etc\/(passwd|shadow|sudoers)/i.test(filePath)) {
      allThreats.push('[HIGH] Accessing system security file');
      if (severityRank('high') > severityRank(maxLevel)) maxLevel = 'high';
    }
  }

  return { level: maxLevel, threats: allThreats, blocked: maxLevel === 'critical' };
}

export function printSecurityWarning(result: SecurityScanResult): void {
  if (result.threats.length === 0) return;

  const levelColor = {
    critical: chalk.bgRed.white.bold,
    high: chalk.red.bold,
    medium: chalk.yellow,
    low: chalk.dim,
    safe: chalk.green,
  };

  console.log(levelColor[result.level](`  ⚠ Security: ${result.level.toUpperCase()}`));
  for (const t of result.threats) {
    console.log(chalk.yellow(`    ${t}`));
  }
  if (result.blocked) {
    console.log(chalk.bgRed.white('    BLOCKED — this operation was prevented.'));
  }
}

function severityRank(level: ThreatLevel): number {
  return { safe: 0, low: 1, medium: 2, high: 3, critical: 4 }[level];
}
