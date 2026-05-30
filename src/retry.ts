/**
 * Retry utility — exponential backoff for API calls.
 * Retries on rate limits (429), server errors (500/502/503), and network failures.
 */
import chalk from 'chalk';

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms before first retry (default: 1000) */
  baseDelay?: number;
  /** Maximum delay in ms between retries (default: 30000) */
  maxDelay?: number;
}

/**
 * Determines if an error is retryable.
 * Retries on: HTTP 429 (rate limit), 500/502/503 (server errors),
 * and common network errors (ECONNREFUSED, ETIMEDOUT, etc.).
 *
 * @param error - The error to evaluate
 * @returns True if the error is transient and the request should be retried
 */
function isRetryableError(error: unknown): boolean {
  // Handle OpenAI APIError and similar error objects
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    const status = err.status as number | undefined;

    // Rate limit errors (429)
    if (status === 429) return true;

    // Server errors (500, 502, 503)
    if (status === 500 || status === 502 || status === 503) return true;
  }

  // Handle network errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Common network error patterns
    if (
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('ehostunreach') ||
      message.includes('enetunreach') ||
      message.includes('getaddrinfo') ||
      message.includes('socket') ||
      message.includes('timeout')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
): number {
  // Exponential backoff: baseDelay * (2 ^ attempt)
  const exponentialDelay = baseDelay * Math.pow(2, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelay);

  // Add jitter: ±10% of the calculated delay
  const jitter = cappedDelay * (0.9 + Math.random() * 0.2);

  return Math.floor(jitter);
}

/**
 * Wraps an async operation with retry logic
 *
 * @param operation - The async function to execute
 * @param config - Retry configuration
 * @returns The result of the operation
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = {},
): Promise<T> {
  const maxRetries = config.maxRetries ?? 3;
  const baseDelay = config.baseDelay ?? 1000;
  const maxDelay = config.maxDelay ?? 30000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // If not retryable or out of retries, throw immediately
      if (!isRetryableError(error) || attempt === maxRetries) {
        throw error;
      }

      const delay = calculateDelay(attempt, baseDelay, maxDelay);
      const errorMsg = error instanceof Error ? error.message : String(error);

      console.log(
        chalk.yellow(
          `Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms (${errorMsg})`,
        ),
      );

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but throw the last error just in case
  throw lastError;
}
