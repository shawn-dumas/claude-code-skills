import { useDropdownScrollHandler } from './hooks';

interface Props {
  label: string;
  onSelect: (value: string) => void;
}

export function SelectWidget({ label, onSelect }: Props) {
  const ref = useDropdownScrollHandler();
  return (
    <div ref={ref}>
      <span>{label}</span>
      <button onClick={() => onSelect('a')}>Pick A</button>
    </div>
  );
}
