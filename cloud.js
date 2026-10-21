// cloud.js: sign-in (Google or username + password + secret words) and cloud saves.
// Loaded after the game script (see index.html).

(function () {
  // Paste your Google OAuth Web client ID here. It is not secret.
  let GOOGLE_CLIENT_ID = '';
  const TOKEN_KEY = 'stickman_token';
  const PUSH_DELAY_MS = 1500;

  let idToken = null;
  let currentRole = 'player';
  let pushTimer = null;
  let messageTimer = null;
  let lastMessageId = 0;
  let mediaTimer = null;
  let lastMediaId = 0;
  let remotePlayer = null;
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
      '<button id="cloud-admin-btn" style="display:none;background:#7c3aed;color:#fff;border:0;border-radius:6px;padding:5px 9px;cursor:pointer;font:600 12px Arial,sans-serif;">Admin panel</button>' +
      '<div id="google-signin"></div>' +
      '<button id="cloud-user-btn" style="background:#4f46e5;color:#fff;border:0;border-radius:6px;padding:5px 9px;cursor:pointer;font:600 12px Arial,sans-serif;">Username sign-in</button>' +
      '<button id="cloud-signout" style="display:none;background:#374151;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font:600 12px Arial,sans-serif;">Sign out</button>';
    document.body.appendChild(bar);
    document.getElementById('cloud-signout').onclick = signOut;
    document.getElementById('cloud-user-btn').onclick = openAccountModal;
    document.getElementById('cloud-admin-btn').onclick = openAdminPanel;
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

  function escapeAdminText(value) {
    return String(value).replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]));
  }

  function showAdminMessage(text, tone = '#a5b4fc') {
    let toast = document.getElementById('admin-live-message');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'admin-live-message';
      toast.style.cssText = 'position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:90;max-width:min(90vw,620px);padding:14px 20px;border-radius:12px;background:rgba(15,23,42,.96);border:1px solid rgba(165,180,252,.55);box-shadow:0 12px 35px rgba(0,0,0,.4);font:700 15px Arial,sans-serif;text-align:center;';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.color = tone;
    toast.style.display = 'block';
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => { toast.style.display = 'none'; }, 8000);
  }

  function applyAdminTheme(theme) {
    const themes = {
      crimson: ['#180b12', '#7f1d1d', '#fecaca'],
      midnight: ['#020617', '#1e1b4b', '#c7d2fe'],
      toxic: ['#071a12', '#14532d', '#bbf7d0'],
      gold: ['#1c1405', '#78350f', '#fef3c7'],
    };
    const colors = themes[theme] || themes.midnight;
    document.body.style.background = `radial-gradient(circle at top, ${colors[1]}, ${colors[0]} 62%)`;
    document.body.style.color = colors[2];
    localStorage.setItem('admin-theme', theme);
    showAdminMessage(`Theme changed to ${theme}.`, colors[2]);
  }

  function showRemoteVideo(youtubeId) {
    if (!remotePlayer) {
      remotePlayer = document.createElement('iframe');
      remotePlayer.id = 'remote-youtube-player';
      remotePlayer.title = 'Admin shared YouTube video';
      remotePlayer.allow = 'autoplay; encrypted-media; picture-in-picture';
      remotePlayer.allowFullscreen = true;
      remotePlayer.style.cssText = 'position:fixed;right:16px;bottom:16px;width:min(360px,calc(100vw - 32px));height:203px;z-index:85;border:1px solid #f59e0b;border-radius:12px;background:#000;box-shadow:0 14px 35px rgba(0,0,0,.55);';
      document.body.appendChild(remotePlayer);
    }
    remotePlayer.src = `https://www.youtube.com/embed/${youtubeId}?autoplay=1&playsinline=1`;
    showAdminMessage('Admin is playing a video for everyone.', '#fde68a');
  }

  function stopRemoteVideo() {
    if (remotePlayer) { remotePlayer.remove(); remotePlayer = null; }
  }

  function playAdminYouTube() {
    const input = document.getElementById('admin-video-url');
    const match = String(input.value).match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (!match) { showAdminMessage('Enter a valid YouTube video URL.', '#fca5a5'); return; }
    let player = document.getElementById('admin-youtube-player');
    if (!player) {
      player = document.createElement('iframe');
      player.id = 'admin-youtube-player';
      player.style.cssText = 'position:fixed;right:16px;bottom:16px;width:320px;height:180px;z-index:85;border:1px solid #6366f1;border-radius:12px;background:#000;box-shadow:0 14px 35px rgba(0,0,0,.5);';
      player.allow = 'autoplay; encrypted-media; picture-in-picture';
      player.allowFullscreen = true;
      document.body.appendChild(player);
    }
    player.src = `https://www.youtube.com/embed/${match[1]}?autoplay=1`;
    showAdminMessage('YouTube video started.');
  }

  function openAdminPanel() {
    if (currentRole !== 'moderator') return;
    const modal = document.getElementById('acct-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('acct-body').innerHTML = `
      <h3 style="margin:0 0 4px;font-size:20px;color:#fff;">Admin Abuse Control Panel</h3>
      <p style="margin:0 0 14px;color:#9ca3af;font-size:12px;">Moderator-only communication and presentation controls.</p>
      <label style="font-size:12px;color:#dbeafe;">On-screen message<textarea id="admin-message" rows="3" placeholder="Message for everyone on this screen..." style="${inputStyle}resize:vertical"></textarea></label>
      <button id="admin-send-message" style="${btnStyle}">Show message</button>
      <div style="margin-top:18px;border-top:1px solid #374151;padding-top:14px;">
        <p style="margin:0 0 8px;font-size:12px;color:#c4b5fd;font-weight:700;">Themes</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">${['crimson','midnight','toxic','gold'].map((theme) => `<button class="admin-theme" data-theme="${theme}" style="padding:8px;border:1px solid #4b5563;border-radius:7px;background:#1f2937;color:#fff;cursor:pointer;">${theme}</button>`).join('')}</div>
      </div>
      <div style="margin-top:18px;border-top:1px solid #374151;padding-top:14px;">
        <p style="margin:0 0 8px;font-size:12px;color:#c4b5fd;font-weight:700;">Shared YouTube video and audio</p>
        <input id="admin-video-url" style="${inputStyle}" placeholder="Paste a YouTube URL (audio follows video)">
        <button id="admin-play-video" style="${btnStyle}">Play video</button>
        <button id="admin-stop-video" style="width:100%;margin-top:8px;padding:8px;border:0;border-radius:8px;background:#374151;color:#fff;cursor:pointer;">Stop video</button>
      </div>`;
    document.getElementById('admin-send-message').onclick = () => {
      const message = document.getElementById('admin-message').value.trim();
      if (message) {
        fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify({ action: 'broadcast-message', message }) })
          .then(async (response) => { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Could not send message.'); showAdminMessage('Message sent to active players.', '#86efac'); })
          .catch((error) => showAdminMessage(error.message, '#fca5a5'));
      }
    };
    document.querySelectorAll('.admin-theme').forEach((button) => { button.onclick = () => applyAdminTheme(button.dataset.theme); });
    document.getElementById('admin-play-video').onclick = () => {
      const input = document.getElementById('admin-video-url');
      const match = String(input.value).match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
      if (!match) { showAdminMessage('Enter a valid YouTube video URL.', '#fca5a5'); return; }
      fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify({ action: 'broadcast-media', youtubeId: match[1], mediaAction: 'play' }) }).then(async (response) => { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Could not start shared video.'); playAdminYouTube(); showAdminMessage('Video and audio sent to active players.', '#86efac'); }).catch((error) => showAdminMessage(error.message, '#fca5a5'));
    };
    document.getElementById('admin-stop-video').onclick = () => { const player = document.getElementById('admin-youtube-player'); if (player) player.remove(); fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify({ action: 'broadcast-media', youtubeId: 'stopped', mediaAction: 'stop' }) }); showAdminMessage('Video stopped for active players.'); };
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
      <p style="margin:0 0 10px;color:#9ca3af;font-size:12px;">Create a username and password. Your secret words and backup recovery code will be shown once, so save them securely.</p>
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
    msg.style.color = '#fca5a5'; msg.textContent = 'Creating...';
    try {
      const res = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', username: document.getElementById('acct-user').value, password: document.getElementById('acct-pass').value }) });
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
  async function pollBroadcastMedia() {
    try {
      const response = await fetch('/api/account?resource=media', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      const newest = (data.media || []).sort((a, b) => Number(a.id) - Number(b.id)).find((item) => Number(item.id) > lastMediaId);
      if (!newest) return;
      lastMediaId = Number(newest.id);
      if (newest.action === 'stop') stopRemoteVideo(); else showRemoteVideo(newest.youtube_id);
    } catch (error) { console.log('[v0] media polling failed:', error.message); }
  }

  async function pollBroadcastMessages() {
    try {
      const response = await fetch('/api/account?resource=messages', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      const newest = (data.messages || []).sort((a, b) => Number(a.id) - Number(b.id)).find((item) => Number(item.id) > lastMessageId);
      if (newest) { lastMessageId = Number(newest.id); showAdminMessage(newest.message, '#fef08a'); }
    } catch (error) {
      console.log('[v0] broadcast polling failed:', error.message);
    }
  }

  async function onToken(token, role) {
    idToken = token;
    currentRole = role || (displayName(token) === 'admin' ? 'moderator' : 'player');
    localStorage.setItem(TOKEN_KEY, token);
    document.getElementById('google-signin').style.display = 'none';
    document.getElementById('cloud-user-btn').style.display = 'none';
    document.getElementById('cloud-signout').style.display = 'inline-block';
    document.getElementById('cloud-admin-btn').style.display = currentRole === 'moderator' ? 'inline-block' : 'none';
    clearInterval(messageTimer);
    lastMessageId = 0;
    pollBroadcastMessages();
    messageTimer = setInterval(() => { pollBroadcastMessages(); pollBroadcastMedia(); }, 3000);
    pollBroadcastMedia();
    setStatus('Signed in as ' + displayName(token));
    try { await pullSave(); }
    catch (e) { setStatus(e.message); }
  }

  async function onGoogleCredential(resp) {
    try {
      const response = await fetch('/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'google-login', credential: resp.credential }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Google sign-in failed.');
      await onToken(data.token, data.role);
    } catch (error) {
      localStorage.removeItem(TOKEN_KEY);
      setStatus(error.message);
    }
  }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    idToken = null;
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    location.reload();
  }

  async function init() {
    buildBar();

    try {
      const config = await fetch('/api/config', { cache: 'no-store' }).then((response) => response.ok ? response.json() : {});
      GOOGLE_CLIENT_ID = String(config.googleClientId || '');
    } catch (e) {
      setStatus('Google sign-in unavailable');
    }

    if (GOOGLE_CLIENT_ID) {
      try {
        await loadGoogleScript();
        google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential });
        google.accounts.id.renderButton(document.getElementById('google-signin'),
          { theme: 'filled_black', size: 'medium', text: 'continue_with', shape: 'rectangular' });
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
