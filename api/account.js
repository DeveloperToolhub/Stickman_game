// api/account.js: username accounts.
//   POST /api/account { action: "create", username, password }  -> { words }
//   POST /api/account { action: "login",  username, password, words } -> { token, username }
const crypto = require('crypto');
const { generateSecretWords, generateRecoveryCode, normalizeWords, hashSecret, checkSecret, signSession, verifySession } = require('../lib/auth');
const { getUser, createUser, updateUser } = require('../lib/demo-storage');
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_FROM = `Stickman Game <${process.env.RESEND_EMAIL_DOMAIN ? `no-reply@${process.env.RESEND_EMAIL_DOMAIN}` : 'onboarding@resend.dev'}>`;

async function sendVerificationEmail(email, code) {
  if (!process.env.RESEND_API_KEY) throw new Error('Email service is not configured.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [email],
      subject: 'Your Stickman Game verification code',
      text: `Your Stickman Game verification code is ${code}. It expires in 10 minutes.`,
    }),
  });
  if (!response.ok) throw new Error('Email delivery failed.');
}

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
  if (req.method === 'GET') {
    const auth = String(req.headers.authorization || '');
    const username = auth.startsWith('Bearer ') ? verifySession(auth.slice(7)) : null;
    const user = username && getUser(username);
    if (!user || user.role !== 'moderator') return res.status(403).json({ error: 'Moderator access required.' });
    const { listUsers } = require('../lib/demo-storage');
    return res.json({ users: listUsers().map(({ username: name, created_at }) => ({ username: name, created_at })) });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const body = req.body || {};
  const username = String(body.username || '').trim();
  const key = username.toLowerCase();              // usernames are not case-sensitive
  const password = String(body.password || '');

  try {
    if (body.action === 'send-code') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Enter a valid username.' });
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      if (getUser(key)) return res.status(409).json({ error: 'That username is taken.' });
      const code = String(crypto.randomInt(100000, 1000000));
      const pendingFields = { username: key, email, password_hash: hashSecret(password), code_hash: hashSecret(code), code_expires: Date.now() + CODE_TTL_MS };
      if (!updateUser(`pending:${key}`, pendingFields)) createUser(`pending:${key}`, pendingFields);
      await sendVerificationEmail(email, code);
      return res.json({ sent: true });
    }

    if (body.action === 'create') {
      const pending = getUser(`pending:${key}`);
      const code = String(body.verificationCode || '').trim();
      if (!pending || pending.code_expires < Date.now() || !checkSecret(code, pending.code_hash)) {
        return res.status(401).json({ error: 'Enter the valid email verification code.' });
      }
      if (getUser(key)) return res.status(409).json({ error: 'That username is taken.' });
      const words = generateSecretWords(6);
      const recoveryCode = generateRecoveryCode();
      const created = createUser(key, { email: pending.email, password_hash: pending.password_hash, words_hash: hashSecret(words.join(' ')), recovery_hash: hashSecret(recoveryCode), failed_attempts: 0, locked_until: 0 });
      if (!created) return res.status(409).json({ error: 'That username is taken.' });
      updateUser(`pending:${key}`, { consumed: true });
      return res.json({ words, recoveryCode });
    }

    if (body.action === 'login') {
      const words = normalizeWords(body.words);
      const recoveryCode = String(body.recoveryCode || '').trim().toUpperCase();
      const user = getUser(key);
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
