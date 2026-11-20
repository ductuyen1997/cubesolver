# Rubik's Cube Solver

A dependency-free web app that solves any legal 3×3 Rubik's Cube position, usually in about 20 moves.

## Run

Open `index.html` in a browser. No build step is needed.

The live camera scanner needs the page served from `localhost` or HTTPS, because browsers only allow
camera access there. Run:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Photo and video upload also work straight from the file.

## Use

1. Press **📷 Scan** and capture the six faces with your camera, from photos, or from a video file.
   Follow the on-screen instructions for how to hold the cube for each face, and drag or resize the grid
   to fit. Then press **Use these colors**. Stickers outlined with dashes were close calls, so double-check them.
   Or enter the colors by hand:
   hold your cube with **white on top** and **green in front**.
2. Pick a color in the palette and click stickers on the net (or on the 3D cube) to match your cube.
   Use **Clear colors** to start from blank stickers. **Scramble** makes a random position.
3. Press **Solve**, then **Play**, or step through the moves with ◀ / ▶| (arrow keys also work).

**Patterns:** pick a pattern such as X, Plus (+), Checkerboard, Cube in a cube or Superflip
(15 in total). The app works out the moves from your cube's current state, and you play them like a solution.

**The solver person:** a cartoon person sits behind the cube and turns it. Their hands flick with every move,
a speech bubble shows the move, they think while the solver searches and cheer when the cube is solved or a pattern
is finished. Use "Hide the solver" under the cube to switch them off (the choice is remembered).

Keyboard: `U R F D L B` turn faces clockwise, `Shift`+key turns counter-clockwise, `Space` plays or pauses.

## How it works

- `js/cube.js`: the facelet model, derived from 3D geometry (sticker positions are rotated in space).
- `js/solver.js`: Kociemba's two-phase algorithm. It first reaches the subgroup ⟨U, D, R2, L2, F2, B2⟩,
  then solves within it, using IDA* with move and pruning tables (about 1 s to build at page load).
  It also validates input and explains errors such as a twisted corner, a flipped edge or swapped pieces.
  After the first solution, it keeps searching with a shorter length limit (for up to about 1.5 s). If a search
  at some length finds nothing, the previous solution is proven shortest. Lightly scrambled cubes get the
  shortest possible solution, and fully scrambled ones usually get 19–20 moves.
- `js/colorscan.js`: sticker color recognition. It samples the median color of each cell, measures color
  differences in a hue-weighted color space, and uses the six centers as reference colors. A Hungarian
  assignment then gives exactly 9 stickers per color, and the references are refined from the result.
- `js/scanner.js`: the scan dialog for camera, photo or video, with the guided face order and a live preview.
- `js/person.js`: the animated person, drawn as two SVG layers (behind and in front of the cube) driven by CSS animations.
- `js/patterns.js`: the pattern library, with each pattern stored as an algorithm from a solved cube. To reach a
  pattern from any cube, `Solver.solveTo(current, target)` solves the position `target⁻¹ · current`.
  The X pattern was found by rotating only the edge stickers 120° around the cube's diagonal.
- `js/app.js`: the CSS-3D cube rendering, animations, editor and solution playback.

## Test

```
node test/solver.test.js
node test/colorscan.test.js
node test/patterns.test.js
```
