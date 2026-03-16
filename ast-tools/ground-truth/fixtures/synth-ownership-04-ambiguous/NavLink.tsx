/* eslint-disable */
import React from 'react';
import { useRouter } from 'next/router';

interface Props {
  href: string;
  label: string;
}

export function NavLink({ href, label }: Props) {
  const router = useRouter();
  const isActive = router.pathname === href;

  return (
    <a href={href} className={isActive ? 'active' : ''}>
      {label}
    </a>
  );
}
