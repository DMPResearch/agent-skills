import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { capture, validateManifest } from '../capture.mjs';

const entry = { kind: 'shot', url: 'https://example.org/reference', designer: 'A | B', licence: 'Unknown\nReference only' };
test('rejects absent credits and non-web or authenticated URLs', () => {
  for (const items of [[], [{}], [{ ...entry, designer: '' }], [{ ...entry, url: 'file:///tmp/reference' }], [{ ...entry, url: ['https://', 'user', ':', 'pass', '@example.org'].join('') }]]) {
    assert.throws(() => validateManifest(items));
  }
});
test('writes both viewport images and durable escaped credits without overwriting evidence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-test-'));
  const output = path.join(root, 'captures');
  const sizes = [];
  let closed = false;
  const chromium = { launch: async () => ({
    newPage: async (options) => {
      sizes.push(options.viewport);
      return { goto: async () => ({ ok: () => true }), mouse: { move: async () => {} }, waitForFunction: async () => {}, evaluate: async () => {},
        screenshot: async ({ path: target }) => fs.writeFile(target, 'test image'), close: async () => {} };
    }, close: async () => { closed = true; }
  }) };
  try {
    await capture([entry], output, chromium);
    assert.deepEqual(sizes, [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]);
    const index = await fs.readFile(path.join(output, 'INDEX.md'), 'utf8');
    assert.ok(index.includes(entry.url));
    assert.ok(index.includes('A \\| B'));
    assert.ok(index.includes('Unknown Reference only'));
    assert.equal((await fs.readdir(output)).filter(n => n.endsWith('.png')).length, 2);
    assert.equal(closed, true);
    await assert.rejects(capture([entry], output, chromium), { code: 'EEXIST' });
  } finally { await fs.rm(root, { recursive: true }); }
});
test('failed navigation rejects and closes resources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-fail-'));
  let closedPage = false, closedBrowser = false;
  try {
    await assert.rejects(capture([entry], path.join(root, 'out'), { launch: async () => ({
      newPage: async () => ({ goto: async () => ({ ok: () => false }), close: async () => { closedPage = true; } }),
      close: async () => { closedBrowser = true; }
    }) }), /navigation failed/);
    assert.ok(closedPage && closedBrowser);
  } finally { await fs.rm(root, { recursive: true }); }
});
test('blank content readiness failure cannot become a successful capture', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-blank-'));
  try {
    const output = path.join(root, 'out');
    await assert.rejects(capture([entry], output, { launch: async () => ({
      newPage: async () => ({ goto: async () => ({ ok: () => true }),
        waitForFunction: async () => { throw new Error('Blank content timeout'); }, close: async () => {} }),
      close: async () => {}
    }) }), /Blank content timeout/);
    assert.deepEqual(await fs.readdir(output), []);
  } finally { await fs.rm(root, { recursive: true }); }
});
