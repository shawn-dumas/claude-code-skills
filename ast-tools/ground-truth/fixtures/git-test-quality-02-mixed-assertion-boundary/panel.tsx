interface Props {
  title: string;
  count: number;
  onSave: () => void;
}

export function Panel({ title, count, onSave }: Props) {
  return (
    <div>
      <h1>
        {title} ({count})
      </h1>
      <button onClick={onSave}>Save</button>
    </div>
  );
}
