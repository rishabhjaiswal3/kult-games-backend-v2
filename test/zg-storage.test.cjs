const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kult-zg-test-'));
const fakeBinary = path.join(tempDir, 'fake-zg-client');

fs.writeFileSync(
  fakeBinary,
  '#!/bin/sh\nprintf "root=0xabc123\\nhash=0xdef456\\n"\n',
  { mode: 0o700 },
);

process.env.JWT_SECRET = 'x'.repeat(64);
process.env.MOMENTS_DOWNLOAD_TMP_DIR = tempDir;
process.env.ZG_BINARY_PATH = fakeBinary;
process.env.ZG_PRIVATE_KEY = 'x'.repeat(64);

const { uploadFile } = require('../dist/external/zg-storage.js');

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

test('metacharacters in upload filenames are passed literally without shell execution', () => {
  const marker = path.join(tempDir, 'injected');
  const input = path.join(tempDir, 'asset;touch injected;.jpg');
  fs.writeFileSync(input, 'asset');

  const result = uploadFile(input);

  assert.equal(result.rootHash, '0xabc123');
  assert.equal(result.txHash, '0xdef456');
  assert.equal(fs.existsSync(marker), false);
});

test('upload rejects files outside the configured temporary directory', () => {
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.jpg`);
  fs.writeFileSync(outside, 'asset');
  try {
    assert.throws(() => uploadFile(outside), /configured temporary directory/);
  } finally {
    fs.rmSync(outside, { force: true });
  }
});
