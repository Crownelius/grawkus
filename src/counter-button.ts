/**
 * A UI counter button component.
 * Tracks a count that can be incremented, decremented, and reset.
 */
export class CounterButton {
  count: number = 0;
  label: string;

  /**
   * Create a new CounterButton.
   * @param label - Display label for the button (default: "Counter")
   */
  constructor(label: string = 'Counter') {
    this.label = label;
  }

  /**
   * Increment the counter by 1.
   */
  press(): void {
    this.count++;
  }

  /**
   * Decrement the counter by 1.
   */
  unpress(): void {
    this.count--;
  }

  /**
   * Reset the counter to 0.
   */
  reset(): void {
    this.count = 0;
  }

  /**
   * Render the button as a string.
   * @returns Formatted string like `[ Counter: 5 ]`
   */
  render(): string {
    return `[ ${this.label}: ${this.count} ]`;
  }

  /**
   * String representation (alias for render).
   * @returns Formatted string like `[ Counter: 5 ]`
   */
  toString(): string {
    return this.render();
  }
}