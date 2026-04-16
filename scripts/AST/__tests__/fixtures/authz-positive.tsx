import { Role } from '@/types';

// --- Core patterns (3) ---
function CorePatterns({ roles }: { roles: Role[] }) {
  // 1. Direct includes
  const isAdmin = roles.includes(Role.ADMIN);
  // 2. indexOf check
  const idx = roles.indexOf(Role.TEAM_OWNER);
  // 3. some() with callback referencing Role member
  const hasRole = roles.some(r => r === Role.MEMBER);
  return <div>{isAdmin ? 'admin' : 'not'}</div>;
}

// --- Edge cases (3) ---
function EdgeCases({ user }: { user: { roles: Role[] } }) {
  // 4. Destructured variable
  const { roles } = user;
  const isSuperAdmin = roles.includes(Role.SUPER_ADMIN);
  // 5. Inline in JSX expression
  return (
    <div>
      {user.roles.includes(Role.INTERNAL_ADMIN) && <span>internal</span>}
      {/* 6. some() with block body */}
      {roles.some(r => {
        return r === Role.ADMIN;
      }) && <span>admin</span>}
    </div>
  );
}

// --- Equality patterns (3) ---
// Note: TEAM_OWNER and MEMBER are singleton roles (no broader family) and
// are excluded from RAW_ROLE_EQUALITY detection by ast-config.singletonRoles.
function EqualityPatterns({ user }: { user: { role: Role } }) {
  // 7. Direct equality check
  const isAdmin = user.role === Role.ADMIN;
  // 8. Inequality check
  const isNotSuperAdmin = user.role !== Role.SUPER_ADMIN;
  // 9. Inline in conditional
  return <div>{user.role === Role.INTERNAL_ADMIN ? 'internal' : 'other'}</div>;
}

export { CorePatterns, EdgeCases, EqualityPatterns };
