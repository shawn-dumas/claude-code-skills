import React from 'react';

interface Props {
  status: 'loading' | 'error' | 'success';
  data: string[];
  errorMessage: string;
}

export function StatusDisplay({ status, data, errorMessage }: Props) {
  return (
    <div className='status-display'>
      <h2>Status</h2>
      {(() => {
        if (status === 'loading') {
          return <div className='spinner'>Loading data...</div>;
        }
        if (status === 'error') {
          return (
            <div className='error-panel'>
              <span className='error-icon'>Error</span>
              <p>{errorMessage}</p>
            </div>
          );
        }
        return (
          <ul>
            {data.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        );
      })()}
    </div>
  );
}
