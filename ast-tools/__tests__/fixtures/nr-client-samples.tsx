/* eslint-disable @typescript-eslint/no-unused-vars, no-console */
import React, { useEffect } from 'react';

// Fixture for ast-nr-client: NR browser agent integration patterns

// 1. NREUM call (setPageViewName)
function RouteTracker() {
  useEffect(() => {
    if (window.NREUM) {
      window.NREUM.setPageViewName('/dashboard');
    }
  }, []);
  return null;
}

// 2. NREUM call (addPageAction)
function TrackAction() {
  function handleClick() {
    if (window.NREUM) {
      window.NREUM.addPageAction('ButtonClick', { page: 'home' });
    }
  }
  return <button onClick={handleClick}>Track</button>;
}

// 3. reportErrorToNewRelic wrapper call
function ErrorReporter() {
  try {
    doSomething();
  } catch (err) {
    reportErrorToNewRelic(err);
  }
  return null;
}

// 4. monitorApiCall wrapper call
async function fetchData() {
  return monitorApiCall('fetchUsers', () => fetch('/api/users'));
}

// 5. NewRelicRouteTracker JSX usage
function AppWrapper() {
  return (
    <NewRelicRouteTracker>
      <div>App</div>
    </NewRelicRouteTracker>
  );
}

// 6. Missing error handler: catch block with console.error, no NR
function NoNrInCatch() {
  try {
    doSomething();
  } catch (err) {
    console.error('Failed:', err);
  }
  return null;
}

// 7. Catch block WITH NR reporting (should NOT trigger NR_MISSING_ERROR_HANDLER)
function WithNrInCatch() {
  try {
    doSomething();
  } catch (err) {
    console.error('Failed:', err);
    reportErrorToNewRelic(err);
  }
  return null;
}

// 8. componentDidCatch without NR (class component)
class ErrorBoundaryNoNr extends React.Component {
  componentDidCatch(error: Error) {
    console.error('Caught:', error);
  }
  render() {
    return this.props.children;
  }
}

// 9. componentDidCatch WITH NR (should NOT trigger)
class ErrorBoundaryWithNr extends React.Component {
  componentDidCatch(error: Error) {
    reportErrorToNewRelic(error);
  }
  render() {
    return this.props.children;
  }
}

// 10. Tracer misuse: async work started BEFORE interaction/tracer
function BadTracerPattern<T>(apiCall: () => Promise<T>) {
  const resultPromise = apiCall(); // async work starts here

  if (window.NREUM) {
    const interaction = window.NREUM.interaction();
    interaction.createTracer('api-call', () => {
      resultPromise
        .then(() => {
          window.NREUM?.addPageAction('success', {});
        })
        .catch((error: Error) => {
          window.NREUM?.noticeError(error);
        });
    });
  }

  return resultPromise;
}

// 11. Correct tracer pattern: async work INSIDE the tracer (should NOT trigger)
function GoodTracerPattern<T>(apiCall: () => Promise<T>) {
  if (window.NREUM) {
    const interaction = window.NREUM.interaction();
    return interaction.createTracer('api-call', () => {
      const result = apiCall(); // async work inside tracer
      return result;
    });
  }
  return apiCall();
}

// Declarations
declare function doSomething(): void;
declare function reportErrorToNewRelic(err: unknown): void;
declare function monitorApiCall<T>(name: string, fn: () => T): T;
declare function NewRelicRouteTracker(props: { children: React.ReactNode }): React.JSX.Element;
