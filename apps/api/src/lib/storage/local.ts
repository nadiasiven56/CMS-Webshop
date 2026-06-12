/**
 * LocalDriver — filesystem-backed StorageDriver.
 *
 * Files land under `STORAGE_LOCAL_PATH` (default `./storage`, resolved
 * relative to the API process working directory). Public URLs are served
 * by Hono `serveStatic` mounted on `/storage/*` (see
 * `apps/api/src/index.ts` registration in REGISTER.md).
 *
 * V2 swap: replace this driver with an S3 implementation that uses the
 * same interface. No call-sites change.
 */
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PutResult, StorageDriver } from './interface.js';

export interface LocalDriverOptions {
  /** Absolute or relative path on disk where blobs are stored. */
  rootPath: string;
  /** Public-base-URL prefix, e.g. `http://localhost:7300`. */
  publicBaseUrl: string;
  /** URL-prefix used to serve files; default `/storage`. */
  urlPrefix?: string;
}

export class LocalDriver implements StorageDriver {
  private readonly root: string;
  private readonly publicBase: string;
  private readonly urlPrefix: string;

  constructor(opts: LocalDriverOptions) {
    this.root = resolve(opts.rootPath);
    this.publicBase = opts.publicBaseUrl.replace(/\/$/, '');
    this.urlPrefix = (opts.urlPrefix ?? '/storage').replace(/\/$/, '');
    if (!this.urlPrefix.startsWith('/')) {
      this.urlPrefix = '/' + this.urlPrefix;
    }
  }

  /**
   * Resolve a storage-key to an absolute filesystem path AND verify the
   * resolved path stays within the storage root (defense-in-depth against
   * path-traversal even though `key` is constructed by us, never user input).
   */
  private resolveSafe(key: string): string {
    // Reject `..` segments outright.
    const normalized = key.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (normalized.split('/').some((seg) => seg === '..' || seg === '.')) {
      throw new Error(`unsafe storage key: ${key}`);
    }
    const abs = resolve(this.root, normalized);
    // Ensure abs starts with root + sep (or equals root).
    if (abs !== this.root && !abs.startsWith(this.root + sep)) {
      throw new Error(`storage key escapes root: ${key}`);
    }
    return abs;
  }

  async put(
    key: string,
    data: Buffer | Readable,
    _contentType: string,
  ): Promise<PutResult> {
    const fsPath = this.resolveSafe(key);
    await mkdir(dirname(fsPath), { recursive: true });

    let size: number;
    if (Buffer.isBuffer(data)) {
      await writeFile(fsPath, data);
      size = data.byteLength;
    } else {
      // Stream-mode: pipe to disk.
      const out = createWriteStream(fsPath);
      await pipeline(data, out);
      const s = await stat(fsPath);
      size = s.size;
    }

    return { key, url: this.publicUrl(key), size };
  }

  async delete(key: string): Promise<void> {
    let fsPath: string;
    try {
      fsPath = this.resolveSafe(key);
    } catch {
      // Garbage key — nothing to delete; treat as no-op (idempotent).
      return;
    }
    try {
      await unlink(fsPath);
    } catch (err) {
      // Idempotent: swallow ENOENT, propagate everything else.
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') throw e;
    }
  }

  publicUrl(key: string): string {
    const path = key.startsWith('/') ? key : `/${key}`;
    return `${this.publicBase}${this.urlPrefix}${path}`;
  }

  /** Test-only: get absolute filesystem path for a key (do not call from prod code). */
  _resolveForTests(key: string): string {
    return this.resolveSafe(key);
  }

  /** Static-serve root (use as `serveStatic({ root })`). */
  get rootForServe(): string {
    return this.root;
  }

  /** URL prefix path (e.g. `/storage`). Useful when wiring static-serve. */
  get servePrefix(): string {
    return this.urlPrefix;
  }

  /** Used by tests to assert files live where we think. */
  get rootPath(): string {
    return this.root;
  }

  /** Helper for static-serve wiring: full directory path that the prefix maps to. */
  get rootDirAbsolute(): string {
    return this.root;
  }

  /** Convenience for callers that need the relative-from-cwd path (Hono serveStatic root). */
  rootRelativeToCwd(cwd: string = process.cwd()): string {
    const rel = this.root.startsWith(cwd) ? this.root.slice(cwd.length).replace(/^[\\/]+/, '') : this.root;
    return rel || '.';
  }
}

/** Convenience to construct a writable test root. */
export function _makeTestLocalDriver(rootPath: string, publicBaseUrl = 'http://test'): LocalDriver {
  return new LocalDriver({ rootPath, publicBaseUrl });
}

// Helper used by route handlers to ensure mkdir was attempted before writeFile.
// (Already done inside `put`.)
export async function _ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

// Re-export join for convenience in tests
export { join as _joinForTests };
