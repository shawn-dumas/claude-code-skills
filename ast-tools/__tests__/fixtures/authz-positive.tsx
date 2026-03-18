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

export { CorePatterns, EdgeCases };
