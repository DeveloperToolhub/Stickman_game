// api/save.js: Vercel serverless function that stores each player's save in Supabase.
//   GET /api/save  -> returns the signed-in player's save, or null
//   PUT /api/save  -> stores the signed-in player's save
// Every request must send:  Authorization: Bearer <Google ID token>

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const MAX_SAVE_BYTES = 2_000_000;

// Asks Google whether the token is genuine, unexpired, and issued for this app.
// Returns the player's stable Google user id (sub), or null.
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

  const sub = await verifyGoogleToken(token);
  if (!sub) return res.status(401).json({ error: 'Sign-in expired. Sign in again.' });

  if (req.method === 'GET') {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/saves?sub=eq.${encodeURIComponent(sub)}&select=data`,
      { headers: supabaseHeaders() }
    );
    if (!r.ok) return res.status(500).json({ error: 'Could not load your save.' });
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
      body: JSON.stringify({ sub, data: body, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) return res.status(500).json({ error: 'Could not save.' });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'Method not allowed.' });
};
