/**
 * StorageDriver — abstraction over file-storage backends.
 *
 * V1: only LocalDriver (filesystem). V2: S3/CDN driver implementing the
 * same interface. Routes / domain code talk only to this interface so the
 * backend can be swapped via env (`STORAGE_DRIVER=local|s3`).
 */
import type { Readable } from 'node:stream';

export interface PutResult {
  /** Canonical storage-key (relative path within the storage-root). */
  key: string;
  /** Public URL the browser can use to fetch this object. */
  url: string;
  /** Bytes written. */
  size: number;
}

export interface StorageDriver {
  /** Persist `data` under `key`. Returns canonical key + public URL + size. */
  put(
    key: string,
    data: Buffer | Readable,
    contentType: string,
  ): Promise<PutResult>;

  /** Remove the object. Idempotent: deleting a non-existing key returns void. */
  delete(key: string): Promise<void>;

  /** Build a public URL for a previously-stored key. */
  publicUrl(key: string): string;
}

/**
 * Thrown by the s3-stub V1 — V2 swaps in real implementation.
 */
export class StorageNotImplementedError extends Error {
  constructor(driver: string) {
    super(`Storage driver '${driver}' is not implemented in V1`);
    this.name = 'StorageNotImplementedError';
  }
}
