import { useAuthState } from '@/providers/auth';
import { sendPosthogEvent } from '@/shared/lib/posthog';
import { useEffect } from 'react';

export function DashPanel() {
  const { user } = useAuthState();

  useEffect(() => {
    if (user) {
      sendPosthogEvent('dashboard_viewed', { uid: user.uid });
    }
  }, [user]);

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome, {user?.email}</p>
    </div>
  );
}
