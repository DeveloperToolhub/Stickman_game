// api/account.js: username accounts.
//   POST /api/account { action: "create", username, password }  -> { words }
//   POST /api/account { action: "login",  username, password, words } -> { token, username }
const { generateText } = require('ai');
const { generateSecretWords, generateRecoveryCode, normalizeWords, hashSecret, checkSecret, signSession, verifySession } = require('../lib/auth');
const { getUser, createUser, updateUser, listUsers, createAdminMessage, listActiveMessages, createAdminMedia, listActiveMedia, grantCoins, grantSecret, listWorldState, setWorldBackground, createChatMessage, listChatMessages, deleteChatMessage, deleteAllChatMessages, createPrivateMessage, listPrivateMessages, createCallSignal, listCallSignals, touchChatPresence, listOnlineUsers, createChatRequest, respondChatRequest, listChatRequests, hasAcceptedChat } = require('../lib/neon-storage');

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

async function runModeratorModel(messages) {
  const models = ['openai/gpt-4o-mini', 'anthropic/claude-haiku-4.5'];
  for (const model of models) {
    try {
      const result = await generateText({ model, system: messages.find((item) => item.role === 'system')?.content || '', prompt: messages.find((item) => item.role === 'user')?.content || '', maxOutputTokens: 300, temperature: 0 });
      if (result.text?.trim()) return { model, content: result.text.trim() };
    } catch {}
  }
  return null;
}

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
    if (String(req.query?.resource || '') === 'session') { const auth = String(req.headers.authorization || ''); const sessionUser = auth.startsWith('Bearer ') ? verifySession(auth.slice(7)) : null; const session = sessionUser && await getUser(sessionUser); if (!session) return res.status(401).json({ error: 'Sign-in required.' }); return res.json({ username: session.username, role: session.role || 'player' }); }
    if (String(req.query?.resource || '') === 'messages') return res.json({ messages: await listActiveMessages() });
    if (String(req.query?.resource || '') === 'media') return res.json({ media: await listActiveMedia() });
    if (String(req.query?.resource || '') === 'world') return res.json({ world: await listWorldState() });
    if (String(req.query?.resource || '') === 'chat') return res.json({ messages: await listChatMessages(Math.max(0, Number(req.query?.after || 0))) });
    if (String(req.query?.resource || '') === 'online-users') return res.json({ users: await listOnlineUsers(String(req.query?.exclude || '').trim().toLowerCase()) });
    if (String(req.query?.resource || '') === 'private-chat') {
      const viewer = String(req.query.viewer || '').trim();
      const peer = String(req.query.peer || '').trim();
      if (!USERNAME_RE.test(viewer) || !USERNAME_RE.test(peer)) return res.status(400).json({ error: 'Valid users are required.' });
      return res.json({ messages: await listPrivateMessages(viewer, peer, Math.max(0, Number(req.query?.after || 0))) });
    }
    if (String(req.query?.resource || '') === 'online-users') { return res.json({ users: await listOnlineUsers(String(req.query.username || '').trim().toLowerCase()) }); }
    if (String(req.query?.resource || '') === 'chat-requests') { return res.json({ requests: await listChatRequests(String(req.query.username || '').trim().toLowerCase()) }); }
    if (String(req.query?.resource || '') === 'public-call-signals') { return res.json({ signals: await listCallSignals('*', String(req.query.callId || '').trim(), Math.max(0, Number(req.query?.after || 0))) }); }
    if (String(req.query?.resource || '') === 'screen-share-signals') { return res.json({ signals: await listCallSignals('*', String(req.query.callId || '').trim(), Math.max(0, Number(req.query?.after || 0))) }); }
  if (String(req.query?.resource || '') === 'call-signals') {
      const recipient = String(req.query.recipient || '').trim();
      const callId = String(req.query.callId || '').trim();
      if (!USERNAME_RE.test(recipient) || !callId) return res.status(400).json({ error: 'Call details are required.' });
      return res.json({ signals: await listCallSignals(recipient, callId, Math.max(0, Number(req.query?.after || 0))) });
    }
    const auth = String(req.headers.authorization || '');
    const username = auth.startsWith('Bearer ') ? verifySession(auth.slice(7)) : null;
    const user = username && await getUser(username);
    if (!user || user.role !== 'moderator') return res.status(403).json({ error: 'Moderator access required.' });
    return res.json({ users: (await listUsers()).map(({ username: name, coins = 0, created_at }) => ({ username: name, coins, created_at })) });
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

    if (body.action === 'chat-message') {
const chatUsername = String(body.username || '').trim().slice(0, 20) || 'Player';
    const nickname = String(body.nickname || chatUsername).replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 20) || chatUsername;
    const rawMessage = String(body.message || '').normalize('NFKC').trim().slice(0, 180);
    const moderationText = rawMessage.toLocaleLowerCase().replace(/[0@4]/g, 'a').replace(/[1!|]/g, 'i').replace(/[3]/g, 'e').replace(/[5$]/g, 's').replace(/[7]/g, 't').replace(/[^a-z0-9]+/g, '');
    const blockedPatterns = [
      /f+u+c+k/i, /s+h+i+t/i, /b+i+t+c+h/i, /a+s+s+h+o+l+e/i, /d+i+c+k/i, /p+e+n+i+s/i, /v+a+g+i+n+a/i, /b+o+o+b+s?/i, /n+i+p+p+l+e/i, /a+n+u+s/i, /c+o+c+k/i, /c+u+m/i,
      /n+i+g+g+e+r/i, /f+a+g+g+o+t/i, /r+e+t+a+r+d/i, /k+i+k+e/i, /s+p+i+c/i, /t+r+a+n+n+y/i,
      /k+i+l+l/i, /d+o+x+x/i, /s+w+a+t/i, /s+p+a+m+w+o+r+d/i, /b+a+d+w+o+r+d/i
    ];
    const hasBlockedLanguage = blockedPatterns.some((pattern) => pattern.test(moderationText));
    const message = rawMessage.replace(/[^\p{L}\p{N}\s]/gu, '');
    if (!/^[A-Za-z0-9 _-]{1,20}$/.test(chatUsername) || !message) return res.status(400).json({ error: 'Enter a valid name and message.' });
    if (hasBlockedLanguage) return res.status(422).json({ error: 'Message blocked by the chat safety filter.' });
    // Keep delivery independent from optional AI services. The deterministic safety filter above
    // is synchronous, predictable, and prevents the moderator from blocking normal chat sends.
    const createdMessage = await createChatMessage(chatUsername, nickname, message); if (!createdMessage) return res.status(429).json({ error: 'Spam detected. Your recent chat messages were deleted. Please slow down.' }); return res.json({ message: createdMessage });
    }

    if (body.action === 'delete-all-chat-messages') { const auth = String(req.headers.authorization || ''); const sessionUser = auth.startsWith('Bearer ') ? verifySession(auth.slice(7)) : null; const sender = sessionUser && await getUser(sessionUser); if (!sender || sender.role !== 'moderator') return res.status(403).json({ error: 'Moderator access required.' }); const deleted = await deleteAllChatMessages(); return res.json({ deleted }); }
  if (body.action === 'ai-moderator') { const message = String(body.message || '').trim().slice(0, 500); if (!message) return res.status(400).json({ error: 'Ask a moderation question.' }); const result = await runModeratorModel([{ role:'system', content:'You are a concise, safety-focused community chat moderator. Explain rules, identify harassment or profanity risks, and suggest respectful rewrites. Never reveal private data or help target users.' }, { role:'user', content:message }]); if (!result) return res.status(503).json({ error:'Both AI moderator providers are unavailable. Try again shortly.' }); return res.json({ reply: result.content, model: result.model }); }
  if (body.action === 'delete-chat-message') { const username = String(body.username || '').trim(); const messageId = Number(body.messageId); if (!USERNAME_RE.test(username) || !Number.isInteger(messageId) || messageId < 1) return res.status(400).json({ error: 'Invalid message.' }); const deleted = await deleteChatMessage(messageId, username); return res.json({ deleted }); }
  if (body.action === 'presence') { const username = String(body.username || '').trim().toLowerCase(); if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Valid username required.' }); await touchChatPresence(username, body.isTyping === true); return res.json({ ok: true }); }
    if (body.action === 'request-chat') { const requester = String(body.requester || '').trim().toLowerCase(); const recipient = String(body.recipient || '').trim().toLowerCase(); if (!USERNAME_RE.test(requester) || !USERNAME_RE.test(recipient) || requester === recipient) return res.status(400).json({ error: 'Valid users required.' }); if (!await getUser(recipient)) return res.status(404).json({ error: 'User not found.' }); return res.json({ request: await createChatRequest(requester, recipient) }); }
    if (body.action === 'respond-chat') { const recipient = String(body.recipient || '').trim().toLowerCase(); const status = body.status === 'accepted' ? 'accepted' : 'declined'; const request = await respondChatRequest(Number(body.requestId), recipient, status); if (!request) return res.status(404).json({ error: 'Request not found or already handled.' }); return res.json({ request }); }
    if (body.action === 'private-message') {
      const sender = String(body.sender || '').trim().toLowerCase();
      const recipient = String(body.recipient || '').trim().toLowerCase();
      const message = String(body.message || '').trim().slice(0, 500);
      if (!USERNAME_RE.test(sender) || !USERNAME_RE.test(recipient) || !message) return res.status(400).json({ error: 'Valid users and a message are required.' });
      if (!await getUser(recipient)) return res.status(404).json({ error: 'User not found.' });
      if (!await hasAcceptedChat(sender, recipient)) return res.status(403).json({ error: 'This user must accept your chat request first.' });
      return res.json({ message: await createPrivateMessage(sender, recipient, message) });
    }

    if (body.action === 'screen-share-signal') { const sender = String(body.sender || '').trim().toLowerCase(); const callId = String(body.callId || '').trim().slice(0, 80); const kind = String(body.kind || '').trim(); const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}; if (!USERNAME_RE.test(sender) || !callId || !['start', 'viewer', 'stop'].includes(kind)) return res.status(400).json({ error: 'Invalid screen-share signal.' }); if (kind === 'start' || kind === 'stop') { const auth = String(req.headers.authorization || ''); const sessionUser = auth.startsWith('Bearer ') ? verifySession(auth.slice(7)) : null; const user = sessionUser && await getUser(sessionUser); if (!user || user.role !== 'moderator') return res.status(403).json({ error: 'Moderator access required.' }); } return res.json({ signal: await createCallSignal(callId, sender, '*', kind, payload) }); }
    if (body.action === 'public-call-signal') { const sender = String(body.sender || '').trim().toLowerCase(); const callId = String(body.callId || '').trim().slice(0, 80); const kind = String(body.kind || '').trim(); const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}; if (!USERNAME_RE.test(sender) || !callId || !['offer', 'answer', 'candidate', 'hangup'].includes(kind)) return res.status(400).json({ error: 'Invalid public call signal.' }); return res.json({ signal: await createCallSignal(callId, sender, '*', kind, payload) }); }
  if (body.action === 'call-signal') {
      const sender = String(body.sender || '').trim().toLowerCase();
      const recipient = String(body.recipient || '').trim().toLowerCase();
      const callId = String(body.callId || '').trim().slice(0, 80);
      const kind = String(body.kind || '').trim();
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
      if (!USERNAME_RE.test(sender) || !USERNAME_RE.test(recipient) || !callId || !['offer', 'answer', 'candidate', 'hangup'].includes(kind)) return res.status(400).json({ error: 'Invalid call signal.' });
      if (!await hasAcceptedChat(sender, recipient)) return res.status(403).json({ error: 'This user must accept your chat request before calls are available.' });
      return res.json({ signal: await createCallSignal(callId, sender, recipient, kind, payload) });
    }

    if (body.action === 'create-reward-code') { const auth = String(req.headers.authorization || ''); const sessionUser = auth.startsWith('Bearer ') ? verifySession(auth.slice(7)) : null; const user = sessionUser && await getUser(sessionUser); if (!user || user.role !== 'moderator') return res.status(403).json({ error: 'Moderator access required.' }); const code = String(body.code || '').trim().toUpperCase(); if (!/^STICK-[A-Z0-9]{10}$/.test(code)) return res.status(400).json({ error: 'Invalid code.' }); return res.json({ code }); }
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
