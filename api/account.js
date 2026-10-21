// api/account.js: username accounts.
//   POST /api/account { action: "create", username, password }  -> { words }
//   POST /api/account { action: "login",  username, password, words } -> { token, username }
const { generateSecretWords, generateRecoveryCode, normalizeWords, hashSecret, checkSecret, signSession, verifySession } = require('../lib/auth');
const { getUser, createUser, updateUser, listUsers, createAdminMessage, listActiveMessages, createAdminMedia, listActiveMedia, grantCoins, grantSecret, listWorldState, setWorldBackground } = require('../lib/neon-storage');

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

async function verifyGoogleCredential(idToken) {
  if (!GOOGLE_CLIENT_ID || !idToken) return null;
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!response.ok) return null;
  const info = await response.json();
  if (info.aud !== GOOGLE_CLIENT_ID) return null;
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) return null;
  if (!info.sub || Number(info.exp) * 1000 < Date.now()) return null;
  return info.sub;
}

const DEMO_ADMIN_USERNAME = 'admin';
const DEMO_ADMIN_PASSWORD = 'admin12345';
const DEMO_ADMIN_WORDS = 'admin mod stickman secure account access';

async function ensureAdmin() {
  if (await getUser(DEMO_ADMIN_USERNAME)) return;
  await createUser(DEMO_ADMIN_USERNAME, {
    password_hash: hashSecret(DEMO_ADMIN_PASSWORD),
    words_hash: hashSecret(DEMO_ADMIN_WORDS),
    failed_attempts: 0,
    locked_until: 0,
    role: 'moderator',
  });
}
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  await ensureAdmin();
  if (req.method === 'GET') {
    if (String(req.query?.resource || '') === 'messages') return res.json({ messages: await listActiveMessages() });
    if (String(req.query?.resource || '') === 'media') return res.json({ media: await listActiveMedia() });
    if (String(req.query?.resource || '') === 'world') return res.json({ world: await listWorldState() });
    const auth = String(req.headers.authorization || '');
    const username = auth.startsWith('Bearer ') ? verifySession(auth.slice(7)) : null;
    const user = username && await getUser(username);
    if (!user || user.role !== 'moderator') return res.status(403).json({ error: 'Moderator access required.' });
    return res.json({ users: (await listUsers()).map(({ username: name, created_at }) => ({ username: name, created_at })) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const body = req.body || {};
  const username = String(body.username || '').trim();
  const key = username.toLowerCase();              // usernames are not case-sensitive
  const password = String(body.password || '');

  try {
    if (body.action === 'grant-coins' || body.action === 'grant-secret' || body.action === 'set-background') {
      const auth = String(req.headers.authorization || '');
      const sessionUser = auth.startsWith('Bearer ') ? verifySession(auth.slice(7)) : null;
      const sender = sessionUser && await getUser(sessionUser);
      if (!sender || sender.role !== 'moderator') return res.status(403).json({ error: 'Moderator access required.' });
      if (body.action === 'grant-coins') {
        const target = String(body.targetUsername || '').trim().toLowerCase();
        const amount = Number(body.amount);
        if (!USERNAME_RE.test(target) || !Number.isInteger(amount) || amount < 1 || amount > 1000000) return res.status(400).json({ error: 'Enter a valid username and coin amount from 1 to 1,000,000.' });
        const result = await grantCoins(target, amount);
        if (!result) return res.status(404).json({ error: 'Player not found.' });
        return res.json({ player: result });
      }
      if (body.action === 'grant-secret') {
        const target = String(body.targetUsername || '').trim().toLowerCase();
        const secretKey = String(body.secretKey || '').trim();
        if (!USERNAME_RE.test(target) || !['double-jump', 'coin-magnet', 'shadow-mode', 'rainbow-trail', 'speed-burst'].includes(secretKey)) return res.status(400).json({ error: 'Choose a valid player and secret.' });
        if (!await getUser(target)) return res.status(404).json({ error: 'Player not found.' });
        const result = await grantSecret(target, secretKey, sessionUser);
        return res.json({ granted: Boolean(result), secret: secretKey });
      }
      const background = String(body.background || 'aurora');
      if (!['aurora', 'neon-rain', 'volcano', 'cyber-grid', 'matrix'].includes(background)) return res.status(400).json({ error: 'Invalid background.' });
      return res.json({ world: await setWorldBackground(background, sessionUser) });
    }

    if (body.action === 'broadcast-message') {
      const auth = String(req.headers.authorization || '');
      const sessionUser = auth.startsWith('Bearer ') ? verifySession(auth.slice(7)) : null;
      const sender = sessionUser && await getUser(sessionUser);
      if (!sender || sender.role !== 'moderator') return res.status(403).json({ error: 'Moderator access required.' });
      const message = String(body.message || '').trim().slice(0, 500);
      if (!message) return res.status(400).json({ error: 'Message cannot be empty.' });
      return res.json({ message: await createAdminMessage(message) });
    }

    if (body.action === 'broadcast-media') {
      const auth = String(req.headers.authorization || '');
      const sessionUser = auth.startsWith('Bearer ') ? verifySession(auth.slice(7)) : null;
      const sender = sessionUser && await getUser(sessionUser);
      if (!sender || sender.role !== 'moderator') return res.status(403).json({ error: 'Moderator access required.' });
      const youtubeId = String(body.youtubeId || '').trim();
      const action = body.mediaAction === 'stop' ? 'stop' : 'play';
      if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId) && action === 'play') return res.status(400).json({ error: 'Invalid YouTube video.' });
      return res.json({ media: await createAdminMedia(youtubeId || 'stopped', action) });
    }

    if (body.action === 'google-login') {
      const googleId = await verifyGoogleCredential(String(body.credential || ''));
      if (!googleId) return res.status(401).json({ error: 'Google sign-in expired. Please try again.' });
      return res.json({ token: signSession(`google:${googleId}`), username: String(body.displayName || 'Google player').slice(0, 80), role: 'player' });
    }

    if (body.action === 'create') {
      if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username must be 3-20 letters, numbers, or underscores.' });
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      if (await getUser(key)) return res.status(409).json({ error: 'That username is taken.' });
      const words = generateSecretWords(6);
      const recoveryCode = generateRecoveryCode();
      const created = await createUser(key, { password_hash: hashSecret(password), words_hash: hashSecret(words.join(' ')), recovery_hash: hashSecret(recoveryCode), failed_attempts: 0, locked_until: 0 });
      if (!created) return res.status(409).json({ error: 'That username is taken.' });
      return res.json({ words, recoveryCode });
    }

    if (body.action === 'login') {
      const words = normalizeWords(body.words);
      const recoveryCode = String(body.recoveryCode || '').trim().toUpperCase();
      const user = await getUser(key);
      const fail = () => res.status(401).json({ error: 'Wrong username, password, or secret words.' });
      if (!user) return fail();

      if (user.locked_until && user.locked_until > Date.now()) {
        return res.status(429).json({ error: 'Too many failed tries. Wait 15 minutes and try again.' });
      }

      // Check both secrets every time, so the response timing doesn't reveal which one was wrong
      const passOk = checkSecret(password, user.password_hash);
      const wordsOk = checkSecret(words, user.words_hash);
      const recoveryOk = Boolean(user.recovery_hash && checkSecret(recoveryCode, user.recovery_hash));
      if (!(passOk && (wordsOk || recoveryOk))) {
        const attempts = (user.failed_attempts || 0) + 1;
        const locking = attempts >= MAX_ATTEMPTS;
        await updateUser(key, {
          failed_attempts: locking ? 0 : attempts,
          locked_until: locking ? Date.now() + LOCK_MS : 0,
        });
        return fail();
      }

      await updateUser(key, { failed_attempts: 0, locked_until: 0 });
      return res.json({ token: signSession(key), username: key, role: user.role || 'player' });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('account error:', err);
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
};
