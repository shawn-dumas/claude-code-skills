// ── Visual Compare: Reusable browser-side JS snippets ──────────────────────
//
// These are JavaScript expressions for use with `playwright-cli -s=<session> eval "..."`.
// They interact with the UI via testids and DOM queries rather than snapshot ref IDs,
// so they work across snapshots without needing to re-discover refs.
//
// ── Usage from the agent ────────────────────────────────────────────────────
//
// Copy the expression (the value after the key) into a playwright-cli eval call:
//   playwright-cli -s=local eval "<expression>"
//
// For expressions that take parameters, replace the placeholders:
//   playwright-cli -s=local eval "document.querySelector('[data-testid=\"select-button-team\"]')?.click()"
//
// ── Available Snippets ──────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// 1. PAGE STATE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

// Check if page has loaded data, shows error, or is still loading.
// Returns: "loaded:<resultText>" | "error:<message>" | "empty:<message>" | "loading"
const PAGE_STATUS = `
(function() {
  var main = document.querySelector('main');
  if (!main) return 'loading';
  var text = main.innerText;
  if (text.includes('Something went wrong')) return 'error:Something went wrong';
  if (text.includes('Select a team to view data')) return 'empty:no-team-selected';
  if (text.includes('Select a user or workstream')) return 'empty:no-user-selected';
  if (text.includes('0 results')) return 'empty:0-results';
  var m = text.match(/(Showing \\d+ to \\d+ of [\\d,]+ results|\\d+ results)/);
  return m ? 'loaded:' + m[1] : 'loaded:no-result-count';
})()
`;

// ═══════════════════════════════════════════════════════════════════════════
// 2. TEAM SELECTION (multi-select FilterSelect used on most insight pages)
// ═══════════════════════════════════════════════════════════════════════════

// Open the team dropdown. Works on all pages that use FilterSelect for teams.
const OPEN_TEAM_DROPDOWN = `
document.querySelector('[data-testid="filter-select-open-button"]')?.click()
`;

// Type into the team search input to filter options.
// Replace TEAM_NAME with the team to search for.
const SEARCH_TEAM = `
(function() {
  var input = document.querySelector('[data-testid="filter-select-search-input"]');
  if (!input) return 'error:no-search-input';
  var nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  nativeInputValueSetter.call(input, 'TEAM_NAME');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()
`;

// Click a team option by exact name. Call after OPEN_TEAM_DROPDOWN + SEARCH_TEAM.
// Replace TEAM_NAME with the exact team name.
const CLICK_TEAM_OPTION = `
(function() {
  var labels = document.querySelectorAll('[data-testid="filter-select-option-label"]');
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].textContent.trim() === 'TEAM_NAME') {
      labels[i].closest('[data-testid="filter-select-option"]')?.click();
      return 'ok:clicked';
    }
  }
  return 'error:option-not-found';
})()
`;

// Close the team dropdown by clicking outside it.
const CLOSE_TEAM_DROPDOWN = `
document.querySelector('main')?.click()
`;

// ═══════════════════════════════════════════════════════════════════════════
// 3. SUBMIT / UPDATE / REFRESH BUTTONS
// ═══════════════════════════════════════════════════════════════════════════

// Click the Update button (used on most insight pages except Realtime/Workstreams).
const CLICK_UPDATE = `
document.querySelector('[data-testid="updateButton"]')?.click()
`;

// Click the Refresh button (Realtime page only).
const CLICK_REFRESH = `
document.querySelector('[data-testid="realtime-filters-submit-button"]')?.click()
`;

// Click the Search button (Workstreams page only).
const CLICK_SEARCH = `
document.querySelector('[data-testid="workstreams-filters-submit-button"]')?.click()
`;

// Click "Show Filters" to expand collapsed filter panel.
const CLICK_SHOW_FILTERS = `
(function() {
  var btns = document.querySelectorAll('button');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent.trim() === 'Show Filters') {
      btns[i].click();
      return 'ok:expanded';
    }
  }
  return 'ok:already-visible';
})()
`;

// ═══════════════════════════════════════════════════════════════════════════
// 4. SINGLE-SELECT DROPDOWNS (Select component: timezone, days period, etc.)
// ═══════════════════════════════════════════════════════════════════════════

// Click a Select dropdown button by its testid suffix.
// The Select component generates testids like "select-button-<name>".
// Replace SELECT_NAME with: team, timezone, daysperiod, reportperiod, reportlevel, analyzingby
const OPEN_SELECT = `
document.querySelector('[data-testid="select-button-SELECT_NAME"]')?.click()
`;

// Click an option in an open Select dropdown by text.
// Replace OPTION_TEXT with the exact option text.
const CLICK_SELECT_OPTION = `
(function() {
  var opts = document.querySelectorAll('[role="option"]');
  for (var i = 0; i < opts.length; i++) {
    if (opts[i].textContent.trim() === 'OPTION_TEXT') {
      opts[i].click();
      return 'ok:selected';
    }
  }
  return 'error:option-not-found';
})()
`;

// ═══════════════════════════════════════════════════════════════════════════
// 5. REALTIME-SPECIFIC
// ═══════════════════════════════════════════════════════════════════════════

// Toggle "Hide users with no events" checkbox.
const TOGGLE_HIDE_NO_EVENTS = `
document.querySelector('input[type="checkbox"]')?.click()
`;

// ═══════════════════════════════════════════════════════════════════════════
// 6. WORKSTREAMS-SPECIFIC
// ═══════════════════════════════════════════════════════════════════════════

// Enter workstream IDs into the workstreams text input.
// Replace WS_IDS with comma-separated IDs.
const FILL_WORKSTREAM_IDS = `
(function() {
  var input = document.querySelector('[data-testid="workstreams-filters-workstreams-input"]');
  if (!input) return 'error:no-input';
  var nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  nativeInputValueSetter.call(input, 'WS_IDS');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()
`;

// ═══════════════════════════════════════════════════════════════════════════
// 7. TABLE INTERACTION
// ═══════════════════════════════════════════════════════════════════════════

// Click a column header to sort. Replace COLUMN_NAME with the exact header text.
const CLICK_COLUMN_HEADER = `
(function() {
  var headers = document.querySelectorAll('th button');
  for (var i = 0; i < headers.length; i++) {
    if (headers[i].textContent.trim() === 'COLUMN_NAME') {
      headers[i].click();
      return 'ok:clicked';
    }
  }
  return 'error:header-not-found';
})()
`;

// Click a table row by matching text (e.g., an email address).
// Replace MATCH_TEXT with text that uniquely identifies the row.
const CLICK_TABLE_ROW = `
(function() {
  var rows = document.querySelectorAll('tr[style*="cursor"]');
  if (rows.length === 0) rows = document.querySelectorAll('tr');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].textContent.includes('MATCH_TEXT')) {
      rows[i].click();
      return 'ok:clicked';
    }
  }
  return 'error:row-not-found';
})()
`;

// Click a tab by name. Replace TAB_NAME with the exact tab text.
const CLICK_TAB = `
(function() {
  var tabs = document.querySelectorAll('[role="tab"]');
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].textContent.trim() === 'TAB_NAME') {
      tabs[i].click();
      return 'ok:clicked';
    }
  }
  return 'error:tab-not-found';
})()
`;

// Click next page button in pagination.
const CLICK_NEXT_PAGE = `
(function() {
  var btns = document.querySelectorAll('nav button');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent.trim() === '->') {
      btns[i].click();
      return 'ok:clicked';
    }
  }
  return 'error:no-next-button';
})()
`;

// ═══════════════════════════════════════════════════════════════════════════
// 8. SYSTEMS-SPECIFIC
// ═══════════════════════════════════════════════════════════════════════════

// Switch to Table view on Systems page (click the second radio button).
const SYSTEMS_TABLE_VIEW = `
document.querySelectorAll('[role="radio"]')[1]?.click()
`;

// Switch to Cards view on Systems page (click the first radio button).
const SYSTEMS_CARDS_VIEW = `
document.querySelectorAll('[role="radio"]')[0]?.click()
`;

// Click a system card by name on Systems page.
// Replace SYSTEM_NAME with the system name (e.g., "Google Sheets").
const CLICK_SYSTEM_CARD = `
(function() {
  var cards = document.querySelectorAll('[class*="cursor-pointer"]');
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].textContent.includes('SYSTEM_NAME')) {
      cards[i].click();
      return 'ok:clicked';
    }
  }
  return 'error:card-not-found';
})()
`;
