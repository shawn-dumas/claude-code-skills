import { targetFunction } from './external-consumer-test/target-module';

export function wrapper(): string {
  return targetFunction();
}
