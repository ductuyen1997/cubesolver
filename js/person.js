/*
 * A cartoon person sitting behind the 3D cube who turns it: their hands flick
 * with every move, their eyes follow the working hand, they think while the
 * solver searches and cheer when the cube is solved.
 *
 * Drawn as two SVG layers in a 400×500 box: one behind the cube (chair, body,
 * head, arms) and one in front of it (hands, speech bubble, sparkles).
 */
(function (root) {
  'use strict';

  const SKIN = '#f2c28f', SKIN_DARK = '#c98f5e', SHIRT = '#7c5cff', SHIRT_DARK = '#5b3fd6';
  const PANTS = '#2f3e66', HAIR = '#3a2a20', WOOD = '#7a5638', WOOD_DARK = '#5c3f28';

  const BACK = `
<svg class="person-svg" viewBox="0 0 400 500" aria-hidden="true">
  <rect x="112" y="150" width="176" height="250" rx="20" fill="${WOOD}"/>
  <rect x="104" y="418" width="14" height="90" rx="4" fill="${WOOD_DARK}"/>
  <rect x="282" y="418" width="14" height="90" rx="4" fill="${WOOD_DARK}"/>
  <rect x="84" y="402" width="232" height="22" rx="10" fill="${WOOD}"/>
  <g class="p-all">
    <rect x="142" y="425" width="44" height="62" rx="14" fill="${PANTS}"/>
    <rect x="214" y="425" width="44" height="62" rx="14" fill="${PANTS}"/>
    <ellipse cx="160" cy="490" rx="30" ry="12" fill="#222"/>
    <ellipse cx="240" cy="490" rx="30" ry="12" fill="#222"/>
    <rect x="122" y="360" width="156" height="72" rx="30" fill="${PANTS}"/>
    <g class="p-breathe">
      <rect x="184" y="104" width="32" height="40" rx="8" fill="${SKIN_DARK}"/>
      <path d="M112,180 Q112,140 156,136 L244,136 Q288,140 288,180 L282,392 L118,392 Z" fill="${SHIRT}"/>
      <path d="M176,136 L200,166 L224,136 Z" fill="${SKIN_DARK}"/>
      <path class="p-arm" d="M136,160 C92,186 70,240 78,292" stroke="${SHIRT_DARK}" stroke-width="30" stroke-linecap="round" fill="none"/>
      <path class="p-arm" d="M264,160 C308,186 330,240 322,292" stroke="${SHIRT_DARK}" stroke-width="30" stroke-linecap="round" fill="none"/>
      <g class="p-head">
        <circle cx="151" cy="76" r="11" fill="${SKIN_DARK}"/>
        <circle cx="249" cy="76" r="11" fill="${SKIN_DARK}"/>
        <circle cx="200" cy="72" r="49" fill="${SKIN}"/>
        <path d="M151,72 Q146,18 200,18 Q256,18 249,72 Q240,40 204,42 Q186,30 176,44 Q160,48 151,72 Z" fill="${HAIR}"/>
        <path class="p-brow" d="M171,62 Q180,57 190,61" stroke="${HAIR}" stroke-width="4" stroke-linecap="round" fill="none"/>
        <path class="p-brow r" d="M210,61 Q220,57 229,62" stroke="${HAIR}" stroke-width="4" stroke-linecap="round" fill="none"/>
        <g class="p-eyes">
          <ellipse cx="181" cy="78" rx="9" ry="10" fill="#fff"/>
          <ellipse cx="219" cy="78" rx="9" ry="10" fill="#fff"/>
          <g class="p-pupils">
            <circle cx="181" cy="79" r="4.6" fill="#1d1d1d"/>
            <circle cx="219" cy="79" r="4.6" fill="#1d1d1d"/>
          </g>
        </g>
        <g class="p-happy-eyes">
          <path d="M172,81 Q181,70 190,81" stroke="#1d1d1d" stroke-width="3.5" stroke-linecap="round" fill="none"/>
          <path d="M210,81 Q219,70 228,81" stroke="#1d1d1d" stroke-width="3.5" stroke-linecap="round" fill="none"/>
        </g>
        <circle cx="168" cy="95" r="7" fill="#ff7b7b" opacity="0.35"/>
        <circle cx="232" cy="95" r="7" fill="#ff7b7b" opacity="0.35"/>
        <path class="p-mouth" d="M189,101 Q200,108 211,101" stroke="#7a3b2e" stroke-width="3.5" stroke-linecap="round" fill="none"/>
        <path class="p-mouth-open" d="M184,97 Q200,122 216,97 Z" fill="#8a2f2a"/>
        <path class="p-mouth-think" d="M192,104 L208,102" stroke="#7a3b2e" stroke-width="3.5" stroke-linecap="round"/>
      </g>
    </g>
  </g>
</svg>`;

  const hand = (id) => `
    <g class="p-hand" id="${id}">
      <g${id === 'pHandR' ? ' transform="translate(400,0) scale(-1,1)"' : ''}>
        <rect x="80" y="270" width="24" height="12" rx="6" fill="${SKIN}" stroke="${SKIN_DARK}" stroke-width="2"/>
        <rect x="82" y="284" width="24" height="12" rx="6" fill="${SKIN}" stroke="${SKIN_DARK}" stroke-width="2"/>
        <rect x="80" y="298" width="22" height="12" rx="6" fill="${SKIN}" stroke="${SKIN_DARK}" stroke-width="2"/>
        <ellipse cx="74" cy="292" rx="17" ry="24" fill="${SKIN}" stroke="${SKIN_DARK}" stroke-width="2"/>
        <ellipse cx="88" cy="262" rx="12" ry="7" transform="rotate(-25 88 262)" fill="${SKIN}" stroke="${SKIN_DARK}" stroke-width="2"/>
      </g>
    </g>`;

  const FRONT = `
<svg class="person-svg" viewBox="0 0 400 500" aria-hidden="true">
  <g class="p-all">${hand('pHandL')}${hand('pHandR')}</g>
  <g class="p-sparkles">
    <text x="112" y="40">✦</text><text x="282" y="30">✦</text>
    <text x="60" y="150">✦</text><text x="330" y="140">✦</text><text x="96" y="90">✦</text>
  </g>
</svg>
<div class="p-bubble" hidden></div>`;

  // Which hand turns each face, and how it flicks (screen px / degrees) for a clockwise turn.
  // Prime turns flick the other way; double turns flick further.
  const FLICK = {
    U: { cw: ['R', -12, -4, -10], ccw: ['L', 12, -4, 10] },
    R: { cw: ['R', 0, -14, -18], ccw: ['R', 0, 14, 18] },
    F: { cw: ['R', -4, -10, -24], ccw: ['L', 4, -10, 24] },
    D: { cw: ['L', 12, 4, 10], ccw: ['R', -12, 4, -10] },
    L: { cw: ['L', 0, 14, -18], ccw: ['L', 0, -14, 18] },
    B: { cw: ['L', 4, 10, 20], ccw: ['R', -4, 10, -20] },
  };
  const FACES = 'URFDLB';
  const MOVE_SUFFIX = ['', '2', "'"];

  let back, front, bubble, hands, scene, visible = true;
  let bubbleTimer = 0, moodTimer = 0;

  function init(sceneEl) {
    scene = sceneEl;
    back = document.createElement('div');
    back.className = 'person back';
    back.innerHTML = BACK;
    front = document.createElement('div');
    front.className = 'person front';
    front.innerHTML = FRONT;
    const cube = scene.querySelector('.cube');
    scene.insertBefore(back, cube);
    scene.appendChild(front);
    bubble = front.querySelector('.p-bubble');
    hands = { L: front.querySelector('#pHandL'), R: front.querySelector('#pHandR') };
    let saved = null;
    try { saved = localStorage.getItem('rubik.person'); } catch (e) { /* storage unavailable */ }
    setVisible(saved !== 'off');
  }

  function setVisible(on) {
    visible = on;
    scene.classList.toggle('with-person', on);
    try { localStorage.setItem('rubik.person', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
  }

  function setMood(mood, ms) {
    for (const el of [back, front]) {
      el.classList.remove('happy', 'thinking', 'cheer');
      if (mood) mood.split(' ').forEach((c) => el.classList.add(c));
    }
    clearTimeout(moodTimer);
    if (mood && ms) moodTimer = setTimeout(() => setMood(null), ms);
  }

  function say(text, ms = 1400) {
    if (!bubble) return;
    clearTimeout(bubbleTimer);
    bubble.textContent = text;
    bubble.hidden = !text;
    bubble.classList.remove('pop');
    void bubble.offsetWidth; // restart the pop animation
    bubble.classList.add('pop');
    if (text && ms) bubbleTimer = setTimeout(() => { bubble.hidden = true; }, ms);
  }

  /** Animate the hand that makes move `m` (0..17) over `ms` milliseconds. */
  function move(m, ms) {
    if (!visible || !hands) return;
    const face = FACES[Math.floor(m / 3)], power = m % 3;
    const [side, dx, dy, rot] = FLICK[face][power === 2 ? 'ccw' : 'cw'];
    const k = power === 1 ? 1.4 : 1;
    const el = hands[side];
    el.style.setProperty('--dx', `${dx * k}px`);
    el.style.setProperty('--dy', `${dy * k}px`);
    el.style.setProperty('--rot', `${rot * k}deg`);
    el.style.setProperty('--dur', `${Math.max(120, ms)}ms`);
    el.classList.remove('flick');
    void el.getBoundingClientRect(); // restart the animation
    el.classList.add('flick');
    back.style.setProperty('--lx', side === 'L' ? '-3px' : '3px');
    if (back.classList.contains('thinking')) setMood(null);
    say(face + MOVE_SUFFIX[power], Math.max(500, ms + 250));
  }

  function think(text) {
    if (!visible) return;
    setMood('thinking');
    back.style.setProperty('--lx', '0px');
    say(text || 'Hmm… 🤔', 0);
  }

  function cheer(text) {
    if (!visible) return;
    setMood('happy cheer', 2600);
    say(text || 'Solved! 🎉', 2600);
  }

  function react(text, happy) {
    if (!visible) return;
    setMood(happy ? 'happy' : null, happy ? 1600 : 0);
    say(text, 2200);
  }

  const api = { init, move, think, cheer, react, say, setVisible, isVisible: () => visible };
  root.RubikPerson = api;
})(typeof self !== 'undefined' ? self : this);
