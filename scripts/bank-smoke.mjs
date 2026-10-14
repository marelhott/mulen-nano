import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
process.loadEnvFile('.env.local');
const { handler } = require('../api/_core/bank.cjs');
const base = process.env.BANK_SMOKE_URL;
let token;
async function call(body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (base) {
    const response = await fetch(`${base}/api/bank`, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  const response = await handler({ httpMethod: 'POST', headers, body: JSON.stringify(body) });
  return { status: response.statusCode, data: JSON.parse(response.body) };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); name.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return out;
}
function png(alternate = false) {
  const width = 128, height = 96;
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + x * 3 + 1;
    pixels[offset] = alternate ? 180 : x * 2; pixels[offset + 1] = y * 2; pixels[offset + 2] = alternate ? x : 90;
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv.includes('--fixtures')) {
  const dir = await mkdtemp(join(tmpdir(), 'mulen-bank-smoke-'));
  await writeFile(join(dir, 'r2-test-a.png'), png());
  await writeFile(join(dir, 'r2-test-b.png'), png(true));
  process.stdout.write(`${dir}\n`);
} else {
  const login = await call({ op: 'login', passphrase: process.env.BANK_PASSPHRASE }, false);
  assert.equal(login.status, 200); token = login.data.token;
  assert.equal((await call({ op: 'index-get' }, false)).status, 401);
  assert.equal((await call({ op: 'index-get', space: 'invalid' })).status, 400);
  const bytes = png();
  const slot = await call({ op: 'upload-url', contentType: 'image/png', size: bytes.length });
  assert.equal(slot.status, 200);
  const { id, itemKey, thumbKey, itemUrl } = slot.data;
  try {
    for (const origin of ['http://localhost:3000', 'https://mulen-nano.vercel.app']) {
      const preflight = await fetch(itemUrl, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'Content-Type' } });
      assert.ok(preflight.ok); assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    }
    const put = await fetch(itemUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes });
    assert.ok(put.ok, `Upload: ${put.status}`);
    const signed = await call({ op: 'download-urls', keys: [itemKey] });
    assert.equal(signed.status, 200);
    const downloaded = await fetch(signed.data.urls[itemKey]);
    assert.equal(downloaded.status, 200); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    const beforeFeed = (await call({ op: 'index-get', space: 'feed' })).data.index;
    const before = (await call({ op: 'index-get' })).data.index;
    const item = { id, kind: 'image', title: 'Automatický R2 smoke test', itemKey, folderId: 'inbox', tags: ['smoke-test'], createdAt: Date.now() };
    const next = { ...before, rev: before.rev + 1, items: [...before.items, item] };
    assert.equal((await call({ op: 'index-put', index: next })).status, 200);
    assert.equal((await call({ op: 'index-put', index: next })).status, 409);
    assert.deepEqual((await call({ op: 'index-get', space: 'feed' })).data.index, beforeFeed);
    const feedNext = { ...beforeFeed, rev: beforeFeed.rev + 1, items: [...beforeFeed.items, { ...item, galleryId: `smoke-${id}` }] };
    assert.equal((await call({ op: 'index-put', index: feedNext, space: 'feed' })).status, 200);
    assert.ok((await call({ op: 'index-get' })).data.index.items.some((entry) => entry.id === id && !entry.galleryId));
    process.stdout.write(`${JSON.stringify({ login: 'OK', unauthorized: 'OK', uploadDownload: 'byte-exact', cors: 'localhost+production', revisionConflict: '409', libraryFeedIsolation: 'OK', target: base || 'local-handler' })}\n`);
  } finally {
    for (const space of ['library', 'feed']) {
      for (let retry = 0; retry < 5; retry++) {
        const current = (await call({ op: 'index-get', space })).data.index;
        if (!current.items.some((entry) => entry.id === id)) break;
        const cleaned = await call({ op: 'index-put', space, index: { ...current, rev: current.rev + 1, items: current.items.filter((entry) => entry.id !== id) } });
        if (cleaned.status === 200) break;
        assert.equal(cleaned.status, 409);
        if (retry === 4) assert.fail('Testovací položku se nepodařilo uklidit.');
      }
    }
    const cleanup = await call({ op: 'delete-objects', keys: [itemKey, thumbKey] });
    assert.equal(cleanup.status, 200); assert.equal(cleanup.data.failed, 0);
  }
}
