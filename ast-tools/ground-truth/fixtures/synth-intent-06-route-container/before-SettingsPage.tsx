import { useRouter } from 'next/router';
import { useAuthState } from '@/providers/auth';
import { useSettingsQuery } from '@/services/hooks/queries/settings';

export default function SettingsPage() {
  const router = useRouter();
  const { user } = useAuthState();
  const { data } = useSettingsQuery();

  if (!user) {
    router.push('/login');
    return null;
  }

  return (
    <div>
      <h1>Settings</h1>
      <p>{data?.theme}</p>
    </div>
  );
}
