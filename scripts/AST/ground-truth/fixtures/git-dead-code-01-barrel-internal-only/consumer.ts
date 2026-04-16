/**
 * Stripped external consumer.
 * Imports extendColorsSet from the barrel but NOT COLORS or Colors.
 * This models the real pattern: getTableColorsSet.ts imports extendColorsSet
 * from the barrel, but COLORS/Colors are only used by extendColorsSet.ts itself.
 */
import { extendColorsSet } from './index';

const colorSet = extendColorsSet({}, ['item1', 'item2']);
