// cloud.js: sign-in (Google or username + password + secret words) and cloud saves.
// Loaded after the game script (see index.html).

(function () {
  const adminGlassStyle = document.createElement('style');
  adminGlassStyle.textContent = `
    #acct-modal { background:rgba(2,6,23,.72) !important; backdrop-filter:blur(22px) saturate(150%); -webkit-backdrop-filter:blur(22px) saturate(150%); }
    #acct-modal > div { background:linear-gradient(145deg,rgba(30,41,59,.82),rgba(2,6,23,.88)) !important; border:1px solid rgba(255,255,255,.22) !important; border-radius:28px !important; box-shadow:0 30px 100px rgba(0,0,0,.6), inset 0 1px rgba(255,255,255,.2) !important; backdrop-filter:blur(28px) saturate(160%); }
    #acct-body > div:first-child { color:#e0f2fe !important; }
    #acct-body section, #acct-body [style*="background:#111827"], #acct-body [style*="background: #111827"] { background:linear-gradient(145deg,rgba(51,65,85,.42),rgba(15,23,42,.56)) !important; border-color:rgba(148,163,184,.22) !important; border-radius:18px !important; box-shadow:inset 0 1px rgba(255,255,255,.1),0 12px 30px rgba(0,0,0,.16); }
    #acct-body input, #acct-body textarea, #acct-body select { color:#e0f2fe !important; background:rgba(15,23,42,.68) !important; border:1px solid rgba(125,211,252,.24) !important; border-radius:12px !important; outline:none; }
    #acct-body button, #acct-close { border:1px solid rgba(255,255,255,.16) !important; border-radius:11px !important; box-shadow:inset 0 1px rgba(255,255,255,.18),0 8px 20px rgba(0,0,0,.18); transition:transform .18s ease,filter .18s ease; }
    #acct-body button:hover, #acct-close:hover { transform:translateY(-1px); filter:brightness(1.12); }
    #cloud-bar { background:rgba(15,23,42,.72) !important; border:1px solid rgba(255,255,255,.2) !important; border-radius:16px !important; box-shadow:0 14px 35px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.18); backdrop-filter:blur(18px) saturate(150%); }\n
    #acct-modal { background:rgba(5,7,11,.72) !important; }
    #acct-modal > div { font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif !important; }
    #acct-body h2 { letter-spacing:-.04em; font-weight:750; }
    #acct-body nav { border-color:rgba(255,255,255,.12) !important; gap:7px !important; }
    #acct-body .admin-tab { border-radius:14px !important; padding:10px 15px !important; background:rgba(255,255,255,.055) !important; }
    #acct-body .admin-tab[style*='#6366f1'] { background:rgba(10,132,255,.22) !important; border-color:rgba(10,132,255,.5) !important; }
    #acct-body section { border-radius:20px !important; }
    #acct-body button { border-radius:13px !important; min-height:40px; }
    #acct-body input,#acct-body textarea,#acct-body select { font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif !important; padding:10px 12px !important; }
    @media(max-width:640px){ #acct-modal{align-items:flex-start !important;padding:8px !important} #acct-modal>div{max-height:calc(100dvh - 16px) !important;border-radius:22px !important;padding:14px !important} #acct-body [style*='grid-template-columns:minmax(0,1.4fr)']{grid-template-columns:1fr !important} }

  `;
  document.head.appendChild(adminGlassStyle);
  // Paste your Google OAuth Web client ID here. It is not secret.
  let GOOGLE_CLIENT_ID = '1003622781649-nd95qmaqqeiccg6jf6ins10vnpr6vmfu.apps.googleusercontent.com';
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
  let screenSharePeer = null;
  let screenShareStream = null;
  let screenShareCallId = '';
  let screenShareCursor = 0;
  async function startAdminScreenShare() { const status = document.getElementById('pro-share-status'); try { screenShareStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); screenSharePeer = new Peer(); screenShareCallId = 'screen-' + Date.now(); screenSharePeer.on('open', async (peerId) => { await fetch('/api/account', { method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+idToken}, body:JSON.stringify({ action:'screen-share-signal', sender:displayName(idToken).toLowerCase(), callId:screenShareCallId, kind:'start', payload:{ peerId } }) }); status.textContent = 'Live: waiting for viewers to connect.'; }); screenShareStream.getVideoTracks()[0].onended = stopAdminScreenShare; screenSharePeer.on('error', (error) => { status.textContent = error.message; }); window.screenSharePoll = setInterval(async () => { const response = await fetch(`/api/account?resource=screen-share-signals&callId=${encodeURIComponent(screenShareCallId)}&after=${screenShareCursor}`, { cache:'no-store' }); const data = await response.json(); for (const signal of data.signals || []) { screenShareCursor = Math.max(screenShareCursor, Number(signal.id)); if (signal.kind === 'viewer' && signal.payload?.peerId) { const call = screenSharePeer.call(signal.payload.peerId, screenShareStream); call.on('close', () => {}); } } }, 1500); } catch (error) { status.textContent = 'Screen sharing was cancelled or blocked.'; } }
  async function stopAdminScreenShare() { if (!screenShareCallId) return; clearInterval(window.screenSharePoll); await fetch('/api/account', { method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+idToken}, body:JSON.stringify({ action:'screen-share-signal', sender:displayName(idToken).toLowerCase(), callId:screenShareCallId, kind:'stop', payload:{} }) }).catch(() => {}); if (screenShareStream) screenShareStream.getTracks().forEach((track) => track.stop()); if (screenSharePeer) screenSharePeer.destroy(); screenShareStream = null; screenSharePeer = null; screenShareCallId = ''; const status = document.getElementById('pro-share-status'); if (status) status.textContent = 'Broadcast stopped.'; }

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
    document.getElementById('cloud-admin-btn').onclick = openAdminPanelPro;
  }

  // ----- username account modal -----
  const inputStyle = 'width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #374151;background:#0b0f19;color:#fff;font:14px Arial,sans-serif;margin-top:4px;';
  const btnStyle = 'width:100%;padding:9px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font:700 14px Arial,sans-serif;cursor:pointer;margin-top:12px;';

  function openAccountModal() {
    let modal = document.getElementById('acct-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'acct-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:clamp(8px,2vw,24px);overflow:auto;';
      modal.innerHTML = `
        <div style="background:#111827;color:#e5e7eb;border:1px solid #263449;border-radius:16px;padding:clamp(14px,2vw,24px);width:min(100%,1240px);max-width:1240px;max-height:calc(100vh - 32px);overflow:auto;font:14px Arial,sans-serif;">
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

  function applyWorldBackground(background) {
    document.body.dataset.background = background;
    const existing = document.getElementById('live-world-background');
    if (existing) existing.remove();
    const layer = document.createElement('div');
    layer.id = 'live-world-background';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.6;mix-blend-mode:screen;background-size:cover;';
    const styles = { aurora:'radial-gradient(circle at 20% 20%,#22d3ee33,transparent 35%),radial-gradient(circle at 80% 30%,#a855f733,transparent 35%),#020617', 'neon-rain':'repeating-linear-gradient(115deg,#22d3ee22 0 2px,transparent 2px 28px),#020617', volcano:'radial-gradient(circle at 50% 110%,#ef4444aa,transparent 45%),#170808', 'cyber-grid':'linear-gradient(#22d3ee22 1px,transparent 1px),linear-gradient(90deg,#22d3ee22 1px,transparent 1px),#050816', matrix:'repeating-linear-gradient(90deg,#22c55e18 0 1px,transparent 1px 24px),#020b07' };
    layer.style.background = styles[background] || styles.aurora;
    document.body.appendChild(layer);
  }

  async function pollWorldBackground() {
    try { const response = await fetch('/api/account?resource=world', { cache:'no-store' }); if (!response.ok) return; const data = await response.json(); if (data.world?.background) applyWorldBackground(data.world.background); } catch (error) { console.log('[v0] background polling failed:', error.message); }
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

  function openAdminPanelPro() {
    if (currentRole !== 'moderator') return;
    const modal = document.getElementById('acct-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    const body = document.getElementById('acct-body');
    body.innerHTML = `
      <div style="max-width:1180px;width:100%;margin:-4px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;">
          <div><div style="font-size:11px;letter-spacing:2px;color:#818cf8;font-weight:800;">STICKMAN CONTROL CENTER</div><h2 style="margin:4px 0 0;color:#fff;font-size:26px;">Moderator command deck</h2></div>
          <div style="text-align:right"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#34d399;box-shadow:0 0 12px #34d399;margin-right:6px;"></span><span style="color:#86efac;font-size:12px;font-weight:700;">LIVE</span><div style="color:#64748b;font-size:11px;margin-top:4px;">Admin access</div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-bottom:14px;">
          ${[['Players online','Live presence','36','emerald'],['Messages','Broadcast ready','12','indigo'],['Media channel','Audio + video','ON','amber'],['Server health','All systems','99.9%','sky']].map(([label,sub,value,color]) => `<div style="background:linear-gradient(145deg,#172033,#0f172a);border:1px solid #263449;border-radius:12px;padding:12px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;">${label}</div><div style="font-size:22px;font-weight:800;color:#${color === 'emerald' ? '6ee7b7' : color === 'amber' ? 'fcd34d' : color === 'sky' ? '7dd3fc' : 'a5b4fc'};margin-top:5px;">${value}</div><div style="font-size:10px;color:#64748b;margin-top:2px;">${sub}</div></div>`).join('')}
        </div>
        <nav id="admin-tabs" style="display:flex;gap:6px;overflow:auto;padding-bottom:10px;border-bottom:1px solid #263449;">
          ${['Command','Players','Broadcasts','World','Tools'].map((tab,index) => `<button class="admin-tab" data-tab="${tab.toLowerCase()}" style="white-space:nowrap;border:1px solid ${index === 0 ? '#6366f1' : '#263449'};background:${index === 0 ? '#312e81' : '#111827'};color:#e0e7ff;border-radius:8px;padding:8px 12px;font:700 12px Arial;cursor:pointer;">${tab}</button>`).join('')}
        </nav>
        <div id="admin-tab-content" style="padding-top:14px;"></div>
      </div>`;
    const content = document.getElementById('admin-tab-content');
    const field = (id, label, placeholder, type = 'text') => `<label style="display:block;color:#cbd5e1;font-size:12px;font-weight:700;">${label}<input id="${id}" type="${type}" placeholder="${placeholder}" style="${inputStyle}"></label>`;
    const button = (id, text, tone = '#4f46e5') => `<button id="${id}" style="border:0;border-radius:8px;padding:9px 12px;background:${tone};color:#fff;font:700 12px Arial;cursor:pointer;">${text}</button>`;
    const render = (tab) => {
      if (tab === 'command') content.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,1fr);gap:12px;"><section style="background:linear-gradient(145deg,#172033,#111827);border:1px solid #263449;border-radius:12px;padding:14px;"><div style="color:#fbbf24;font-size:12px;font-weight:800;margin-bottom:10px;">CODE GENERATOR</div><p style="color:#94a3b8;font-size:11px;margin:0 0 10px;">Create a redeemable-looking event code for your next drop.</p><div style="display:flex;gap:7px;align-items:center;"><input id="pro-code-output" readonly placeholder="Click generate" style="${inputStyle};font-weight:800;letter-spacing:.12em;"><button id="pro-code-generate" style="${button('unused','Generate','#d97706')}">Generate</button></div><p id="pro-code-status" style="color:#94a3b8;font-size:11px;min-height:16px;margin:8px 0 0;"></p></section><section style="background:#111827;border:1px solid #263449;border-radius:12px;padding:14px;"><div style="color:#a5b4fc;font-size:12px;font-weight:800;margin-bottom:10px;">GLOBAL ANNOUNCEMENT</div>${field('pro-message','Message','Everyone will see this...')}<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">${button('pro-send','Broadcast message')} ${button('pro-clear','Clear live banners','#374151')} ${button('pro-delete-all-chat','Delete all chat messages','#991b1b')}</div><p id="pro-status" style="font-size:12px;color:#64748b;min-height:16px;margin:10px 0 0;"></p></section><section style="background:#111827;border:1px solid #263449;border-radius:12px;padding:14px;"><div style="color:#a5b4fc;font-size:12px;font-weight:800;margin-bottom:10px;">QUICK ACTIONS</div><div style="display:grid;gap:8px;">${button('pro-welcome','Send welcome banner','#059669')}${button('pro-alert','Send alert banner','#b45309')}${button('pro-reset-theme','Reset world theme','#334155')}</div></section></div>`;
      if (tab === 'players') content.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;"><section style="background:linear-gradient(145deg,#30111b,#111827);border:1px solid #7f1d1d;border-radius:12px;padding:14px;"><div style="color:#fca5a5;font-size:12px;font-weight:800;margin-bottom:10px;">MODERATION</div>${field('pro-mod-target','Player username','Player name')}${field('pro-timeout-minutes','Timeout minutes','10','number')}<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px;">${button('pro-timeout','Timeout','#b45309')}${button('pro-ban','Ban','#b91c1c')}${button('pro-unban','Unban','#475569')}</div><p id="pro-mod-status" style="color:#94a3b8;font-size:11px;min-height:16px;margin:9px 0 0;">Moderation actions broadcast to connected players.</p></section><section style="background:#111827;border:1px solid #263449;border-radius:12px;padding:14px;"><div style="color:#fcd34d;font-size:12px;font-weight:800;margin-bottom:10px;">REWARD CENTER</div>${field('pro-target','Player username','yuh')}${field('pro-coins','Coin amount','100','number')}<button id="pro-grant-coins" style="${button('unused','Grant coins','#d97706').replace('id=\"unused\"','')}">Grant coins</button><select id="pro-secret" style="${inputStyle};margin-top:8px"><option value="double-jump">Double jump</option><option value="coin-magnet">Coin magnet</option><option value="shadow-mode">Shadow mode</option><option value="rainbow-trail">Rainbow trail</option><option value="speed-burst">Speed burst</option></select><button id="pro-grant-secret" style="${button('unused2','Grant selected secret','#7c3aed').replace('id=\"unused2\"','')}">Grant secret</button><p id="pro-reward-status" style="color:#64748b;font-size:12px;min-height:16px;"></p></section><section style="background:#111827;border:1px solid #263449;border-radius:12px;padding:14px;"><div style="color:#a5b4fc;font-size:12px;font-weight:800;margin-bottom:10px;">PLAYER DIRECTORY</div><button id="pro-refresh-users" style="border:0;border-radius:8px;padding:9px 12px;background:#334155;color:#fff;font:700 12px Arial;cursor:pointer;">Refresh list</button><div id="pro-users" style="color:#94a3b8;font-size:12px;margin-top:10px;">Loading player directory...</div></section></div>`;
      if (tab === 'broadcasts') content.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;"><section style="background:linear-gradient(145deg,#172033,#0f172a);border:1px solid #263449;border-radius:12px;padding:14px;"><div style="color:#67e8f9;font-size:12px;font-weight:800;margin-bottom:10px;">LIVE SCREEN BROADCAST</div><p style="color:#94a3b8;font-size:11px;line-height:1.5;margin:0 0 10px;">Share your screen to every online player. Players receive a live viewer automatically.</p><button id="pro-start-share" style="width:100%;border:0;border-radius:8px;padding:10px;background:#0891b2;color:#fff;font:700 12px Arial;cursor:pointer;">Start screen sharing</button><button id="pro-stop-share" style="width:100%;margin-top:8px;border:0;border-radius:8px;padding:9px;background:#374151;color:#fff;font:700 12px Arial;cursor:pointer;">Stop broadcast</button><p id="pro-share-status" style="color:#64748b;font-size:11px;min-height:16px;margin:10px 0 0;">Ready to broadcast.</p></section><section style="background:#111827;border:1px solid #263449;border-radius:12px;padding:14px;"><div style="color:#fcd34d;font-size:12px;font-weight:800;margin-bottom:10px;">SHARED MEDIA</div>${field('pro-youtube','YouTube URL','https://youtu.be/...')}${button('pro-play','Play for active players','#b45309')}<button id="pro-stop" style="display:block;margin-top:8px;width:100%;border:0;border-radius:8px;padding:9px;background:#374151;color:#fff;font:700 12px Arial;cursor:pointer;">Stop shared media</button><p style="font-size:11px;color:#64748b;line-height:1.4;">Video and audio follow the browser autoplay policy. Players may need one click first.</p></section><section style="background:linear-gradient(145deg,#24113b,#111827);border:1px solid #7c3aed;border-radius:12px;padding:14px;"><div style="color:#f0abfc;font-size:12px;font-weight:800;margin-bottom:10px;">SECRET PACK VISIBILITY</div><p style="color:#cbd5e1;font-size:11px;line-height:1.5;margin:0 0 9px;">Reveal or hide the Secret Pack in the shop for active players. This change is broadcast live.</p>${button('pro-secret-pack-toggle', localStorage.getItem('stickman-secret-packs-visible') === 'true' ? 'Hide secret packs' : 'Reveal secret packs', '#7c3aed')}<p id="pro-secret-pack-status" style="color:#94a3b8;font-size:11px;min-height:16px;margin:8px 0 12px;">${localStorage.getItem('stickman-secret-packs-visible') === 'true' ? 'Secret Pack is currently revealed on this device.' : 'Secret Pack is currently hidden on this device.'}</p><div style="color:#f0abfc;font-size:12px;font-weight:800;margin-bottom:10px;">ADMIN ABUSE PACKS</div><div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px;">${button('pro-pack-chaos','Chaos pack','#be123c')}${button('pro-pack-party','Party pack','#db2777')}${button('pro-pack-calm','Calm pack','#2563eb')}</div><div style="color:#f0abfc;font-size:12px;font-weight:800;margin-bottom:10px;">ADMIN ABUSE FX</div><p style="color:#a78bfa;font-size:11px;line-height:1.4;margin:0 0 10px;">Playful live effects for the community view.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;">${button('pro-fx-neon','Neon pulse','#7c3aed')}${button('pro-fx-shake','Screen shake','#be123c')}${button('pro-fx-confetti','Confetti burst','#db2777')}${button('pro-fx-edges','Neon edges','#0891b2')}${button('pro-fx-rainbow','Rainbow edges','#ec4899')}${button('pro-fx-reset','Reset effects','#374151')}</div><input id="pro-bg-music" placeholder="YouTube music URL" style="${inputStyle};margin-top:9px">${button('pro-bg-music-play','Play background music','#059669')}<div style="margin-top:10px;color:#c4b5fd;font-size:11px;font-weight:800;">SOUNDBOARD</div><input id="pro-custom-sound" type="file" accept="audio/*" style="${inputStyle};margin:7px 0;font-size:11px;"><p id="pro-sound-status" style="color:#94a3b8;font-size:10px;margin:0 0 7px;">Import an audio file to add it to the board.</p><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px;">${button('pro-sound-airhorn','Air horn','#7c3aed')}${button('pro-sound-pop','Pop','#2563eb')}${button('pro-sound-drum','Drum hit','#0891b2')}${button('pro-sound-chime','Chime','#0ea5e9')}${button('pro-sound-laser','Laser','#f97316')}${button('pro-sound-alarm','Alarm','#dc2626')}${button('pro-sound-custom','Play imported','#059669')}${button('pro-sound-stop','Stop sound','#374151')}</div><p id="pro-fx-status" style="color:#94a3b8;font-size:11px;min-height:16px;margin:9px 0 0;">No live effect active.</p></section><section style="background:#111827;border:1px solid #263449;border-radius:12px;padding:14px;"><div style="color:#c4b5fd;font-size:12px;font-weight:800;margin-bottom:10px;">THEME STUDIO</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px;">${['crimson','midnight','toxic','gold'].map((theme) => `<button class="pro-theme" data-theme="${theme}" style="padding:10px;border:1px solid #374151;border-radius:8px;background:#1f2937;color:#fff;cursor:pointer;font-weight:700;">${theme}</button>`).join('')}</div></section></div>`;
      if (tab === 'world') content.innerHTML = `<div style="display:grid;gap:12px;"><section style="background:#111827;border:1px solid #263449;border-radius:12px;padding:14px;"><div style="color:#67e8f9;font-size:12px;font-weight:800;margin-bottom:10px;">LIVE BACKGROUND STUDIO</div><p style="color:#64748b;font-size:11px;margin:0 0 10px;">Choose an animated background for every active player.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:7px;">${['aurora','neon-rain','volcano','cyber-grid','matrix'].map((bg) => `<button class="pro-background" data-background="${bg}" style="padding:10px 6px;border:1px solid #374151;border-radius:8px;background:#1f2937;color:#fff;cursor:pointer;font-size:11px;font-weight:700;">${bg}</button>`).join('')}</div><p id="pro-world-status" style="font-size:12px;color:#64748b;margin:12px 0 0;">No background selected.</p></section><section style="background:#111827;border:1px solid #263449;border-radius:12px;padding:14px;"><div style="color:#a5b4fc;font-size:12px;font-weight:800;margin-bottom:12px;">WORLD EVENTS</div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">${button('pro-event-rain','Start rain event','#2563eb')}${button('pro-event-gold','Start gold rush','#b45309')}${button('pro-event-speed','Double speed','#7c3aed')}${button('pro-event-calm','Return to normal','#334155')}</div></section></div>`;
      if (tab === 'tools') content.innerHTML = `<section style="background:#111827;border:1px solid #263449;border-radius:12px;padding:14px;"><div style="color:#a5b4fc;font-size:12px;font-weight:800;margin-bottom:12px;">ADMIN UTILITIES</div><div style="display:grid;gap:10px;">${button('pro-open-directory','Open account directory','#334155')}${button('pro-download-log','Copy session diagnostics','#334155')}${button('pro-close-panel','Close control center','#374151')}</div><p style="font-size:11px;color:#64748b;line-height:1.5;">All server actions remain moderator-protected. Never share your admin session token.</p></section>`;
      wireTab(tab);
    };
    const status = (text, tone = '#86efac') => { const el = document.getElementById('pro-status') || document.getElementById('pro-world-status'); if (el) { el.textContent = text; el.style.color = tone; } };
    const send = (message) => fetch('/api/account', { method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer ' + idToken}, body:JSON.stringify({action:'broadcast-message', message}) }).then(async (r) => { const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error || 'Action failed.'); status('Delivered to active players.'); showAdminMessage('Admin broadcast delivered.', '#86efac'); });
    const wireTab = (tab) => {
      const sendButton = document.getElementById('pro-send'); if (sendButton) sendButton.onclick = () => { const message = document.getElementById('pro-message').value.trim(); if (message) send(message).catch((e) => status(e.message, '#fca5a5')); };
  const codeButton = document.getElementById('pro-code-generate'); if (codeButton) codeButton.onclick = async () => { const code = `STICK-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`; const response = await fetch('/api/account', { method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer ' + idToken}, body:JSON.stringify({ action:'create-reward-code', code }) }); const data = await response.json().catch(() => ({})); if (!response.ok) return status(data.error || 'Could not create code.', '#fca5a5'); document.getElementById('pro-code-output').value = data.code; document.getElementById('pro-code-status').textContent = 'Code saved and ready to redeem.'; };
  ['chaos','party','calm'].forEach((pack) => { const el = document.getElementById('pro-pack-' + pack); if (el) el.onclick = () => send(`__ADMIN_PACK__:${pack}`).catch((e) => status(e.message, '#fca5a5')); });\n  const secretPackToggle = document.getElementById('pro-secret-pack-toggle'); if (secretPackToggle) secretPackToggle.onclick = async () => { const showing = localStorage.getItem('stickman-secret-packs-visible') === 'true'; const nextState = !showing; const prompt = nextState ? 'Reveal the Secret Pack in the shop for all active players? This broadcasts the change to open game sessions.' : 'Hide the Secret Pack from the shop for all active players? This broadcasts the change to open game sessions.'; if (!window.confirm(prompt)) return; secretPackToggle.disabled = true; try { await send(`__SECRET_PACKS__:${nextState ? 'show' : 'hide'}`); window.setSecretPacksVisible?.(nextState); secretPackToggle.textContent = nextState ? 'Hide secret packs' : 'Reveal secret packs'; const note = document.getElementById('pro-secret-pack-status'); if (note) note.textContent = nextState ? 'Secret Pack revealed to active players.' : 'Secret Pack hidden from active players.'; } catch (error) { status(error.message, '#fca5a5'); } finally { secretPackToggle.disabled = false; } };
  ['airhorn','pop','drum','chime','laser','alarm','stop'].forEach((sound) => { const el = document.getElementById('pro-sound-' + sound); if (el) el.onclick = () => send(`__SOUNDBOARD__:${sound}`).catch((e) => status(e.message, '#fca5a5')); });
  const customSound = document.getElementById('pro-custom-sound'); if (customSound) customSound.onchange = () => { const file = customSound.files?.[0]; if (!file || file.size > 700000) return status('Choose an audio file smaller than 700 KB.', '#fca5a5'); const reader = new FileReader(); reader.onload = () => { window.customSoundData = String(reader.result); document.getElementById('pro-sound-status').textContent = `${file.name} imported. Press play after saving it.`; }; reader.readAsDataURL(file); };
  const customPlay = document.getElementById('pro-sound-custom'); if (customPlay) customPlay.onclick = () => { if (!window.customSoundData) return status('Import an audio file first.', '#fca5a5'); const audio = new Audio(window.customSoundData); audio.play().catch(() => {}); send(`__SOUNDBOARD_DATA__:${window.customSoundData}`).catch((e) => status(e.message, '#fca5a5')); };
      ['welcome','alert'].forEach((kind) => { const el = document.getElementById('pro-' + kind); if (el) el.onclick = () => send(kind === 'welcome' ? 'Welcome to the Stickman arena.' : 'Moderator alert: please follow the server rules.').catch((e) => status(e.message, '#fca5a5')); });
  const moderation = (action) => { const target = document.getElementById('pro-mod-target').value.trim(); const minutes = Number(document.getElementById('pro-timeout-minutes').value) || 10; if (!target) return status('Enter a player username.', '#fca5a5'); send(`__MODERATION__:${action}:${target}:${minutes}`).then(() => { document.getElementById('pro-mod-status').textContent = `${action} sent for ${target}.`; }).catch((e) => status(e.message, '#fca5a5')); }; ['timeout','ban','unban'].forEach((action) => { const el = document.getElementById('pro-' + action); if (el) el.onclick = () => moderation(action); });
      const clear = document.getElementById('pro-clear'); if (clear) clear.onclick = () => showAdminMessage('Live banners cleared.');
      const deleteAllChat = document.getElementById('pro-delete-all-chat'); if (deleteAllChat) deleteAllChat.onclick = async () => { if (!window.confirm('Permanently delete every public chat message? This cannot be undone.')) return; deleteAllChat.disabled = true; try { const response = await fetch('/api/account', { method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer ' + idToken}, body:JSON.stringify({ action:'delete-all-chat-messages' }) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Could not delete chat messages.'); showAdminMessage(`Deleted ${data.deleted} public chat messages.`, '#86efac'); } catch (error) { showAdminMessage(error.message, '#fca5a5'); } finally { deleteAllChat.disabled = false; } };
      document.querySelectorAll('.pro-theme').forEach((el) => { el.onclick = () => applyAdminTheme(el.dataset.theme); });
      ['neon','shake','confetti','edges','rainbow','reset'].forEach((fx) => { const el = document.getElementById('pro-fx-' + fx); if (el) el.onclick = () => { document.body.dataset.adminFx = fx; if (fx === 'reset') delete document.body.dataset.adminFx; const target = document.getElementById('pro-fx-status'); if (target) target.textContent = fx === 'reset' ? 'Effects reset.' : `${fx} effect activated.`; send(`__ADMIN_FX__:${fx}`).catch(() => {}); }; });
      const fxMusic = document.getElementById('pro-bg-music-play'); if (fxMusic) fxMusic.onclick = () => { const value = document.getElementById('pro-bg-music').value.trim(); const match = value.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); if (!match) return showAdminMessage('Enter a valid YouTube music URL.', '#fca5a5'); playAdminYouTube(); showAdminMessage('Background music started.', '#86efac'); };
      const startShare = document.getElementById('pro-start-share'); if (startShare) startShare.onclick = startAdminScreenShare; const stopShare = document.getElementById('pro-stop-share'); if (stopShare) stopShare.onclick = stopAdminScreenShare; const play = document.getElementById('pro-play'); if (play) play.onclick = () => { const match = String(document.getElementById('pro-youtube').value).match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); if (!match) return showAdminMessage('Enter a valid YouTube URL.', '#fca5a5'); fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+idToken},body:JSON.stringify({action:'broadcast-media',youtubeId:match[1],mediaAction:'play'})}).then(() => { showAdminMessage('Shared video and audio started.', '#86efac'); }).catch(() => showAdminMessage('Could not start media.', '#fca5a5')); };
      const stop = document.getElementById('pro-stop'); if (stop) stop.onclick = () => fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+idToken},body:JSON.stringify({action:'broadcast-media',youtubeId:'stopped',mediaAction:'stop'})}).then(() => showAdminMessage('Shared media stopped.'));
      ['rain','gold','speed','calm'].forEach((event) => { const el = document.getElementById('pro-event-' + event); if (el) el.onclick = () => { document.body.dataset.worldEvent = event; const target = document.getElementById('pro-world-status'); if (target) target.textContent = event + ' event activated.'; showAdminMessage(event + ' event activated.'); }; });
      const rewardStatus = (text, tone = '#86efac') => { const el = document.getElementById('pro-reward-status'); if (el) { el.textContent = text; el.style.color = tone; } };
      const grant = (action, payload) => fetch('/api/account', { method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+idToken}, body:JSON.stringify({ action, ...payload }) }).then(async (r) => { const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error || 'Reward action failed.'); rewardStatus(action === 'grant-coins' ? `Balance updated: ${data.player.coins} coins.` : (data.granted ? 'Secret granted.' : 'Player already has that secret.')); });
      const grantCoinsButton = document.getElementById('pro-grant-coins'); if (grantCoinsButton) grantCoinsButton.onclick = () => grant('grant-coins', { targetUsername: document.getElementById('pro-target').value, amount: document.getElementById('pro-coins').value }).catch((e) => rewardStatus(e.message, '#fca5a5'));
      const grantSecretButton = document.getElementById('pro-grant-secret'); if (grantSecretButton) grantSecretButton.onclick = () => grant('grant-secret', { targetUsername: document.getElementById('pro-target').value, secretKey: document.getElementById('pro-secret').value }).catch((e) => rewardStatus(e.message, '#fca5a5'));
      document.querySelectorAll('.pro-background').forEach((el) => { el.onclick = () => fetch('/api/account', { method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+idToken}, body:JSON.stringify({ action:'set-background', background:el.dataset.background }) }).then(() => { applyWorldBackground(el.dataset.background); const target = document.getElementById('pro-world-status'); if (target) target.textContent = `${el.dataset.background} is now live for players.`; }).catch(() => showAdminMessage('Could not change background.', '#fca5a5')); });
      const resetTheme = document.getElementById('pro-reset-theme'); if (resetTheme) resetTheme.onclick = () => { applyAdminTheme('midnight'); applyWorldBackground('aurora'); showAdminMessage('World theme reset.'); };
      const diagnostics = document.getElementById('pro-download-log'); if (diagnostics) diagnostics.onclick = async () => { const report = `Stickman admin diagnostics\nrole=${currentRole}\nuser=${displayName(idToken)}\ntime=${new Date().toISOString()}`; try { await navigator.clipboard.writeText(report); showAdminMessage('Diagnostics copied to clipboard.', '#86efac'); } catch { showAdminMessage(report); } };
      const close = document.getElementById('pro-close-panel'); if (close) close.onclick = () => { document.getElementById('acct-modal').style.display = 'none'; };
      const directory = document.getElementById('pro-open-directory'); if (directory) directory.onclick = openAccountDirectory;
      const refresh = document.getElementById('pro-refresh-users'); if (refresh) refresh.onclick = async () => { const el = document.getElementById('pro-users'); try { const r = await fetch('/api/account',{headers:{Authorization:'Bearer '+idToken}}); const data = await r.json(); el.innerHTML = (data.users || []).map((u) => `<div style="display:flex;justify-content:space-between;border-top:1px solid #263449;padding:9px 0;"><span style="color:#fff;font-weight:700;">${escapeAdminText(u.username)}</span><span style="color:#fcd34d;">${Number(u.coins || 0).toLocaleString()} coins</span><span style="color:#64748b;">${new Date(u.created_at).toLocaleDateString()}</span></div>`).join('') || 'No players found.'; } catch (e) { el.textContent = e.message; } };
    };
    document.querySelectorAll('.admin-tab').forEach((tab) => { tab.onclick = () => { document.querySelectorAll('.admin-tab').forEach((item) => { item.style.background = '#111827'; item.style.borderColor = '#263449'; }); tab.style.background = '#312e81'; tab.style.borderColor = '#6366f1'; render(tab.dataset.tab); }; });
    render('command');
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
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:6px;">${['crimson','midnight','toxic','gold'].map((theme) => `<button class="admin-theme" data-theme="${theme}" style="padding:8px;border:1px solid #4b5563;border-radius:7px;background:#1f2937;color:#fff;cursor:pointer;">${theme}</button>`).join('')}</div>
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
const input = document.getElementById('admin-video-url') || document.getElementById('pro-bg-music');
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

function playSoundboardSound(sound) { const AudioCtx = window.AudioContext || window.webkitAudioContext; if (!AudioCtx) return; const ctx = new AudioCtx(); const now = ctx.currentTime; const notes = sound === 'airhorn' ? [180,240] : sound === 'drum' ? [90,55] : sound === 'chime' ? [660,880,1040] : sound === 'laser' ? [1200,420] : sound === 'alarm' ? [880,520,880,520] : [520,760]; if (sound === 'stop') { ctx.close(); return; } notes.forEach((frequency, index) => { const oscillator = ctx.createOscillator(); const gain = ctx.createGain(); oscillator.type = sound === 'airhorn' ? 'sawtooth' : 'square'; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.0001, now + index * .08); gain.gain.exponentialRampToValueAtTime(.18, now + index * .08 + .02); gain.gain.exponentialRampToValueAtTime(.0001, now + index * .08 + (sound === 'drum' ? .18 : .32)); oscillator.connect(gain).connect(ctx.destination); oscillator.start(now + index * .08); oscillator.stop(now + index * .08 + .35); }); }
  function applyAdminPack(pack) { document.body.dataset.adminPack = pack; showAdminMessage(`Admin abuse: ${pack} pack activated.`, '#f0abfc'); if (pack === 'chaos') document.body.dataset.adminFx = 'shake'; if (pack === 'party') document.body.dataset.adminFx = 'confetti'; if (pack === 'calm') document.body.dataset.adminFx = 'neon'; }
  async function pollBroadcastMessages() {
  try {
      const response = await fetch('/api/account?resource=messages', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      const newest = (data.messages || []).sort((a, b) => Number(a.id) - Number(b.id)).find((item) => Number(item.id) > lastMessageId);
      if (newest) { lastMessageId = Number(newest.id); const message = newest.message || ''; if (message.startsWith('__SOUNDBOARD__:')) playSoundboardSound(message.split(':')[1]); else if (message.startsWith('__ADMIN_FX__:')) document.body.dataset.adminFx = message.split(':')[1]; else if (message.startsWith('__ADMIN_PACK__:')) applyAdminPack(message.split(':')[1]); else showAdminMessage(message, '#fef08a'); }
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
    messageTimer = setInterval(() => { pollBroadcastMessages(); pollBroadcastMedia(); pollWorldBackground(); }, 3000);
    pollBroadcastMedia();
    pollWorldBackground();
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
    if (stored && isFresh(stored)) { let role = null; try { const session = await fetch('/api/account?resource=session', { headers:{ Authorization:'Bearer ' + stored }, cache:'no-store' }); if (session.ok) role = (await session.json()).role; } catch {} await onToken(stored, role); }
    else localStorage.removeItem(TOKEN_KEY);
  }

  window.addEventListener('load', init);
})();
