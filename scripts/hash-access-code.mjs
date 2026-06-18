import crypto from "node:crypto";

const code = process.argv[2]?.trim();

if (!code) {
  console.error("Usage: node scripts/hash-access-code.mjs <access-code>");
  process.exit(1);
}

const n = 16384;
const r = 8;
const p = 1;
const keyLength = 64;
const salt = crypto.randomBytes(16);
const key = crypto.scryptSync(code, salt, keyLength, { N: n, r, p });

console.log(`scrypt$${n}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`);
