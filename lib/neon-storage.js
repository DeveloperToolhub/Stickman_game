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
    'select username, created_at from game_users order by created_at desc',
  );
  return rows;
}

async function createAdminMessage(message) {
  const { rows } = await pool.query(
    'insert into admin_messages (message) values ($1) returning id, message, created_at, expires_at',
    [message],
  );
  return rows[0];
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

module.exports = { getUser, listUsers, createUser, updateUser, createAdminMessage, listActiveMessages };
