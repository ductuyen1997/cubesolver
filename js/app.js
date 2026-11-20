(function () {
  'use strict';

  const Cube = window.RubikCube;
  const Solver = window.RubikSolver;
  const Person = window.RubikPerson;
  const $ = (id) => document.getElementById(id);

  const COLOR_KEYS = ['U', 'R', 'F', 'D', 'L', 'B'];
  const COLOR_NAMES = { U: 'White', R: 'Red', F: 'Green', D: 'Yellow', L: 'Orange', B: 'Blue' };
  const UNPAINTED = 'X';
  const CENTERS = new Set([4, 13, 22, 31, 40, 49]);

  // ---------- state ----------
  let facelets = Cube.SOLVED.split('');
  let selectedColor = 'U';
  let solution = null; // { moves, index, start }
  let uncertain = new Set(); // sticker indices the scanner was unsure about
  let playing = false;
  const queue = [];
  let animating = false;

  const busy = () => animating || queue.length > 0;

  // ---------- 3D cube ----------
  const cubeEl = $('cube');
  const sceneEl = $('scene');
  const cubies = [];
  const stickerEls = []; // indexed by facelet index
  const FACE_TRANSFORMS = [
    'rotateX(90deg)', 'rotateY(90deg)', '', 'rotateX(-90deg)', 'rotateY(-90deg)', 'rotateY(180deg)',
  ];
  let unit = 56;

  function readUnit() {
    unit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cubie')) || 56;
  }

  function buildCube() {
    readUnit();
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          const pos = [x, y, z];
          const el = document.createElement('div');
          el.className = 'cubie';
          Cube.NORMALS.forEach((n, f) => {
            const face = document.createElement('div');
            face.className = 'face';
            face.dataset.f = f;
            if (pos[0] * n[0] + pos[1] * n[1] + pos[2] * n[2] === 1) {
              const idx = Cube.faceletIndex(pos, n);
              const st = document.createElement('div');
              st.className = 'sticker' + (CENTERS.has(idx) ? ' center' : '');
              st.dataset.idx = idx;
              face.appendChild(st);
              stickerEls[idx] = st;
            }
            face.style.transform = `${FACE_TRANSFORMS[f]} translateZ(${unit / 2}px)`;
            el.appendChild(face);
          });
          cubeEl.appendChild(el);
          cubies.push({ el, pos });
        }
      }
    }
    resetCubieTransforms();
  }

  function baseTranslate(pos) {
    return [pos[0] * unit, -pos[1] * unit, pos[2] * unit];
  }

  function resetCubieTransforms() {
    for (const c of cubies) {
      const [tx, ty, tz] = baseTranslate(c.pos);
      c.el.style.transform = `translate3d(${tx}px, ${ty}px, ${tz}px)`;
    }
  }

  function relayout() {
    readUnit();
    cubeEl.querySelectorAll('.face').forEach((face) => {
      face.style.transform = `${FACE_TRANSFORMS[+face.dataset.f]} translateZ(${unit / 2}px)`;
    });
    if (!animating) resetCubieTransforms();
  }

  /** CSS matrix3d for a world rotation of `angle` radians about axis n, applied after translating to pos. */
  function rotationMatrix(n, angle, pos) {
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    const [x, y, z] = n;
    const R = [
      [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
      [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
      [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    ];
    // World (y up) -> CSS (y down): conjugate by diag(1, -1, 1).
    const sg = [1, -1, 1];
    const M = R.map((row, i) => row.map((v, j) => v * sg[i] * sg[j]));
    const p = baseTranslate(pos);
    const tr = M.map((row) => row[0] * p[0] + row[1] * p[1] + row[2] * p[2]);
    return `matrix3d(${M[0][0]},${M[1][0]},${M[2][0]},0,${M[0][1]},${M[1][1]},${M[2][1]},0,` +
      `${M[0][2]},${M[1][2]},${M[2][2]},0,${tr[0]},${tr[1]},${tr[2]},1)`;
  }

  function animationMs() {
    const s = +$('speed').value;
    return 760 - s * 68;
  }

  function animateMove(m, done) {
    const f = Math.floor(m / 3);
    const n = Cube.NORMALS[f];
    const target = [-Math.PI / 2, -Math.PI, Math.PI / 2][m % 3];
    const layer = cubies.filter((c) => c.pos[0] * n[0] + c.pos[1] * n[1] + c.pos[2] * n[2] === 1);
    const dur = animationMs() * (m % 3 === 1 ? 1.4 : 1);
    Person.move(m, dur);
    const start = performance.now();
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    function frame(now) {
      const t = Math.min(1, (now - start) / dur);
      const a = target * ease(t);
      for (const c of layer) c.el.style.transform = rotationMatrix(n, a, c.pos);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        done();
        resetCubieTransforms();
      }
    }
    requestAnimationFrame(frame);
  }

  function enqueueMove(m, onDone) {
    uncertain.clear(); // stickers move, so scan highlights no longer apply
    queue.push({ m, onDone });
    if (!animating) runQueue();
  }

  function runQueue() {
    const item = queue.shift();
    if (!item) {
      animating = false;
      updateControls();
      return;
    }
    animating = true;
    updateControls();
    animateMove(item.m, () => {
      facelets = Cube.applyMove(facelets, item.m);
      render();
      if (!queue.length) celebrateIfDone();
      if (item.onDone) item.onDone();
      runQueue();
    });
  }

  /** The person cheers when the cube gets solved, or when a pattern is finished. */
  function celebrateIfDone() {
    const done = solution && solution.index >= solution.moves.length;
    if (Cube.isSolved(facelets.join(''))) Person.cheer('Solved! 🎉');
    else if (done && solution.title !== 'Solution') Person.cheer('Ta-da! ✨');
  }

  // ---------- camera ----------
  let rotX = -28, rotY = -38;
  function applyCamera() {
    cubeEl.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
  }

  function setupDrag() {
    let startX = 0, startY = 0, lastX = 0, lastY = 0, moved = false, down = false, target = null;
    sceneEl.addEventListener('pointerdown', (e) => {
      down = true;
      moved = false;
      target = e.target;
      startX = lastX = e.clientX;
      startY = lastY = e.clientY;
      sceneEl.setPointerCapture(e.pointerId);
    });
    sceneEl.addEventListener('pointermove', (e) => {
      if (!down) return;
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 5) {
        moved = true;
        sceneEl.classList.add('dragging');
      }
      if (moved) {
        rotY += (e.clientX - lastX) * 0.45;
        rotX = Math.max(-89, Math.min(89, rotX - (e.clientY - lastY) * 0.45));
        applyCamera();
      }
      lastX = e.clientX;
      lastY = e.clientY;
    });
    const end = () => {
      if (down && !moved && target && target.classList.contains('sticker')) paint(+target.dataset.idx);
      down = false;
      sceneEl.classList.remove('dragging');
    };
    sceneEl.addEventListener('pointerup', end);
    sceneEl.addEventListener('pointercancel', () => { down = false; sceneEl.classList.remove('dragging'); });
  }

  // ---------- net editor & palette ----------
  const netCells = [];
  // Face block positions in a 4x3 grid of 3x3 blocks: [blockRow, blockCol]
  const NET_POS = { U: [0, 1], L: [1, 0], F: [1, 1], R: [1, 2], B: [1, 3], D: [2, 1] };

  function buildNet() {
    const net = $('net');
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 12; col++) {
        const br = Math.floor(row / 3), bc = Math.floor(col / 3);
        const face = Object.keys(NET_POS).find((k) => NET_POS[k][0] === br && NET_POS[k][1] === bc);
        let el;
        if (face) {
          const idx = COLOR_KEYS.indexOf(face) * 9 + (row % 3) * 3 + (col % 3);
          el = document.createElement('button');
          el.className = 'cell' + (CENTERS.has(idx) ? ' center' : '');
          el.title = `${face}${(row % 3) * 3 + (col % 3) + 1}`;
          el.addEventListener('click', () => paint(idx));
          netCells[idx] = el;
        } else {
          el = document.createElement('div');
        }
        if (col % 3 === 0 && col > 0) el.classList.add('gap-left');
        if (row % 3 === 0 && row > 0) el.classList.add('gap-top');
        net.appendChild(el);
      }
    }
  }

  const swatches = {};
  function buildPalette() {
    const pal = $('palette');
    for (const k of COLOR_KEYS) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.title = COLOR_NAMES[k];
      b.innerHTML = `<span class="chip" style="background: var(--c-${k})"></span><span class="count"></span>`;
      b.addEventListener('click', () => {
        selectedColor = k;
        renderPalette();
      });
      pal.appendChild(b);
      swatches[k] = b;
    }
  }

  function renderPalette() {
    const counts = {};
    for (const c of facelets) counts[c] = (counts[c] || 0) + 1;
    for (const k of COLOR_KEYS) {
      swatches[k].classList.toggle('active', k === selectedColor);
      const cnt = swatches[k].querySelector('.count');
      cnt.textContent = `${counts[k] || 0}/9`;
      cnt.classList.toggle('bad', (counts[k] || 0) !== 9);
    }
  }

  function paint(idx) {
    if (busy() || CENTERS.has(idx)) return;
    if (facelets[idx] === selectedColor) return;
    stopPlaying();
    facelets[idx] = selectedColor;
    uncertain.delete(idx);
    clearSolution();
    setMessage('');
    render();
  }

  // ---------- rendering ----------
  function render() {
    for (let i = 0; i < 54; i++) {
      const col = `var(--c-${facelets[i]})`;
      stickerEls[i].style.background = col;
      netCells[i].style.background = col;
      netCells[i].classList.toggle('uncertain', uncertain.has(i));
    }
    renderPalette();
    renderSolution();
  }

  function setMessage(text, kind) {
    const el = $('message');
    el.textContent = text;
    el.className = 'message' + (kind ? ' ' + kind : '');
  }

  function clearSolution() {
    solution = null;
    setActivePattern(null);
    setPatternMessage('');
    playing = false;
    $('playback').hidden = true;
  }

  function renderSolution() {
    if (!solution) return;
    const box = $('solutionMoves');
    if (box.childElementCount !== solution.moves.length) {
      box.innerHTML = '';
      solution.moves.forEach((m, i) => {
        const s = document.createElement('span');
        s.className = 'mv';
        s.textContent = Cube.moveToString(m);
        s.title = `Move ${i + 1}`;
        box.appendChild(s);
      });
    }
    [...box.children].forEach((el, i) => {
      el.classList.toggle('done', i < solution.index);
      el.classList.toggle('current', i === solution.index);
    });
    const n = solution.moves.length;
    $('solutionTitle').textContent = solution.title;
    $('solutionInfo').textContent = solution.index >= n
      ? `${n} moves · done!`
      : `${n} moves · step ${solution.index + 1} of ${n}`;
    updateControls();
  }

  function updateControls() {
    const b = busy();
    if (solution) {
      const n = solution.moves.length;
      $('btnFirst').disabled = (b && !playing) || solution.index === 0;
      $('btnPrev').disabled = b || solution.index === 0;
      $('btnNext').disabled = b || solution.index >= n;
      $('btnLast').disabled = (b && !playing) || solution.index >= n;
      $('btnPlay').disabled = !playing && (b || solution.index >= n);
      $('btnPlay').textContent = playing ? '⏸ Pause' : '▶ Play';
    }
    $('btnSolve').disabled = !Solver.isReady() || b;
    for (const id of ['btnScramble', 'btnReset', 'btnClear', 'btnApply']) $(id).disabled = b;
    for (const btn of Object.values(patternButtons)) btn.disabled = b;
  }

  // ---------- solution playback ----------
  function stepForward(onDone) {
    if (!solution || busy() || solution.index >= solution.moves.length) return false;
    const m = solution.moves[solution.index++];
    renderSolution();
    enqueueMove(m, onDone);
    return true;
  }

  function stepBack() {
    if (!solution || busy() || solution.index === 0) return;
    const m = solution.moves[--solution.index];
    renderSolution();
    enqueueMove(Cube.invertMove(m));
  }

  function playLoop() {
    if (!playing) return;
    const started = stepForward(() => {
      if (playing) setTimeout(playLoop, 60);
    });
    if (!started) {
      playing = false;
      updateControls();
    }
  }

  function togglePlay() {
    if (!solution) return;
    if (playing) {
      stopPlaying();
      return;
    }
    if (solution.index >= solution.moves.length) return;
    playing = true;
    updateControls();
    playLoop();
  }

  function stopPlaying() {
    playing = false;
    queue.length = 0;
    updateControls();
  }

  function jumpTo(index) {
    if (!solution) return;
    stopPlaying();
    if (animating) {
      // Let the running move finish, then jump.
      setTimeout(() => jumpTo(index), 30);
      return;
    }
    solution.index = index;
    facelets = Cube.applyMoves(solution.start.split(''), solution.moves.slice(0, index));
    render();
  }

  // ---------- actions ----------
  function doSolve() {
    if (busy()) return;
    const missing = facelets.filter((c) => c === UNPAINTED).length;
    if (missing) {
      setMessage(`${missing} sticker${missing > 1 ? 's are' : ' is'} still unpainted.`, 'error');
      return;
    }
    const str = facelets.join('');
    if (Cube.isSolved(str)) {
      clearSolution();
      setMessage('The cube is already solved. Scramble it or paint your own cube first.', 'ok');
      return;
    }
    setMessage('Searching for the shortest solution…');
    $('btnSolve').disabled = true;
    Person.think();
    setTimeout(() => {
      const res = Solver.solve(str);
      updateControls();
      if (res.error) {
        clearSolution();
        setMessage(res.error, 'error');
        Person.react('Hmm, this cube looks wrong…');
        return;
      }
      Person.react(`Got it! ${res.moves.length} moves.`, true);
      solution = { moves: res.moves, index: 0, start: str, title: 'Solution' };
      $('solutionMoves').innerHTML = '';
      $('playback').hidden = false;
      const quality = res.optimal ? ' (the shortest possible)' : '';
      setMessage(`Found a ${res.moves.length}-move solution${quality} in ${res.ms} ms. Press Play or step through it.`, 'ok');
      render();
    }, 30);
  }

  // ---------- patterns ----------
  const PATTERNS = window.RubikPatterns.PATTERNS;
  const patternButtons = {};

  /** Small isometric picture (U, F, R faces) of a facelet string, as SVG. */
  function patternThumb(f) {
    const proj = (v) => `${((v[0] - v[2]) * 0.866).toFixed(3)},${((v[0] + v[2]) * 0.5 - v[1]).toFixed(3)}`;
    const quad = (center, n, half) => {
      const [a, b] = [0, 1, 2].filter((k) => n[k] === 0);
      return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([s1, s2]) => {
        const p = center.slice();
        p[a] += s1 * half;
        p[b] += s2 * half;
        return proj(p);
      }).join(' ');
    };
    let svg = '';
    for (let fi = 0; fi < 3; fi++) { // U, R, F
      const n = Cube.NORMALS[fi];
      svg += `<polygon points="${quad(n.map((v) => v * 1.5), n, 1.5)}" fill="#111"/>`;
    }
    for (const s of Cube.STICKERS) {
      if (s.face > 2) continue;
      const center = s.pos.map((v, k) => v + s.normal[k] * 0.5);
      svg += `<polygon points="${quad(center, s.normal, 0.42)}" style="fill: var(--c-${f[s.index]})"/>`;
    }
    return `<svg viewBox="-2.7 -3.1 5.4 6.2" aria-hidden="true">${svg}</svg>`;
  }

  function buildPatterns() {
    const grid = $('patternGrid');
    for (const p of PATTERNS) {
      const b = document.createElement('button');
      b.className = 'pattern';
      b.title = p.desc;
      b.innerHTML = patternThumb(Cube.applyMoves(Cube.SOLVED, Cube.parseMoves(p.alg))) + `<span>${p.name}</span>`;
      b.addEventListener('click', () => makePattern(p));
      grid.appendChild(b);
      patternButtons[p.id] = b;
    }
  }

  function setActivePattern(id) {
    for (const [k, b] of Object.entries(patternButtons)) b.classList.toggle('active', k === id);
  }

  function setPatternMessage(text, kind) {
    const el = $('patternMsg');
    el.textContent = text;
    el.className = 'message' + (kind ? ' ' + kind : '');
  }

  function makePattern(p) {
    if (busy()) return;
    stopPlaying();
    const missing = facelets.filter((c) => c === UNPAINTED).length;
    if (missing) {
      setPatternMessage(`Paint all stickers first (${missing} still unpainted).`, 'error');
      return;
    }
    const current = facelets.join('');
    const targetMoves = Cube.parseMoves(p.alg);
    const target = Cube.applyMoves(Cube.SOLVED, targetMoves);
    if (current === target) {
      setPatternMessage(`Your cube already shows ${p.name}.`, 'ok');
      return;
    }
    setPatternMessage(`Finding the moves to make ${p.name}…`);
    Person.think();
    setTimeout(() => {
      const res = Solver.solveTo(current, target, { improveMs: 1000 });
      if (res.error) {
        setPatternMessage(res.error, 'error');
        Person.react('Hmm, this cube looks wrong…');
        return;
      }
      Person.react(`${p.name}? Easy!`, true);
      // From a solved cube, the classic algorithm may be just as short and is the "famous" one.
      let moves = res.moves;
      if (Cube.isSolved(current) && targetMoves.length <= moves.length) moves = targetMoves;
      uncertain.clear();
      clearSolution();
      solution = { moves, index: 0, start: current, title: `Make: ${p.name}` };
      setActivePattern(p.id);
      $('solutionMoves').innerHTML = '';
      $('playback').hidden = false;
      setMessage('');
      setPatternMessage(`${moves.length} moves to make ${p.name}. Press Play or step through them.`, 'ok');
      render();
      $('playback').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 30);
  }

  function manualMove(m) {
    if (solution) clearSolution();
    setMessage('');
    enqueueMove(m);
  }

  function setupActions() {
    $('btnSolve').addEventListener('click', doSolve);
    $('btnScramble').addEventListener('click', () => {
      if (busy()) return;
      const scr = Cube.randomScramble(25);
      facelets = Cube.applyMoves(Cube.SOLVED.split(''), scr);
      $('scrambleText').textContent = 'Scramble: ' + scr.map(Cube.moveToString).join(' ');
      Person.react('Whoa, all mixed up! 😵');
      uncertain.clear();
      clearSolution();
      setMessage('');
      render();
    });
    $('btnReset').addEventListener('click', () => {
      if (busy()) return;
      facelets = Cube.SOLVED.split('');
      $('scrambleText').textContent = '';
      uncertain.clear();
      clearSolution();
      setMessage('');
      render();
    });
    $('btnClear').addEventListener('click', () => {
      if (busy()) return;
      facelets = facelets.map((c, i) => (CENTERS.has(i) ? c : UNPAINTED));
      $('scrambleText').textContent = '';
      uncertain.clear();
      clearSolution();
      setMessage('All stickers cleared — paint them to match your cube.');
      render();
    });
    $('btnApply').addEventListener('click', applyAlgorithm);
    $('algInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyAlgorithm();
    });

    $('btnPlay').addEventListener('click', togglePlay);
    $('btnNext').addEventListener('click', () => stepForward());
    $('btnPrev').addEventListener('click', stepBack);
    $('btnFirst').addEventListener('click', () => jumpTo(0));
    $('btnLast').addEventListener('click', () => solution && jumpTo(solution.moves.length));

    const pad = $('movePad');
    for (const suffix of ['', "'", '2']) {
      for (const f of COLOR_KEYS) {
        const b = document.createElement('button');
        b.textContent = f + suffix;
        b.addEventListener('click', () => manualMove(Cube.parseMoves(f + suffix)[0]));
        pad.appendChild(b);
      }
    }

    document.addEventListener('keydown', (e) => {
      if (window.RubikScanner.isOpen()) return;
      if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (COLOR_KEYS.includes(k)) {
        if (queue.length > 3) return;
        manualMove(COLOR_KEYS.indexOf(k) * 3 + (e.shiftKey ? 2 : 0));
      } else if (e.key === ' ' && solution) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        stepForward();
      } else if (e.key === 'ArrowLeft') {
        stepBack();
      }
    });

    window.addEventListener('resize', relayout);
  }

  function applyAlgorithm() {
    if (busy()) return;
    const moves = Cube.parseMoves($('algInput').value);
    if (!moves) {
      setMessage("Couldn't read that algorithm. Use moves like R U R' U' F2.", 'error');
      return;
    }
    if (solution) clearSolution();
    setMessage('');
    moves.forEach((m) => enqueueMove(m));
  }

  function applyScan(letters, unsure) {
    if (busy()) return;
    stopPlaying();
    facelets = letters;
    $('scrambleText').textContent = '';
    clearSolution();
    uncertain = new Set(unsure);
    const check = Solver.toCubie(facelets.join(''));
    if (check.error) {
      setMessage(`Scanned, but the result isn't a valid cube: ${check.error} ` +
        'Fix the stickers that look wrong (dashed ones were close calls) or rescan a face.', 'error');
    } else if (unsure.length) {
      setMessage(`Scanned! ${unsure.length} sticker${unsure.length > 1 ? 's were close calls' : ' was a close call'} ` +
        '(dashed outline). Check them against your cube, then press Solve.', 'ok');
    } else {
      setMessage('Scanned! Check that the colors match your cube, then press Solve.', 'ok');
    }
    render();
  }

  // ---------- boot ----------
  buildCube();
  Person.init(sceneEl);
  const personBtn = $('btnPerson');
  const syncPersonBtn = () => { personBtn.textContent = Person.isVisible() ? 'Hide the solver' : 'Show the solver'; };
  personBtn.addEventListener('click', () => { Person.setVisible(!Person.isVisible()); syncPersonBtn(); });
  syncPersonBtn();
  buildNet();
  buildPalette();
  setupDrag();
  setupActions();
  buildPatterns();
  window.RubikScanner.init({ onApply: applyScan });
  applyCamera();
  render();
  updateControls();

  // Build solver tables after the first paint so the page appears immediately.
  setTimeout(() => {
    const t = performance.now();
    Solver.init();
    const status = $('status');
    status.textContent = `Solver ready (tables built in ${Math.round(performance.now() - t)} ms)`;
    status.classList.add('ready');
    updateControls();
  }, 50);
})();
