// api/save.js: stores each player's save in demo storage.
//   GET /api/save  -> the signed-in player's save, or null
//   PUT /api/save  -> stores the signed-in player's save
// Send: Authorization: Bearer <token>. The token is a server session token
// (starts with "v1.") for either Google or username accounts.

const { verifySession } = require('../lib/auth');
const { getSave, setSave } = require('../lib/demo-storage');
const MAX_SAVE_BYTES = 2_000_000;

// All authenticated saves use server-signed sessions. Google identities are
// prefixed separately so they cannot collide with username accounts.
async function identityFor(token) {
  if (!token.startsWith('v1.')) return null;
  const subject = verifySession(token);
  if (!subject) return null;
  return subject.startsWith('google:') ? subject : `local:${subject}`;
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
