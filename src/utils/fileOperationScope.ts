import { captureProfileFileScope } from './profileFiles';

export class FileOperationCancelled extends Error {
  constructor() { super('Your account, space or upload panel changed. Reopen the upload and try again.'); }
}

/** Capture before hashing/compression, not only when the network write starts. */
export function createFileOperationScope(identity: () => readonly unknown[]) {
  const isCurrent = captureProfileFileScope(identity);
  const check = () => { if (!isCurrent()) throw new FileOperationCancelled(); };
  return {
    isCurrent, check,
    async step<T>(operation: () => T | Promise<T>): Promise<T> {
      check();
      const result = await operation();
      check();
      return result;
    },
  };
}

export type FileOperationScope = ReturnType<typeof createFileOperationScope>;
