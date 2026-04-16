// Declaration merging: type and const with same name should not produce duplicates
export type Status = 'active' | 'inactive';
export const Status = {
  ACTIVE: 'active' as const,
  INACTIVE: 'inactive' as const,
};

export type Direction = 'up' | 'down';
export const Direction = {
  UP: 'up' as const,
  DOWN: 'down' as const,
};
