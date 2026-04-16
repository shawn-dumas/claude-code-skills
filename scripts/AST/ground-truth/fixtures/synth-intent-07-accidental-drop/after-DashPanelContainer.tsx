import { useAuthState } from '@/providers/auth';
import { DashPanelBlock } from './DashPanelBlock';

export function DashPanelContainer() {
  const { user } = useAuthState();

  return <DashPanelBlock email={user?.email ?? ''} />;
}
