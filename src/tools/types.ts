/**
 * Tool definition interface.
 * All tools must implement this contract to be used by the AI agent.
 */
export interface Tool {
  /** Unique tool name (used by the AI to call the tool) */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON schema for the tool's input parameters */
  parameters: JsonSchema;
  /** If true, the tool only reads data and never modifies state */
  isReadOnly: boolean;
  /** If true, the tool can make destructive changes (writes, deletes) */
  isDestructive: boolean;
  /**
   * Execute the tool with the given input.
   * @param input - Parsed JSON arguments matching the tool's schema
   * @param cwd - Current working directory
   * @returns Tool result with output and error status
   */
  call(input: Record<string, unknown>, cwd: string): Promise<ToolResult>;
}

/**
 * Result returned by a tool after execution.
 */
export interface ToolResult {
  /** Text output from the tool (stdout or error message) */
  output: string;
  /** True if the tool encountered an error */
  isError: boolean;
}

/**
 * Simplified JSON Schema definition for tool parameters.
 */
export interface JsonSchema {
  /** JSON Schema type (usually "object") */
  type: string;
  /** Property definitions keyed by parameter name */
  properties: Record<string, unknown>;
  /** List of required parameter names */
  required?: string[];
  /** Whether additional properties are allowed */
  additionalProperties?: boolean;
}
