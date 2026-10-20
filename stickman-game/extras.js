// extras.js: settings menu, home menu music, and low performance mode.
// Loaded after the game script and before cloud.js (see index.html).
(function () {
  const KEYS = { sound: 'stickman_sound', music: 'stickman_music', lowPerf: 'stickman_lowperf' };
  let soundOn = localStorage.getItem(KEYS.sound) !== 'off';
  let musicOn = localStorage.getItem(KEYS.music) !== 'off';
  window.lowPerf = localStorage.getItem(KEYS.lowPerf) === 'on';
  document.documentElement.classList.toggle('low-perf', window.lowPerf);

  // Sound effects: mute by wrapping the game's sound function
  const rawPlay = window.playSound;
  window.playSound = function () {
    if (soundOn) return rawPlay.apply(this, arguments);
  };

  // ----- home menu music -----
  // The built-in track is generated here (original notes, no copied audio).
  // You can also play your own audio file for this visit.
  let audioCtx = null, master = null, loopTimer = null, customAudio = null;
  const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am, F, C, G
  const midiToHz = m => 440 * Math.pow(2, (m - 69) / 12);

  function tone(freq, start, dur, type, gain) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(master);
    o.start(start); o.stop(start + dur + 0.05);
  }

  function scheduleBar(t0) {
    const beat = 0.5; // 120 bpm, so one 4-chord loop lasts 8 seconds
    CHORDS.forEach((ch, i) => {
      const t = t0 + i * 4 * beat;
      tone(midiToHz(ch[0] - 12), t, 4 * beat * 0.95, 'sine', 0.22);            // bass
      for (let k = 0; k < 8; k++) {                                              // arpeggio
        tone(midiToHz(ch[k % 3] + 12), t + k * beat / 2, beat * 0.45, 'triangle', 0.07);
      }
    });
  }

  function startGenerated() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      master = audioCtx.createGain();
      master.gain.value = 0.35;
      master.connect(audioCtx.destination);
    }
    audioCtx.resume();
    scheduleBar(audioCtx.currentTime + 0.1);
    clearInterval(loopTimer);
    loopTimer = setInterval(() => scheduleBar(audioCtx.currentTime + 0.1), 8000);
  }

  function stopGenerated() {
    clearInterval(loopTimer);
    loopTimer = null;
    if (audioCtx) audioCtx.suspend();
  }

  function playMusic() {
    if (!musicOn) return;
    if (customAudio) { customAudio.play().catch(() => {}); return; }
    startGenerated();
  }

  function pauseMusic() {
    stopGenerated();
    if (customAudio) customAudio.pause();
  }

  // Browsers only allow audio after a click or tap, so start on the first one
  function firstGesture() {
    playMusic();
  }
  document.addEventListener('pointerdown', firstGesture, { once: true });

  // ----- settings UI -----
  const btn = document.createElement('button');
  btn.id = 'settings-btn';
  btn.textContent = '⚙️ Settings';
  btn.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:60;background:#1f2937;color:#e5e7eb;border:1px solid #374151;border-radius:10px;padding:8px 12px;font:700 12px Arial,sans-serif;cursor:pointer;';
  document.body.appendChild(btn);

  const row = (label, id, checked) => `
    <label style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;">
      <span>${label}</span>
      <input id="${id}" type="checkbox" ${checked ? 'checked' : ''} style="width:18px;height:18px;">
    </label>`;

  const modal = document.createElement('div');
  modal.id = 'settings-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#111827;color:#e5e7eb;border-radius:14px;padding:20px;width:100%;max-width:360px;font:14px Arial,sans-serif;">
      <h3 style="margin:0 0 8px;font-size:18px;color:#fff;">Settings</h3>
      ${row('Sound effects', 'sound-toggle', soundOn)}
      ${row('Home menu music', 'music-toggle', musicOn)}
      <div style="padding:8px 0;border-top:1px solid #1f2937;margin-top:6px;">
        <div style="font-size:12px;color:#9ca3af;margin-bottom:6px;">Play your own music (this visit only)</div>
        <input id="music-file" type="file" accept="audio/*" style="font-size:12px;width:100%;">
        <button id="music-reset" style="margin-top:6px;background:none;border:0;color:#a5b4fc;font:600 12px Arial,sans-serif;cursor:pointer;padding:0;">Use the built-in track</button>
      </div>
      <div style="border-top:1px solid #1f2937;margin-top:6px;padding-top:6px;">
        ${row('Low performance mode', 'lowperf-toggle', window.lowPerf)}
        <p style="font-size:11px;color:#9ca3af;margin:0 0 4px;">Turns off blur, animations, particles, and screen shake. Use this if the game feels slow.</p>
      </div>
      <button id="settings-close" style="width:100%;margin-top:14px;padding:8px;border:0;border-radius:8px;background:#1f2937;color:#9ca3af;cursor:pointer;font:600 12px Arial,sans-serif;">Close</button>
    </div>`;
  document.body.appendChild(modal);

  btn.onclick = () => { modal.style.display = 'flex'; };
  document.getElementById('settings-close').onclick = () => { modal.style.display = 'none'; };
  modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

  document.getElementById('sound-toggle').onchange = e => {
    soundOn = e.target.checked;
    localStorage.setItem(KEYS.sound, soundOn ? 'on' : 'off');
  };

  document.getElementById('music-toggle').onchange = e => {
    musicOn = e.target.checked;
    localStorage.setItem(KEYS.music, musicOn ? 'on' : 'off');
    if (musicOn) playMusic(); else pauseMusic();
  };

  document.getElementById('music-file').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    if (customAudio) customAudio.pause();
    stopGenerated();
    customAudio = new Audio(URL.createObjectURL(file));
    customAudio.loop = true;
    customAudio.volume = 0.5;
    if (musicOn) playMusic();
  };

  document.getElementById('music-reset').onclick = () => {
    if (customAudio) { customAudio.pause(); customAudio = null; }
    document.getElementById('music-file').value = '';
    if (musicOn) playMusic();
  };

  document.getElementById('lowperf-toggle').onchange = e => {
    window.lowPerf = e.target.checked;
    localStorage.setItem(KEYS.lowPerf, window.lowPerf ? 'on' : 'off');
    document.documentElement.classList.toggle('low-perf', window.lowPerf);
  };
})();
