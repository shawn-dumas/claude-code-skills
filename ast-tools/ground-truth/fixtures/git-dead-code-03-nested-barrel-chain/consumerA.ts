/**
 * Consumer A -- uses Environment, RuleOption, and PageSizeValue through barrel.
 */
import { Environment, PageSizeValue } from './index';
import type { RuleOption } from './index';

const env: Environment = Environment.PRODUCTION;
const size: PageSizeValue = PageSizeValue.MEDIUM;

const options: RuleOption<string>[] = [
  { value: 'equals', name: 'Equals' },
  { value: 'contains', name: 'Contains' },
];
