const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

function rowToUser(row) {
  return row ? {
    username: row.username,
    email: row.email,
    password_hash: row.password_hash,
    words_hash: row.words_hash,
    recovery_hash: row.recovery_hash,
    failed_attempts: row.failed_attempts,
    locked_until: Number(row.locked_until || 0),
    role: row.role,
    created_at: row.created_at,
  } : null;
}

async function getUser(username) {
  const { rows } = await pool.query(
    'select username, email, password_hash, words_hash, recovery_hash, failed_attempts, locked_until, role, created_at from game_users where username = $1',
    [username],
  );
  return rowToUser(rows[0]);
}

async function listUsers() {
  const { rows } = await pool.query(
    'select username, coins, created_at from game_users order by created_at desc',
  );
  return rows;
}

async function grantCoins(username, amount) {
  const { rows } = await pool.query('update game_users set coins = coins + $2 where username = $1 returning username, coins', [username, amount]);
  return rows[0] || null;
}

async function grantSecret(username, secretKey, grantedBy) {
  const { rows } = await pool.query('insert into player_secrets (username, secret_key, granted_by) values ($1, $2, $3) on conflict (username, secret_key) do nothing returning id, username, secret_key', [username, secretKey, grantedBy]);
  return rows[0] || null;
}

async function listWorldState() {
  const { rows } = await pool.query("select background, updated_at from admin_world_state where id = 1");
  return rows[0] || { background: 'aurora' };
}

async function setWorldBackground(background, updatedBy) {
  const { rows } = await pool.query('insert into admin_world_state (id, background, updated_by) values (1, $1, $2) on conflict (id) do update set background = excluded.background, updated_by = excluded.updated_by, updated_at = now() returning background, updated_at', [background, updatedBy]);
  return rows[0];
}

async function createAdminMessage(message) {
  const { rows } = await pool.query(
    'insert into admin_messages (message) values ($1) returning id, message, created_at, expires_at',
    [message],
  );
  return rows[0];
}

async function createAdminMedia(youtubeId, action = 'play') {
  const { rows } = await pool.query(
    'insert into admin_media (youtube_id, action) values ($1, $2) returning id, youtube_id, action, created_at, expires_at',
    [youtubeId, action],
  );
  return rows[0];
}

async function listActiveMedia() {
  const { rows } = await pool.query(
    'select id, youtube_id, action, created_at from admin_media where expires_at > now() order by id desc limit 10',
  );
  return rows;
}

async function createChatMessage(username, message) {
  const { rows } = await pool.query('insert into public_chat_messages (username, message) values ($1, $2) returning id, username, message, created_at', [username, message]);
  return rows[0];
}

async function listChatMessages(afterId = 0) {
  const { rows } = await pool.query('select id, username, message, created_at from public_chat_messages where id > $1 order by id asc limit 100', [afterId]);
  return rows;
}

async function touchChatPresence(username) {
  await pool.query('insert into chat_presence (username, last_seen) values ($1, now()) on conflict (username) do update set last_seen = now()', [username]);
}

async function listOnlineUsers(excludeUsername = '') {
  const { rows } = await pool.query("select username, extract(epoch from (now() - last_seen)) as seconds_ago from chat_presence where last_seen > now() - interval '45 seconds' and username <> $1 order by username", [excludeUsername]);
  return rows;
}

async function createChatRequest(requester, recipient) {
  await pool.query("delete from chat_requests where requester = $1 and recipient = $2 and status = 'pending'", [requester, recipient]);
  const { rows } = await pool.query("insert into chat_requests (requester, recipient, status) values ($1, $2, 'pending') returning id, requester, recipient, status, created_at", [requester, recipient]);
  return rows[0];
}

async function respondChatRequest(id, recipient, status) {
  const { rows } = await pool.query("update chat_requests set status = $3, responded_at = now() where id = $1 and recipient = $2 and status = 'pending' returning id, requester, recipient, status", [id, recipient, status]);
  return rows[0] || null;
}

async function listChatRequests(username) {
  const { rows } = await pool.query("select id, requester, recipient, status, created_at from chat_requests where (recipient = $1 or requester = $1) and ((status = 'pending' and recipient = $1) or status = 'accepted') order by id desc limit 50", [username]);
  return rows;
}

async function hasAcceptedChat(userA, userB) {
  const { rowCount } = await pool.query("select 1 from chat_requests where status = 'accepted' and ((requester = $1 and recipient = $2) or (requester = $2 and recipient = $1)) limit 1", [userA, userB]);
  return rowCount > 0;
}

async function createPrivateMessage(sender, recipient, message) {
  const { rows } = await pool.query('insert into private_messages (sender, recipient, message) values ($1, $2, $3) returning id, sender, recipient, message, created_at', [sender, recipient, message]);
  return rows[0];
}

async function listPrivateMessages(userA, userB, afterId = 0) {
  const { rows } = await pool.query('select id, sender, recipient, message, created_at from private_messages where id > $3 and ((sender = $1 and recipient = $2) or (sender = $2 and recipient = $1)) order by id asc limit 100', [userA, userB, afterId]);
  return rows;
}

async function createCallSignal(callId, sender, recipient, kind, payload) {
  const { rows } = await pool.query('insert into call_signals (call_id, sender, recipient, kind, payload) values ($1, $2, $3, $4, $5) returning id, call_id, sender, recipient, kind, payload, created_at', [callId, sender, recipient, kind, payload]);
  return rows[0];
}

async function listCallSignals(recipient, callId, afterId = 0) {
  const { rows } = await pool.query("select id, call_id, sender, recipient, kind, payload, created_at from call_signals where recipient = $1 and ($2 = '' or call_id = $2) and id > $3 and created_at > now() - interval '30 seconds' order by id asc limit 100", [recipient, callId, afterId]);
  return rows;
}

async function listActiveMessages() {
  const { rows } = await pool.query(
    'select id, message, created_at from admin_messages where expires_at > now() order by id desc limit 20',
  );
  return rows;
}

async function createUser(username, fields) {
  const { rowCount } = await pool.query(
    `insert into game_users
      (username, email, password_hash, words_hash, recovery_hash, failed_attempts, locked_until, role)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (username) do nothing`,
    [username, fields.email || null, fields.password_hash, fields.words_hash, fields.recovery_hash || null,
      fields.failed_attempts || 0, fields.locked_until || 0, fields.role || 'player'],
  );
  return rowCount === 1;
}

async function updateUser(username, fields) {
  const allowed = ['email', 'password_hash', 'words_hash', 'recovery_hash', 'failed_attempts', 'locked_until', 'role'];
  const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
  if (!entries.length) return false;
  const values = [username];
  const assignments = entries.map(([key, value], index) => {
    values.push(value);
    return `${key} = $${index + 2}`;
  });
  const { rowCount } = await pool.query(
    `update game_users set ${assignments.join(', ')} where username = $1`,
    values,
  );
  return rowCount === 1;
}

module.exports = { getUser, listUsers, createUser, updateUser, createAdminMessage, listActiveMessages, createAdminMedia, listActiveMedia, grantCoins, grantSecret, listWorldState, setWorldBackground, createChatMessage, listChatMessages, createPrivateMessage, listPrivateMessages, createCallSignal, listCallSignals, touchChatPresence, listOnlineUsers, createChatRequest, respondChatRequest, listChatRequests, hasAcceptedChat };
