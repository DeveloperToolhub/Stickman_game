// cloud.js: sign-in (Google or username + password + secret words) and cloud saves.
// Loaded after the game script (see index.html).

(function () {
  // Paste your Google OAuth Web client ID here. It is not secret.
  const GOOGLE_CLIENT_ID = 'PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com';
  const TOKEN_KEY = 'stickman_token';
  const PUSH_DELAY_MS = 1500;

  let idToken = null;
  let currentRole = 'player';
  let pushTimer = null;
  let pendingPush = false;

  // ----- token helpers (Google tokens and username tokens both carry a JSON payload) -----
  function tokenInfo(token) {
    try {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(atob(part).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
    } catch (e) { return null; }
  }
  function isFresh(token) {
    const info = tokenInfo(token);
    // Google's exp is in seconds, and so is ours
    return !!info && info.exp * 1000 > Date.now() + 30000;
  }
  function displayName(token) {
    const i = tokenInfo(token) || {};
    return i.u || i.given_name || i.name || i.email || 'player';
  }
  function setStatus(text) {
    const el = document.getElementById('cloud-status');
    if (el) el.textContent = text;
  }

  // ----- sign-in bar -----
  function buildBar() {
    const bar = document.createElement('div');
    bar.id = 'cloud-bar';
    bar.style.cssText = 'position:fixed;top:8px;right:8px;z-index:60;display:flex;gap:8px;align-items:center;font:600 12px Arial,sans-serif;color:#e5e7eb;background:rgba(17,24,39,.9);padding:6px 10px;border-radius:10px;';
    bar.innerHTML =
      '<span id="cloud-status">Not signed in</span>' +
      '<button id="cloud-admin-btn" style="display:none;background:#7c3aed;color:#fff;border:0;border-radius:6px;padding:5px 9px;cursor:pointer;font:600 12px Arial,sans-serif;">Account directory</button>' +
      '<div id="google-signin"></div>' +
      '<button id="cloud-user-btn" style="background:#4f46e5;color:#fff;border:0;border-radius:6px;padding:5px 9px;cursor:pointer;font:600 12px Arial,sans-serif;">Username sign-in</button>' +
      '<button id="cloud-signout" style="display:none;background:#374151;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font:600 12px Arial,sans-serif;">Sign out</button>';
    document.body.appendChild(bar);
    document.getElementById('cloud-signout').onclick = signOut;
    document.getElementById('cloud-user-btn').onclick = openAccountModal;
    document.getElementById('cloud-admin-btn').onclick = openAccountDirectory;
  }

  // ----- username account modal -----
  const inputStyle = 'width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #374151;background:#0b0f19;color:#fff;font:14px Arial,sans-serif;margin-top:4px;';
  const btnStyle = 'width:100%;padding:9px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font:700 14px Arial,sans-serif;cursor:pointer;margin-top:12px;';

  function openAccountModal() {
    let modal = document.getElementById('acct-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'acct-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:16px;';
      modal.innerHTML = `
        <div style="background:#111827;color:#e5e7eb;border-radius:14px;padding:20px;width:100%;max-width:360px;font:14px Arial,sans-serif;">
          <div id="acct-body"></div>
          <button id="acct-close" style="width:100%;margin-top:8px;padding:7px;border:0;border-radius:8px;background:#1f2937;color:#9ca3af;cursor:pointer;font:600 12px Arial,sans-serif;">Close</button>
        </div>`;
      document.body.appendChild(modal);
      document.getElementById('acct-close').onclick = () => modal.style.display = 'none';
    }
    modal.style.display = 'flex';
    showSignIn();
  }

  async function openAccountDirectory() {
    const modal = document.getElementById('acct-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('acct-body').innerHTML = '<h3 style="margin:0 0 4px;font-size:18px;color:#fff;">Account directory</h3><p id="acct-msg" style="color:#9ca3af;font-size:12px;">Loading accounts...</p>';
    try {
      const res = await fetch('/api/account', { headers: { Authorization: 'Bearer ' + idToken } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load accounts.');
      const rows = data.users || [];
      document.getElementById('acct-body').innerHTML = '<h3 style="margin:0 0 12px;font-size:18px;color:#fff;">Account directory</h3>' +
        (rows.length ? '<div style="max-height:260px;overflow:auto;border:1px solid #374151;border-radius:8px;"><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="color:#a5b4fc;text-align:left;"><th style="padding:8px;">Username</th><th style="padding:8px;">Date created</th></tr></thead><tbody>' + rows.map((row) => '<tr style="border-top:1px solid #1f2937;"><td style="padding:8px;color:#fff;">' + row.username.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) + '</td><td style="padding:8px;color:#9ca3af;">' + new Date(row.created_at).toLocaleString() + '</td></tr>').join('') + '</tbody></table></div>' : '<p style="color:#9ca3af;font-size:12px;">No accounts created yet.</p>');
    } catch (error) {
      document.getElementById('acct-body').innerHTML = '<p style="color:#fca5a5;font-size:12px;">' + error.message + '</p>';
    }
  }

  function showSignIn(prefill = '') {
    document.getElementById('acct-body').innerHTML = `
      <h3 style="margin:0 0 4px;font-size:18px;color:#fff;">Sign in</h3>
      <p style="margin:0 0 10px;color:#9ca3af;font-size:12px;">Enter your username and password, then use your 6 secret words or recovery code.</p>
      <label style="font-size:12px;">Username<input id="acct-user" style="${inputStyle}" value="${prefill}" autocomplete="username"></label>
      <label style="font-size:12px;display:block;margin-top:8px;">Password<input id="acct-pass" type="password" style="${inputStyle}" autocomplete="current-password"></label>
      <label style="font-size:12px;display:block;margin-top:8px;">Secret words (6, separated by spaces)<input id="acct-words" style="${inputStyle}" autocomplete="off" spellcheck="false"></label>
      <label style="font-size:12px;display:block;margin-top:8px;">Lost your words? Recovery code<input id="acct-recovery" style="${inputStyle}" autocomplete="one-time-code" placeholder="XXXX-XXXX-XXXX"></label>
      <p id="acct-msg" style="color:#fca5a5;font-size:12px;min-height:16px;margin:8px 0 0;"></p>
      <button id="acct-signin" style="${btnStyle}">Sign in</button>
      <p style="text-align:center;font-size:12px;margin:12px 0 0;">New here? <a href="#" id="acct-to-create" style="color:#a5b4fc;">Create an account</a></p>`;
    document.getElementById('acct-signin').onclick = doSignIn;
    document.getElementById('acct-to-create').onclick = (e) => { e.preventDefault(); showCreate(); };
  }

  function showCreate() {
    document.getElementById('acct-body').innerHTML = `
      <h3 style="margin:0 0 4px;font-size:18px;color:#fff;">Create account</h3>
      <p style="margin:0 0 10px;color:#9ca3af;font-size:12px;">No email needed. You'll get 6 secret words to sign in with. Write them down: they're shown only once and can't be recovered.</p>
      <label style="font-size:12px;">Username (3-20 letters, numbers, _)<input id="acct-user" style="${inputStyle}" autocomplete="username"></label>
      <label style="font-size:12px;display:block;margin-top:8px;">Password (at least 8 characters)<input id="acct-pass" type="password" style="${inputStyle}" autocomplete="new-password"></label>
      <p id="acct-msg" style="color:#fca5a5;font-size:12px;min-height:16px;margin:8px 0 0;"></p>
      <button id="acct-create" style="${btnStyle}">Create account</button>
      <p style="text-align:center;font-size:12px;margin:12px 0 0;">Already have one? <a href="#" id="acct-to-signin" style="color:#a5b4fc;">Sign in</a></p>`;
    document.getElementById('acct-create').onclick = doCreate;
    document.getElementById('acct-to-signin').onclick = (e) => { e.preventDefault(); showSignIn(); };
  }

  function showWords(username, words, recoveryCode) {
    document.getElementById('acct-body').innerHTML = `
      <h3 style="margin:0 0 4px;font-size:18px;color:#fff;">Your secret words</h3>
      <p style="margin:0 0 10px;color:#fca5a5;font-size:12px;"><b>Save both of these now.</b> Your recovery code is the backup 2FA method if you lose your secret words. Neither will be shown again.</p>
      <div style="background:#0b0f19;border:1px dashed #6366f1;border-radius:10px;padding:12px;font:700 16px Consolas,monospace;color:#c7d2fe;text-align:center;letter-spacing:.5px;">${words.join(' ')}</div>
      <p style="margin:12px 0 6px;font-size:12px;color:#fcd34d;font-weight:700;">Backup 2FA recovery code</p>
      <div style="background:#0b0f19;border:1px dashed #f59e0b;border-radius:10px;padding:12px;font:700 18px Consolas,monospace;color:#fde68a;text-align:center;letter-spacing:1px;">${recoveryCode}</div>
      <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">Use the recovery code with your password if you lose your secret words.</p>
      <button id="acct-continue" style="${btnStyle}">I saved them, sign in</button>`;
    document.getElementById('acct-continue').onclick = () => showSignIn(username);
  }

  async function doCreate() {
    const msg = document.getElementById('acct-msg');
    msg.textContent = 'Creating...';
    try {
      const res = await fetch('/api/account', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create',
          username: document.getElementById('acct-user').value,
          password: document.getElementById('acct-pass').value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { msg.textContent = data.error || 'Could not create the account.'; return; }
      showWords(document.getElementById('acct-user').value.trim(), data.words, data.recoveryCode);
    } catch (e) { msg.textContent = 'Network error. Try again.'; }
  }

  async function doSignIn() {
    const msg = document.getElementById('acct-msg');
    msg.textContent = 'Signing in...';
    try {
      const res = await fetch('/api/account', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login',
          username: document.getElementById('acct-user').value,
          password: document.getElementById('acct-pass').value,
          words: document.getElementById('acct-words').value,
          recoveryCode: document.getElementById('acct-recovery').value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { msg.textContent = data.error || 'Could not sign in.'; return; }
      document.getElementById('acct-modal').style.display = 'none';
      await onToken(data.token, data.role);
    } catch (e) { msg.textContent = 'Network error. Try again.'; }
  }

  // ----- Google sign-in -----
  function loadGoogleScript() {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load Google sign-in.'));
      document.head.appendChild(s);
    });
  }

  // ----- server calls -----
  async function api(method, body) {
    const res = await fetch('/api/save', {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { signOut(); throw new Error('Your sign-in expired.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  function refreshUI() {
    if (typeof updateUI === 'function') updateUI();
    if (typeof renderShopPacks === 'function') renderShopPacks();
    if (typeof renderAlbum === 'function') renderAlbum();
  }

  async function pullSave() {
    setStatus('Loading save...');
    const remote = await api('GET');
    if (remote && typeof remote.coins === 'number') {
      gameState = remote;          // the cloud save wins once it exists
      localSave();
      refreshUI();
      setStatus('Synced');
    } else {
      await api('PUT', gameState); // first sign-in: upload this browser's progress
      setStatus('Save uploaded');
    }
  }

  // ----- auto-save: wrap the game's save function -----
  const localSave = window.saveGameState;
  window.saveGameState = function () {
    localSave.apply(this, arguments);
    schedulePush();
  };

  function schedulePush() {
    if (!idToken) return;
    pendingPush = true;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, PUSH_DELAY_MS);
  }

  async function pushNow() {
    if (!idToken || !pendingPush) return;
    pendingPush = false;
    try {
      await api('PUT', gameState);
      setStatus('Saved');
    } catch (e) {
      pendingPush = true;
      setStatus('Save failed: ' + e.message);
      clearTimeout(pushTimer);
      pushTimer = setTimeout(pushNow, 10000);
    }
  }

  window.addEventListener('pagehide', () => {
    if (!idToken || !pendingPush) return;
    fetch('/api/save', {
      method: 'PUT', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify(gameState),
    });
  });

  // ----- sign-in state -----
  async function onToken(token, role) {
    idToken = token;
    currentRole = role || (displayName(token) === 'admin' ? 'moderator' : 'player');
    localStorage.setItem(TOKEN_KEY, token);
    document.getElementById('google-signin').style.display = 'none';
    document.getElementById('cloud-user-btn').style.display = 'none';
    document.getElementById('cloud-signout').style.display = 'inline-block';
    document.getElementById('cloud-admin-btn').style.display = currentRole === 'moderator' ? 'inline-block' : 'none';
    setStatus('Signed in as ' + displayName(token));
    try { await pullSave(); }
    catch (e) { setStatus(e.message); }
  }

  async function onGoogleCredential(resp) { await onToken(resp.credential); }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    idToken = null;
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    location.reload();
  }

  async function init() {
    buildBar();

    if (!GOOGLE_CLIENT_ID.startsWith('PASTE_')) {
      try {
        await loadGoogleScript();
        google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential });
        google.accounts.id.renderButton(document.getElementById('google-signin'),
          { theme: 'filled_black', size: 'medium', text: 'signin_with' });
      } catch (e) { setStatus(e.message); }
    } else {
      console.warn('cloud.js: set GOOGLE_CLIENT_ID to enable Google sign-in.');
    }

    // Restore a still-valid sign-in from an earlier visit
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored && isFresh(stored)) await onToken(stored);
    else localStorage.removeItem(TOKEN_KEY);
  }

  window.addEventListener('load', init);
})();
