// cloud.js: adds Google sign-in and cloud saves to the game.
// Loaded after the game script (see index.html).

(function () {
  // Paste your Google OAuth Web client ID here. It is not secret.
  const GOOGLE_CLIENT_ID = '1003622781649-nd95qmaqqeiccg6jf6ins10vnpr6vmfu.apps.googleusercontent.com';
  const TOKEN_KEY = 'stickman_google_token';
  const PUSH_DELAY_MS = 1500;

  let idToken = null;
  let pushTimer = null;
  let pendingPush = false;

  // ----- helpers -----
  function decodeJwt(token) {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(atob(part).split('').map(c =>
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
  }
  function isFresh(token) {
    try { return decodeJwt(token).exp * 1000 > Date.now() + 30000; }
    catch (e) { return false; }
  }
  function setStatus(text) {
    const el = document.getElementById('cloud-status');
    if (el) el.textContent = text;
  }

  // ----- sign-in bar -----
  function buildBar() {
    const bar = document.createElement('div');
    bar.id = 'cloud-bar';
    bar.style.cssText = 'position:fixed;top:8px;right:8px;z-index:60;display:flex;gap:8px;align-items:center;font:600 12px Arial,sans-serif;color:#e5e7eb;background:rgba(17,24,39,.85);padding:6px 10px;border-radius:10px;';
    bar.innerHTML = '<span id="cloud-status">Not signed in</span>' +
      '<div id="google-signin"></div>' +
      '<button id="cloud-signout" style="display:none;background:#374151;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;">Sign out</button>';
    document.body.appendChild(bar);
    document.getElementById('cloud-signout').onclick = signOut;
  }

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

  async function pullSave() {
    setStatus('Loading save...');
    const remote = await api('GET');
    if (remote && typeof remote.coins === 'number') {
      // The cloud save is the source of truth once you have one
      gameState = remote;
      localSave();                 // keep this browser's copy in sync
      refreshUI();
      setStatus('Synced');
    } else {
      // First sign-in: upload whatever progress this browser already has
      await api('PUT', gameState);
      setStatus('Save uploaded');
    }
  }

  function refreshUI() {
    if (typeof updateUI === 'function') updateUI();
    if (typeof renderShopPacks === 'function') renderShopPacks();
    if (typeof renderAlbum === 'function') renderAlbum();
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
    try { await api('PUT', gameState); setStatus('Saved'); }
    catch (e) { pendingPush = true; setStatus('Save failed, retrying...'); }
  }

  // If the player closes the tab with a save waiting, send it anyway
  window.addEventListener('pagehide', () => {
    if (!idToken || !pendingPush) return;
    fetch('/api/save', {
      method: 'PUT', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify(gameState),
    });
  });

  // ----- sign-in flow -----
  async function onCredential(resp) {
    idToken = resp.credential;
    localStorage.setItem(TOKEN_KEY, idToken);
    const p = decodeJwt(idToken);
    document.getElementById('google-signin').style.display = 'none';
    document.getElementById('cloud-signout').style.display = 'inline-block';
    setStatus('Signed in as ' + (p.given_name || p.name || p.email));
    try { await pullSave(); }
    catch (e) { setStatus(e.message); }
  }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    idToken = null;
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    location.reload();
  }

  async function init() {
    if (GOOGLE_CLIENT_ID.startsWith('PASTE_')) {
      console.warn('cloud.js: set GOOGLE_CLIENT_ID first.');
      return;
    }
    buildBar();
    try { await loadGoogleScript(); }
    catch (e) { setStatus(e.message); return; }

    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onCredential });
    google.accounts.id.renderButton(document.getElementById('google-signin'),
      { theme: 'filled_black', size: 'medium', text: 'signin_with' });

    // Restore a still-valid sign-in from an earlier visit
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored && isFresh(stored)) {
      await onCredential({ credential: stored });
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  window.addEventListener('load', init);
})();
