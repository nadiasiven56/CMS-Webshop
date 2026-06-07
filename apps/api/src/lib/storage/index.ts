import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export { isAllowedMime, makeImageKey, sanitizeFilenameStem, type AllowedImageMime } from './sanitize.js';

export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
}

/**
 * Local filesystem storage driver
 */
class LocalStorage implements StorageDriver {
  private basePath: string;
  private publicUrl: string;

  constructor(basePath: string, publicUrl: string) {
    this.basePath = basePath;
    this.publicUrl = publicUrl;
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filePath = path.join(this.basePath, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
    return this.getUrl(key);
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.basePath, key);
    try {
      await fs.unlink(filePath);
    } catch {
      // File might not exist, that's OK
    }
  }

  getUrl(key: string): string {
    return `${this.publicUrl}/storage/${key}`;
  }
}

/**
 * In-memory storage driver (for testing)
 */
class MemoryStorage implements StorageDriver {
  private files = new Map<string, Buffer>();

  async put(key: string, data: Buffer, _contentType: string): Promise<string> {
    this.files.set(key, data);
    return this.getUrl(key);
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  getUrl(key: string): string {
    return `/storage/${key}`;
  }
}

let storageInstance: StorageDriver | null = null;

/**
 * Get or create the storage driver based on environment config
 */
export function getStorage(): StorageDriver {
  if (storageInstance) return storageInstance;

  const driver = process.env.STORAGE_DRIVER || 'local';
  const basePath = process.env.STORAGE_LOCAL_PATH || './storage';
  const publicUrl = process.env.API_PUBLIC_URL || 'http://localhost:7300';

  if (driver === 'memory') {
    storageInstance = new MemoryStorage();
  } else {
    storageInstance = new LocalStorage(basePath, publicUrl);
  }

  return storageInstance;
}

/**
 * Override storage instance (for testing)
 */
export function setStorage(driver: StorageDriver): void {
  storageInstance = driver;
}
