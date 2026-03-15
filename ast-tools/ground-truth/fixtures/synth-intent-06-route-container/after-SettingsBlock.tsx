interface SettingsBlockProps {
  theme: string;
}

export function SettingsBlock({ theme }: SettingsBlockProps) {
  return (
    <div>
      <h1>Settings</h1>
      <p>{theme}</p>
    </div>
  );
}
