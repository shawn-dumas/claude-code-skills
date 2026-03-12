import type { ImportInfo } from '@/shared/types/astTypes';
import { readStorage } from '@/shared/utils/typedStorage';

export function processImport(info: ImportInfo): string {
  return info.source;
}

export function readSomething(): unknown {
  return readStorage('key');
}
