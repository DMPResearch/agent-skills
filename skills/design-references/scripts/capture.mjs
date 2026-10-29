#!/usr/bin/env node
// Uses an existing Playwright installation. Does not install packages.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

export function validateManifest(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('Manifest must be a nonempty array.');
  return items.map((item) => {
    if (!item || !['search', 'shot', 'product'].includes(item.kind)) throw new Error('Each item needs kind: search, shot or product.');
    for (const key of ['url', 'designer', 'licence']) {
      if (typeof item[key] !== 'string' || !item[key].trim()) throw new Error(`Each item needs ${key}.`);
    }
    const url = new URL(item.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use public HTTP(S) URLs without credentials.');
    return item;
  });
}
const cell = (value) => String(value).replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');

export async function capture(items, output, chromium) {
  validateManifest(items);
  // Refuse an existing directory so previous evidence is never overwritten.
  await fs.mkdir(output, { recursive: false });
  const rows = ['# Reference captures', '', `Captured: ${new Date().toISOString()}`, '',
    'Reference only. Credits and licence notes are supplied by the researcher and must be verified.', '',
    '| Kind | Source | Designer | Licence note | Desktop | Phone |', '| --- | --- | --- | --- | --- | --- |'];
  const browser = await chromium.launch();
  try {
    for (const [index, item] of items.entries()) {
      const names = [];
      for (const [label, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
        try {
          const response = await page.goto(item.url, { waitUntil: 'load', timeout: 60000 });
          if (!response || !response.ok()) throw new Error(`Reference navigation failed for item ${index + 1}.`);
          await page.waitForFunction((kind) => {
            const text = document.body?.innerText.trim() ?? '';
            const visibleImage = [...document.images].some(img => img.complete && img.naturalWidth > 100 && img.getBoundingClientRect().width > 100);
            return text.length > 40 && (kind === 'product' || visibleImage);
          }, item.kind, { timeout: 15000 });
          await page.mouse.move(1, 1);
          await page.evaluate(async () => {
            await document.fonts.ready;
            const limit = Math.min(document.documentElement.scrollHeight, 40000);
            for (let y = 0; y < limit; y += innerHeight) {
              scrollTo(0, y);
              await new Promise(resolve => setTimeout(resolve, 150));
            }
            await Promise.all([...document.images].filter(img => img.currentSrc).map(img =>
              Promise.race([img.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))])));
            scrollTo(0, 0);
          });
          const name = `${String(index + 1).padStart(2, '0')}-${item.kind}-${label}.png`;
          await page.screenshot({ path: path.join(output, name), fullPage: true });
          names.push(`[${label}](${name})`);
        } finally { await page.close(); }
      }
      rows.push(`| ${cell(item.kind)} | ${cell(item.url)} | ${cell(item.designer)} | ${cell(item.licence)} | ${names.join(' | ')} |`);
      await fs.writeFile(path.join(output, 'INDEX.md'), rows.join('\n') + '\n');
    }
  } finally { await browser.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const [manifest, output] = process.argv.slice(2);
    if (!manifest || !output) throw new Error('Usage: PW_DIR=<existing package directory> node capture.mjs manifest.json new-output-folder');
    const items = validateManifest(JSON.parse(await fs.readFile(manifest, 'utf8')));
    const require = createRequire(path.join(path.resolve(process.env.PW_DIR || process.cwd()), 'package.json'));
    await capture(items, path.resolve(output), require('playwright').chromium);
    console.log(`Captured ${items.length} references. Inspect every image and verify INDEX.md credits.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
