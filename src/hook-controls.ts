/**
 * Hook Runtime Controls — environment-based hook profile management.
 * Control which hooks run and what severity of checks are enforced.
 */

export type HookProfile = 'minimal' | 'standard' | 'strict';

export interface HookControlConfig {
  profile: HookProfile;
  disabledHooks: string[];
}

/**
 * Get the current hook profile from environment variable.
 * Defaults to 'standard' if not set or invalid.
 */
export function getHookProfile(): HookProfile {
  const profile = process.env.GRAWKUS_HOOK_PROFILE?.toLowerCase();
  if (profile === 'minimal' || profile === 'strict') {
    return profile;
  }
  return 'standard';
}

/**
 * Get list of disabled hooks from environment variable.
 * Format: comma-separated hook IDs (e.g., "hook1,hook2,hook3")
 */
export function getDisabledHooks(): string[] {
  const disabled = process.env.GRAWKUS_DISABLED_HOOKS || '';
  return disabled
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
}

/**
 * Determine if a hook should run based on profile and disabled list.
 * @param hookId - The hook identifier
 * @param event - The hook event type (PreToolUse, PostToolUse, SessionStart, SessionStop)
 * @returns true if the hook should run, false otherwise
 */
export function shouldRunHook(hookId: string, event: string): boolean {
  // Check if hook is explicitly disabled
  const disabled = getDisabledHooks();
  if (disabled.includes(hookId)) {
    return false;
  }

  const profile = getHookProfile();

  // minimal: only session start/stop hooks
  if (profile === 'minimal') {
    return event === 'SessionStart' || event === 'SessionStop';
  }

  // strict: all hooks run
  if (profile === 'strict') {
    return true;
  }

  // standard: all hooks except expensive ones
  // (assume pre-commit validation and complex analysis hooks are "expensive")
  if (profile === 'standard') {
    // Filter out hooks that are marked as expensive/pre-commit hooks
    const expensivePatterns = ['pre-commit', 'validation', 'analysis', 'lint'];
    const isExpensive = expensivePatterns.some((pattern) =>
      hookId.toLowerCase().includes(pattern),
    );
    return !isExpensive;
  }

  return true;
}

/**
 * Get a human-readable description of what a hook profile does.
 */
export function getProfileDescription(profile: HookProfile): string {
  switch (profile) {
    case 'minimal':
      return 'Only session start/stop hooks enabled (minimal overhead)';
    case 'standard':
      return 'All hooks except expensive validation (default, balanced)';
    case 'strict':
      return 'All hooks including pre-commit validation (comprehensive checks)';
    default:
      return 'Unknown profile';
  }
}

/**
 * Print the current hook control status to console.
 */
export function printHookControlStatus(): void {
  const profile = getHookProfile();
  const disabled = getDisabledHooks();

  console.log('\n=== Hook Control Status ===');
  console.log(`Profile: ${profile}`);
  console.log(`Description: ${getProfileDescription(profile)}`);

  if (disabled.length > 0) {
    console.log(`Disabled hooks: ${disabled.join(', ')}`);
  } else {
    console.log('Disabled hooks: none');
  }
  console.log('');
}
