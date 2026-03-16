import React from 'react';

interface Props {
  label: string;
  onSave: (value: string) => void;
}

export function SmallForm({ label, onSave }: Props) {
  return (
    <div className='small-form'>
      <label htmlFor='input'>{label}</label>
      <input id='input' type='text' />
      <button
        type='button'
        onClick={e => {
          const input = e.currentTarget.closest('form')?.querySelector('input');
          if (input) onSave(input.value);
        }}
      >
        Save
      </button>
    </div>
  );
}
