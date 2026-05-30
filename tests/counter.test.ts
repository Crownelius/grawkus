import { describe, it, expect, beforeEach } from 'vitest';
import { incrementCounter, decrementCounter, resetCounter, getCounter } from '../src/counter.js';

describe('Counter module', () => {
  beforeEach(() => {
    // Reset counter state before each test
    resetCounter();
  });

  it('starts at zero', () => {
    expect(getCounter()).toBe(0);
  });

  it('increments by 1', () => {
    incrementCounter();
    expect(getCounter()).toBe(1);
  });

  it('increments multiple times', () => {
    incrementCounter();
    incrementCounter();
    incrementCounter();
    expect(getCounter()).toBe(3);
  });

  it('decrements by 1', () => {
    incrementCounter();
    incrementCounter();
    decrementCounter();
    expect(getCounter()).toBe(1);
  });

  it('decrements below zero', () => {
    decrementCounter();
    expect(getCounter()).toBe(-1);
  });

  it('resets to zero after incrementing', () => {
    incrementCounter();
    incrementCounter();
    incrementCounter();
    resetCounter();
    expect(getCounter()).toBe(0);
  });

  it('resets to zero after decrementing', () => {
    decrementCounter();
    decrementCounter();
    resetCounter();
    expect(getCounter()).toBe(0);
  });

  it('handles mixed increment/decrement operations', () => {
    incrementCounter();
    incrementCounter();
    decrementCounter();
    incrementCounter();
    decrementCounter();
    decrementCounter();
    expect(getCounter()).toBe(0);
  });
});