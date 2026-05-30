import { describe, expect, it } from 'vitest';
import { maybeInstantAnswer } from '../src/instant-answer.js';

describe('instant local answers', () => {
  it('answers trivial conversational prompts without touching the provider', () => {
    expect(maybeInstantAnswer('hi there')).toBe('Hi. What would you like Grawkus to work on?');
    expect(maybeInstantAnswer('I need your help')).toBe('What do you need help with?');
    expect(maybeInstantAnswer('help me')).toBe('What do you need help with?');
    expect(maybeInstantAnswer('THANK YOU!')).toBe("You're welcome.");
    expect(maybeInstantAnswer("what's Grawkus?")).toBe('I am Grawkus: terminal coding agents with a mind for the whole repo.');
  });

  it('answers current time and date prompts locally', () => {
    const now = new Date('2026-05-28T12:34:00Z');
    expect(maybeInstantAnswer('do you know what time it is right now?', { now, timeZone: 'UTC' }))
      .toBe('It is 12:34 PM UTC on Thursday, May 28, 2026.');
    expect(maybeInstantAnswer('what day is it today?', { now, timeZone: 'UTC' }))
      .toBe('Today is Thursday, May 28, 2026.');
  });

  it('does not catch substantive prompts that need the model or tools', () => {
    expect(maybeInstantAnswer('hi there, fix the tests')).toBeNull();
    expect(maybeInstantAnswer('help me fix the tests')).toBeNull();
    expect(maybeInstantAnswer('thanks, now write a poem')).toBeNull();
  });

  it('answers basic square-root prompts without a provider call', () => {
    expect(maybeInstantAnswer('what is the square root of 81')).toBe('The square root of 81 is 9.');
    expect(maybeInstantAnswer('sqrt of 2')).toBe('The square root of 2 is 1.4142135624.');
  });

  it('answers small arithmetic prompts safely', () => {
    expect(maybeInstantAnswer('what is 12 times 3?')).toBe('12 times 3 = 36.');
    expect(maybeInstantAnswer('10 / 0')).toBe('Division by zero is undefined.');
  });
});
