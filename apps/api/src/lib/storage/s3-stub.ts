/**
 * S3Driver — V1 placeholder. Throws on every method.
 *
 * This file exists to lock in the contract: when V2 swaps to S3, only this
 * file changes (or a new `s3.ts` replaces it). Routes / admin code never
 * reference this driver directly — they go through the factory in
 * `index.ts` which reads `STORAGE_DRIVER` from env.
 */
import type { PutResult, StorageDriver } from './interface.js';
import { StorageNotImplementedError } from './interface.js';

export class S3Driver implements StorageDriver {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  put(_key: string, _data: Buffer, _contentType: string): Promise<PutResult> {
    return Promise.reject(new StorageNotImplementedError('s3'));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  delete(_key: string): Promise<void> {
    return Promise.reject(new StorageNotImplementedError('s3'));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  publicUrl(_key: string): string {
    throw new StorageNotImplementedError('s3');
  }
}
