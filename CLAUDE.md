# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> ⚠️ Expo SDK has changed significantly. Read the versioned docs at
> https://docs.expo.dev/versions/v56.0.0/ before writing any Expo/RN code.

## What this is

Expo (SDK 56) / React Native client for a Go (囲碁) game. `SPEC.md` is the
authoritative design doc and is organized by chapter (referenced throughout the
source as "SPEC N章"). Phase 1 — the current implementation — is a local
two-player (pass-and-play) 9×9 game with full rule judgment and Chinese-rules
area scoring. Phase 2 (remote/API play) is anticipated by the interfaces but not
built.

## Commands

```bash
npm run typecheck     # tsc --noEmit (strict). Run after any TS change.
npm run test:engine   # The rule-engine verification suite (see below).
npm run web           # Run in a browser — the practical way to preview (see note).
npm start             # Expo dev server (QR / dev client)
npm run ios|android   # Native simulators / devices
```

There is no test framework. `npm run test:engine` compiles
`src/engine/spike.test.ts` to CommonJS into `.spike-build/` and runs it in Node.
It is a hand-rolled assertion harness that **throws on failure** (non-zero exit).
It is the single source of automated verification — run it after any change to
engine logic. There is no "run a single test"; edit/comment checks in that file.

**Expo Go caveat:** the App Store Expo Go binary supports only ≤ SDK 55, so this
SDK 56 app cannot run in Expo Go. Use `npm run web`, or build a dev client.

## Architecture

Strictly layered, with the two lower layers hidden behind interfaces so they can
be swapped without touching anything above:

```
components/  →  state/gameStore (zustand)  →  IGameService  →  IRuleEngine
   (UI)            (UI + derived state)        (game lifecycle)   (pure rules)
```

The UI layer never references a concrete service or engine — only the interfaces.

### `moves[]` is the single source of truth
The board is a **derived cache**, never authoritative. `GameState.currentBoard`
and the engine's internal board are both reconstructed from `moves[]` via
`replayMoves(engine, size, moves)` (src/engine/ruleEngine.ts). This is the
mechanism behind the "board must be reconstructable from moves[]" requirement —
preserve it. Don't mutate board state independently of `moves[]`.

### Seam 1 — `IRuleEngine` (src/engine/types.ts)
Pure board rules, **zero RN/DOM dependencies** (so it runs in plain Node for the
spike). Key contract: `EngineState = unknown` is **deliberately opaque** — never
inspect or destructure it outside the engine; pass it back into engine methods.
- Concrete impl: `SelfRuleEngine` (src/engine/selfRuleEngine.ts), chosen via the
  Chapter-6 "engine spike". `createRuleEngine()` (ruleEngine.ts) is the **only**
  place that names the concrete class — swap engines by editing only that factory.
- Rules implemented: suicide rejection; capture (flood-fill liberties); ko as
  **positional superko** (forbid recreating any prior board hash — checked on
  *every* move, not only capturing ones: a snapback lets a non-capturing move
  close a repetition cycle); double-pass game end; Chinese **area scoring**
  (stones + single-color-surrounded territory).
- `toPlay()` and `captures()` make the engine the single authority for turn
  order and アゲハマ. Upper layers must read them rather than tracking their own
  copies — that duplication is what `capturesBetween()` used to cause.
- `score()` returns `winner: StoneColor | 'draw'`; komi is a parameter, so 持碁
  (jigo) is reachable and must not be collapsed into a 0-point win.
- `pass()` exists on the interface even though SPEC omitted it: because
  `EngineState` is opaque, passes must flow through the engine for `isGameOver`
  (double-pass) to be computable. See the note in types.ts.
- Coordinates: `Point {x,y}`, 0-indexed, top-left origin, `board[y][x]`.

### Seam 2 — `IGameService` (src/services/gameService.ts)
Game lifecycle. **All methods are async/Promise** even in the in-memory impl, so
a Phase 2 `remoteGameService` can drop in with no signature changes.
- Concrete impl: `LocalGameService` (in-memory `Map<gameId, GameRecord>`),
  exported as the `localGameService` singleton.
- `submitMove` is the **authority**: it enforces turn order and legality, applies
  the move through the engine, and on double-pass computes the score
  (`DEFAULT_KOMI = 6.5`) and sets `result`.
- `GameRecord` stores only what the engine can't derive (ids, komi, `moves[]`,
  terminal `result`/`score`). `project()` builds every derived `GameState` field
  — board, `nextToPlay`, `captures` — from `engineState` on each call, so there
  is no per-case bookkeeping to keep in sync and no hand-written deep clone.
- `result` is a structured `GameResult` (`{kind:'score'|'resign', winner, …}`),
  **not** a string. Format it at the boundary (`components/resultFormat.ts`);
  never build a `"B+5.5"` string only to parse it back.

### State / UI
- `state/gameStore.ts` (zustand) holds `GameState` plus UI-only derived state
  (preview point, error, busy). It keeps a separate `previewEngine` purely for
  **client-side pre-checks** of legality (`replayMoves` → `isLegalMove`); the
  real, authoritative submit always goes through the service.
- **Two-stage tap:** `tapPoint` → first tap previews (translucent stone), a
  second tap on the *same* point confirms. `confirmMove`/`pass`/`resign` submit.
- `components/` is SVG-based (`react-native-svg`): `GobanBoard` (board + touch
  handling via `nearestIntersection`), `BoardGrid`, `Stone`, `ControlBar`;
  geometry math is isolated in `boardGeometry.ts`. `screens/GameScreen.tsx`
  fixes `BOARD_SIZE = 9` (engine itself is size-agnostic).

## Conventions

- Production source uses **extensionless imports** (Metro-friendly). The engine
  spike is compiled to CommonJS separately because Node ESM can't resolve them —
  that's why `test:engine` shells out to `tsc` rather than running the `.ts`
  directly.
- TypeScript is `strict`. Keep `npm run typecheck` clean.
- Source comments reference `SPEC.md` chapters ("SPEC N章"); when adding logic,
  cite the relevant chapter the same way.
