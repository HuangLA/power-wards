import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalServer } from './server.mjs';

let dataDir;
let server;
let base;

const profile = {
  id: 'profile-1',
  name: '本地测试',
  mapVersion: '7.41',
  createdAt: '2026-09-23T00:00:00.000Z',
  updatedAt: '2026-09-23T00:00:00.000Z',
  wards: [{
    id: 'ward-1', x: 0.5, y: 0.25, name: '中路高台', color: '#56b6f7',
    categories: ['radiant-offense'], tags: ['中路'], description: '测试说明',
    screenshotIds: ['shot-1'], createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
  }],
};

async function request(route, init = {}) {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== 'GET') headers.set('Origin', base);
  return fetch(`${base}${route}`, { ...init, headers });
}

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'power-wards-local-'));
  const created = await createLocalServer({ dataDir, staticDir: null, apiOnly: true, port: 0 });
  server = created.server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('writes Profile and screenshot files and reads them back through the local API', async () => {
  const health = await request('/api/v1/health');
  assert.equal(health.status, 200);
  const instance = await health.json();
  assert.equal(instance.apiVersion, 1);

  const save = await request('/api/v1/profiles/profile-1', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile),
  });
  assert.equal(save.status, 200);

  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const putScreenshot = await request('/api/v1/profiles/profile-1/screenshots/shot-1', {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: image,
  });
  assert.equal(putScreenshot.status, 200);

  const listed = await request('/api/v1/profiles');
  assert.equal((await listed.json())[0].name, profile.name);
  assert.deepEqual(await (await request('/api/v1/profiles/profile-1/screenshots')).json(), ['shot-1']);
  const loaded = await request('/api/v1/profiles/profile-1');
  assert.deepEqual(await loaded.json(), profile);
  assert.deepEqual(Buffer.from(await (await request('/api/v1/profiles/profile-1/screenshots/shot-1')).arrayBuffer()), image);

  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, 'profiles', 'profile-1.json'), 'utf8')), profile);
  assert.deepEqual(await fs.readFile(path.join(dataDir, 'screenshots', 'profile-1', 'shot-1.png')), image);
});

test('atomically updates existing profiles and removes profile plus screenshots', async () => {
  await request('/api/v1/profiles/profile-1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
  const renamed = { ...profile, name: '更新后的名字' };
  await request('/api/v1/profiles/profile-1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(renamed) });
  assert.equal((await (await request('/api/v1/profiles/profile-1')).json()).name, renamed.name);

  await request('/api/v1/profiles/profile-1/screenshots/shot-1', {
    method: 'PUT', headers: { 'Content-Type': 'image/png' },
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  });
  const deleted = await request('/api/v1/profiles/profile-1', { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal((await request('/api/v1/profiles/profile-1')).status, 404);
  await assert.rejects(fs.stat(path.join(dataDir, 'profiles', 'profile-1.json')));
  await assert.rejects(fs.stat(path.join(dataDir, 'screenshots', 'profile-1')));
});

test('rejects path traversal, invalid coordinates, unsupported screenshots and non-local browser origins', async () => {
  const traversal = await request('/api/v1/profiles/%2e%2e');
  assert.ok([400, 404].includes(traversal.status));

  const invalidProfile = { ...profile, wards: [{ ...profile.wards[0], x: 1.2 }] };
  const invalid = await request('/api/v1/profiles/profile-1', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invalidProfile),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await request('/api/v1/profiles')).status, 200);

  const wrongType = await request('/api/v1/profiles/profile-1/screenshots/shot-1', {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('bad'),
  });
  assert.equal(wrongType.status, 415);

  const fakePng = await request('/api/v1/profiles/profile-1/screenshots/shot-1', {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('not an image'),
  });
  assert.equal(fakePng.status, 400);

  const oversized = await request('/api/v1/profiles/profile-1/screenshots/shot-1', {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(8 * 1024 * 1024 + 1),
  });
  assert.equal(oversized.status, 413);

  const hostileOrigin = await fetch(`${base}/api/v1/profiles/profile-1`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' }, body: JSON.stringify(profile),
  });
  assert.equal(hostileOrigin.status, 403);

  const devPreflight = await fetch(`${base}/api/v1/health`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' },
  });
  assert.equal(devPreflight.status, 204);
  assert.equal(devPreflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.match(devPreflight.headers.get('access-control-allow-methods'), /PUT/);
});
