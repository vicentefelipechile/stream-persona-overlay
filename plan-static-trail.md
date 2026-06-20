# Plan: Static Row layout system (parallel to the free system)

## Concept

A second pet-positioning model, also **backend-authoritative** (consistent with `GridManager`),
where pets are anchored in **a single row** pinned to the bottom **left or right** edge, stacked
from the edge toward the center, all the **same size**, with no wander. Pets enter when their owner
speaks and leave by **inactivity** (reusing the existing timer). When one enters/leaves, the rest
**re-pack** automatically, closing the gap.

It reuses the existing `tama-grid-config` / `tama-grid-update` / `tama-grid-remove` events, so the
frontend changes very little.

### Confirmed design decisions (from the user)

- **Removal trigger:** reuse the current inactivity timer (`tama_inactivity_mins` -> sleep -> despawn).
  No new timeout config.
- **Row order:** stack from the edge toward the center. Left: first pet flush to the left edge, the
  rest to its right; Right: mirrored. When one leaves, the others slide to close the gap (FIFO order).
- **Perspective:** uniform size. All pets equal, aligned in one flat row at the bottom edge.
- **UI control:** a dedicated new card ("Modo de disposicion") with the system checkbox and the row
  options, leaving the Config card for everything else.

## Key design decision

The row mode is a **layout** inside `GridManager`, not a separate parallel system. Internally the row
is an `N x 1` grid where the column order is compacted. This lets us reuse
`ensure`/`release`/`reconfigure`/snapshot and all the WS paths without duplicating logic.

- The current meaning of `tama_layout_mode = "static"` (6x1 grid) is **removed** and replaced by a
  dedicated key.
- New config key: **`tama_placement_mode`** = `"free"` (default, current free grid) | `"row"` (static row).
- New config key: **`tama_row_anchor`** = `"left"` (default) | `"right"`.
- The old "Tamano de la matriz" selector (Piso estatico 6x1 / Normal) is **removed** from the panel;
  "free" mode always uses the normal 150x30 grid (with optional high-precision).

---

## Changes - Backend (Rust)

### 1. `src-tauri/src/state.rs`
- Add to `AppConfig`: `tama_placement_mode: String` (default `"free"`), `tama_row_anchor: String`
  (default `"left"`).

### 2. `src-tauri/src/db/migrations.rs`
- Insert defaults `tama_placement_mode="free"`, `tama_row_anchor="left"`.
- One-shot migration: if `tama_layout_mode="static"` exists, set `tama_placement_mode="row"`
  (preserves behavior for anyone who had it). `tama_layout_mode` stays as legacy (get/set must not
  drop it), same as `tama_static_anchor`.

### 3. `src-tauri/src/grid/mod.rs` (core of the change)
- `GridState` gets a field `mode: PlacementMode { Free, Row { anchor: Anchor } }`.
- `reconfigure(app, placement_mode, row_anchor, high_precision)` (widened signature): in `Row` mode
  build an `ROW_COLS x 1` grid and mark the mode; in `Free` it behaves as today.
- **Row compaction**: new method `repack_row()` that reassigns columns `0..n` in arrival order toward
  the edge, plus an insertion order (`Vec<i64>` or index) for stable FIFO. Called after each
  `ensure`/`release` in Row mode.
  - Backend emits sequential columns `0..n`; the client maps the column to the correct edge using
    `tama_row_anchor` it receives via config. Keeps `Grid2D` as the only cell->pixel translator
    (consistent with the architecture).
- `wander_tick`: it already does `if cols*rows <= 1 || empty return;`. In Row mode skip the wander
  explicitly (`if self.mode == Row return;`) so pets don't move.
- `ensure_cell` / `place_nearest`: in Row mode, ignore the spacing/front-center logic and delegate to
  the sequential row assignment + `repack_row`.

### 4. `src-tauri/src/commands/config.rs`
- In the cache `match`: handle `tama_placement_mode` and `tama_row_anchor`.
- `rebuild_grid` now also triggers on `tama_placement_mode` and `tama_row_anchor`.
- The `state.grid.reconfigure(...)` call passes the new parameters.

### 5. `src-tauri/src/lib.rs`
- In the initial setup read `tama_placement_mode`/`tama_row_anchor` and pass them to `reconfigure`.
- The wander task only spawns if `placement_mode == "free" && wander_enabled` (no sense in Row).

---

## Changes - Frontend (TypeScript)

### 6. `src/overlay/tamagotchi/core/Grid2D.ts`
- Add `placementMode: "free" | "row"` and `rowAnchor` to `GridConfig`.
- New branch in `cellToPx`: in `"row"` mode, instead of the trapezoid band, compute a **flat row**
  anchored to the bottom edge:
  - fixed `top` (reuse `floorTopFrac`/bottom-margin), `scale = 1` (uniform size), `left` =
    `EDGE_PAD + col * (petSizePx + gap)` for left anchor; mirrored from the right for right anchor.
  - `z` per column for natural overlap.
- `rowEdges`/`rowTop`/perspective stay intact (only used in free mode). `GridGuide` is hidden in row mode.

### 7. `src/overlay/tamagotchi/core/PetManager.ts`
- In `init()` and `_onTamaConfigChanged()`: read `tama_placement_mode` / `tama_row_anchor` and pass
  them to `grid.setConfig(...)`.
- `_retranslateAll()` already recomputes everything on resize/config-change - works unchanged.
- No perspective in row: already covered by `Grid2D`.

### 8. `src/views/tamagotchi.ts` (admin panel)
- **Remove** the "Tamano de la matriz" selector block (Piso estatico 6x1 / Normal) and its
  `cfg-layout-mode` handler.
- **New card "Modo de disposicion"** (following `.tama-*`, `.section-title`, `.tama-setting-row`
  conventions):
  - System toggle/checkbox: Free (grid) <-> Static row.
  - Edge selector (Left / Right), visible/enabled only when row mode is selected (the
    `opacity/pointer-events` pattern already used in this view).
  - Handlers that persist `tama_placement_mode` / `tama_row_anchor` via `set_config_cmd` (live applied
    by `tama-config-changed`, no reload - `reconfigure` re-emits config+cells, so no reload needed).
- The "Efecto de perspectiva", high-precision, wander and guide cards still apply only to free mode;
  optionally dim them in row mode (UX improvement, not required).

### 9. Styles
- Reuse `tamagotchi-panel.css` (`.tama-*`). If a row class is needed in `pets.css`, keep it minimal.
  The flat row is achieved only with `left/top/scale` from `Grid2D`, no significant new CSS.

---

## Changes - Documentation

### 10. `AGENTS.md`
- Section 5 Config Keys: document `tama_placement_mode`, `tama_row_anchor`; mark `tama_layout_mode`
  as legacy/redefined.
- Section 17 (positioning): describe the second "row" mode (anchored static row, uniform size, no
  wander, FIFO compaction).
- Section 15 admin panel: the new card and the removal of the matrix selector.

---

## Verification
- `cd src-tauri && cargo build` and `cargo test` (existing grid tests must stay green; add 1-2 tests
  for `repack_row`/compaction for left/right anchor).
- `npx tsc --noEmit`.
- `npm run tauri dev`: test both overlays (Tauri + OBS Browser Source via `:6767`), toggle Free <->
  Row, left/right, watch the re-pack when pets enter/leave (use "Disparar Accion Manual" /
  `send_test_message`), and confirm there is no wander in row mode.

---

## Notes / risks
- **Right anchor**: the client receives `rowAnchor` via config and computes `left` from the correct
  edge; backend only emits sequential columns `0..n`. This keeps `Grid2D` as the single
  cell->pixel translator (consistent with the architecture).
- Reusing `tama-grid-*` avoids touching the WS protocol and the dispatcher.
- `BasePet`'s inactivity/sleep/despawn timer already closes the "stops talking -> leaves" loop; the
  `release` + `repack_row` close the gap.
