/* eslint-disable */
// Fixture file for ast-side-effects tests. Contains intentional side effects.

// --- CONSOLE_CALL (top-level) ---
console.log('top-level log');
console.warn('top-level warn');
console.error('top-level error');

// --- TOAST_CALL (in a named function) ---
function showToast() {
  toast('simple toast');
  toast.success('success toast');
  toast.error('error toast');
}

// --- TIMER_CALL (in a named function) ---
function startTimers() {
  setTimeout(() => {}, 1000);
  setInterval(() => {}, 2000);
  requestAnimationFrame(() => {});
  clearTimeout(0);
  clearInterval(0);
  cancelAnimationFrame(0);
}

// --- POSTHOG_CALL (in an arrow function) ---
const trackEvents = () => {
  sendPosthogEvent('click', {});
  posthog.capture('event');
  posthog.identify('user-id');
  posthog.reset();
};

// --- WINDOW_MUTATION (in a named function) ---
function navigateAway() {
  window.location.href = 'https://example.com';
  window.open('https://example.com');
  document.title = 'new title';
  history.pushState({}, '', '/new');
  history.replaceState({}, '', '/replaced');
}

// --- Side effects inside useEffect (should have isInsideUseEffect: true) ---
function MyComponent() {
  useEffect(() => {
    console.log('inside useEffect');
    const timer = setTimeout(() => {}, 500);
    document.title = 'effect title';
    return () => clearTimeout(timer);
  }, []);

  useLayoutEffect(() => {
    console.debug('inside useLayoutEffect');
  });

  // This one is OUTSIDE useEffect
  console.info('outside useEffect in component');

  return null;
}

// --- Nested function inside useEffect ---
function AnotherComponent() {
  useEffect(() => {
    function cleanup() {
      clearInterval(99);
    }
    const id = setInterval(() => {}, 3000);
    return () => cleanup();
  }, []);

  return null;
}

// --- Cookie mutation ---
function setCookie() {
  document.cookie = 'name=value';
}
