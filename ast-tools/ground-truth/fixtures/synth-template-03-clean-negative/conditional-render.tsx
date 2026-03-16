import React from 'react';

interface Props {
  isVisible: boolean;
  message: string;
  onDismiss: () => void;
}

export function ConditionalBanner({ isVisible, message, onDismiss }: Props) {
  return (
    <div className='banner-wrapper'>
      {isVisible ? (
        <div className='banner'>
          <p>{message}</p>
          <button type='button' onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      ) : (
        <div className='banner-hidden' />
      )}
    </div>
  );
}
