import React from 'react';

interface Props {
  /** Utility hook that returns current breakpoint -- NOT a service hook */
  useBreakpoint: () => { isMobile: boolean; isTablet: boolean };
  /** Utility hook for click-away detection -- NOT a service hook */
  useClickAway: (ref: React.RefObject<HTMLElement>, handler: () => void) => void;
  label: string;
  onToggle: () => void;
  isActive: boolean;
}

export function ThemeToggle({ useBreakpoint, useClickAway, label, onToggle, isActive }: Props) {
  const { isMobile } = useBreakpoint();
  const ref = React.useRef<HTMLDivElement>(null);

  useClickAway(ref, onToggle);

  return (
    <div ref={ref}>
      <button onClick={onToggle}>
        {isMobile ? label[0] : label}: {isActive ? 'On' : 'Off'}
      </button>
    </div>
  );
}
