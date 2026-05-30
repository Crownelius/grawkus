/**
 * PM2 Service Lifecycle Management
 * Utilities for managing background services with PM2.
 */

import { execSync } from 'node:child_process';
import chalk from 'chalk';

export interface ServiceConfig {
  name: string;
  script: string;
  cwd: string;
  env?: Record<string, string>;
  instances?: number;
  maxMemory?: string;
}

/**
 * Build a prompt for Claude to help with PM2 lifecycle management.
 * @param action - The PM2 action (start, stop, restart, delete, logs, status, scale)
 * @returns A prompt describing what PM2 actions are available
 */
export function buildPM2Prompt(action: string): string {
  const actions = ['start', 'stop', 'restart', 'delete', 'logs', 'status', 'scale'];
  const normalizedAction = action.toLowerCase();

  if (!actions.includes(normalizedAction)) {
    return `PM2 supports the following actions: ${actions.join(', ')}. Please specify a valid action.`;
  }

  const prompts: Record<string, string> = {
    start:
      'Use `pm2 start <script.js>` to start a service, or `pm2 start ecosystem.config.js` to start services from an ecosystem file.',
    stop: 'Use `pm2 stop <app-name>` to stop a running service, or `pm2 stop all` to stop all services.',
    restart:
      'Use `pm2 restart <app-name>` to restart a service, or `pm2 restart all` to restart all services.',
    delete:
      'Use `pm2 delete <app-name>` to remove a service from PM2, or `pm2 delete all` to remove all services.',
    logs:
      'Use `pm2 logs <app-name>` to view real-time logs, or `pm2 logs` to view all logs. Use `pm2 logs --lines 100` to view last 100 lines.',
    status:
      'Use `pm2 list` or `pm2 status` to view all running services, their status, CPU/memory usage, and uptime.',
    scale:
      'Use `pm2 scale <app-name> <num>` to scale a service to N instances for load balancing.',
  };

  return prompts[normalizedAction] || 'Unknown PM2 action.';
}

/**
 * Check if PM2 is installed and available.
 * @returns true if pm2 command is available, false otherwise
 */
export function isPM2Available(): boolean {
  try {
    execSync('pm2 -v', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * List all PM2 services and return the formatted output.
 * @param cwd - Working directory to run the command in
 * @returns PM2 list output as a string
 */
export function listPM2Services(cwd: string): string {
  try {
    const output = execSync('pm2 list', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output;
  } catch (err) {
    return `Error listing PM2 services: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Build a prompt for creating a PM2 ecosystem configuration file.
 * @param cwd - Working directory where the ecosystem file will be created
 * @returns A prompt with guidance on creating ecosystem.config.js
 */
export function buildEcosystemPrompt(cwd: string): string {
  return `To manage multiple services with PM2, create an ecosystem.config.js file in ${cwd}.

Example structure:
module.exports = {
  apps: [
    {
      name: 'api-server',
      script: './dist/server.js',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'worker',
      script: './dist/worker.js',
      instances: 1,
      max_memory_restart: '300M'
    }
  ]
};

Then start all services with: pm2 start ecosystem.config.js
Monitor logs with: pm2 logs
View status with: pm2 status`;
}

/**
 * Pretty-print PM2 status output with colored formatting.
 * @param output - Raw PM2 list output
 */
export function printPM2Status(output: string): void {
  const lines = output.split('\n');

  console.log(chalk.bold.cyan('\n=== PM2 Service Status ===\n'));

  for (const line of lines) {
    // Color-code status indicators
    if (line.includes('online')) {
      console.log(chalk.green(line));
    } else if (line.includes('stopped')) {
      console.log(chalk.red(line));
    } else if (line.includes('errored')) {
      console.log(chalk.red.bold(line));
    } else if (line.includes('one-launch-status')) {
      console.log(chalk.yellow(line));
    } else if (line.match(/CPU|MEM|RESTART/)) {
      console.log(chalk.dim(line));
    } else if (line.match(/id|name|namespace/i)) {
      console.log(chalk.bold(line));
    } else {
      console.log(line);
    }
  }

  console.log(chalk.dim('\nUse `pm2 logs` to view service logs'));
}
