// api/save.js: stores each player's save in Supabase.
//   GET /api/save  -> the signed-in player's save, or null
//   PUT /api/save  -> stores the signed-in player's save
// Send: Authorization: Bearer <token>. The token is either a Google ID token
// or a username session token (starts with "v1.").

const { verifySession } = require('../lib/auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/saves?sub=eq.${encodeURIComponent(identity)}&select=data`,
      { headers: supabaseHeaders() }
    );
    if (!r.ok) {
      console.error('Supabase GET failed:', r.status, await r.text());
      return res.status(500).json({ error: `Could not load your save (server code ${r.status}).` });
    }
    const rows = await r.json();
    return res.status(200).json(rows.length ? rows[0].data : null);
  }

  if (req.method === 'PUT') {
    const body = req.body;
    if (!looksLikeSave(body)) return res.status(400).json({ error: 'Invalid save data.' });
    if (JSON.stringify(body).length > MAX_SAVE_BYTES) {
      return res.status(413).json({ error: 'Save is too large.' });
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/saves?on_conflict=sub`, {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ sub: identity, data: body, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) {
      console.error('Supabase PUT failed:', r.status, await r.text());
      return res.status(500).json({ error: `Could not save (server code ${r.status}).` });
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'Method not allowed.' });
};
