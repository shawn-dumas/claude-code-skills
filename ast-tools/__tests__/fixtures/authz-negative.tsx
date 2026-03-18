import { isAdmin, isTeamOwner } from '@/shared/utils/user/roleChecks';
import type { Role } from '@/types';

// Approved utility functions
function UtilityPatterns({ roles }: { roles: Role[] }) {
  const admin = isAdmin(roles);
  const owner = isTeamOwner(roles);
  return <div>{admin ? 'admin' : owner ? 'owner' : 'other'}</div>;
}

// Non-role array operations
function NonRolePatterns() {
  const items = ['a', 'b'];
  const hasA = items.includes('a');
  const nums = [1, 2, 3];
  const has2 = nums.includes(2);
  const str = 'hello';
  const idx = str.indexOf('e');
  const hasLong = items.some(s => s.length > 5);
  enum Status {
    ACTIVE = 'active',
  }
  const isActive = [Status.ACTIVE].includes(Status.ACTIVE);
  return <div>{hasA ? 'yes' : 'no'}</div>;
}

// Type-only import
function TypeOnlyPattern(props: { roles: Role[] }) {
  return <div>{props.roles.length}</div>;
}

// Non-role equality checks
function NonRoleEquality() {
  enum Status {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
  }
  const status = Status.ACTIVE;
  const isActive = status === Status.ACTIVE;
  const flag = 'admin';
  const isFlag = flag === 'admin';
  return <div>{isActive ? 'yes' : 'no'}</div>;
}

export { UtilityPatterns, NonRolePatterns, TypeOnlyPattern, NonRoleEquality };
