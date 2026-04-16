import { processA } from './serviceA';
import { processB } from './serviceB';
import { resolveX } from './helperX';
import { resolveY } from './helperY';

const resultA = processA(10);
const resultB = processB(5);
const resultX = resolveX('test');
const resultY = resolveY('test');
