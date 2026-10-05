const PANE_ID = 'youtube-side-player';
const STATE_FILE_PATH = '/tmp/claude-yt-mod-state.json';
const DEFAULT_COLOR = 0x01000000;

const CURATED_VIDEOS = [
  {
    id: 'jfKfPfyJRdk',
    title: 'lofi hip hop radio - beats to relax/study to',
    author: 'Lofi Girl',
    category: 'Focus & Beats'
  },
  {
    id: 'zjkBMFhNj_g',
    title: 'Intro to Large Language Models (1hr Talk)',
    author: 'Andrej Karpathy',
    category: 'AI & Systems'
  },
  {
    id: 'aircAruvnKk',
    title: 'But what is a neural network? | Deep learning Ch. 1',
    author: '3Blue1Brown',
    category: 'Math & ML'
  },
  {
    id: '4b4MUYve_U8',
    title: 'Synthwave Radio - chill synth / retro beats to code to',
    author: 'Lofi Girl Synthwave',
    category: 'Focus & Beats'
  },
  {
    id: 'kCc8FmEb1nY',
    title: 'Let’s build GPT: from scratch, in code, spelled out',
    author: 'Andrej Karpathy',
    category: 'AI & Systems'
  },
  {
    id: 'r6sGWTCMz2k',
    title: 'But what is a Fourier series? From heat flow to circles',
    author: '3Blue1Brown',
    category: 'Math & ML'
  }
];

const POSITION_PRESETS = [
  { key: 'top-left', short: 'TL', arrow: '↖', label: 'Top-Left', hotkey: 'q', row: 0, col: 0 },
  { key: 'top-center', short: 'TC', arrow: '↑', label: 'Top-Center', hotkey: 'w', row: 0, col: 1 },
  { key: 'top-right', short: 'TR', arrow: '↗', label: 'Top-Right', hotkey: 'e', row: 0, col: 2 },
  { key: 'left-side', short: 'L', arrow: '←', label: 'Left-Side', hotkey: 'a', row: 1, col: 0 },
  { key: 'center', short: 'C', arrow: '·', label: 'Center', hotkey: 's', row: 1, col: 1 },
  { key: 'right-side', short: 'R', arrow: '→', label: 'Right-Side', hotkey: 'd', row: 1, col: 2 },
  { key: 'bottom-left', short: 'BL', arrow: '↙', label: 'Bottom-Left', hotkey: 'z', row: 2, col: 0 },
  { key: 'bottom-center', short: 'BC', arrow: '↓', label: 'Bottom-Center', hotkey: 'x', row: 2, col: 1 },
  { key: 'bottom-right', short: 'BR', arrow: '↘', label: 'Bottom-Right', hotkey: 'c', row: 2, col: 2 }
];

let activeTab = 'player';
let currentVideo = {
  id: CURATED_VIDEOS[0].id,
  title: CURATED_VIDEOS[0].title,
  author: CURATED_VIDEOS[0].author
};
let screenPosition = 'top-right';
let customCoords = '';
let sizePreset = 'medium';
let opacity = 0.96;
let uiPlacement = 'both'; // 'pane' | 'band' | 'both' | 'spinner'
let paneColumns = 58;
let isPlaying = false;
let isMuted = false;
let playlist = CURATED_VIDEOS.slice();
let searchResults = [];
let videoNotes = [];
let aiSummary = '';
let pluginRootPath = '';
let isUiHidden = false;
let hasActiveVideo = false; // a video is loaded (playing or paused) until stopped
// Inline (in-pane) playback: decided per session from the terminal
const INLINE_FRAME = { width: 960, height: 540, fps: 24, file: '/tmp/claude-yt-inline-frame.rgb' };
const INLINE_IMAGE_KEY = 'inline-video';
const INLINE_CACHE_DIR = '/tmp/claude-yt-inline-cache';
let modePreference = 'auto'; // 'auto' | 'inline' | 'window'
let playbackMode = 'window'; // 'inline' | 'window'
let terminalInfo = { canInline: false, terminal: 'unknown', reason: 'not detected yet' };
let inlineSession = null;
let inlineOffset = 0;
let depsDir = ''; // where bin/install-deps.sh puts yt-dlp and ffmpeg
let depsInstall = null; // the install in flight, if any
let toolPaths = { 'yt-dlp': 'yt-dlp', ffmpeg: 'ffmpeg' };
let lastSurface = null;
const DEPS_UPDATE_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

export function extractYouTubeId(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) {
    return raw;
  }
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host.includes('youtu.be')) {
      const id = url.pathname.replace(/^\/+/, '').slice(0, 11);
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v.slice(0, 11))) {
        return v.slice(0, 11);
      }
      const parts = url.pathname.split('/').filter(Boolean);
      const markerIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'live' || p === 'v');
      if (markerIdx !== -1 && parts[markerIdx + 1]) {
        const candidate = parts[markerIdx + 1].slice(0, 11);
        if (/^[A-Za-z0-9_-]{11}$/.test(candidate)) return candidate;
      }
    }
  } catch {
    // Not a full URL; check for inline v= or youtu.be/ pattern
  }
  const match = raw.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

export function normalizePosition(raw) {
  const cleaned = String(raw || '').trim().toLowerCase();
  if (!cleaned) return 'top-right';
  const map = {
    tr: 'top-right',
    'top-right': 'top-right',
    topright: 'top-right',
    tl: 'top-left',
    'top-left': 'top-left',
    topleft: 'top-left',
    br: 'bottom-right',
    'bottom-right': 'bottom-right',
    bottomright: 'bottom-right',
    bl: 'bottom-left',
    'bottom-left': 'bottom-left',
    bottomleft: 'bottom-left',
    r: 'right-side',
    right: 'right-side',
    'right-side': 'right-side',
    'dock-right': 'right-side',
    l: 'left-side',
    left: 'left-side',
    'left-side': 'left-side',
    'dock-left': 'left-side',
    tc: 'top-center',
    top: 'top-center',
    'top-center': 'top-center',
    bc: 'bottom-center',
    bottom: 'bottom-center',
    'bottom-center': 'bottom-center',
    c: 'center',
    center: 'center'
  };
  if (map[cleaned]) return map[cleaned];
  if (/^\d+\s*,\s*\d+/.test(cleaned)) {
    return 'custom';
  }
  return cleaned;
}

function packRasterCells(rows) {
  const numbers = rows.flat().flatMap(([ch, fg, bg]) => [
    ch.codePointAt(0),
    fg ?? DEFAULT_COLOR,
    bg ?? DEFAULT_COLOR
  ]);
  return new Uint8Array(Uint32Array.from(numbers).buffer).toBase64();
}

function buildScreenRadarRaster(pos, playing) {
  const cols = 19;
  const rowsCount = 5;
  const activePos = normalizePosition(pos);
  const grid = [];

  let targetRow = 0;
  let targetColStart = 13;
  let targetRowEnd = 1;

  if (activePos === 'top-left') {
    targetRow = 0;
    targetRowEnd = 1;
    targetColStart = 1;
  } else if (activePos === 'top-center') {
    targetRow = 0;
    targetRowEnd = 1;
    targetColStart = 7;
  } else if (activePos === 'top-right') {
    targetRow = 0;
    targetRowEnd = 1;
    targetColStart = 13;
  } else if (activePos === 'left-side') {
    targetRow = 1;
    targetRowEnd = 3;
    targetColStart = 1;
  } else if (activePos === 'center' || activePos === 'custom') {
    targetRow = 1;
    targetRowEnd = 3;
    targetColStart = 7;
  } else if (activePos === 'right-side') {
    targetRow = 1;
    targetRowEnd = 3;
    targetColStart = 13;
  } else if (activePos === 'bottom-left') {
    targetRow = 3;
    targetRowEnd = 4;
    targetColStart = 1;
  } else if (activePos === 'bottom-center') {
    targetRow = 3;
    targetRowEnd = 4;
    targetColStart = 7;
  } else if (activePos === 'bottom-right') {
    targetRow = 3;
    targetRowEnd = 4;
    targetColStart = 13;
  }

  const activeColor = playing ? 0xe53935 : 0x29b6f6;
  const frameColor = 0x546e7a;

  for (let r = 0; r < rowsCount; r += 1) {
    const rowCells = [];
    for (let c = 0; c < cols; c += 1) {
      const inTarget =
        r >= targetRow &&
        r <= targetRowEnd &&
        c >= targetColStart &&
        c <= targetColStart + 4;
      if (inTarget) {
        const ch = c === targetColStart + 2 && r === targetRow ? '▶' : '█';
        rowCells.push([ch, 0xffffff, activeColor]);
      } else if (c === 0 || c === cols - 1 || r === 0 || r === rowsCount - 1) {
        rowCells.push(['·', frameColor, DEFAULT_COLOR]);
      } else {
        rowCells.push([' ', DEFAULT_COLOR, DEFAULT_COLOR]);
      }
    }
    grid.push(rowCells);
  }
  return { columns: cols, rows: rowsCount, cells: packRasterCells(grid) };
}

function buildDesktopPositionSvg(pos, playing) {
  const activePos = normalizePosition(pos);
  const coords = {
    'top-left': { x: 8, y: 6, w: 38, h: 20 },
    'top-center': { x: 51, y: 6, w: 38, h: 20 },
    'top-right': { x: 94, y: 6, w: 38, h: 20 },
    'left-side': { x: 8, y: 14, w: 34, h: 44 },
    center: { x: 51, y: 24, w: 38, h: 24 },
    custom: { x: 51, y: 24, w: 38, h: 24 },
    'right-side': { x: 98, y: 14, w: 34, h: 44 },
    'bottom-left': { x: 8, y: 46, w: 38, h: 20 },
    'bottom-center': { x: 51, y: 46, w: 38, h: 20 },
    'bottom-right': { x: 94, y: 46, w: 38, h: 20 }
  };
  const box = coords[activePos] || coords['top-right'];
  const fill = playing ? '#e53935' : '#29b6f6';
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 72">' +
    '<rect x="2" y="2" width="136" height="68" rx="6" fill="#111827" stroke="#374151" stroke-width="1.5"/>' +
    '<rect x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" rx="3" fill="' + fill + '"/>' +
    '<polygon points="' + (box.x + 15) + ',' + (box.y + 5) + ' ' + (box.x + 15) + ',' + (box.y + box.h - 5) + ' ' + (box.x + 25) + ',' + (box.y + box.h / 2) + '" fill="#ffffff"/>' +
    '</svg>'
  );
}

async function persistSettings($) {
  await $.store.set('currentVideo', currentVideo);
  await $.store.set('screenPosition', screenPosition);
  await $.store.set('customCoords', customCoords);
  await $.store.set('sizePreset', sizePreset);
  await $.store.set('opacity', opacity);
  await $.store.set('uiPlacement', uiPlacement);
  await $.store.set('paneColumns', paneColumns);
  await $.store.set('playlist', playlist);
  await $.store.set('videoNotes', videoNotes);
}

async function loadSavedSettings($) {
  const savedVideo = await $.store.get('currentVideo');
  if (savedVideo && typeof savedVideo === 'object' && savedVideo.id) {
    currentVideo = savedVideo;
  }
  const savedPos = await $.store.get('screenPosition');
  if (typeof savedPos === 'string' && savedPos) {
    screenPosition = savedPos;
  }
  const savedCustom = await $.store.get('customCoords');
  if (typeof savedCustom === 'string') {
    customCoords = savedCustom;
  }
  const savedSize = await $.store.get('sizePreset');
  if (typeof savedSize === 'string' && savedSize) {
    sizePreset = savedSize;
  }
  const savedOpacity = await $.store.get('opacity');
  if (typeof savedOpacity === 'number') {
    opacity = savedOpacity;
  }
  const savedPlacement = await $.store.get('uiPlacement');
  if (typeof savedPlacement === 'string' && savedPlacement) {
    uiPlacement = savedPlacement;
  }
  const savedCols = await $.store.get('paneColumns');
  if (typeof savedCols === 'number') {
    paneColumns = savedCols;
  }
  const savedPlaylist = await $.store.get('playlist');
  if (Array.isArray(savedPlaylist) && savedPlaylist.length > 0) {
    playlist = savedPlaylist;
  }
  const savedNotes = await $.store.get('videoNotes');
  if (Array.isArray(savedNotes)) {
    videoNotes = savedNotes;
  }
  const savedMode = await $.store.get('modePreference');
  if (savedMode === 'auto' || savedMode === 'inline' || savedMode === 'window') {
    modePreference = savedMode;
  }
}

async function resolveVideoMetadata($, videoId, fallbackTitle) {
  const oembedUrl =
    'https://www.youtube.com/oembed?url=' +
    encodeURIComponent('https://www.youtube.com/watch?v=' + videoId) +
    '&format=json';
  try {
    const res = await $.http.fetch(oembedUrl);
    if (res && res.ok && res.text) {
      const data = JSON.parse(res.text);
      return {
        id: videoId,
        title: data.title || fallbackTitle || 'YouTube Video (' + videoId + ')',
        author: data.author_name || 'YouTube'
      };
    }
  } catch {
    // Fall back to curated or default title when offline or in tests
  }
  const curated = CURATED_VIDEOS.find((v) => v.id === videoId);
  if (curated) {
    return { id: curated.id, title: curated.title, author: curated.author };
  }
  return {
    id: videoId,
    title: fallbackTitle || 'YouTube Video (' + videoId + ')',
    author: 'YouTube'
  };
}

async function searchYouTubeVideos($, query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const localMatches = playlist.filter(
    (v) =>
      v.title.toLowerCase().includes(lower) ||
      (v.author && v.author.toLowerCase().includes(lower)) ||
      (v.category && v.category.toLowerCase().includes(lower))
  );

  try {
    const searchUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
    const res = await $.http.fetch(searchUrl);
    if (res && res.ok && res.text) {
      const results = [];
      const seen = new Set();
      const regex = /"videoId":"([A-Za-z0-9_-]{11})".*?"title":\{"runs":\[\{"text":"([^"]+)"/g;
      let match = regex.exec(res.text);
      while (match && results.length < 6) {
        const id = match[1];
        let title = match[2];
        try {
          // Titles are JSON string contents: decode \u0026 and friends
          title = JSON.parse('"' + title + '"');
        } catch {
          // Keep it as found
        }
        if (!seen.has(id)) {
          seen.add(id);
          results.push({ id, title, author: 'YouTube Search' });
        }
        match = regex.exec(res.text);
      }
      if (results.length > 0) {
        return results;
      }
    }
  } catch {
    // Fall back to local curated matches
  }

  return localMatches.length > 0 ? localMatches : [CURATED_VIDEOS[0]];
}

async function runNativePipCommand($, args) {
  const binPath = pluginRootPath + '/bin/yt-pip';
  try {
    await $.process.run([binPath, ...args]);
    return true;
  } catch {
    return false;
  }
}

// Terminals whose graphics protocol the pane's `Image` element draws (kitty's).
const INLINE_TERMINALS = [
  { name: 'Ghostty', test: (env) => /ghostty/i.test(env.termProgram) || /ghostty/i.test(env.term) || !!env.ghostty },
  { name: 'kitty', test: (env) => /kitty/i.test(env.term) || !!env.kittyWindowId }
];

export function classifyTerminal(env) {
  if (env.surface && env.surface !== 'terminal') {
    return { canInline: false, terminal: env.surface, reason: 'the ' + env.surface + ' app draws no video in a pane' };
  }
  if (env.tmux) {
    return { canInline: false, terminal: 'tmux', reason: 'tmux does not pass inline images through' };
  }
  const match = INLINE_TERMINALS.find((t) => t.test(env));
  if (match) {
    return { canInline: true, terminal: match.name, reason: match.name + ' draws inline images' };
  }
  const name = env.termProgram || env.term || 'this terminal';
  return { canInline: false, terminal: name, reason: name + ' has no inline image protocol (Ghostty or kitty do)' };
}

// A tool on PATH wins; otherwise the copy bin/install-deps.sh put in depsDir.
async function resolveTool($, name) {
  try {
    const { exitCode, stdout } = await $.process.run(['/usr/bin/env', 'which', name]);
    if (exitCode === 0 && stdout.trim()) return stdout.trim();
  } catch {
    // Not on PATH
  }
  if (depsDir) {
    try {
      const { exitCode } = await $.process.run(['/bin/test', '-x', depsDir + '/' + name]);
      if (exitCode === 0) return depsDir + '/' + name;
    } catch {
      // Not installed by us either
    }
  }
  return null;
}

// Runs bin/install-deps.sh: yt-dlp and ffmpeg into depsDir, checksum-verified.
async function installDeps($, { update = false } = {}) {
  if (depsInstall) return depsInstall;
  depsInstall = (async () => {
    try {
      const { exitCode, stdout, stderr } = await $.process.run(
        ['/bin/bash', pluginRootPath + '/bin/install-deps.sh', ...(update ? ['--update'] : [])],
        { env: { YT_MOD_DEPS_DIR: depsDir }, timeoutMs: 600000 }
      );
      const lines = String(stdout || '').trim().split('\n');
      const last = lines[lines.length - 1] || '';
      if (exitCode !== 0 || !last.startsWith('ok ')) {
        const why = lines.find((l) => l.startsWith('error ')) || String(stderr || '').trim().split('\n').pop() || 'exit ' + exitCode;
        return { ok: false, message: why.replace(/^error /, '') };
      }
      await $.store.set('depsCheckedAt', Date.now());
      return { ok: true, message: 'yt-dlp and ffmpeg are ready in ' + depsDir };
    } catch (err) {
      return { ok: false, message: err && err.message ? err.message : String(err) };
    } finally {
      depsInstall = null;
    }
  })();
  return depsInstall;
}

// Installs missing tools, then decides the playback mode again.
async function setupInlineDeps($) {
  $.ui.toast('Installing yt-dlp + ffmpeg for inline video (one-time, ~100 MB)…');
  const result = await installDeps($);
  await detectPlaybackMode($, lastSurface);
  $.ui.toast(result.ok ? 'Inline video ready: ' + describeMode() : 'Install failed: ' + result.message);
  $.ui.invalidate('ui.render');
  return result;
}

async function detectPlaybackMode($, surface) {
  const env = {
    surface,
    termProgram: (await $.env.get('TERM_PROGRAM')) || '',
    term: (await $.env.get('TERM')) || '',
    tmux: (await $.env.get('TMUX')) || '',
    kittyWindowId: (await $.env.get('KITTY_WINDOW_ID')) || '',
    ghostty: (await $.env.get('GHOSTTY_RESOURCES_DIR')) || ''
  };
  lastSurface = surface;
  let result = { ...classifyTerminal(env), needsDeps: false };
  if (result.canInline) {
    const missing = [];
    for (const tool of ['yt-dlp', 'ffmpeg']) {
      const path = await resolveTool($, tool);
      if (path) toolPaths[tool] = path;
      else missing.push(tool);
    }
    if (missing.length > 0) {
      result = {
        ...result,
        canInline: false,
        needsDeps: true,
        reason: 'needs ' + missing.join(' + ') + ' (installed on first play, or /yt setup)'
      };
    }
  }
  terminalInfo = result;
  applyModePreference();
  return result;
}

function applyModePreference() {
  playbackMode = modePreference === 'window' || !terminalInfo.canInline ? 'window' : 'inline';
}

function inlinePosition() {
  if (!inlineSession) return inlineOffset;
  return inlineSession.offset + (Date.now() - inlineSession.startedAt) / 1000;
}

function drainInBackground(stream, onEnd) {
  void (async () => {
    let stderr = '';
    let code = null;
    try {
      while (true) {
        const step = await stream.next();
        if (step.done) {
          code = step.value ? step.value.code : null;
          break;
        }
        if (step.value.stream === 'stderr' && stderr.length < 2000) stderr += step.value.text;
      }
    } catch {
      // Closed by stopInline
    }
    if (onEnd) onEnd(code, stderr);
  })();
}

function stopInline() {
  if (!inlineSession) return;
  const session = inlineSession;
  inlineOffset = inlinePosition();
  inlineSession = null;
  session.frameTimer.cancel();
  session.proc.return(undefined).catch(() => {});
}

function inlineFrameSource(generation) {
  return {
    file: INLINE_FRAME.file,
    format: 'rgb',
    width: INLINE_FRAME.width,
    height: INLINE_FRAME.height,
    generation
  };
}

// One ffmpeg reads yt-dlp's separate video and audio downloads at the same
// pace, writing frames for the pane and playing the sound, so they stay in
// sync. `exec` makes the spawned process ffmpeg itself: ending it ends both
// downloads (they get a broken pipe).
const shellQuote = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

export function buildInlineScript(videoId, offsetSeconds, muted, tools = { 'yt-dlp': 'yt-dlp', ffmpeg: 'ffmpeg' }) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new Error('not a YouTube video id: ' + videoId);
  }
  const seek = String(Math.max(0, Math.floor(offsetSeconds)));
  // Read the first `seek` seconds at full speed so resuming does not wait
  const burst = String(Math.max(0, Math.floor(offsetSeconds)) + 1);
  const download =
    shellQuote(tools['yt-dlp']) + ' -q --no-warnings --no-part --cache-dir ' + INLINE_CACHE_DIR + ' -o - ' +
    '"https://www.youtube.com/watch?v=' + videoId + '"';
  return [
    'exec ' + shellQuote(tools.ffmpeg) + ' -loglevel error',
    '-readrate 1 -readrate_initial_burst ' + burst,
    '-i <(' + download + ' -f "bv*[height<=720][vcodec^=avc1]/bv*[height<=720]/bv*")',
    '-readrate 1 -readrate_initial_burst ' + burst,
    '-i <(' + download + ' -f "ba[ext=m4a]/ba")',
    '-ss ' + seek + ' -map 0:v:0',
    // Fit inside the frame and letterbox, so 4:3 and vertical videos keep their shape
    "-vf 'scale=" + INLINE_FRAME.width + ':' + INLINE_FRAME.height + ':force_original_aspect_ratio=decrease,' +
      'pad=' + INLINE_FRAME.width + ':' + INLINE_FRAME.height + ":(ow-iw)/2:(oh-ih)/2,fps=" + INLINE_FRAME.fps + "'",
    '-pix_fmt rgb24 -c:v rawvideo -f image2 -update 1 -atomic_writing 1 -y ' + INLINE_FRAME.file,
    '-ss ' + seek + ' -map 1:a:0' + (muted ? ' -af volume=0' : '') + ' -f audiotoolbox -'
  ].join(' ');
}

async function startInline($, videoId, offsetSeconds, attempt = 0) {
  stopInline();
  const script = buildInlineScript(videoId, offsetSeconds, isMuted, toolPaths);
  const proc = $.process.spawn({ argv: ['/bin/bash', '-c', script] });

  let generation = 0;
  const frameTimer = $.clock.every(Math.round(1000 / INLINE_FRAME.fps), () => {
    generation += 1;
    $.ui
      .blit({ requestId: PANE_ID, key: INLINE_IMAGE_KEY, source: inlineFrameSource(generation) })
      .catch(() => {});
  });

  const session = { videoId, offset: offsetSeconds, startedAt: Date.now(), proc, frameTimer };
  inlineSession = session;
  drainInBackground(proc, (code, stderr) => {
    // Ended by itself (the video finished or the download failed), not by stopInline
    if (inlineSession !== session) return;
    stopInline();
    // YouTube now and then refuses a download (HTTP 403); a fresh start usually works
    if (code !== 0 && attempt < 2 && Date.now() - session.startedAt < 20000) {
      startInline($, videoId, offsetSeconds, attempt + 1).catch(() => {});
      return;
    }
    inlineOffset = 0;
    isPlaying = false;
    if (code !== 0) {
      const line = stderr.split('\n').find((l) => /error/i.test(l)) || stderr.trim().split('\n')[0] || 'exit ' + code;
      $.ui.toast('Inline playback stopped: ' + line.slice(0, 160));
    }
    $.ui.invalidate('ui.render');
  });
}

// Routes a player command to the inline pane player or the native window.
async function runPlayerCommand($, args) {
  if (playbackMode !== 'inline') {
    return runNativePipCommand($, args);
  }
  const [cmd, arg] = args;
  try {
    if (cmd === 'play') {
      inlineOffset = 0;
      await startInline($, arg, 0);
    } else if (cmd === 'pause' || (cmd === 'toggle' && inlineSession)) {
      stopInline();
    } else if (cmd === 'resume' || cmd === 'toggle') {
      await startInline($, currentVideo.id, inlineOffset);
    } else if (cmd === 'stop') {
      stopInline();
      inlineOffset = 0;
    } else if ((cmd === 'mute' || cmd === 'unmute') && inlineSession) {
      // ffmpeg takes its volume at start, so restart from where it is
      await startInline($, currentVideo.id, inlinePosition());
    }
    // position/size move the native window; the pane has no screen position
    return true;
  } catch (err) {
    stopInline();
    isPlaying = false;
    $.ui.toast('Inline playback failed: ' + (err && err.message ? err.message : String(err)));
    return false;
  }
}

async function syncFromNativeStateFile($) {
  try {
    const raw = await $.fs.read(STATE_FILE_PATH);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed.position) {
        screenPosition = parsed.position;
      }
      if (typeof parsed.customX === 'number' && typeof parsed.customY === 'number') {
        customCoords = Math.round(parsed.customX) + ',' + Math.round(parsed.customY);
      }
      if (typeof parsed.isPaused === 'boolean') {
        isPlaying = !parsed.shouldQuit && !parsed.isPaused;
      }
    }
  } catch {
    // Ignore missing state file before first launch
  }
}

async function playYouTubeTarget($, rawTarget, requestedPos, requestedSize) {
  // This terminal can play inline but the tools are missing: fetch them first
  if (terminalInfo.needsDeps && modePreference !== 'window') {
    await setupInlineDeps($);
  }
  if (requestedPos) {
    const norm = normalizePosition(requestedPos);
    screenPosition = norm;
    if (norm === 'custom') {
      customCoords = String(requestedPos).trim();
    }
  }
  if (requestedSize) {
    sizePreset = String(requestedSize).trim().toLowerCase();
  }

  const trimmed = String(rawTarget || '').trim();
  let videoId = extractYouTubeId(trimmed);
  let resolvedMeta = null;

  if (!videoId && trimmed) {
    const found = await searchYouTubeVideos($, trimmed);
    searchResults = found;
    if (found.length > 0) {
      videoId = found[0].id;
      resolvedMeta = found[0];
    }
  }

  if (!videoId) {
    videoId = currentVideo.id || CURATED_VIDEOS[0].id;
  }

  const meta = await resolveVideoMetadata($, videoId, resolvedMeta ? resolvedMeta.title : '');
  currentVideo = meta;
  isPlaying = true;
  hasActiveVideo = true;

  if (!playlist.some((item) => item.id === meta.id)) {
    playlist = [meta, ...playlist.slice(0, 14)];
  }

  const posArg = screenPosition === 'custom' && customCoords ? customCoords : screenPosition;
  await runPlayerCommand($, [
    'play',
    meta.id,
    '--position',
    posArg,
    '--size',
    sizePreset,
    '--title',
    meta.title,
    '--opacity',
    String(opacity)
  ]);

  await persistSettings($);
  $.ui.invalidate('ui.render');
  return meta;
}

async function movePlayerPosition($, newPos, newSize) {
  const raw = String(newPos || '').trim();
  if (raw === 'pane' || raw === 'band' || raw === 'both' || raw === 'spinner') {
    uiPlacement = raw;
    await persistSettings($);
    $.ui.invalidate('ui.render');
    return { kind: 'ui', placement: uiPlacement };
  }

  const norm = normalizePosition(raw);
  screenPosition = norm;
  if (norm === 'custom') {
    customCoords = raw;
  }
  if (newSize) {
    sizePreset = String(newSize).trim().toLowerCase();
  } else if (norm === 'right-side' || norm === 'left-side') {
    sizePreset = 'sidebar';
  } else if (sizePreset === 'sidebar') {
    sizePreset = 'medium';
  }

  const posArg = screenPosition === 'custom' && customCoords ? customCoords : screenPosition;
  await runPlayerCommand($, ['position', posArg, sizePreset]);
  await persistSettings($);
  $.ui.invalidate('ui.render');
  return { kind: 'screen', position: screenPosition, sizePreset };
}

const YT_HELP = [
  '/yt                       open the player pane',
  '/yt <url|id|search>       play (same as /yt play)',
  '/yt play <url|search> [@position] [size]',
  '/yt pause | resume        pause toggles when already paused',
  '/yt stop                  stop playback and close the pane and bar',
  '/yt hide | show           hide or show the UI; playback keeps going',
  '/yt pos <where> [size]    move the popout window',
  '/yt mode auto|inline|window',
  '/yt width <cols>          pane width (the inline video scales with it)',
  '/yt setup                 install yt-dlp + ffmpeg for inline video',
  '/yt status'
].join('\n');

// Opened to watch, the pane leaves the keyboard with the prompt so typing goes
// on; opened to use (/yt, /yt show, /yt pos), it takes the keys.
async function openPlayerPane($, { focus = true } = {}) {
  await $.ui.open({
    id: PANE_ID,
    title: 'YouTube Side Player',
    ...(focus ? { focus: true } : {}),
    closeOnEscape: true,
    columns: paneColumns
  });
}

async function stopPlayback($) {
  isPlaying = false;
  hasActiveVideo = false;
  await runPlayerCommand($, ['stop']);
  await $.ui.close({ id: PANE_ID });
  $.ui.invalidate('ui.render');
}

function describeMode() {
  const where = playbackMode === 'inline' ? 'inline in the pane' : 'in the popout window';
  return (
    'Playback: ' + where + ' (mode ' + modePreference + '; ' + terminalInfo.terminal + ': ' + terminalInfo.reason + ')'
  );
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await loadSavedSettings($);

    try {
      await $.command.register({
        name: 'yt',
        description: 'YouTube side player: play, pause, resume, stop, hide, show, pos, mode, status',
        argumentHint: '[play <url|search> | pause | resume | stop | hide | show | pos <where> | mode auto|inline|window | width <cols> | setup | status]',
        immediate: true
      });
    } catch {
      // Ignore duplicate command registration on reload
    }

    pluginRootPath = $.plugin.root;
    depsDir = ((await $.env.get('HOME')) || '/tmp') + '/.claude/plugins/data/youtube-side-player/bin';
    await detectPlaybackMode($, e.surface ?? (await $.session.surfaces())[0] ?? null);

    // YouTube changes break old yt-dlp releases: refresh our own copy weekly
    const checkedAt = await $.store.get('depsCheckedAt');
    if (terminalInfo.canInline && (typeof checkedAt !== 'number' || Date.now() - checkedAt > DEPS_UPDATE_EVERY_MS)) {
      void installDeps($, { update: true });
    }

    try {
      await $.tool.register({
        name: 'youtube_player',
        description:
          'Play a YouTube video on the side, search YouTube, or move the floating YouTube player to any screen or terminal position the user likes.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              description: 'play, position, pause, resume, stop, or status'
            },
            queryOrUrl: {
              type: 'string',
              description: 'YouTube video URL, 11-character video ID, or search query'
            },
            position: {
              type: 'string',
              description:
                'top-right, top-left, bottom-right, bottom-left, right-side, left-side, top-center, bottom-center, center, pane, band, both, or custom x,y,w,h'
            },
            size: {
              type: 'string',
              description: 'small, medium, large, or sidebar'
            }
          },
          required: ['action']
        }
      });
    } catch {
      // Ignore duplicate tool registration on reload
    }

    return next(e);
  });

  on('classic.SessionStart', { source: 'clear' }, async ($, e, next) => {
    await loadSavedSettings($);
    return next(e);
  });

  on('command.run', { command: 'yt' }, async ($, e) => {
    const rawArgs = String(e.args || '').trim();
    if (playbackMode === 'window') {
      await syncFromNativeStateFile($);
    }
    const [first = '', ...rest] = rawArgs.split(/\s+/).filter(Boolean);
    const sub = first.toLowerCase();
    const restText = rest.join(' ');

    if (!sub || sub === 'show') {
      isUiHidden = false;
      // Bare /yt is to use the pane; /yt show only brings it back into view
      await openPlayerPane($, { focus: !sub });
      $.ui.invalidate('ui.render');
      return {};
    }
    if (sub === 'help') {
      return { text: YT_HELP };
    }
    if (sub === 'setup') {
      const result = await setupInlineDeps($);
      return { text: (result.ok ? result.message : 'Install failed: ' + result.message) + '\n' + describeMode() };
    }
    if (sub === 'pause' || sub === 'resume') {
      const wantPlaying = sub === 'resume' || !isPlaying;
      if (wantPlaying === isPlaying) {
        return { text: (isPlaying ? 'Already playing: ' : 'Already paused: ') + currentVideo.title };
      }
      isPlaying = wantPlaying;
      await runPlayerCommand($, [wantPlaying ? 'resume' : 'pause']);
      $.ui.invalidate('ui.render');
      return { text: (isPlaying ? 'Resumed: ' : 'Paused: ') + currentVideo.title };
    }
    if (sub === 'stop') {
      await stopPlayback($);
      return { text: 'Stopped YouTube Side Player.' };
    }
    if (sub === 'hide') {
      isUiHidden = true;
      await $.ui.close({ id: PANE_ID });
      $.ui.invalidate('ui.render');
      return { text: 'YouTube player UI hidden' + (isPlaying ? ' (still playing; /yt show to bring it back).' : '.') };
    }
    if (sub === 'pos' || sub === 'position') {
      if (!restText) {
        activeTab = 'position';
        await openPlayerPane($);
        return {};
      }
      const [posToken, sizeToken] = rest;
      const updated = await movePlayerPosition($, posToken, sizeToken);
      if (updated.kind === 'ui') {
        return { text: 'YouTube Mod UI placement set to: ' + updated.placement };
      }
      return {
        text:
          'Moved YouTube Side Player to ' +
          updated.position +
          (screenPosition === 'custom' && customCoords ? ' (' + customCoords + ')' : '') +
          ' [' +
          updated.sizePreset +
          ']' +
          (playbackMode === 'inline' ? ' (applies to the popout window; inline video lives in the pane)' : '')
      };
    }
    if (sub === 'width') {
      const cols = Number(rest[0]);
      if (!Number.isInteger(cols) || cols < 30 || cols > 160) {
        return { text: 'Usage: /yt width <30-160>  (pane width in columns; now ' + paneColumns + ')' };
      }
      paneColumns = cols;
      await persistSettings($);
      if (!isUiHidden) await openPlayerPane($, { focus: false });
      $.ui.invalidate('ui.render');
      return { text: 'Pane width set to ' + cols + ' columns.' };
    }
    if (sub === 'mode') {
      const want = (rest[0] || '').toLowerCase();
      if (want === 'auto' || want === 'inline' || want === 'window') {
        const wasPlaying = isPlaying;
        if (wasPlaying) await runPlayerCommand($, ['stop']);
        modePreference = want;
        await $.store.set('modePreference', modePreference);
        applyModePreference();
        if (wasPlaying) await playYouTubeTarget($, currentVideo.id, null, null);
        $.ui.invalidate('ui.render');
      } else if (want) {
        return { text: 'Usage: /yt mode auto|inline|window' };
      }
      return { text: describeMode() };
    }
    if (sub === 'status') {
      return {
        text:
          (isPlaying ? '▶ ' : '⏸ ') + currentVideo.title + '\n' + describeMode()
      };
    }

    // `/yt play <target>` or the shorthand `/yt <url | id | search>`
    const parts = sub === 'play' ? rest.slice() : rawArgs.split(/\s+/);
    let sizeOverride = null;
    let posOverride = null;

    const knownSizes = new Set(['small', 'medium', 'large', 'sidebar']);
    const knownPositions = new Set([
      'top-left', 'top-center', 'top-right',
      'left-side', 'center', 'right-side',
      'bottom-left', 'bottom-center', 'bottom-right',
      'tl', 'tc', 'tr', 'bl', 'bc', 'br', 'left', 'right', 'top', 'bottom',
      'dock-left', 'dock-right'
    ]);

    if (parts.length >= 2 && knownSizes.has(parts[parts.length - 1].toLowerCase())) {
      sizeOverride = parts.pop().toLowerCase();
    }
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (last.startsWith('@')) {
        posOverride = parts.pop().slice(1);
      } else if (knownPositions.has(last.toLowerCase()) || /^\d+,\d+/.test(last)) {
        posOverride = parts.pop();
      }
    }

    isUiHidden = false;
    // Open first so the inline Image is mounted when frames start arriving
    await openPlayerPane($, { focus: false });
    const meta = await playYouTubeTarget($, parts.join(' '), posOverride, sizeOverride);
    $.ui.toast(
      isPlaying
        ? 'Playing "' + meta.title + '" ' + (playbackMode === 'inline' ? 'in the pane' : 'at ' + screenPosition)
        : 'Could not play "' + meta.title + '"'
    );
    return {};
  });

  on('tool.call', { tool: 'mcp__youtube-side-player__youtube_player' }, async ($, e) => {
    const action = String(e.action || 'status').toLowerCase();
    if (action === 'play') {
      const meta = await playYouTubeTarget($, e.queryOrUrl || '', e.position, e.size);
      return {
        result:
          'Playing "' +
          meta.title +
          '" (' +
          meta.id +
          ') at position ' +
          screenPosition +
          ' [' +
          sizePreset +
          '].'
      };
    }
    if (action === 'position' || action === 'move') {
      const updated = await movePlayerPosition($, e.position || 'top-right', e.size);
      return {
        result:
          updated.kind === 'ui'
            ? 'Updated Claude UI placement to ' + updated.placement
            : 'Moved YouTube Side Player to ' + updated.position + ' [' + updated.sizePreset + ']'
      };
    }
    if (action === 'pause') {
      isPlaying = false;
      await runPlayerCommand($, ['pause']);
      $.ui.invalidate('ui.render');
      return { result: 'Paused YouTube Side Player.' };
    }
    if (action === 'resume') {
      isPlaying = true;
      await runPlayerCommand($, ['resume']);
      $.ui.invalidate('ui.render');
      return { result: 'Resumed YouTube Side Player.' };
    }
    if (action === 'stop') {
      await stopPlayback($);
      return { result: 'Stopped and closed YouTube Side Player.' };
    }
    return {
      result: JSON.stringify({
        video: currentVideo,
        isPlaying,
        screenPosition,
        sizePreset,
        uiPlacement
      })
    };
  });

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!isPlaying) {
      return next(e);
    }
    const shortTitle =
      currentVideo.title.length > 28
        ? currentVideo.title.slice(0, 25) + '…'
        : currentVideo.title;
    return next({
      ...e,
      props: {
        ...e.props,
        suffix: ' · ▶ [' + screenPosition + '] ' + shortTitle
      }
    });
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (uiPlacement !== 'band' && uiPlacement !== 'both') {
      return next(e);
    }
    if (isUiHidden || !hasActiveVideo) {
      return next(e);
    }

    const { Box, Text, Button } = $.ui.resolve(e);
    const theirs = await next(e);

    const bandBar = Box({
      borderStyle: 'round',
      borderColor: isPlaying ? 'red' : 'cyan',
      paddingX: 1,
      flexDirection: 'row',
      columnGap: 2,
      children: [
        Text({
          bold: true,
          color: isPlaying ? 'red' : 'cyan',
          children: [(isPlaying ? '▶ YT' : '⏸ YT') + ' [' + screenPosition + ' · ' + sizePreset + ']']
        }),
        Text({
          wrap: 'truncate-end',
          children: [currentVideo.title]
        }),
        Button({
          key: 'band-toggle-play',
          label: isPlaying ? 'Pause' : 'Play',
          plain: true,
          onPress: async () => {
            if (isPlaying) {
              isPlaying = false;
              await runPlayerCommand($, ['pause']);
            } else {
              await playYouTubeTarget($, currentVideo.id, screenPosition, sizePreset);
            }
            $.ui.invalidate('ui.render');
          }
        }),
        Button({
          key: 'band-cycle-pos',
          label: 'Move ↻',
          plain: true,
          onPress: async () => {
            const order = ['top-right', 'bottom-right', 'bottom-left', 'top-left', 'right-side', 'left-side'];
            const idx = order.indexOf(screenPosition);
            const nextPos = order[(idx + 1) % order.length];
            await movePlayerPosition($, nextPos, null);
          }
        }),
        Button({
          key: 'band-open-pane',
          label: 'Pane',
          plain: true,
          onPress: async () => {
            await $.ui.open({
              id: PANE_ID,
              title: 'YouTube Side Player',
              focus: true,
              closeOnEscape: true,
              columns: paneColumns
            });
          }
        })
      ]
    });

    return Box({
      flexDirection: 'column',
      children: [theirs, bandBar]
    });
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) {
      return next(e);
    }

    const { Box, Text, Button, Input, Select, Link, Markdown, Raster, Svg, Image } = $.ui.resolve(e);
    const redraw = () => $.ui.invalidate('ui.render');

    const tabButton = (id, label, hotkey) =>
      Button({
        key: 'tab-' + id,
        label,
        hotkey,
        plain: true,
        dimColor: activeTab !== id,
        onPress: () => {
          activeTab = id;
          redraw();
        }
      });

    const headerTabs = Box({
      flexDirection: 'row',
      columnGap: 3,
      children: [
        tabButton('player', 'Player', '1'),
        tabButton('position', 'Position (' + screenPosition + ')', '2'),
        tabButton('playlist', 'Playlist (' + playlist.length + ')', '3'),
        tabButton('notes', 'Notes & AI (' + videoNotes.length + ')', '4')
      ]
    });

    const visualMonitor =
      e.surface === 'terminal' && Raster
        ? Raster({
            key: 'screen-radar',
            ...buildScreenRadarRaster(screenPosition, isPlaying)
          })
        : e.surface === 'desktop' && Svg
          ? Svg({
              alt: 'Screen position map showing ' + screenPosition,
              width: 140,
              height: 72,
              source: buildDesktopPositionSvg(screenPosition, isPlaying)
            })
          : Text({
              dimColor: true,
              children: ['Screen Radar: [' + screenPosition + ']']
            });

    const statusCard = Box({
      borderStyle: 'round',
      borderColor: isPlaying ? 'red' : 'cyan',
      paddingX: 1,
      flexDirection: 'row',
      columnGap: 2,
      children: [
        visualMonitor,
        Box({
          flexDirection: 'column',
          children: [
            Text({
              bold: true,
              color: isPlaying ? 'red' : 'cyan',
              children: [
                (isPlaying ? (playbackMode === 'inline' ? '● PLAYING INLINE' : '● PLAYING ON SIDE') : '○ READY') +
                  ' · ' +
                  screenPosition.toUpperCase() +
                  (screenPosition === 'custom' && customCoords ? ' (' + customCoords + ')' : '') +
                  ' · ' +
                  sizePreset.toUpperCase()
              ]
            }),
            Text({ bold: true, children: [currentVideo.title] }),
            Text({
              dimColor: true,
              children: ['Channel: ' + (currentVideo.author || 'YouTube') + ' · ID: ' + currentVideo.id]
            }),
            Link({
              href: 'https://www.youtube.com/watch?v=' + currentVideo.id,
              label: 'Open on YouTube'
            })
          ]
        })
      ]
    });

    let tabBody = [];

    if (activeTab === 'player') {
      tabBody = [
        Input({
          key: 'yt-url-input',
          label: 'Play / Search',
          placeholder: 'Paste YouTube URL, video ID, or search query and press Enter',
          value: '',
          submitLabel: 'play on side',
          autoFocus: true,
          onSubmit: async (value) => {
            if (!value || !value.trim()) return;
            await playYouTubeTarget($, value.trim(), null, null);
          }
        }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({
              key: 'btn-play-toggle',
              label: isPlaying ? 'Pause [p]' : 'Play PiP [p]',
              hotkey: 'p',
              onPress: async () => {
                if (isPlaying) {
                  isPlaying = false;
                  await runPlayerCommand($, ['pause']);
                  redraw();
                } else {
                  await playYouTubeTarget($, currentVideo.id, screenPosition, sizePreset);
                }
              }
            }),
            Button({
              key: 'btn-mute-toggle',
              label: isMuted ? 'Unmute [m]' : 'Mute [m]',
              hotkey: 'm',
              onPress: async () => {
                isMuted = !isMuted;
                await runPlayerCommand($, [isMuted ? 'mute' : 'unmute']);
                redraw();
              }
            }),
            Button({
              key: 'btn-relaunch-pip',
              label: 'Popout Side Window [o]',
              hotkey: 'o',
              onPress: async () => {
                // Popping out leaves inline mode for this session
                if (playbackMode === 'inline') {
                  await runPlayerCommand($, ['stop']);
                  playbackMode = 'window';
                }
                await playYouTubeTarget($, currentVideo.id, screenPosition, sizePreset);
              }
            }),
            Button({
              key: 'btn-stop-pip',
              label: 'Stop [k]',
              hotkey: 'k',
              dimColor: !isPlaying,
              onPress: async () => {
                await stopPlayback($);
              }
            })
          ]
        }),
        Text({ bold: true, children: ['Quick Corner & Side Snap (or press 2 for full 9-point grid):'] }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({
              key: 'quick-pos-tl',
              label: '↖ Top-Left',
              plain: true,
              dimColor: screenPosition !== 'top-left',
              onPress: async () => {
                await movePlayerPosition($, 'top-left', null);
              }
            }),
            Button({
              key: 'quick-pos-tr',
              label: '↗ Top-Right',
              plain: true,
              dimColor: screenPosition !== 'top-right',
              onPress: async () => {
                await movePlayerPosition($, 'top-right', null);
              }
            }),
            Button({
              key: 'quick-pos-bl',
              label: '↙ Bottom-Left',
              plain: true,
              dimColor: screenPosition !== 'bottom-left',
              onPress: async () => {
                await movePlayerPosition($, 'bottom-left', null);
              }
            }),
            Button({
              key: 'quick-pos-br',
              label: '↘ Bottom-Right',
              plain: true,
              dimColor: screenPosition !== 'bottom-right',
              onPress: async () => {
                await movePlayerPosition($, 'bottom-right', null);
              }
            }),
            Button({
              key: 'quick-pos-right',
              label: '⇥ Right Sidebar',
              plain: true,
              dimColor: screenPosition !== 'right-side',
              onPress: async () => {
                await movePlayerPosition($, 'right-side', 'sidebar');
              }
            }),
            Button({
              key: 'quick-pos-left',
              label: '⇤ Left Sidebar',
              plain: true,
              dimColor: screenPosition !== 'left-side',
              onPress: async () => {
                await movePlayerPosition($, 'left-side', 'sidebar');
              }
            })
          ]
        })
      ];
    } else if (activeTab === 'position') {
      const compassRows = [0, 1, 2].map((rIdx) =>
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: POSITION_PRESETS.filter((p) => p.row === rIdx).map((preset) =>
            Button({
              key: 'pos-' + preset.key,
              label:
                preset.arrow +
                ' ' +
                preset.label +
                (screenPosition === preset.key ? ' ✓' : '') +
                ' [' +
                preset.hotkey +
                ']',
              hotkey: preset.hotkey,
              dimColor: screenPosition !== preset.key,
              onPress: async () => {
                await movePlayerPosition($, preset.key, null);
              }
            })
          )
        })
      );

      tabBody = [
        Text({
          bold: true,
          children: ['Choose Any Screen Position (press q/w/e, a/s/d, z/x/c or drag window freely):']
        }),
        ...compassRows,
        Input({
          key: 'custom-coords-input',
          label: 'Custom (x,y or x,y,w,h)',
          placeholder: 'e.g. 980,60,480,270 — or drag the floating player anywhere on screen',
          value: '',
          submitLabel: 'snap to coords',
          onSubmit: async (val) => {
            if (!val || !val.trim()) return;
            await movePlayerPosition($, val.trim(), null);
          }
        }),
        Select({
          key: 'size-preset-select',
          label: 'Window Size',
          value: sizePreset,
          options: [
            { value: 'small', label: 'Mini PiP (340×222)' },
            { value: 'medium', label: 'Medium PiP (460×290)' },
            { value: 'large', label: 'Large Theater (640×390)' },
            { value: 'sidebar', label: 'Full-Height Side Split (460×Full)' }
          ],
          onSelect: async (val) => {
            sizePreset = val;
            await runPlayerCommand($, ['size', val]);
            await persistSettings($);
            redraw();
          }
        }),
        Select({
          key: 'ui-placement-select',
          label: 'In-Claude UI Position',
          value: uiPlacement,
          options: [
            { value: 'both', label: 'Side Pane + Above-Prompt Mini Bar' },
            { value: 'pane', label: 'Side Pane Only' },
            { value: 'band', label: 'Above-Prompt Mini Bar Only' },
            { value: 'spinner', label: 'Minimal (Spinner Status Only)' }
          ],
          onSelect: async (val) => {
            uiPlacement = val;
            await persistSettings($);
            redraw();
          }
        }),
        Select({
          key: 'pane-columns-select',
          label: 'Claude Side Pane Width',
          value: String(paneColumns),
          options: [
            { value: '44', label: 'Compact Sidebar (44 cols)' },
            { value: '58', label: 'Standard Sidebar (58 cols)' },
            { value: '74', label: 'Wide Sidebar (74 cols)' }
          ],
          onSelect: async (val) => {
            paneColumns = Number(val) || 58;
            await persistSettings($);
            await $.ui.open({
              id: PANE_ID,
              title: 'YouTube Side Player',
              focus: true,
              closeOnEscape: true,
              columns: paneColumns
            });
            redraw();
          }
        })
      ];
    } else if (activeTab === 'playlist') {
      const listToShow = searchResults.length > 0 ? searchResults : playlist;
      tabBody = [
        Input({
          key: 'playlist-search-input',
          label: 'Search / Add',
          placeholder: 'Search YouTube or paste URL to add to queue',
          value: '',
          submitLabel: 'search & play',
          onSubmit: async (val) => {
            if (!val || !val.trim()) return;
            await playYouTubeTarget($, val.trim(), null, null);
          }
        }),
        ...listToShow.slice(0, 8).map((item, idx) =>
          Box({
            flexDirection: 'row',
            columnGap: 2,
            children: [
              Button({
                key: 'play-item-' + idx,
                label: currentVideo.id === item.id && isPlaying ? '▶ Playing' : 'Play',
                onPress: async () => {
                  await playYouTubeTarget($, item.id, null, null);
                }
              }),
              Text({
                bold: currentVideo.id === item.id,
                wrap: 'truncate-end',
                children: [item.title + ' — ' + (item.author || 'YouTube')]
              })
            ]
          })
        )
      ];
    } else if (activeTab === 'notes') {
      tabBody = [
        Input({
          key: 'note-input',
          label: 'Timestamp Note',
          placeholder: 'Write a note on "' + currentVideo.title.slice(0, 30) + '" and press Enter',
          value: '',
          submitLabel: 'save note',
          onSubmit: async (val) => {
            const text = String(val || '').trim();
            if (!text) return;
            videoNotes = [
              {
                videoId: currentVideo.id,
                videoTitle: currentVideo.title,
                text,
                savedAt: new Date().toISOString().slice(11, 19)
              },
              ...videoNotes.slice(0, 19)
            ];
            await persistSettings($);
            redraw();
          }
        }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({
              key: 'btn-ai-summarize',
              label: 'Summarize Video Topic with Claude [g]',
              hotkey: 'g',
              onPress: async () => {
                const reply = await $.model.complete({
                  model: 'haiku',
                  system:
                    'Provide a concise 3-bullet technical cheat-sheet or study guide for the given YouTube video title and channel.',
                  prompt: 'Video: "' + currentVideo.title + '" by ' + (currentVideo.author || 'YouTube'),
                  maxTokens: 220,
                  timeoutMs: 15000
                });
                aiSummary = reply.isAnswered ? reply.text.trim() : 'Could not generate summary right now.';
                redraw();
              }
            })
          ]
        }),
        ...(aiSummary
          ? [
              Markdown({
                text: '### AI Video Study Guide\n' + aiSummary
              })
            ]
          : []),
        ...videoNotes.map((n, i) =>
          Box({
            flexDirection: 'row',
            columnGap: 1,
            children: [
              Button({
                key: 'del-note-' + i,
                label: 'x',
                plain: true,
                onPress: async () => {
                  videoNotes = videoNotes.filter((_, j) => j !== i);
                  await persistSettings($);
                  redraw();
                }
              }),
              Text({
                children: ['[' + n.savedAt + ' · ' + n.videoTitle.slice(0, 22) + '] ' + n.text]
              })
            ]
          })
        )
      ];
    }

    // Inline video: a keyed Image that the frame timer swaps with $.ui.blit
    const inlineVideo = [];
    if (playbackMode === 'inline' && hasActiveVideo && Image) {
      const columns = Math.max(16, Math.min(255, (e.props && e.props.bodyColumns ? e.props.bodyColumns : paneColumns) - 2));
      // Cells are about twice as tall as wide
      const rows = Math.max(4, Math.round((columns * INLINE_FRAME.height) / INLINE_FRAME.width / 2));
      inlineVideo.push(
        Image({
          key: INLINE_IMAGE_KEY,
          source: inlineFrameSource(0),
          columns,
          rows,
          alt: isPlaying ? 'Loading ' + currentVideo.title + '…' : 'Paused: ' + currentVideo.title
        })
      );
    }
    const modeLine = Text({
      dimColor: true,
      wrap: 'truncate-end',
      children: [
        (playbackMode === 'inline' ? 'Inline · ' : 'Popout window · ') + terminalInfo.terminal + ': ' + terminalInfo.reason
      ]
    });

    const setupButton = terminalInfo.needsDeps
      ? [
          Button({
            key: 'btn-install-deps',
            label: 'Install inline video (yt-dlp + ffmpeg, ~100 MB) [i]',
            hotkey: 'i',
            onPress: async () => {
              await setupInlineDeps($);
            }
          })
        ]
      : [];

    return Box({
      flexDirection: 'column',
      gap: 1,
      children: [...inlineVideo, headerTabs, statusCard, modeLine, ...setupButton, ...tabBody]
    });
  });
}
