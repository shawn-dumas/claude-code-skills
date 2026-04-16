/* eslint-disable */
// Negative fixture: only type exports and a utility function.
// No React component. Should produce zero ownership assessments.

export type ItemStatus = 'active' | 'archived' | 'deleted';

export interface Item {
  id: string;
  name: string;
  status: ItemStatus;
}

export function formatItemLabel(item: Item): string {
  return `${item.name} (${item.status})`;
}
