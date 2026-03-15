interface UserPanelBlockProps {
  email: string;
  users: Array<{ id: string; name: string }>;
}

export function UserPanelBlock({ email, users }: UserPanelBlockProps) {
  return (
    <div>
      <h1>{email}</h1>
      <ul>
        {users.map(u => (
          <li key={u.id}>{u.name}</li>
        ))}
      </ul>
    </div>
  );
}
