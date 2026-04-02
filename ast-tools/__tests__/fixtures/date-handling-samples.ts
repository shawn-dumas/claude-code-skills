// Fixture for ast-date-handling testing.
// Contains raw Date usage and proper Temporal usage patterns.

// --- Raw Date patterns ---

// RAW_DATE_CONSTRUCTOR
const now = new Date();
const fromMs = new Date(1234567890);
const fromString = new Date('2026-01-01');

// RAW_DATE_STATIC
const timestamp = Date.now();
const parsed = Date.parse('2026-01-01');
const utc = Date.UTC(2026, 0, 1);

// RAW_DATE_ACCESSOR
const year = now.getFullYear();
const month = now.getMonth();
const ms = now.getTime();

// RAW_DATE_FORMAT
const iso = now.toISOString();
const locale = now.toLocaleDateString();

// RAW_DATE_FORMAT (ambiguous methods resolved via type checker)
const localeStr = now.toLocaleString();
const json = now.toJSON();

// MANUAL_DATE_STRING_OP
const cleaned = iso.replace('T', ' ');
const cleanedRegex = iso.replace(/T/, ' ');
const parts = iso.split('T');

// Not a date string op (should NOT be flagged -- exercises negative branches)
const notDate = 'hello world';
const nonDateReplace = notDate.replace('world', 'there');
const nonDateReplaceOneArg = notDate.replace('world');

// Not a date string op (should NOT be flagged -- exercises the false branch of the /T/ check)
const notDate = 'hello world';
const nonDateReplace = notDate.replace('world', 'there');

// --- Proper patterns ---

// TEMPORAL_USAGE
import { Temporal } from 'temporal-polyfill';
const today = Temporal.Now.plainDateISO();
const dt = Temporal.PlainDate.from('2026-01-01');

// FORMAT_UTIL_USAGE -- call expressions matching known utility names.
// No definitions needed: this file is parsed as AST, never compiled.
// Using bare calls avoids shadowing the real imports from @/shared/utils/temporal.
const formatted = formatDate(today);
const dur = formatDuration(1000);

export {
  now,
  fromMs,
  fromString,
  timestamp,
  parsed,
  utc,
  year,
  month,
  ms,
  iso,
  locale,
  localeStr,
  json,
  cleaned,
  cleanedRegex,
  parts,
  notDate,
  nonDateReplace,
  today,
  dt,
  formatted,
  dur,
};
