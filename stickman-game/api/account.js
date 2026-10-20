// api/account.js: username accounts.
//   POST /api/account { action: "create", username, password }  -> { words }
//   POST /api/account { action: "login",  username, password, words } -> { token, username }
const { generateSecretWords, normalizeWords, hashSecret, checkSecret, signSession } = require('../lib/auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

const sbHeaders = (extra = {}) => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  ...extra,
});

async function getUser(username) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/local_users?username=eq.${encodeURIComponent(username)}&select=*`,
    { headers: sbHeaders() }
  );
  if (!r.ok) throw new Error(`Database error ${r.status}`);
  const rows = await r.json();
  return rows[0] || null;
}

async function updateUser(username, fields) {
  await fetch(`${SUPABASE_URL}/rest/v1/local_users?username=eq.${encodeURIComponent(username)}`, {
    method: 'PATCH',
    headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(fields),
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const body = req.body || {};
  const username = String(body.username || '').trim();
  const key = username.toLowerCase();              // usernames are not case-sensitive
  const password = String(body.password || '');

  try {
    if (body.action === 'create') {
      if (!USERNAME_RE.test(username)) {
        return res.status(400).json({ error: 'Username must be 3-20 letters, numbers, or underscores.' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      if (await getUser(key)) {
        return res.status(409).json({ error: 'That username is taken.' });
      }

      const words = generateSecretWords(6);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/local_users`, {
        method: 'POST',
        headers: sbHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({
          username: key,
          password_hash: hashSecret(password),
          words_hash: hashSecret(words.join(' ')),
        }),
      });
      if (r.status === 409) return res.status(409).json({ error: 'That username is taken.' });
      if (!r.ok) {
        console.error('create failed:', r.status, await r.text());
        return res.status(500).json({ error: `Could not create the account (server code ${r.status}).` });
      }
      // The words are shown once and never stored in plain text
      return res.json({ words });
    }

    if (body.action === 'login') {
      const words = normalizeWords(body.words);
      const user = await getUser(key);
      const fail = () => res.status(401).json({ error: 'Wrong username, password, or secret words.' });
      if (!user) return fail();

      if (user.locked_until && user.locked_until > Date.now()) {
        return res.status(429).json({ error: 'Too many failed tries. Wait 15 minutes and try again.' });
      }

      // Check both secrets every time, so the response timing doesn't reveal which one was wrong
      const passOk = checkSecret(password, user.password_hash);
      const wordsOk = checkSecret(words, user.words_hash);
      if (!(passOk && wordsOk)) {
        const attempts = (user.failed_attempts || 0) + 1;
        const locking = attempts >= MAX_ATTEMPTS;
        await updateUser(key, {
          failed_attempts: locking ? 0 : attempts,
          locked_until: locking ? Date.now() + LOCK_MS : 0,
        });
        return fail();
      }

      await updateUser(key, { failed_attempts: 0, locked_until: 0 });
      return res.json({ token: signSession(key), username: key });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('account error:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
};
