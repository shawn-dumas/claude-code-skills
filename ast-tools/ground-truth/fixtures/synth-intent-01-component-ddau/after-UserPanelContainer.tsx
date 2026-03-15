import { useAuthState } from '@/providers/auth';
import { useRouter } from 'next/router';
import { useUsersQuery } from '@/services/hooks/queries/users';
import { useEffect } from 'react';
import { UserPanelBlock } from './UserPanelBlock';

export function UserPanelContainer() {
  const { user } = useAuthState();
  const router = useRouter();
  const { data } = useUsersQuery();

  useEffect(() => {
    if (!user) router.push('/login');
  }, [user, router]);

  return <UserPanelBlock email={user?.email ?? ''} users={data ?? []} />;
}
