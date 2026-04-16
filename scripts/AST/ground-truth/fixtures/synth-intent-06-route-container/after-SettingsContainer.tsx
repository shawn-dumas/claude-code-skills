import { useRouter } from 'next/router';
import { useAuthState } from '@/providers/auth';
import { useSettingsQuery } from '@/services/hooks/queries/settings';
import { SettingsBlock } from './SettingsBlock';

export function SettingsContainer() {
  const router = useRouter();
  const { user } = useAuthState();
  const { data } = useSettingsQuery();

  if (!user) {
    router.push('/login');
    return null;
  }

  return <SettingsBlock theme={data?.theme ?? 'default'} />;
}
