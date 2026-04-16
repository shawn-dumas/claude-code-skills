import { useAuthState } from '@/providers/auth';
import { useRouter } from 'next/router';
import { useUsersQuery } from '@/services/hooks/queries/users';
import { useEffect } from 'react';
import toast from 'react-hot-toast';

export function UserPanel() {
  const { user } = useAuthState();
  const router = useRouter();
  const { data } = useUsersQuery();

  useEffect(() => {
    if (!user) router.push('/login');
  }, [user, router]);

  const handleSave = () => {
    toast.success('Saved');
  };

  return (
    <div>
      <h1>{user?.email}</h1>
      <ul>{data?.map(u => <li key={u.id}>{u.name}</li>)}</ul>
      <button onClick={handleSave}>Save</button>
    </div>
  );
}
