import { useEffect, useMemo, useRef } from 'react';

interface NavEvent {
  pathname: string;
  eventName: string;
}

const dashboardNavigationEvents: NavEvent[] = [{ pathname: '/dashboard', eventName: 'dashboard_view' }];

function sendPosthogEvent(_payload: { eventName: string; properties: Record<string, unknown> }) {
  // analytics network call
}

interface Props {
  children: React.ReactNode;
  pathname: string;
  userId: string | undefined;
}

export function DashboardLayoutExtract({ children, pathname, userId }: Props) {
  const lastSentRef = useRef('');

  useEffect(() => {
    const key = `${userId ?? 'anon'}|${pathname}`;
    if (lastSentRef.current === key) return;
    lastSentRef.current = key;

    const event = dashboardNavigationEvents.find(e => e.pathname === pathname);
    if (event) {
      sendPosthogEvent({
        eventName: event.eventName,
        properties: {
          distinct_id: userId,
          url: typeof window !== 'undefined' ? window.location.href : '',
        },
      });
    }
  }, [pathname, userId]);

  return <section>{children}</section>;
}
