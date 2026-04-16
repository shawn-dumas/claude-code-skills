interface DashPanelBlockProps {
  email: string;
}

export function DashPanelBlock({ email }: DashPanelBlockProps) {
  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome, {email}</p>
    </div>
  );
}
