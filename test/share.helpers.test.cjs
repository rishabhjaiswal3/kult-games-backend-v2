const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const helperModule = path.resolve(__dirname, '../dist/modules/share/share.helpers.js');
const STRONG_TEST_SECRET = 'x'.repeat(64);

function runShareHelper(envOverrides = {}) {
  const script = `
    const { buildMomentPageUrl, buildOgImageProxyUrl } = require(${JSON.stringify(helperModule)});
    const req = {
      protocol: 'https',
      get(name) {
        const headers = {
          host: 'internal-backend.example',
          'x-forwarded-host': 'internal-backend.example',
          'x-forwarded-proto': 'https',
        };
        return headers[String(name).toLowerCase()];
      },
    };
    const result = {
      momentPageUrl: buildMomentPageUrl(req, 'moment-123'),
      ogImageUrl: buildOgImageProxyUrl(req, 'moment-123'),
    };
    process.stdout.write(JSON.stringify(result));
  `;

  return spawnSync(process.execPath, ['-e', script], {
    cwd: '/tmp',
    env: {
      ...process.env,
      JWT_SECRET: STRONG_TEST_SECRET,
      PUBLIC_APP_URL: 'https://app.kult.games',
      SHARE_BASE_URL: 'https://kult-browser-rust-l2lwg.ondigitalocean.app',
      ...envOverrides,
    },
    encoding: 'utf8',
  });
}

test('share helpers use PUBLIC_APP_URL for page URLs and SHARE_BASE_URL for OG image URLs', () => {
  const result = runShareHelper();
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.momentPageUrl, 'https://app.kult.games/moments/moment-123');
  assert.equal(
    payload.ogImageUrl,
    'https://kult-browser-rust-l2lwg.ondigitalocean.app/api/share/moments/moment-123/og-image.jpg',
  );
});
