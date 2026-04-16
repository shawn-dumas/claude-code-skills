interface Props {
  name: string;
}

export function Container({ name }: Props) {
  return <div>Hello {name}</div>;
}
