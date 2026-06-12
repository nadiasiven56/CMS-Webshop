import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDriver } from './local.js';

describe('LocalDriver', () => {
  let root: string;
  let driver: LocalDriver;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'webshop-crm-storage-'));
    driver = new LocalDriver({ rootPath: root, publicBaseUrl: 'http://test' });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes a buffer to disk under the given key', async () => {
    const buf = Buffer.from('hello world', 'utf8');
    const res = await driver.put('images/products/p1/abc-photo.jpg', buf, 'image/jpeg');

    expect(res.size).toBe(buf.byteLength);
    expect(res.url).toBe('http://test/storage/images/products/p1/abc-photo.jpg');

    const fsPath = join(root, 'images/products/p1/abc-photo.jpg');
    const onDisk = await readFile(fsPath);
    expect(onDisk.equals(buf)).toBe(true);
  });

  it('auto-mkdir for nested keys', async () => {
    await driver.put('images/products/deep/nested/path/x.png', Buffer.from('x'), 'image/png');
    const s = await stat(join(root, 'images/products/deep/nested/path/x.png'));
    expect(s.isFile()).toBe(true);
  });

  it('publicUrl uses configured prefix', () => {
    const d2 = new LocalDriver({
      rootPath: root,
      publicBaseUrl: 'https://cdn.example.com/',
      urlPrefix: '/static',
    });
    expect(d2.publicUrl('images/foo.jpg')).toBe('https://cdn.example.com/static/images/foo.jpg');
  });

  it('rejects keys with .. (path-traversal defense)', async () => {
    await expect(
      driver.put('../escape.jpg', Buffer.from('x'), 'image/jpeg'),
    ).rejects.toThrow(/unsafe storage key|escapes root/);
  });

  it('delete is idempotent (no error if file absent)', async () => {
    await expect(driver.delete('images/does-not-exist.jpg')).resolves.toBeUndefined();
  });

  it('delete removes a previously-put file', async () => {
    const key = 'images/products/p1/to-delete.jpg';
    await driver.put(key, Buffer.from('bye'), 'image/jpeg');
    await driver.delete(key);
    await expect(stat(join(root, key))).rejects.toThrow();
  });
});
