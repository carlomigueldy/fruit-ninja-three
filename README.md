# Fruit Ninja Three.js

A polished browser-based Fruit Ninja-style arcade game built with **Vite**, **TypeScript**, and **Three.js**. Swipe through flying fruit, chain combo slices, avoid bombs, and survive as long as possible in a responsive 3D dojo scene.

**Live demo:** https://fruit-ninja-three-inky.vercel.app  
**Repository:** https://github.com/carlomigueldy/fruit-ninja-three

## Table of Contents

- [Overview](#overview)
- [Gameplay](#gameplay)
- [Features](#features)
- [Controls](#controls)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Available Scripts](#available-scripts)
- [Build and Deployment](#build-and-deployment)
- [Debug and Smoke Testing](#debug-and-smoke-testing)
- [Implementation Notes](#implementation-notes)
- [Accessibility and UX](#accessibility-and-ux)
- [Troubleshooting](#troubleshooting)

## Overview

Fruit Ninja Three.js is a lightweight arcade clone focused on fast input response and satisfying feedback. It uses procedural 3D fruit, real pointer-based swipe detection, animated sliced halves, particle bursts, combo scoring, bombs, lives, high-score persistence, WebAudio sound effects, and a neon blade trail.

The game is designed to run entirely in the browser with no backend. It is suitable as a Three.js interaction demo, a Vite/TypeScript game starter, or a small deployable arcade project.

## Gameplay

The objective is simple:

1. Start a run from the title overlay.
2. Slice flying fruit before they fall off-screen.
3. Chain multiple slices quickly to earn combo bonuses.
4. Avoid bombs — slicing one costs lives.
5. Keep playing until all lives are lost.
6. Restart and try to beat the persisted best score.

### Scoring

- Each sliced fruit adds score.
- Multiple quick slices build combos.
- Combo chains award bonus points and display feedback in the HUD.

### Lives and Game Over

- Missed fruit costs lives.
- Bombs are more punishing than a missed fruit.
- The run ends when lives reach zero.
- The game-over overlay displays the final score and allows immediate restart.

## Features

### Core Game Systems

- Real mouse, pen, and touch swipe slicing through the Three.js canvas.
- Projectile fruit spawning with difficulty scaling over time.
- Multiple procedural fruit styles with distinct colors and geometry.
- Bomb hazards with explosion feedback and life penalties.
- Lives, scoring, best-score persistence, combo messages, restart flow, and game-over overlay.

### Visual Feedback

- Responsive 3D dojo-like arcade scene.
- Procedural fruit meshes and sliced fruit halves.
- Juice particles, floating score/combo text, and bomb explosions.
- Tapered neon blade trail that follows active swipes.
- Animated HUD and overlay styling designed for quick readability.

### Audio Feedback

- Procedural WebAudio sound effects for:
  - game start
  - slicing
  - combo hits
  - bombs
  - game over
- Persistent mute toggle.
- Mute button and `M` keyboard shortcut.

### Browser UX

- Responsive layout for desktop and mobile browser sizes.
- Pointer Events API support for mouse, stylus, and touch.
- Keyboard restart from game-over state.
- Accessible HUD status and mute button state.

## Controls

| Action | Control |
| --- | --- |
| Start game | Click **Start slicing** |
| Slice fruit | Swipe / drag across fruit with mouse, pen, or touch |
| Avoid bomb | Do not swipe through bombs |
| Toggle sound | Click the mute button or press `M` |
| Restart from game over | Click **Play again**, press `Enter`, or press `Space` |

## Tech Stack

- **TypeScript** — typed game logic and DOM integration.
- **Three.js** — 3D rendering, meshes, particles, camera, lighting, and scene graph.
- **Vite** — local development server and production build pipeline.
- **pnpm** — package manager and lockfile.
- **WebAudio API** — generated arcade sound effects without external audio files.
- **Pointer Events API** — unified mouse/touch/pen swipe handling.
- **localStorage** — persisted best score and mute preference.

## Project Structure

```txt
fruit-ninja-three/
├── index.html              # App shell, HUD, overlay, mute button
├── package.json            # Scripts and dependencies
├── pnpm-lock.yaml          # Locked dependency graph
├── pnpm-workspace.yaml     # pnpm workspace metadata
├── tsconfig.json           # TypeScript config
├── src/
│   ├── main.ts             # Three.js scene, gameplay, input, audio, debug API
│   ├── styles.css          # HUD, overlay, layout, and responsive styling
│   └── vite-env.d.ts       # Vite and debug API typings
└── dist/                   # Generated production build output
```

## Getting Started

### Prerequisites

- Node.js 22+ recommended
- pnpm 11+

Check your versions:

```bash
node -v
pnpm -v
```

### Install dependencies

```bash
pnpm install
```

### Run locally

```bash
pnpm dev
```

Vite will print the local URL, typically:

```txt
http://127.0.0.1:5173/
```

In this project the dev script binds to `127.0.0.1` for predictable local browser testing.

## Available Scripts

```bash
pnpm dev
```

Starts the Vite development server.

```bash
pnpm build
```

Runs TypeScript compilation and creates a production Vite build in `dist/`.

```bash
pnpm preview
```

Serves the production build locally for preview testing.

## Build and Deployment

### Production build

```bash
pnpm build
```

Expected successful output includes:

```txt
✓ built
```

Vite may warn that the Three.js bundle is larger than 500 KB after minification. That warning is expected for this small single-page Three.js demo and does not prevent deployment.

### Vercel

This app is a static Vite project and can be deployed on Vercel with:

- Framework preset: **Vite**
- Install command: `pnpm install`
- Build command: `pnpm build`
- Output directory: `dist`

After deployment, the production URL should be added to the GitHub repository homepage/About section and to the live demo link at the top of this README.

## Debug and Smoke Testing

The browser exposes a small debug API at:

```ts
window.__fruitNinjaDebug
```

Available helpers include:

- `spawnFruitAtScreen(x, y)` — spawn a fruit at a screen coordinate.
- `spawnBombAtScreen(x, y)` — spawn a bomb at a screen coordinate.
- `sliceAtScreen(x, y)` — run a synthetic slice through a coordinate.
- `getState()` — inspect score, lives, game-over state, active targets, trail visibility, and mute state.
- `toggleMute()` — toggle audio mute state.
- `restart()` — restart the game without audio unlock.

These hooks are intended for smoke tests and browser verification. They make it possible to assert key gameplay loops without relying on manual play.

Example browser-console smoke check:

```js
const d = window.__fruitNinjaDebug;
d.restart();
d.spawnFruitAtScreen(500, 300);
d.sliceAtScreen(500, 300);
d.getState();
```

## Implementation Notes

### Swipe detection

Pointer movement is tracked as a stream of recent screen/world points. Each movement segment is checked against active targets. This allows real drag and swipe gestures rather than simple click-to-destroy behavior.

### Blade trail

The blade trail is rendered as a tapered, camera-facing ribbon built from recent swipe points. It appears only while a pointer is actively swiping and clears on pointer release or game over.

### Procedural assets

Fruit, particles, floating text, bombs, and effects are generated at runtime with Three.js primitives and canvas textures. The game does not require external art or audio assets.

### Audio

Sound effects are synthesized with the WebAudio API. Because browsers restrict autoplaying audio, the game unlocks audio from user gestures such as clicking Start, clicking mute, or pressing keyboard controls.

### Cleanup and memory

Transient targets and effects are removed from the Three.js scene and disposed when no longer needed. Shared cached geometries/textures are preserved to avoid disposing reusable resources incorrectly.

## Accessibility and UX

- The HUD uses ARIA labels/live regions for status updates.
- The mute button exposes `aria-pressed` and updates its label between mute/unmute states.
- The game-over flow supports keyboard restart with `Enter` or `Space`.
- The layout adapts for smaller screens and touch play.

## Troubleshooting

### The local server opens a different port

If port `5173` is busy, Vite may choose a different port. Use the URL printed by the terminal.

### Audio does not play immediately

Most browsers require a user gesture before audio can start. Click **Start slicing** or interact with the mute button to unlock audio.

### Build warns about chunk size

Three.js is a large dependency, so Vite may warn about a chunk over 500 KB. The current app still builds and deploys successfully. If the project grows, consider dynamic imports or manual chunking.

### Touch gestures scroll the page instead of slicing

The game canvas is configured for pointer input. If a browser/device still scrolls unexpectedly, make sure you are dragging inside the active game canvas area.

## Verification Checklist

Before publishing a change, run:

```bash
pnpm build
```

Then smoke-test in the browser:

- Start a run.
- Slice a fruit and confirm score increases.
- Slice multiple fruit quickly and confirm combo feedback.
- Miss fruit and confirm lives decrease.
- Slice a bomb and confirm the penalty.
- Reach game over and restart.
- Toggle mute with the button and with `M`.

## License

No license has been selected yet. Add one before accepting external contributions or reusing the project outside personal/demo contexts.
