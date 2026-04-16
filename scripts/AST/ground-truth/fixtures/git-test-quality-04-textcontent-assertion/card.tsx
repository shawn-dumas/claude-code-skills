interface Props {
  title: string;
  total: number;
}

export function Card({ title, total }: Props) {
  return (
    <div>
      <h2>{title} </h2>
      <span>{total}</span>
    </div>
  );
}
