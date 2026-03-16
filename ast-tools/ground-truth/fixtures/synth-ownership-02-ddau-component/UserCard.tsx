/* eslint-disable */
import React from 'react';

interface Props {
  name: string;
  email: string;
  onSelect: () => void;
}

export function UserCard({ name, email, onSelect }: Props) {
  return (
    <div onClick={onSelect}>
      <span>{name}</span>
      <span>{email}</span>
    </div>
  );
}
