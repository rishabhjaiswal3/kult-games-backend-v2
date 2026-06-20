const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const configModule = path.resolve(__dirname, '../dist/config.js');

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
  assert.match(result.stderr, /Missing required secret env var: JWT_SECRET/);
});

test('startup rejects known weak JWT secrets', () => {
  const result = loadConfig('change-me-before-production');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be a strong secret/);
});

test('startup accepts a strong JWT secret', () => {
  const result = loadConfig('test-only-secret-0123456789abcdef0123456789abcdef');
  assert.equal(result.status, 0, result.stderr);
});
