// In-memory demo storage for previews and local testing.
// Data lasts while the server process is running and is intentionally not production persistence.
const users = new Map();
const saves = new Map();

function getUser(username) {
  return users.get(username) || null;
}

function listUsers() {
  return Array.from(users.values());
}

function createUser(username, fields) {
  if (users.has(username)) return false;
  users.set(username, { username, created_at: new Date().toISOString(), ...fields });
  return true;
}

function updateUser(username, fields) {
  const user = users.get(username);
  if (!user) return false;
  users.set(username, { ...user, ...fields });
  return true;
}

function getSave(identity) {
  return saves.get(identity) || null;
}

function setSave(identity, data) {
  saves.set(identity, data);
}

module.exports = { getUser, listUsers, createUser, updateUser, getSave, setSave };
