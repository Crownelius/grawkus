function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(10))).replace(/\.?0+$/, '');
}

function parseNumber(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export interface InstantAnswerOptions {
  now?: Date;
  locale?: string;
  timeZone?: string;
}

function formatCurrentDateTime(options: InstantAnswerOptions = {}): { date: string; time: string } {
  const now = options.now ?? new Date();
  const locale = options.locale ?? 'en-US';
  const timeZone = options.timeZone;
  const common = timeZone ? { timeZone } : {};
  const date = new Intl.DateTimeFormat(locale, {
    ...common,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);
  const time = new Intl.DateTimeFormat(locale, {
    ...common,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(now);
  return { date, time };
}

export function maybeInstantAnswer(input: string, options: InstantAnswerOptions = {}): string | null {
  const text = input.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/[.!?]+$/g, '');

  if (/^(?:hi|hello|hey|yo|hiya|howdy)(?: there)?$/.test(normalized)) {
    return 'Hi. What would you like Grawkus to work on?';
  }

  if (/^(?:i\s+)?need\s+(?:your\s+)?help$/.test(normalized) || /^help(?: me)?$/.test(normalized)) {
    return 'What do you need help with?';
  }

  if (/^(?:thanks|thank you|thx|ty|appreciate it)$/.test(normalized)) {
    return "You're welcome.";
  }

  if (/^(?:who are you|what are you|what is grawkus|what's grawkus)$/.test(normalized)) {
    return 'I am Grawkus: terminal coding agents with a mind for the whole repo.';
  }

  if (
    /^(?:do you know )?what(?:'s| is)? (?:the )?time(?:(?: is it)|(?: it is))?(?: right now| now)?$/.test(normalized)
    || /^(?:tell me|give me) (?:the )?(?:current )?time(?: right now| now)?$/.test(normalized)
    || /^current time$/.test(normalized)
  ) {
    const { date, time } = formatCurrentDateTime(options);
    return `It is ${time} on ${date}.`;
  }

  if (
    /^(?:what(?:'s| is)? )?(?:today's date|the date|the current date|current date|date today)$/.test(normalized)
    || /^what day is it(?: today)?$/.test(normalized)
  ) {
    const { date } = formatCurrentDateTime(options);
    return `Today is ${date}.`;
  }

  const sqrt = text.match(/^(?:(?:what(?:'s| is)?|calculate|compute)\s+)?(?:the\s+)?(?:square\s+root|sqrt)\s+(?:of\s+)?(-?\d+(?:,\d{3})*(?:\.\d+)?)\??$/i);
  if (sqrt) {
    const value = parseNumber(sqrt[1]);
    if (value == null) return null;
    if (value < 0) return `The real square root of ${formatNumber(value)} is not defined.`;
    return `The square root of ${formatNumber(value)} is ${formatNumber(Math.sqrt(value))}.`;
  }

  const arithmetic = text.match(/^(?:(?:what(?:'s| is)?|calculate|compute)\s+)?(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*(plus|\+|minus|-|times|x|\*|divided by|\/)\s*(-?\d+(?:,\d{3})*(?:\.\d+)?)\??$/i);
  if (arithmetic) {
    const left = parseNumber(arithmetic[1]);
    const right = parseNumber(arithmetic[3]);
    if (left == null || right == null) return null;
    const op = arithmetic[2].toLowerCase();
    let result: number;
    if (op === 'plus' || op === '+') result = left + right;
    else if (op === 'minus' || op === '-') result = left - right;
    else if (op === 'times' || op === 'x' || op === '*') result = left * right;
    else {
      if (right === 0) return 'Division by zero is undefined.';
      result = left / right;
    }
    return `${formatNumber(left)} ${arithmetic[2]} ${formatNumber(right)} = ${formatNumber(result)}.`;
  }

  return null;
}
