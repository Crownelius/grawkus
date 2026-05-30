/**
 * Simple in-memory counter utility.
 * Used by the `/count` slash command for basic increment/decrement/reset operations.
 */

let count = 0;

/**
 * Increment the counter by 1.
 */
export function incrementCounter(): void {
  count++;
}

/**
 * Decrement the counter by 1.
 */
export function decrementCounter(): void {
  count--;
}

/**
 * Reset the counter to 0.
 */
export function resetCounter(): void {
  count = 0;
}

/**
 * Get the current counter value.
 * @returns The current count
 */
export function getCounter(): number {
  return count;
}