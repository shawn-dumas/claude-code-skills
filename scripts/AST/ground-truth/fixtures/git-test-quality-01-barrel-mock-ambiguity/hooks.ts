import { useRef } from 'react';

export function useDropdownScrollHandler() {
  return useRef<HTMLDivElement>(null);
}

export function useBreakpoints() {
  return { isMobile: false, isTablet: false, isDesktop: true };
}
