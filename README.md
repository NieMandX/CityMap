# CityMap

CityMap is an early RoadBLD-like web prototype for drawing road splines in one 3D viewport and generating editable 3D road geometry directly in the browser.

## Current MVP

- Vite + TypeScript application shell.
- Road math is separated into `src/core/geometry.ts`.
- Three.js mesh generation is separated into `src/render/mesh-builders.ts`.
- Single Three.js WebGPU viewport with perspective and top views.
- Automatic WebGL2 fallback through Three.js `WebGPURenderer`; force fallback with `?renderer=webgl`.
- Road spline drawing by clicking the ground plane.
- Editable control points, road width, lane count, lane width, and sidewalk settings.
- Procedural asphalt, curbs, sidewalks, lane markings, and a simple roundabout generator.
- Demo satellite/scheme/mask underlays, image upload, and optional Yandex Static API underlay hook.
- JSON project export and GLB model export.

## Run

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:4173/
```

## Verify

```bash
npm run ci:verify
```

`ci:verify` runs TypeScript checks and a production Vite build.

## Deploy

Pushes to `main` build `dist/` and publish it to GitHub Pages through `.github/workflows/pages.yml`.

For repositories still configured to publish from the branch root, run this before committing:

```bash
npm run build:pages-root
```

That command copies the production Vite output into root `index.html` and `assets/`.

## Architecture Direction

- `src/road-editor.ts` owns application state, UI, input, scene orchestration, and export flow.
- `src/core/` is renderer-independent road/topology math.
- `src/render/` owns Three.js/WebGPU mesh and debug-layer construction.

## Notes

Yandex imagery should be loaded through official API access or user-provided imagery. Do not scrape map tiles.
