// api/save.js: stores each player's save in demo storage.
//   GET /api/save  -> the signed-in player's save, or null
//   PUT /api/save  -> stores the signed-in player's save
// Send: Authorization: Bearer <token>. The token is either a Google ID token
// or a username session token (starts with "v1.").

const { verifySession } = require('../lib/auth');
const { getSave, setSave } = require('../lib/demo-storage');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const MAX_SAVE_BYTES = 2_000_000;

// Returns the player's stable id: the Google user id, or null if the token is invalid.
async function verifyGoogleToken(idToken) {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );
  if (!res.ok) return null;
  const info = await res.json();
  if (info.aud !== GOOGLE_CLIENT_ID) return null;
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) return null;
  if (Number(info.exp) * 1000 < Date.now()) return null;
  return info.sub;
}

// Returns the save key for this token. Username accounts are prefixed with "local:"
// so they can never collide with Google ids.
async function identityFor(token) {
  if (token.startsWith('v1.')) {
    const username = verifySession(token);
    return username ? `local:${username}` : null;
  }
  return verifyGoogleToken(token);
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function looksLikeSave(s) {
  return (
    s !== null &&
    typeof s === 'object' &&
    typeof s.coins === 'number' &&
    Array.isArray(s.inventory) &&
    s.inventory.length <= 5000
  );
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Sign in first.' });

  let identity;
  try { identity = await identityFor(token); }
  catch (e) { console.error('auth error:', e); return res.status(500).json({ error: 'Server auth is not configured.' }); }
  if (!identity) return res.status(401).json({ error: 'Sign-in expired. Sign in again.' });

  if (req.method === 'GET') {
    return res.status(200).json(getSave(identity));
  }

  if (req.method === 'PUT') {
    const body = req.body;
    if (!looksLikeSave(body)) return res.status(400).json({ error: 'Invalid save data.' });
    if (JSON.stringify(body).length > MAX_SAVE_BYTES) {
      return res.status(413).json({ error: 'Save is too large.' });
    }
    setSave(identity, body);
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'Method not allowed.' });
};
