// Fixture for ast-field-refs testing.
// Contains various reference patterns for the field "active_time_ms".

interface UserStats {
  active_time_ms: number;
  idle_time_ms: number;
}

type StatsRow = {
  active_time_ms: string; // UInt64 serializes as string from ClickHouse
};

const stats: UserStats = { active_time_ms: 100, idle_time_ms: 200 };

// Property access
const time = stats.active_time_ms;

// Destructuring
const { active_time_ms } = stats;
const { active_time_ms: renamedTime } = stats;

// Element access
const val = (stats as Record<string, number>)['active_time_ms'];

// String literal in accessor/column config
const columns = [
  { accessor: 'active_time_ms', header: 'Active Time' },
  { sortKey: 'idle_time_ms', header: 'Idle Time' },
];

// Shorthand object literal
const payload = { active_time_ms };

export { time, renamedTime, val, columns, payload };
