import React from 'react';

interface Props {
  isLoading: boolean;
  error: string | null;
  data: string;
}

export function StatusMessage({ isLoading, error, data }: Props) {
  return (
    <div className='status'>
      {isLoading ? <span>Loading...</span> : <span>{data}</span>}
      {error && <p className='error'>{error}</p>}
    </div>
  );
}
