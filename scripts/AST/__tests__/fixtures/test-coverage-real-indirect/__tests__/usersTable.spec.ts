import { mapUserRoleName } from '../mapUserRoleName';

describe('UsersTable', () => {
  it('renders user role name in table cell', () => {
    const roleName = mapUserRoleName('admin');
    expect(roleName).toBe('Admin');
  });

  it('renders unknown role as-is', () => {
    const roleName = mapUserRoleName('unknown');
    expect(roleName).toBe('unknown');
  });
});
