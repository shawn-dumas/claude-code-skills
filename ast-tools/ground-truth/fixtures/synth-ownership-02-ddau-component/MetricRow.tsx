/* eslint-disable */
import React, { useState, useCallback } from 'react';

interface Props {
  title: string;
  value: number;
  onChange: (v: number) => void;
}

export function MetricRow({ title, value, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const handleSave = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      onChange(Number(e.target.value));
      setEditing(false);
    },
    [onChange],
  );

  return (
    <div>
      <span>{title}</span>
      {editing ? (
        <input defaultValue={value} onBlur={handleSave} />
      ) : (
        <span onClick={() => setEditing(true)}>{value}</span>
      )}
    </div>
  );
}
