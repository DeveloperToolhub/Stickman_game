// lib/auth.js: password hashing, secret-word generation, and session tokens.
// Uses only Node's built-in crypto, so there are no extra packages to install.
const crypto = require('crypto');

// Word list for secret words. 6 words from this list is roughly 40 bits of randomness.
const WORDS = [
  'apple','anchor','arrow','autumn','badge','bamboo','basket','beacon','biscuit','blanket',
  'blossom','bottle','breeze','bridge','bronze','cactus','camera','candle','canyon','carrot',
  'castle','cedar','cherry','cinder','circle','cloud','cobalt','comet','copper','coral',
  'cottage','cricket','crystal','dagger','dolphin','dragon','dune','eagle','ember','engine',
  'falcon','fern','flame','forest','fossil','garden','glacier','goblin','granite','harbor',
  'hazel','helmet','honey','horizon','island','jaguar','jelly','jigsaw','jungle','kettle',
  'lantern','legend','lemon','locket','magnet','maple','marble','meadow','meteor','mirror',
  'mountain','nectar','nickel','noodle','oasis','olive','orbit','otter','paddle','panda',
  'pebble','pepper','pirate','planet','pocket','pumpkin','quartz','rabbit','rocket','saddle',
  'saffron','sailor','scarf','shadow','silver','spark','sunset','tiger','timber','tulip',
  'velvet','violet','walnut','whistle','willow','window','wizard','yonder','zephyr','zipper'
];

function generateSecretWords(count = 6) {
  return Array.from({ length: count }, () => WORDS[crypto.randomInt(WORDS.length)]);
}

function generateRecoveryCode() {
  return crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
}

// Lowercase, trim, and collapse spaces or commas, so "Apple, Tiger" matches "apple tiger"
function normalizeWords(input) {
  return String(input || '').toLowerCase().trim().split(/[\s,]+/).filter(Boolean).join(' ');
}

function hashSecret(value) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(value, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function checkSecret(value, stored) {
  const [kind, saltHex, keyHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(value, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sessionSecret() {
  // Keep sessions working without requiring another project variable. The Supabase
  // service key is already available server-side and is never exposed to the browser.
  const secret = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('No server session secret is configured.');
  return secret;
}

// Token format: v1.<payload>.<signature>. The payload holds the username and an expiry in seconds.
function signSession(username) {
  const payload = Buffer.from(JSON.stringify({
    u: username,
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, // 30 days
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `v1.${payload}.${sig}`;
}

function verifySession(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [, payload, sig] = parts;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (!data.exp || data.exp * 1000 < Date.now()) return null;
  return data.u;
}

module.exports = { generateSecretWords, generateRecoveryCode, normalizeWords, hashSecret, checkSecret, signSession, verifySession, WORDS };
