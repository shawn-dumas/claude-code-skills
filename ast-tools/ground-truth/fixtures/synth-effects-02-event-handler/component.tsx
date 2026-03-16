import React, { useState, useEffect } from 'react';

interface Props {
  onSelect: (id: string) => void;
  onChange: (value: number) => void;
  selectedId: string;
  count: number;
}

export function EventHandlerDisguised({ onSelect, onChange, selectedId, count }: Props) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    onSelect(selectedId);
  }, [onSelect]);

  useEffect(() => {
    onChange(count + value);
  }, [count, onChange, value]);

  return <div>{value}</div>;
}
