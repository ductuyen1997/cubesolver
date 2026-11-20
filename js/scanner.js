/*
 * Scanner dialog: capture the six faces from a live camera, a photo or a
 * video file, then classify the sticker colors.
 */
(function () {
  'use strict';

  const Scan = window.RubikColorScan;
  const $ = (id) => document.getElementById(id);

  const NAMES = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' };
  const FACE_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
  // Scan order and how to hold the cube, so the photo matches the facelet layout.
  const STEPS = [
    { face: 'F', top: 'U', how: 'Hold the cube with <b>green</b> facing the camera and <b>white</b> on top.' },
    { face: 'R', top: 'U', how: 'Turn the whole cube a quarter to the left so <b>red</b> faces the camera. Keep <b>white</b> on top.' },
    { face: 'B', top: 'U', how: 'Turn another quarter to the left: <b>blue</b> faces the camera, <b>white</b> on top.' },
    { face: 'L', top: 'U', how: 'Turn another quarter to the left: <b>orange</b> faces the camera, <b>white</b> on top.' },
    { face: 'U', top: 'B', how: 'Go back to green in front, then tip the top toward the camera: <b>white</b> faces the camera, <b>blue</b> on top.' },
    { face: 'D', top: 'F', how: 'Go back to green in front, then tip the bottom toward the camera: <b>yellow</b> faces the camera, <b>green</b> on top.' },
  ];

  let onApply = null;
  let open = false;
  let step = 0;
  const captured = {}; // face -> 9 RGB samples
  let liveSamples = null;
  let liveColors = null; // liveSamples snapped to defined colors (face letters)

  // Source
  let stream = null;
  let video = null;
  let image = null;
  let sourceKind = null; // 'camera' | 'video' | 'photo'
  let objectUrl = null;
  let sourceToken = 0; // bumps on every source change so late async results are discarded

  // Grid placement (normalized to canvas): center and size relative to min(w, h).
  const grid = { cx: 0.5, cy: 0.5, size: 0.6 };

  const canvas = () => $('scanCanvas');

  // ---------- snapping to the six defined colors ----------
  let paletteHex = null;
  function palette(letter) {
    if (!paletteHex) {
      const css = getComputedStyle(document.documentElement);
      paletteHex = {};
      for (const f of Scan.FACES) paletteHex[f] = css.getPropertyValue(`--c-${f}`).trim();
    }
    return paletteHex[letter];
  }

  /** Reference colors: defaults, calibrated by every center captured so far. */
  function currentRefs() {
    const centers = {};
    for (const f of Object.keys(captured)) centers[f] = captured[f][4];
    return Scan.references(centers);
  }

  /** Defined color (face letter) for each sticker of every captured face. */
  function snappedFaces() {
    const out = {};
    if (Object.keys(captured).length === 6) {
      // All faces in: use the full classification, exactly what "Use these colors" will apply.
      const { facelets } = Scan.classify(collectSamples());
      for (const st of STEPS) {
        const f = FACE_INDEX[st.face];
        out[st.face] = facelets.slice(f * 9, f * 9 + 9).split('');
      }
      return out;
    }
    const refs = currentRefs();
    for (const face of Object.keys(captured)) {
      out[face] = captured[face].map((rgb, k) => (k === 4 ? face : Scan.nearestColor(rgb, refs)));
    }
    return out;
  }

  function collectSamples() {
    const samples = new Array(54);
    for (const st of STEPS) {
      const f = FACE_INDEX[st.face];
      captured[st.face].forEach((rgb, k) => { samples[f * 9 + k] = rgb; });
    }
    return samples;
  }

  function init(options) {
    onApply = options.onApply;
    $('btnScan').addEventListener('click', openDialog);
    $('scanClose').addEventListener('click', closeDialog);
    $('scanModal').addEventListener('click', (e) => { if (e.target.id === 'scanModal') closeDialog(); });
    $('scanCamera').addEventListener('click', startCamera);
    $('scanPhoto').addEventListener('change', (e) => loadFile(e.target, 'photo'));
    $('scanVideo').addEventListener('change', (e) => loadFile(e.target, 'video'));
    $('scanMirror').addEventListener('change', () => canvas().classList.toggle('mirrored', $('scanMirror').checked));
    $('gridSize').addEventListener('input', () => { grid.size = $('gridSize').value / 100; });
    $('scanCapture').addEventListener('click', capture);
    $('scanApply').addEventListener('click', apply);
    $('scanResetAll').addEventListener('click', () => {
      for (const k of Object.keys(captured)) delete captured[k];
      step = 0;
      renderSide();
    });
    $('vidPlay').addEventListener('click', () => {
      if (!video) return;
      if (video.paused) video.play(); else video.pause();
    });
    $('vidSeek').addEventListener('input', () => {
      if (video && video.duration) video.currentTime = ($('vidSeek').value / 1000) * video.duration;
    });
    setupGridDrag();
    document.addEventListener('keydown', (e) => {
      if (!open) return;
      if (e.key === 'Escape') closeDialog();
      else if (e.key === ' ' && e.target.tagName !== 'INPUT') { e.preventDefault(); capture(); }
    });
    renderSide();
  }

  function openDialog() {
    open = true;
    $('scanModal').hidden = false;
    setMessage('');
    renderSide();
    requestAnimationFrame(loop);
    if (!sourceKind) startCamera();
  }

  function closeDialog() {
    open = false;
    $('scanModal').hidden = true;
    stopSource();
  }

  function setMessage(text, kind) {
    const el = $('scanMsg');
    el.innerHTML = text;
    el.className = 'message' + (kind ? ' ' + kind : '');
  }

  // ---------- sources ----------
  function stopSource() {
    sourceToken++;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) { video.pause(); video.removeAttribute('src'); video.srcObject = null; }
    video = null;
    image = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    sourceKind = null;
    liveSamples = null;
    liveColors = null;
    $('videoControls').hidden = true;
    $('stageEmpty').hidden = false;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMessage('Camera access is not available here. Open the app via <code>http://localhost</code> ' +
        '(e.g. <code>python3 -m http.server</code>) or use <b>Photo</b> / <b>Video</b> upload instead.', 'error');
      return;
    }
    stopSource();
    const token = sourceToken;
    try {
      setMessage('Requesting camera… allow access in your browser\'s prompt.');
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (token !== sourceToken) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = s;
      await video.play();
      if (token !== sourceToken) return;
      sourceKind = 'camera';
      $('stageEmpty').hidden = true;
      setMessage('');
    } catch (err) {
      if (token !== sourceToken) return;
      setMessage(`Could not start the camera (${err.name || err}). You can upload a photo or video instead.`, 'error');
    }
  }

  function loadFile(input, kind) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    stopSource();
    const token = sourceToken;
    objectUrl = URL.createObjectURL(file);
    if (kind === 'photo') {
      const img = new Image();
      img.onload = () => {
        if (token !== sourceToken) return;
        image = img;
        sourceKind = 'photo';
        $('stageEmpty').hidden = true;
        setMessage('Drag the grid over the face and resize it to fit, then capture.');
      };
      img.onerror = () => setMessage('That image could not be loaded.', 'error');
      img.src = objectUrl;
    } else {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.loop = true;
      v.src = objectUrl;
      v.addEventListener('loadeddata', () => {
        if (token !== sourceToken) return;
        video = v;
        sourceKind = 'video';
        $('stageEmpty').hidden = true;
        $('videoControls').hidden = false;
        setMessage('Pause or scrub to a frame where the face is clear, then capture.');
      });
      v.addEventListener('timeupdate', () => {
        if (v.duration) $('vidSeek').value = Math.round((v.currentTime / v.duration) * 1000);
      });
      v.addEventListener('play', () => { $('vidPlay').textContent = '⏸'; });
      v.addEventListener('pause', () => { $('vidPlay').textContent = '▶'; });
      v.addEventListener('error', () => setMessage('That video could not be played by this browser.', 'error'));
      v.load();
    }
  }

  // ---------- drawing & sampling ----------
  function gridRect(w, h) {
    const size = Math.min(w, h) * grid.size;
    return { x: grid.cx * w - size / 2, y: grid.cy * h - size / 2, size };
  }

  function loop() {
    if (!open) return;
    requestAnimationFrame(loop);
    try {
      draw();
    } catch (err) {
      console.error(err);
    }
  }

  function draw() {
    const cv = canvas();
    const src = image || (video && video.readyState >= 2 ? video : null);
    if (!src) return;
    const sw = image ? image.naturalWidth : video.videoWidth;
    const sh = image ? image.naturalHeight : video.videoHeight;
    if (!sw || !sh) return;
    const scale = Math.min(1, 960 / Math.max(sw, sh));
    const w = Math.round(sw * scale), h = Math.round(sh * scale);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, w, h);

    const r = gridRect(w, h);
    const cell = r.size / 3;
    const img = ctx.getImageData(0, 0, w, h);
    liveSamples = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const inner = cell * 0.4;
        liveSamples.push(Scan.sampleRegion(img,
          r.x + col * cell + (cell - inner) / 2, r.y + row * cell + (cell - inner) / 2, inner));
      }
    }

    // Dim everything outside the grid.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, w, r.y);
    ctx.fillRect(0, r.y + r.size, w, h - r.y - r.size);
    ctx.fillRect(0, r.y, r.x, r.size);
    ctx.fillRect(r.x + r.size, r.y, w - r.x - r.size, r.size);
    // Grid lines.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = Math.max(2, w / 400);
    for (let i = 0; i <= 3; i++) {
      ctx.beginPath(); ctx.moveTo(r.x + i * cell, r.y); ctx.lineTo(r.x + i * cell, r.y + r.size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r.x, r.y + i * cell); ctx.lineTo(r.x + r.size, r.y + i * cell); ctx.stroke();
    }
    // Detected color dots, snapped to the closest defined color.
    const refs = currentRefs();
    liveColors = liveSamples.map((rgb) => Scan.nearestColor(rgb, refs));
    liveSamples.forEach((rgb, i) => {
      const cx = r.x + (i % 3 + 0.5) * cell, cy = r.y + (Math.floor(i / 3) + 0.5) * cell;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = palette(liveColors[i]);
      ctx.fill();
      ctx.lineWidth = Math.max(2, cell * 0.03);
      ctx.strokeStyle = '#000';
      ctx.stroke();
    });
    renderLivePreview();
  }

  function renderLivePreview() {
    const el = $('livePreview');
    if (!el.childElementCount) for (let i = 0; i < 9; i++) el.appendChild(document.createElement('span'));
    [...el.children].forEach((c, i) => {
      c.style.background = liveColors ? `var(--c-${liveColors[i]})` : '';
    });
  }

  function setupGridDrag() {
    const cv = canvas();
    let dragging = false, lastX = 0, lastY = 0;
    const toNorm = (e) => {
      const rect = cv.getBoundingClientRect();
      let x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      if ($('scanMirror').checked) x = 1 - x;
      return [x, y];
    };
    cv.addEventListener('pointerdown', (e) => {
      dragging = true;
      [lastX, lastY] = toNorm(e);
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const [x, y] = toNorm(e);
      grid.cx = Math.min(1, Math.max(0, grid.cx + x - lastX));
      grid.cy = Math.min(1, Math.max(0, grid.cy + y - lastY));
      lastX = x;
      lastY = y;
    });
    cv.addEventListener('pointerup', () => { dragging = false; });
    cv.addEventListener('pointercancel', () => { dragging = false; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      grid.size = Math.min(0.95, Math.max(0.2, grid.size - e.deltaY * 0.0008));
      $('gridSize').value = Math.round(grid.size * 100);
    }, { passive: false });
  }

  // ---------- capture & apply ----------
  function capture() {
    try {
      draw(); // sample the exact frame on screen right now
    } catch (err) {
      setMessage(`Could not read the image (${err.name || err}).`, 'error');
      return;
    }
    if (!liveSamples) {
      setMessage('Start the camera or upload a photo/video first.', 'error');
      return;
    }
    const s = STEPS[step];
    const centerLooksLike = liveColors[4];
    captured[s.face] = liveSamples.map((c) => c.slice());
    if (centerLooksLike !== s.face) {
      setMessage(`Captured, but the center looks <b>${NAMES[centerLooksLike]}</b>, not ${NAMES[s.face]}. ` +
        `If you showed the wrong face, click the ${NAMES[s.face]} thumbnail and capture again.`, 'error');
    } else {
      setMessage(`Captured the ${NAMES[s.face]} face.`, 'ok');
    }
    // Advance to the next face that has not been captured yet.
    for (let k = 1; k <= STEPS.length; k++) {
      const next = (step + k) % STEPS.length;
      if (!captured[STEPS[next].face]) { step = next; break; }
    }
    renderSide();
  }

  function renderSide() {
    const s = STEPS[step];
    const count = Object.keys(captured).length;
    $('scanStep').innerHTML =
      `<div class="step-title"><span class="dot" style="background: var(--c-${s.face})"></span>` +
      `Face ${step + 1} of 6: <b>${NAMES[s.face]}</b> center</div><p class="small">${s.how}</p>`;
    const faces = $('scanFaces');
    faces.innerHTML = '';
    const snapped = snappedFaces();
    STEPS.forEach((st, i) => {
      const b = document.createElement('button');
      b.className = 'scan-face' + (i === step ? ' active' : '') + (captured[st.face] ? ' done' : '');
      b.title = `Select the ${NAMES[st.face]} face to (re)capture`;
      const mini = document.createElement('div');
      mini.className = 'mini';
      for (let k = 0; k < 9; k++) {
        const c = document.createElement('span');
        const letter = snapped[st.face] ? snapped[st.face][k] : k === 4 ? st.face : null;
        if (letter) c.style.background = `var(--c-${letter})`;
        mini.appendChild(c);
      }
      const label = document.createElement('span');
      label.textContent = NAMES[st.face];
      b.append(mini, label);
      b.addEventListener('click', () => { step = i; renderSide(); });
      faces.appendChild(b);
    });
    $('scanApply').disabled = count < 6;
    $('scanApply').textContent = count < 6 ? `Use these colors (${count}/6 captured)` : 'Use these colors';
  }

  function apply() {
    const result = Scan.classify(collectSamples());
    closeDialog();
    onApply(result.facelets.split(''), result.uncertain);
  }

  window.RubikScanner = { init, isOpen: () => open };
})();
