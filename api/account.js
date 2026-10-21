// api/account.js: username accounts.
//   POST /api/account { action: "create", username, password }  -> { words }
//   POST /api/account { action: "login",  username, password, words } -> { token, username }
const { generateSecretWords, normalizeWords, hashSecret, checkSecret, signSession } = require('../lib/auth');
const { getUser, createUser, updateUser } = require('../lib/demo-storage');
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

// Demo-only moderator credentials for previews without a database.
const DEMO_ADMIN_USERNAME = 'admin';
const DEMO_ADMIN_PASSWORD = 'admin12345';
const DEMO_ADMIN_WORDS = 'admin mod stickman secure account access';
createUser(DEMO_ADMIN_USERNAME, {
  password_hash: hashSecret(DEMO_ADMIN_PASSWORD),
  words_hash: hashSecret(DEMO_ADMIN_WORDS),
  failed_attempts: 0,
  locked_until: 0,
  role: 'moderator',
});
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

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
      if (getUser(key)) {
        return res.status(409).json({ error: 'That username is taken.' });
      }

      const words = generateSecretWords(6);
      const created = createUser(key, {
        password_hash: hashSecret(password),
        words_hash: hashSecret(words.join(' ')),
        failed_attempts: 0,
        locked_until: 0,
      });
      if (!created) return res.status(409).json({ error: 'That username is taken.' });
      // The words are shown once and never stored in plain text
      return res.json({ words });
    }

    if (body.action === 'login') {
      const words = normalizeWords(body.words);
      const user = getUser(key);
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
        updateUser(key, {
          failed_attempts: locking ? 0 : attempts,
          locked_until: locking ? Date.now() + LOCK_MS : 0,
        });
        return fail();
      }

      updateUser(key, { failed_attempts: 0, locked_until: 0 });
      return res.json({ token: signSession(key), username: key, role: user.role || 'player' });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('account error:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
};
