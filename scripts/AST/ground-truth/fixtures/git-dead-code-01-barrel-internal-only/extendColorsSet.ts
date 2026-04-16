/**
 * Stripped from src/shared/utils/color/extendColorsSet/extendColorsSet.ts
 * Imports COLORS and Colors from sibling constants.ts.
 */
import { COLORS, Colors } from './constants';

export const extendColorsSet = <T>(set: Record<string, Colors>, items: T | T[]): Record<string, Colors> => {
  const normalizedItems = Array.isArray(items) ? items : [items];
  const existingEntities = Object.keys(set);
  const newItems = normalizedItems.filter(id => !existingEntities.includes(String(id)) && !!id).map(String);

  const extensions: Record<string, Colors> = {};
  for (let index = 0; index < newItems.length; index++) {
    extensions[newItems[index]] = COLORS[(index + existingEntities.length) % COLORS.length];
  }

  return { ...set, ...extensions };
};
