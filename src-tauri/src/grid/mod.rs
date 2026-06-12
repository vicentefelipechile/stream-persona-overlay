// =========================================================================================================
// Pet grid (2D matrix) — backend-authoritative positioning
// =========================================================================================================
// The Tamagotchi pets used to position themselves entirely on the frontend, each
// client deriving pixel coordinates from its own `window.innerWidth/innerHeight`.
// Because the Tauri overlay and the OBS Browser Source are two independent clients,
// their positions diverged and there was no way to control where pets sat or moved.
//
// This module makes Rust the single source of truth for pet placement. The screen
// is modeled as a 2D grid of cells; each pet owns exactly one cell `(cell_x, cell_y)`.
// The backend assigns cells, runs a "wander" tick that nudges pets to free neighbor
// cells, and resolves the nearest free cell for fight/actions. It emits cell
// coordinates over BOTH `app.emit` (Tauri overlay window) and `broadcast_ws` (OBS
// Browser Source), so every client renders the same cells. Clients only translate
// cell -> pixels (with a perspective scale derived from the row).
//
// Dimensions are fixed per mode: a small "floor" grid (6x1) and a normal grid
// (150x30 = 4500 cells). The "high precision" toggle doubles both axes.
// =========================================================================================================

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::state::{AppState, GridUpdatePayload};

// Base dimensions per mode. The high-precision toggle doubles each axis.
const SMALL_COLS: u16 = 6;
const SMALL_ROWS: u16 = 1;
const NORMAL_COLS: u16 = 150;
const NORMAL_ROWS: u16 = 30;

/// Wander destination distance in cells. Each wander emits a SINGLE update; the
/// overlay then walks there at a constant slow speed. The wide range mixes short
/// shuffles with longer strolls so movement reads as natural wandering rather than
/// every pet dashing the same long distance toward an edge. On the fine 150×30 grid
/// even the max is well under half the width, so pets explore the middle instead of
/// repeatedly slamming into the far columns.
const WANDER_MIN_STEP: i32 = 6;
const WANDER_MAX_STEP: i32 = 45;

/// When a pet sits in the outer `EDGE_BIAS_FRAC` of the columns, its horizontal
/// wander direction is biased back toward the centre with this probability, so pets
/// drift away from the edges instead of accumulating there. 1.0 = always turn inward
/// at the very edge, fading to no bias by the time it reaches the zone's inner border.
const EDGE_BIAS_FRAC: f64 = 0.25;

/// Per-pet idle time between finishing one stroll and starting the next, in wander
/// ticks. Each pet draws its own value in this range, so pets move asynchronously
/// instead of all stepping on the same global beat. (One tick ≈ the wander interval
/// in `lib.rs`.) A low minimum keeps the floor lively; the spread breaks up sync.
const WANDER_COOLDOWN_MIN_TICKS: u32 = 1;
const WANDER_COOLDOWN_MAX_TICKS: u32 = 5;

/// When picking a wander/spawn destination, prefer cells with personal space so pets
/// keep their distance instead of piling up. We try several candidates and take the
/// first comfortable one, falling back to any free cell if none is found. A high count
/// makes the spacing hold even on a busy floor before we accept any overlap.
const WANDER_SPACING_TRIES: u32 = 24;

/// "Personal space" is measured in CELLS, but the visual separation a viewer sees is
/// anisotropic: a sprite is ~80px wide, yet a column is only ~(usableW/cols) px and a
/// row only ~(bandH/rows) px. On the normal 150×30 grid a sprite spans ROUGHLY 6
/// columns and 5 rows, so a 1-cell gap leaves sprites fully overlapping on screen.
/// These fractions of each axis approximate the sprite footprint + a gap, so the gap
/// holds at any density (high-precision doubles cols/rows AND these radii). The X gap
/// is wider because horizontal overlap is the most obvious to the eye and columns are
/// the most compressed axis.
const SPACING_FRAC_X: f64 = 0.085; // ~13 cols on a 150-wide grid (> one sprite footprint)
const SPACING_FRAC_Y: f64 = 0.15; // ~4-5 rows on a 30-tall grid

/// A single cell coordinate. `(0,0)` is the back-left of the floor band; higher
/// `y` is closer to the viewer (and rendered larger by the perspective scale).
type Cell = (u16, u16);

/// Snapshot of the grid sent to a freshly-connected client so it can rehydrate
/// dimensions + every pet's current cell without waiting for the next update.
#[derive(Clone, serde::Serialize)]
pub struct GridSnapshot {
    pub cols: u16,
    pub rows: u16,
    pub cells: Vec<GridUpdatePayload>,
}

/// Authoritative grid state. Stored behind a Mutex inside `GridManager`.
struct GridState {
    cols: u16,
    rows: u16,
    /// userId -> assigned cell.
    cells: HashMap<i64, Cell>,
    /// Currently occupied cells (mirror of `cells` values) for O(1) free-cell checks.
    occupied: HashSet<Cell>,
    /// userId -> wander ticks remaining before the pet may pick a new destination.
    /// Decremented each tick; a pet only wanders when its counter reaches 0, after
    /// which it draws a fresh per-pet cooldown. This desynchronizes movement.
    wander_wait: HashMap<i64, u32>,
}

impl GridState {
    fn dims_for(small_mode: bool, high_precision: bool) -> (u16, u16) {
        let (mut c, mut r) = if small_mode {
            (SMALL_COLS, SMALL_ROWS)
        } else {
            (NORMAL_COLS, NORMAL_ROWS)
        };
        if high_precision {
            c = c.saturating_mul(2);
            r = r.saturating_mul(2);
        }
        (c.max(1), r.max(1))
    }

    fn is_free(&self, cell: Cell) -> bool {
        cell.0 < self.cols && cell.1 < self.rows && !self.occupied.contains(&cell)
    }
}

/// Owns the authoritative grid. Lives in `AppState` as `Arc<GridManager>`.
#[derive(Default)]
pub struct GridManager {
    inner: Mutex<Option<GridState>>,
}

impl GridManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// (Re)builds the grid from the layout config. `small_mode` comes from
    /// `tama_layout_mode == "static"`; `high_precision` from `tama_grid_high_precision`.
    /// Pets whose cell falls outside the new bounds are repacked into free cells.
    /// Emits the new config + a fresh snapshot so every client re-renders. Called at
    /// startup and whenever a grid-shaping config key changes.
    pub fn reconfigure(&self, app: &AppHandle, small_mode: bool, high_precision: bool) {
        let Ok(mut guard) = self.inner.lock() else {
            return;
        };

        let (cols, rows) = GridState::dims_for(small_mode, high_precision);

        // Preserve existing pet assignments across a reconfigure when possible.
        let previous = guard.take();
        let mut state = GridState {
            cols,
            rows,
            cells: HashMap::new(),
            occupied: HashSet::new(),
            wander_wait: HashMap::new(),
        };

        if let Some(prev) = previous {
            for (user_id, cell) in prev.cells {
                let target = if state.is_free(cell) {
                    cell
                } else {
                    state.nearest_free(cell).unwrap_or((0, 0))
                };
                state.cells.insert(user_id, target);
                state.occupied.insert(target);
                // Stagger initial cooldowns so pets don't all wander on the first tick.
                state.wander_wait.insert(user_id, state.random_cooldown());
            }
        }

        let snapshot = state.snapshot();
        *guard = Some(state);
        drop(guard);

        emit_grid_config(app, cols, rows);
        broadcast_snapshot(app, &snapshot);
        tracing::info!(
            "[grid] Reconfigurada: {}x{} (small={}, precision={})",
            cols,
            rows,
            small_mode,
            high_precision
        );
    }

    /// Allocates the pet's cell if it doesn't have one yet. Returns the cell plus
    /// whether it was newly assigned (vs already present). Pure state mutation — the
    /// caller is responsible for emitting. Shared by both the Tauri and WS paths.
    fn ensure_cell(&self, user_id: i64) -> Option<(Cell, bool)> {
        let mut guard = self.inner.lock().ok()?;
        let state = guard.as_mut()?;
        if let Some(c) = state.cells.get(&user_id) {
            Some((*c, false))
        } else {
            let c = state.first_free().unwrap_or((0, 0));
            state.cells.insert(user_id, c);
            state.occupied.insert(c);
            // Give the fresh pet a randomized cooldown so its first stroll doesn't
            // coincide with everyone else's.
            let cooldown = state.random_cooldown();
            state.wander_wait.insert(user_id, cooldown);
            Some((c, true))
        }
    }

    /// Returns the pet's current cell, assigning a fresh free one on first call.
    /// Always emits a `tama-grid-update` so late-joining clients converge. Called by
    /// the overlay (Tauri window) when a pet spawns. Returns `None` if uninitialized.
    pub fn ensure(&self, app: &AppHandle, user_id: i64) -> Option<Cell> {
        let (cell, _) = self.ensure_cell(user_id)?;
        emit_grid_update(app, user_id, cell);
        Some(cell)
    }

    /// WS-only variant of `ensure` for OBS Browser Source clients (the WS command
    /// dispatcher has an `AppState` but no `AppHandle`). Broadcasts the update over
    /// the WebSocket fan-out only; there is no Tauri window to `emit` to from here.
    pub fn ensure_ws(&self, state: &AppState, user_id: i64) -> Option<Cell> {
        let (cell, _) = self.ensure_cell(user_id)?;
        state.broadcast_ws(
            "tama-grid-update",
            &GridUpdatePayload {
                user_id,
                cell_x: cell.0,
                cell_y: cell.1,
            },
        );
        Some(cell)
    }

    /// Removes the pet from the grid. Pure state mutation; the caller emits.
    fn release_cell(&self, user_id: i64) {
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(state) = guard.as_mut() {
                if let Some(cell) = state.cells.remove(&user_id) {
                    state.occupied.remove(&cell);
                }
                state.wander_wait.remove(&user_id);
            }
        }
    }

    /// Frees the pet's cell (call on despawn) and emits `tama-grid-remove`.
    pub fn release(&self, app: &AppHandle, user_id: i64) {
        self.release_cell(user_id);
        emit_grid_remove(app, user_id);
    }

    /// WS-only variant of `release` for OBS Browser Source clients.
    pub fn release_ws(&self, state: &AppState, user_id: i64) {
        self.release_cell(user_id);
        state.broadcast_ws(
            "tama-grid-remove",
            &serde_json::json!({ "user_id": user_id }),
        );
    }

    /// Resolves the free cell nearest `target` and assigns it to the pet. Pure state
    /// mutation; the caller emits. Shared by the Tauri and WS paths.
    fn place_nearest(&self, user_id: i64, target: Cell) -> Option<Cell> {
        let mut guard = self.inner.lock().ok()?;
        let state = guard.as_mut()?;
        let current = state.cells.get(&user_id).copied();
        if let Some(c) = current {
            state.occupied.remove(&c);
        }
        // Prefer the exact target if it's both free and roomy; otherwise the nearest
        // free cell that still has personal space; only then any nearest free cell.
        // This keeps fight/action repositioning from stacking pets on top of each other.
        let dest = if state.is_free(target) && state.has_personal_space(target) {
            target
        } else {
            state
                .nearest_free_spaced(target)
                .or_else(|| state.nearest_free(target))
                .or(current)
                .unwrap_or((0, 0))
        };
        state.cells.insert(user_id, dest);
        state.occupied.insert(dest);
        // An action just repositioned this pet; hold off the autonomous wander so it
        // doesn't immediately stroll away from where the action put it.
        let cooldown = state.random_cooldown();
        state.wander_wait.insert(user_id, cooldown);
        Some(dest)
    }

    /// Moves a pet to the free cell nearest `target`, used by fight/actions so pets
    /// converge on a meeting point instead of a hard-coded screen center. Emits the
    /// update (Tauri + WS) and returns the resolved cell.
    pub fn move_to_nearest_free(
        &self,
        app: &AppHandle,
        user_id: i64,
        target: Cell,
    ) -> Option<Cell> {
        let cell = self.place_nearest(user_id, target)?;
        emit_grid_update(app, user_id, cell);
        Some(cell)
    }

    /// WS-only variant of `move_to_nearest_free` for OBS Browser Source clients.
    pub fn move_to_nearest_free_ws(
        &self,
        state: &AppState,
        user_id: i64,
        target: Cell,
    ) -> Option<Cell> {
        let cell = self.place_nearest(user_id, target)?;
        state.broadcast_ws(
            "tama-grid-update",
            &GridUpdatePayload {
                user_id,
                cell_x: cell.0,
                cell_y: cell.1,
            },
        );
        Some(cell)
    }

    /// One wander tick. Each pet runs its own countdown (`wander_wait`): the counter
    /// is decremented every tick, and a pet only picks a new destination when it
    /// reaches 0, after which it draws a fresh per-pet cooldown. Because each pet has
    /// an independent, randomized cooldown, they move asynchronously instead of all
    /// stepping together on the global beat. Emits an update only for pets that moved.
    pub fn wander_tick(&self, app: &AppHandle) {
        let moves: Vec<(i64, Cell)> = {
            let Ok(mut guard) = self.inner.lock() else {
                return;
            };
            let Some(state) = guard.as_mut() else {
                return;
            };
            // Don't wander a 1-cell grid or empty grid.
            if state.cols * state.rows <= 1 || state.cells.is_empty() {
                return;
            }

            let ids: Vec<i64> = state.cells.keys().copied().collect();
            let mut moved = Vec::new();
            for user_id in ids {
                // Tick down this pet's personal cooldown; skip until it elapses.
                let remaining = state.wander_wait.entry(user_id).or_insert(0);
                if *remaining > 0 {
                    *remaining -= 1;
                    continue;
                }

                let Some(&from) = state.cells.get(&user_id) else {
                    continue;
                };
                // Free the pet's own cell BEFORE searching so the personal-space check
                // doesn't count the pet against its own nearby destinations (which would
                // wrongly reject every short step). Restore it if no step is found.
                state.occupied.remove(&from);
                if let Some(to) = state.random_free_step(from) {
                    state.occupied.insert(to);
                    state.cells.insert(user_id, to);
                    moved.push((user_id, to));
                } else {
                    state.occupied.insert(from);
                }
                // Draw the next personal cooldown whether or not it found a step, so a
                // boxed-in pet doesn't retry every single tick.
                let cooldown = state.random_cooldown();
                state.wander_wait.insert(user_id, cooldown);
            }
            moved
        };

        for (user_id, cell) in moves {
            emit_grid_update(app, user_id, cell);
        }
    }

    /// Snapshot of dimensions + all pet cells, for `tama_grid_get_state`.
    pub fn snapshot(&self) -> GridSnapshot {
        self.inner
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|s| s.snapshot()))
            .unwrap_or(GridSnapshot {
                cols: 1,
                rows: 1,
                cells: Vec::new(),
            })
    }
}

// =========================================================================================================
// GridState — cell math
// =========================================================================================================

impl GridState {
    fn snapshot(&self) -> GridSnapshot {
        let cells = self
            .cells
            .iter()
            .map(|(&user_id, &(cx, cy))| GridUpdatePayload {
                user_id,
                cell_x: cx,
                cell_y: cy,
            })
            .collect();
        GridSnapshot {
            cols: self.cols,
            rows: self.rows,
            cells,
        }
    }

    /// Spawn cell: front-center first, fanning columns outward. Two passes — the
    /// first only accepts cells with personal space (no occupied neighbor) so new
    /// pets land spread apart instead of stacking onto whoever's already there; the
    /// second pass takes any free cell as a fallback once the floor fills up.
    fn first_free(&self) -> Option<Cell> {
        if let Some(c) = self.scan_front_center(true) {
            return Some(c);
        }
        self.scan_front_center(false)
    }

    /// Walk front rows first (high y = closer), columns outward from center.
    /// When `require_space` is set, only return cells whose neighbors are all empty.
    fn scan_front_center(&self, require_space: bool) -> Option<Cell> {
        let mid = self.cols / 2;
        for y in (0..self.rows).rev() {
            for off in 0..self.cols {
                let cx = if off % 2 == 0 {
                    mid.saturating_add(off / 2)
                } else {
                    mid.saturating_sub(off / 2 + 1)
                };
                if cx < self.cols {
                    let cell = (cx, y);
                    if self.is_free(cell) && (!require_space || self.has_personal_space(cell)) {
                        return Some(cell);
                    }
                }
            }
        }
        None
    }

    /// Like `nearest_free`, but only accepts cells that also have personal space.
    /// Used by action/fight placement so converging pets keep their distance. Returns
    /// None if no roomy cell exists within the grid (caller falls back to nearest_free).
    fn nearest_free_spaced(&self, target: Cell) -> Option<Cell> {
        if self.is_free(target) && self.has_personal_space(target) {
            return Some(target);
        }
        let max_radius = self.cols.max(self.rows);
        for radius in 1..=max_radius {
            let r = radius as i32;
            let (tx, ty) = (target.0 as i32, target.1 as i32);
            for dy in -r..=r {
                for dx in -r..=r {
                    if dx.abs() != r && dy.abs() != r {
                        continue;
                    }
                    let (nx, ny) = (tx + dx, ty + dy);
                    if nx < 0 || ny < 0 {
                        continue;
                    }
                    let cell = (nx as u16, ny as u16);
                    if self.is_free(cell) && self.has_personal_space(cell) {
                        return Some(cell);
                    }
                }
            }
        }
        None
    }

    /// Free cell nearest `target` by Chebyshev distance (expanding ring search).
    fn nearest_free(&self, target: Cell) -> Option<Cell> {
        if self.is_free(target) {
            return Some(target);
        }
        let max_radius = self.cols.max(self.rows);
        for radius in 1..=max_radius {
            let r = radius as i32;
            let (tx, ty) = (target.0 as i32, target.1 as i32);
            for dy in -r..=r {
                for dx in -r..=r {
                    // Only the ring at exactly `radius` (Chebyshev), not the interior.
                    if dx.abs() != r && dy.abs() != r {
                        continue;
                    }
                    let (nx, ny) = (tx + dx, ty + dy);
                    if nx < 0 || ny < 0 {
                        continue;
                    }
                    let cell = (nx as u16, ny as u16);
                    if self.is_free(cell) {
                        return Some(cell);
                    }
                }
            }
        }
        None
    }

    /// A far free destination cell for a wander walk, or None if none is reachable.
    /// Tries several random directions/reaches and prefers a destination with
    /// personal space (no occupied immediate neighbor), so pets spread out instead of
    /// piling onto each other. Falls back to the first plain-free cell it found if no
    /// roomy one turns up. Each candidate favors horizontal travel and a varied reach
    /// so two pets rarely take the same-length step in the same direction.
    fn random_free_step(&self, from: Cell) -> Option<Cell> {
        let mut fallback: Option<Cell> = None;

        for _ in 0..WANDER_SPACING_TRIES {
            let Some(cell) = self.random_free_step_once(from) else {
                continue;
            };
            if self.has_personal_space(cell) {
                return Some(cell);
            }
            fallback.get_or_insert(cell);
        }

        fallback
    }

    /// One random direction/reach probe for a free destination cell (no spacing
    /// preference). The reach is drawn from the wide WANDER_MIN/MAX range so short
    /// shuffles and long strolls mix. The horizontal direction is biased back toward
    /// the centre when the pet sits near an edge (see `edge_bias_dir`), so pets drift
    /// inward instead of piling up against the far columns. Returns the free cell
    /// CLOSEST to the desired reach (not the farthest), which keeps walks at the
    /// intended length and stops every step from bottoming out at the wall.
    fn random_free_step_once(&self, from: Cell) -> Option<Cell> {
        let (fx, fy) = (from.0 as i32, from.1 as i32);
        let span = (WANDER_MAX_STEP - WANDER_MIN_STEP + 1).max(1);
        let reach = WANDER_MIN_STEP + (rand_f64() * span as f64) as i32;

        let dir_x = self.edge_bias_dir(from.0);
        // Mostly horizontal: dy biased to 0 (±1 only occasionally) so pets stroll
        // along the floor rather than drifting between rows on every step.
        let dir_y: i32 = if rand_f64() < 0.25 {
            if rand_f64() < 0.5 {
                -1
            } else {
                1
            }
        } else {
            0
        };

        // Walk outward from 1 up to `reach`, returning the FIRST free cell at or beyond
        // a small minimum so the pet actually travels but lands near the chosen reach
        // instead of always at the farthest wall-adjacent cell.
        let mut best: Option<Cell> = None;
        for step in 1..=reach {
            let nx = fx + dir_x * step;
            let ny = fy + dir_y * step;
            if nx < 0 || ny < 0 {
                break; // ran off the near/left edge; nothing farther in this direction
            }
            let cell = (nx as u16, ny as u16);
            if cell.0 >= self.cols || cell.1 >= self.rows {
                break; // ran off the far/bottom edge
            }
            if self.is_free(cell) {
                best = Some(cell);
            }
        }
        best
    }

    /// Horizontal wander direction (-1 left, +1 right). When the pet sits in the outer
    /// EDGE_BIAS_FRAC of the columns it is nudged back toward the centre with a
    /// probability that ramps from 0 at the zone's inner border to 1 at the very edge;
    /// elsewhere the direction is an even coin flip. This is what pulls pets off the
    /// walls and keeps the middle of the floor populated.
    fn edge_bias_dir(&self, col: u16) -> i32 {
        if self.cols <= 1 {
            return if rand_f64() < 0.5 { -1 } else { 1 };
        }
        let pos = col as f64 / (self.cols - 1) as f64; // 0 = left edge, 1 = right edge
        let zone = EDGE_BIAS_FRAC.max(f64::EPSILON);
        // Strength rises toward each edge inside the bias zone; 0 in the middle.
        let (toward_center, strength) = if pos < zone {
            (1, (zone - pos) / zone) // near left edge → push right (+1)
        } else if pos > 1.0 - zone {
            (-1, (pos - (1.0 - zone)) / zone) // near right edge → push left (-1)
        } else {
            (0, 0.0)
        };
        if toward_center != 0 && rand_f64() < strength {
            toward_center
        } else if rand_f64() < 0.5 {
            -1
        } else {
            1
        }
    }

    /// Per-axis spacing radius in cells, derived from the grid size so the on-screen
    /// gap matches the sprite footprint regardless of grid density. At least 1 cell.
    fn spacing_radius(&self) -> (i32, i32) {
        let rx = ((self.cols as f64 * SPACING_FRAC_X).round() as i32).max(1);
        let ry = ((self.rows as f64 * SPACING_FRAC_Y).round() as i32).max(1);
        (rx, ry)
    }

    /// True when no occupied cell lies within the anisotropic spacing rectangle around
    /// `cell` — i.e. the pet would stand with real ON-SCREEN breathing room, not just
    /// one grid cell apart. The rectangle is wider in X than Y because a sprite spans
    /// more columns than rows visually (see SPACING_FRAC_*).
    fn has_personal_space(&self, cell: Cell) -> bool {
        let (cx, cy) = (cell.0 as i32, cell.1 as i32);
        let (rx, ry) = self.spacing_radius();
        for dy in -ry..=ry {
            for dx in -rx..=rx {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let (nx, ny) = (cx + dx, cy + dy);
                if nx < 0 || ny < 0 {
                    continue;
                }
                if self.occupied.contains(&(nx as u16, ny as u16)) {
                    return false;
                }
            }
        }
        true
    }

    /// A randomized per-pet wander cooldown in ticks (see WANDER_COOLDOWN_*).
    fn random_cooldown(&self) -> u32 {
        let span = (WANDER_COOLDOWN_MAX_TICKS - WANDER_COOLDOWN_MIN_TICKS + 1).max(1);
        WANDER_COOLDOWN_MIN_TICKS + (rand_f64() * span as f64) as u32
    }
}

// =========================================================================================================
// Emission helpers — every grid event goes to BOTH the Tauri overlay and the WS
// browser clients (AGENTS.md §8 rule).
// =========================================================================================================

fn state_of(app: &AppHandle) -> tauri::State<'_, AppState> {
    app.state::<AppState>()
}

fn emit_grid_config(app: &AppHandle, cols: u16, rows: u16) {
    #[derive(serde::Serialize, Clone)]
    struct Cfg {
        cols: u16,
        rows: u16,
    }
    let payload = Cfg { cols, rows };
    let _ = app.emit("tama-grid-config", payload.clone());
    state_of(app).broadcast_ws("tama-grid-config", &payload);
}

fn emit_grid_update(app: &AppHandle, user_id: i64, cell: Cell) {
    let payload = GridUpdatePayload {
        user_id,
        cell_x: cell.0,
        cell_y: cell.1,
    };
    let _ = app.emit("tama-grid-update", payload.clone());
    state_of(app).broadcast_ws("tama-grid-update", &payload);
}

fn emit_grid_remove(app: &AppHandle, user_id: i64) {
    #[derive(serde::Serialize, Clone)]
    struct Rm {
        user_id: i64,
    }
    let payload = Rm { user_id };
    let _ = app.emit("tama-grid-remove", payload.clone());
    state_of(app).broadcast_ws("tama-grid-remove", &payload);
}

fn broadcast_snapshot(app: &AppHandle, snapshot: &GridSnapshot) {
    // Re-emit every pet's cell so existing clients converge after a reconfigure.
    let _ = app.emit(
        "tama-grid-config",
        serde_json::json!({
            "cols": snapshot.cols,
            "rows": snapshot.rows,
        }),
    );
    for cell in &snapshot.cells {
        let _ = app.emit("tama-grid-update", cell.clone());
        state_of(app).broadcast_ws("tama-grid-update", cell);
    }
}

// =========================================================================================================
// Tiny PRNG — avoids pulling the `rand` crate just for wander jitter.
// =========================================================================================================

/// Cheap thread-local xorshift in [0,1). Good enough for visual wander randomness.
fn rand_f64() -> f64 {
    use std::cell::Cell as StdCell;
    thread_local! {
        static SEED: StdCell<u64> = StdCell::new(seed_init());
    }
    SEED.with(|s| {
        let mut x = s.get();
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        s.set(x);
        // Top 53 bits -> [0,1).
        (x >> 11) as f64 / (1u64 << 53) as f64
    })
}

fn seed_init() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E3779B97F4A7C15);
    nanos | 1 // never zero (xorshift requires a nonzero state)
}

// =========================================================================================================
// Tests
// =========================================================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a normal-size empty grid with the given pets placed at fixed cells.
    fn grid_with(cells: &[(i64, Cell)]) -> GridState {
        let (cols, rows) = GridState::dims_for(false, false);
        let mut state = GridState {
            cols,
            rows,
            cells: HashMap::new(),
            occupied: HashSet::new(),
            wander_wait: HashMap::new(),
        };
        for &(id, cell) in cells {
            state.cells.insert(id, cell);
            state.occupied.insert(cell);
        }
        state
    }

    #[test]
    fn personal_space_radius_exceeds_one_cell() {
        // The spacing radius must be wider than a single cell on the normal grid, else
        // sprites (which span several columns/rows) visually overlap despite "spacing".
        let state = grid_with(&[]);
        let (rx, ry) = state.spacing_radius();
        assert!(rx >= 10, "x spacing radius too small: {rx}");
        assert!(ry >= 3, "y spacing radius too small: {ry}");
    }

    #[test]
    fn has_personal_space_rejects_neighbor_within_radius() {
        let state = grid_with(&[(1, (75, 15))]);
        let (rx, ry) = state.spacing_radius();
        let (rx, ry) = (rx as u16, ry as u16);
        // A cell just inside the spacing rectangle is NOT roomy.
        assert!(!state.has_personal_space((75 + rx - 1, 15)));
        assert!(!state.has_personal_space((75, 15 + ry - 1)));
        // A cell comfortably outside it IS roomy.
        assert!(state.has_personal_space((75 + rx + 2, 15 + ry + 2)));
    }

    #[test]
    fn nearest_free_spaced_keeps_distance() {
        // One pet at centre; asking to place another AT the same target must return a
        // cell with personal space, never the occupied/adjacent cell.
        let state = grid_with(&[(1, (75, 15))]);
        let placed = state.nearest_free_spaced((75, 15)).expect("a spaced cell exists");
        assert!(state.has_personal_space(placed), "placement not roomy: {placed:?}");
        assert!(placed != (75, 15));
    }

    #[test]
    fn edge_bias_pushes_inward_at_walls() {
        let state = grid_with(&[]);
        // At the far-left column, many draws should never send the pet further left
        // off the grid; inward (+1) must dominate. We sample to average out the RNG.
        let mut inward = 0;
        for _ in 0..400 {
            if state.edge_bias_dir(0) == 1 {
                inward += 1;
            }
        }
        assert!(inward > 300, "left-edge bias too weak: {inward}/400 inward");

        let mut inward_r = 0;
        for _ in 0..400 {
            if state.edge_bias_dir(state.cols - 1) == -1 {
                inward_r += 1;
            }
        }
        assert!(inward_r > 300, "right-edge bias too weak: {inward_r}/400 inward");
    }

    #[test]
    fn edge_bias_is_balanced_in_the_middle() {
        let state = grid_with(&[]);
        let mid = state.cols / 2;
        let mut right = 0;
        for _ in 0..1000 {
            if state.edge_bias_dir(mid) == 1 {
                right += 1;
            }
        }
        // No bias in the centre: roughly a coin flip (wide tolerance for the cheap RNG).
        assert!((350..=650).contains(&right), "middle not balanced: {right}/1000 right");
    }

    #[test]
    fn wander_steps_stay_in_bounds() {
        // From many positions, every wander destination must be a valid in-bounds free
        // cell — never off-grid and never the pet's own cell.
        let mut state = grid_with(&[]);
        for col in [0u16, 1, 75, 148, 149] {
            for _ in 0..200 {
                let from = (col, 15);
                if let Some(to) = state.random_free_step(from) {
                    assert!(to.0 < state.cols && to.1 < state.rows, "out of bounds: {to:?}");
                    assert!(to != from, "did not move from {from:?}");
                }
            }
        }
        // Touch `state` mutably to silence unused-mut if the loop above never moved.
        state.cells.clear();
    }
}
