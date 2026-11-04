<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

# Project rules

- AirDraw is a single-page, client-only drawing app at `/`; no backend. Why: everything (camera, tracking, drawing) runs in the browser.
- Drawing logic lives in framework-agnostic modules under `src/lib/airdraw/` (engine, gestures, geometry, render); React components only wire DOM events to them. Why: the logic is unit-tested without a browser.
- Stroke points are stored in stage-relative 0..1 coordinates. Why: drawings must survive window resizes.
- Every change to strokes (draw, move, erase, clear) goes through `DrawingEngine` so it is undoable.
- Hand tracking uses `@mediapipe/tasks-vision` imported dynamically; its version is pinned exactly in package.json and must match `TASKS_VISION_VERSION` in `use-hand-tracking.ts`. Why: the WASM files are loaded from the CDN by version.
- `three` is only imported from `Scene3D.tsx`, which is loaded with `React.lazy` behind `<ClientOnly>`. Why: keeps WebGL out of SSR and the initial bundle.
- Canvas/WebGL colors are read from CSS variables at runtime (`readCssVar`, `cssColorToHex`); ink colors in `palette.ts` are drawing data, not theme tokens.
- Drawings and brush settings persist to localStorage (`src/lib/airdraw/storage.ts`, validated with zod).
