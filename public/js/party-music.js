import { db, doc, setDoc, onSnapshot, serverTimestamp } from './firebase-config.js';

const VOLUME_KEY_PREFIX = 'swrp-music-vol:';

let ytApiPromise = null;

export function parseYouTubeVideoId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith('http')) {
      const url = new URL(trimmed);
      if (url.hostname.includes('youtu.be')) {
        const id = url.pathname.replace(/^\//, '').split('/')[0];
        return id || null;
      }
      if (url.hostname.includes('youtube.com') || url.hostname.includes('youtube-nocookie.com')) {
        const v = url.searchParams.get('v');
        if (v) return v;
        const embed = url.pathname.match(/\/embed\/([^/?]+)/);
        if (embed) return embed[1];
        const shorts = url.pathname.match(/\/shorts\/([^/?]+)/);
        if (shorts) return shorts[1];
      }
    }
  } catch {
    /* not a URL */
  }
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  return null;
}

function loadYouTubeIframeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return ytApiPromise;
}

function getLocalVolume(partyId) {
  const raw = localStorage.getItem(VOLUME_KEY_PREFIX + partyId);
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 60;
}

function setLocalVolume(partyId, vol) {
  localStorage.setItem(VOLUME_KEY_PREFIX + partyId, String(vol));
}

async function fetchYouTubeTitle(videoId) {
  try {
    const res = await fetch(
      `https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`
    );
    const data = await res.json();
    return data.title || null;
  } catch {
    return null;
  }
}

/**
 * Sincroniza música ambiental de partida vía Firestore `state/music`.
 * GM: panel para URL y detener. Todos: mini-reproductor flotante (play/pause + volumen local).
 */
export function initPartyMusic({ partyId, isGM, panel = {}, playerMount = '#swrp-music-player-mount' } = {}) {
  const panelRoot = panel.root ? document.querySelector(panel.root) : null;
  const urlInput = panel.urlInput ? document.querySelector(panel.urlInput) : null;
  const applyBtn = panel.applyBtn ? document.querySelector(panel.applyBtn) : null;
  const stopBtn = panel.stopBtn ? document.querySelector(panel.stopBtn) : null;
  const statusEl = panel.status ? document.querySelector(panel.status) : null;

  panelRoot?.classList.toggle('d-none', !isGM);

  let remoteState = { videoId: null, title: '', playing: false };
  let localPaused = false;
  let needsUserGesture = false;
  let ytPlayer = null;
  let ytPlayerVideoId = null;
  let playerHost = null;
  let miniPlayer = null;
  let miniPlayBtn = null;
  let miniVolInput = null;
  let miniUnmuteBtn = null;
  let miniTitleEl = null;
  let miniProgressFill = null;
  let miniProgressTime = null;
  let progressTimer = null;

  let hostWrap = document.getElementById('swrp-yt-player-host');
  if (!hostWrap) {
    hostWrap = document.createElement('div');
    hostWrap.id = 'swrp-yt-player-host';
    hostWrap.className = 'swrp-yt-player-host';
    hostWrap.setAttribute('aria-hidden', 'true');
    document.body.appendChild(hostWrap);
  }

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || '';
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function stopProgressTick() {
    if (progressTimer) {
      window.clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  function updateProgressBar() {
    if (!miniProgressFill || !miniProgressTime || !ytPlayer?.getDuration) return;
    const duration = ytPlayer.getDuration() || 0;
    const current = ytPlayer.getCurrentTime() || 0;
    const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
    miniProgressFill.style.width = `${pct}%`;
    miniProgressTime.textContent = duration > 0
      ? `${formatTime(current)} / ${formatTime(duration)}`
      : '0:00';
  }

  function startProgressTick() {
    stopProgressTick();
    updateProgressBar();
    progressTimer = window.setInterval(updateProgressBar, 500);
  }

  function effectivePlaying() {
    return !!remoteState.videoId && remoteState.playing && !localPaused;
  }

  function updateMiniPlayerUi() {
    if (!miniPlayer) return;
    const active = !!remoteState.videoId;
    miniPlayer.classList.toggle('d-none', !active);
    if (!active) return;

    const title = remoteState.title || 'YouTube';
    miniTitleEl.textContent = title;
    miniTitleEl.title = title;
    miniVolInput.value = String(getLocalVolume(partyId));

    const showPlay = isGM ? !remoteState.playing : (localPaused || !remoteState.playing);
    miniPlayBtn.textContent = showPlay ? '▶' : '⏸';
    miniPlayBtn.setAttribute('aria-label', showPlay ? 'Reproducir' : 'Pausar');
    miniUnmuteBtn.classList.toggle('d-none', !needsUserGesture);
    if (effectivePlaying()) startProgressTick();
    else {
      stopProgressTick();
      updateProgressBar();
    }
  }

  function destroyPlayer() {
    if (ytPlayer?.destroy) {
      try {
        ytPlayer.destroy();
      } catch {
        /* ignore */
      }
    }
    ytPlayer = null;
    ytPlayerVideoId = null;
    if (playerHost) {
      playerHost.remove();
      playerHost = null;
    }
  }

  async function ensurePlayer(videoId) {
    await loadYouTubeIframeApi();
    if (ytPlayer && ytPlayerVideoId === videoId) return;
    destroyPlayer();
    ytPlayerVideoId = videoId;
    playerHost = document.createElement('div');
    hostWrap.appendChild(playerHost);
    await new Promise((resolve) => {
      ytPlayer = new window.YT.Player(playerHost, {
        height: '1',
        width: '1',
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: window.location.origin
        },
        events: {
          onReady: () => resolve(),
          onStateChange: (ev) => {
            if (ev.data === window.YT.PlayerState.ENDED && effectivePlaying()) {
              ev.target.seekTo(0);
              ev.target.playVideo();
            }
            if (ev.data === window.YT.PlayerState.PLAYING) {
              needsUserGesture = false;
              updateMiniPlayerUi();
              startProgressTick();
            }
            if (ev.data === window.YT.PlayerState.PAUSED || ev.data === window.YT.PlayerState.ENDED) {
              stopProgressTick();
              updateProgressBar();
            }
          }
        }
      });
    });
  }

  async function applyPlayback() {
    if (!remoteState.videoId) {
      destroyPlayer();
      needsUserGesture = false;
      stopProgressTick();
      updateMiniPlayerUi();
      return;
    }
    await ensurePlayer(remoteState.videoId);
    if (!ytPlayer?.setVolume) return;
    ytPlayer.setVolume(getLocalVolume(partyId));
    if (effectivePlaying()) {
      try {
        ytPlayer.playVideo();
        window.setTimeout(() => {
          const state = ytPlayer?.getPlayerState?.();
          if (state !== window.YT.PlayerState.PLAYING && state !== window.YT.PlayerState.BUFFERING) {
            needsUserGesture = true;
            updateMiniPlayerUi();
          }
        }, 800);
      } catch {
        needsUserGesture = true;
      }
    } else {
      ytPlayer.pauseVideo();
      needsUserGesture = false;
    }
    updateMiniPlayerUi();
  }

  function ensureMiniPlayer() {
    if (miniPlayer) return;
    const mountEl = playerMount ? document.querySelector(playerMount) : null;
    miniPlayer = document.createElement('div');
    miniPlayer.className = 'swrp-music-player d-none';
    miniPlayer.innerHTML = `
      <div class="swrp-music-player__inner">
        <div class="swrp-music-player__row">
          <button type="button" class="swrp-music-player__play btn btn-sm btn-swrp btn-swrp-ghost" aria-label="Reproducir">▶</button>
          <p class="swrp-music-player__title"></p>
          <label class="swrp-music-player__vol-wrap">
            <span class="swrp-music-player__vol-label">Volumen</span>
            <input type="range" class="swrp-music-player__vol" min="0" max="100" step="1" aria-label="Volumen">
          </label>
          <button type="button" class="swrp-music-player__unmute btn btn-sm btn-swrp btn-swrp-primary d-none">Activar sonido</button>
        </div>
        <div class="swrp-music-player__progress-row">
          <div class="swrp-music-player__progress-track" aria-hidden="true">
            <div class="swrp-music-player__progress-fill"></div>
          </div>
          <span class="swrp-music-player__time">0:00</span>
        </div>
      </div>
    `;
    (mountEl || document.body).appendChild(miniPlayer);

    miniPlayBtn = miniPlayer.querySelector('.swrp-music-player__play');
    miniVolInput = miniPlayer.querySelector('.swrp-music-player__vol');
    miniUnmuteBtn = miniPlayer.querySelector('.swrp-music-player__unmute');
    miniTitleEl = miniPlayer.querySelector('.swrp-music-player__title');
    miniProgressFill = miniPlayer.querySelector('.swrp-music-player__progress-fill');
    miniProgressTime = miniPlayer.querySelector('.swrp-music-player__time');

    miniPlayBtn.addEventListener('click', async () => {
      if (isGM) {
        await writeMusicState({ playing: !remoteState.playing });
        if (remoteState.playing) localPaused = false;
        return;
      }
      localPaused = !localPaused;
      await applyPlayback();
    });

    miniVolInput.addEventListener('input', () => {
      const vol = Number(miniVolInput.value);
      setLocalVolume(partyId, vol);
      ytPlayer?.setVolume?.(vol);
    });

    miniUnmuteBtn.addEventListener('click', async () => {
      localPaused = false;
      needsUserGesture = false;
      await applyPlayback();
    });
  }

  async function writeMusicState(patch) {
    const ref = doc(db, 'parties', partyId, 'state', 'music');
    await setDoc(ref, { ...patch, updatedAt: serverTimestamp() }, { merge: true });
    remoteState = { ...remoteState, ...patch };
    if (patch.playing) localPaused = false;
    if (patch.videoId === null) localPaused = false;
    await applyPlayback();
    if (isGM) syncGmStatus();
  }

  function syncGmStatus() {
    if (!isGM || !remoteState.videoId) {
      if (!remoteState.videoId) setStatus('');
      return;
    }
    const label = remoteState.title || 'YouTube';
    setStatus(remoteState.playing ? `Reproduciendo: ${label}` : `Pausado: ${label}`);
  }

  applyBtn?.addEventListener('click', async () => {
    const videoId = parseYouTubeVideoId(urlInput?.value || '');
    if (!videoId) {
      setStatus('URL de YouTube no válida.');
      return;
    }
    setStatus('Cargando…');
    const title = await fetchYouTubeTitle(videoId);
    if (urlInput) urlInput.value = `https://www.youtube.com/watch?v=${videoId}`;
    await writeMusicState({ videoId, title: title || '', playing: true });
  });

  stopBtn?.addEventListener('click', async () => {
    await writeMusicState({ videoId: null, title: '', playing: false });
    if (urlInput) urlInput.value = '';
    setStatus('');
  });

  ensureMiniPlayer();

  const unsub = onSnapshot(doc(db, 'parties', partyId, 'state', 'music'), async (snap) => {
    const data = snap.exists() ? snap.data() : {};
    const nextVideoId = data.videoId || null;
    const next = {
      videoId: nextVideoId,
      title: data.title || '',
      playing: !!nextVideoId && data.playing !== false
    };
    const videoChanged = next.videoId !== remoteState.videoId;
    remoteState = next;
    if (videoChanged) localPaused = false;
    if (urlInput && isGM && next.videoId) {
      urlInput.value = `https://www.youtube.com/watch?v=${next.videoId}`;
    }
    syncGmStatus();
    await applyPlayback();
  });

  return () => {
    unsub();
    stopProgressTick();
    miniPlayer?.remove();
    miniPlayer = null;
    destroyPlayer();
  };
}
