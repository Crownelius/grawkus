import { describe, it, expect, beforeEach } from 'vitest';
import { CounterButton } from '../src/counter-button.js';

describe('CounterButton', () => {
  let button: CounterButton;

  beforeEach(() => {
    button = new CounterButton();
  });

  it('starts with count 0 and default label', () => {
    expect(button.count).toBe(0);
    expect(button.label).toBe('Counter');
  });

  it('can be created with a custom label', () => {
    const btn = new CounterButton('Votes');
    expect(btn.label).toBe('Votes');
    expect(btn.count).toBe(0);
  });

  it('increments count when pressed', () => {
    button.press();
    expect(button.count).toBe(1);
  });

  it('increments count multiple times when pressed', () => {
    button.press();
    button.press();
    button.press();
    expect(button.count).toBe(3);
  });

  it('decrements count when unpress', () => {
    button.press();
    button.press();
    button.unpress();
    expect(button.count).toBe(1);
  });

  it('resets count to 0 when reset is called', () => {
    button.press();
    button.press();
    button.reset();
    expect(button.count).toBe(0);
  });

  it('renders as a formatted button string', () => {
    button.press();
    button.press();
    expect(button.render()).toBe('[ Counter: 2 ]');
  });

  it('renders with custom label', () => {
    const btn = new CounterButton('Likes');
    btn.press();
    expect(btn.render()).toBe('[ Likes: 1 ]');
  });

  it('renders at zero', () => {
    expect(button.render()).toBe('[ Counter: 0 ]');
  });

  it('handles unpress below zero gracefully', () => {
    button.unpress();
    expect(button.count).toBe(-1);
  });

  it('provides a toString alias for render', () => {
    button.press();
    expect(button.toString()).toBe('[ Counter: 1 ]');
  });
});