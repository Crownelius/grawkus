#!/usr/bin/env node
// Cawdex legacy alias — delegates to Grawkus.
// Cawdex has evolved into Grawkus. Use `grawkus` as the primary entry point.
console.error('\x1b[33m⚠  cawdex is a legacy alias for grawkus. Use `grawkus` for the canonical experience.\x1b[0m');
import('./grawkus.js');
