// A minimal component with no behavioral patterns to extract
type EmptyProps = { data: string[] };

export function EmptyComponent({ data }: EmptyProps) {
  return (
    <ul>
      {data.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
