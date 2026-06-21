const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const configModule = path.resolve(__dirname, '../dist/config.js');
const STRONG_TEST_SECRET = 'x'.repeat(64);

function loadConfig(jwtSecret) {
  const env = { ...process.env };
  delete env.JWT_SECRET;
  if (jwtSecret !== undefined) env.JWT_SECRET = jwtSecret;
  return spawnSync(process.execPath, ['-e', `require(${JSON.stringify(configModule)})`], {
    cwd: '/tmp',
    env,
    encoding: 'utf8',
  });
}

test('startup rejects a missing JWT secret', () => {
  const result = loadConfig(undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be configured with at least 32 characters/);
});

test('startup rejects short JWT secrets', () => {
  const result = loadConfig('too-short');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be configured with at least 32 characters/);
});

test('startup accepts a strong JWT secret', () => {
  const result = loadConfig(STRONG_TEST_SECRET);
  assert.equal(result.status, 0, result.stderr);
});
