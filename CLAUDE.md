# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> ⚠️ Expo SDK has changed significantly. Read the versioned docs at
> https://docs.expo.dev/versions/v56.0.0/ before writing any Expo/RN code.

## What this is

An Expo (SDK 56) / React Native client for a Go (囲碁) game, plus the beginnings
of its server, in one **npm-workspaces monorepo**. `SPEC.md` is the authoritative
design doc and is organized by chapter (referenced throughout the source as
"SPEC N章"). Phase 1 — the current implementation — is a local two-player
(pass-and-play) 9×9 game with full rule judgment and Chinese-rules area scoring.
Phase 2 (remote/API play) is anticipated by the interfaces but not built.

## Repository layout

```
packages/core/   @igo/core — domain types, rule engine, IGameService.
                 Zero RN/DOM dependencies; runs unchanged in plain Node.
apps/client/     igo-client — the Expo app (UI only).
apps/server/     @igo/server — Hono REST server. Its only working feature is the
                 token-auth mock (src/auth, src/http) built from
                 mobile-game-token-auth-design.md. Match history is still unbuilt:
                 no DB, and src/smoke.ts only proves @igo/core runs under Node.
```

The monorepo exists for one reason: SPEC Phase 2 requires **server-authoritative
rule judgment** (`ルール判定はサーバー権威`), so suicide detection, positional
superko and Chinese area scoring must run on both sides. Sharing one engine is
the only way to guarantee client and server never disagree about legality.

**Therefore `packages/core` must never depend on `react`, `react-native`, or any
DOM API.** Its tsconfig deliberately omits the `DOM` lib so such a mistake fails
typecheck. Anything UI-shaped belongs in `apps/client`.

## Commands

All run from the repo root.

```bash
npm run typecheck     # tsc --noEmit (strict) across all 3 workspaces.
npm run test:engine   # The rule-engine verification suite (see below).
npm run test:auth     # The token-auth verification suite (see below).
npm run server:smoke  # Prove @igo/core drives a full game under plain Node.
npm run server:dev    # Auth mock server on :8787, tsx watch. server:start for once.
npm run web           # Run in a browser — the practical way to preview (see note).
npm start             # Expo dev server (QR / dev client)
npm run ios|android   # Native simulators / devices
```

The client scripts delegate to the `igo-client` workspace and forward extra args,
so `npm run web -- --port 8082` works.

There is no test framework. Both suites are hand-rolled assertion harnesses run
through `tsx` that **throw on failure** (non-zero exit), and they are the only
automated verification in the repo:

- `npm run test:engine` → `packages/core/src/engine/spike.test.ts`. Run after any
  change to engine logic.
- `npm run test:auth` → `apps/server/src/auth/authMock.test.ts`. Run after any
  change under `apps/server/src`. It drives the HTTP layer through Hono's
  `app.request()`, so it binds no port.

There is no "run a single test"; edit/comment checks in those files.

`tsx` does not typecheck, so `npm run typecheck` is not optional — it is the only
thing checking types in `packages/core` and `apps/server`.

**Expo Go caveat:** the App Store Expo Go binary supports only ≤ SDK 55, so this
SDK 56 app cannot run in Expo Go. Use `npm run web`, or build a dev client.

## Architecture

Strictly layered, with the two lower layers hidden behind interfaces so they can
be swapped without touching anything above:

```
components/  →  state/gameStore (zustand)  │  IGameService  →  IRuleEngine
   (UI)            (UI + derived state)    │  (game lifecycle)   (pure rules)
└────────── apps/client ──────────────────┘└───────── @igo/core ──────────┘
```

The UI layer never references a concrete service or engine — only the interfaces.
The package boundary falls on the same seam: everything from `IGameService` down
lives in `@igo/core` and is shared with the server.

### `moves[]` is the single source of truth
The board is a **derived cache**, never authoritative. `GameState.currentBoard`
and the engine's internal board are both reconstructed from `moves[]` via
`replayMoves(engine, size, moves)` (packages/core/src/engine/ruleEngine.ts). This is the
mechanism behind the "board must be reconstructable from moves[]" requirement —
preserve it. Don't mutate board state independently of `moves[]`.

### Seam 1 — `IRuleEngine` (packages/core/src/engine/types.ts)
Pure board rules, **zero RN/DOM dependencies** (so it runs in plain Node for the
spike). Key contract: `EngineState = unknown` is **deliberately opaque** — never
inspect or destructure it outside the engine; pass it back into engine methods.
- Concrete impl: `SelfRuleEngine` (packages/core/src/engine/selfRuleEngine.ts),
  chosen via the Chapter-6 "engine spike". `createRuleEngine()` (ruleEngine.ts) is
  the **only** place that names the concrete class — swap engines by editing only
  that factory. For the same reason `selfRuleEngine` is **not** re-exported from
  the `@igo/core` barrel (packages/core/src/index.ts).
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

### Seam 2 — `IGameService` (packages/core/src/services/gameService.ts)
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
  **not** a string. Format it at the boundary
  (`apps/client/src/components/resultFormat.ts`); never build a `"B+5.5"` string
  only to parse it back.

### State / UI
All under `apps/client/src/`.

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

## Token auth mock (apps/server)

`mobile-game-token-auth-design.md` (repo root) is the authoritative design doc for
this part, the way `SPEC.md` is for the game. Source comments cite it as
"DESIGN N章". `apps/server/README.md` documents the endpoints.

```
http/        Hono routes, middleware, wire-format mapping. camelCase inside,
             snake_case on the wire — convert only in http/present.ts.
auth/        The domain. Knows nothing about HTTP.
```

Invariants that are load-bearing — breaking one silently reintroduces a
vulnerability the design exists to close:

- **A family is only ever revoked after a hash match** (`authService.rotateUnderLock`).
  `family_id` is readable from any observed access token's `fid` claim and
  `generation` is a small integer, so revoking without verifying the secret lets a
  third party force-logout arbitrary users. Every other refresh failure is
  "reject only, don't touch the family".
- **Raw refresh tokens live only in the grace-period cache** (`cache.ts`, TTL =
  grace period). `store.ts` holds `secret_hash` alone, so a DB leak yields no
  usable token. Keep the two stores separate; don't "simplify" by merging them.
- **`alg` is never read when verifying.** `kid` → `{alg, key}` via
  `SigningKeyRegistry`, then verify. Reversing that order reopens `alg: none`.
- **401 means "your credentials are dead"** — clients drop them on it (DESIGN 6章).
  Server-side trouble (lock contention, cache outage, rate limit) must be 503/429
  with `Retry-After`, never 401.
- **`verifyAccessToken` deliberately does not check family/device revocation.**
  Those are designed to lag by the access-token lifetime; checking them per request
  would put the state read back into every request that the design removes.
- Domain code takes an injected `Clock`; don't call `Date.now()` there. `lock.ts` is
  the exception and says why.

## Conventions

- Production source uses **extensionless imports** (Metro-friendly). Node ESM
  can't resolve those, which is why anything running under Node (`test:engine`,
  `server:smoke`) goes through `tsx` — esbuild resolves them like a bundler. Do
  not "fix" this by adding `.js` extensions; it would only move the problem.
- **Never add an `exports` field to `packages/core/package.json`.** It switches
  Metro and Node to exports semantics, which disables extension inference and
  breaks every extensionless import inside the package. `main`/`types` is enough.
- `apps/*` and `packages/*` tsconfigs do **not** share a base. `apps/client`
  extends `expo/tsconfig.base`; core and server must not, because that base sets
  `customConditions: ["react-native"]` and pulls in the `DOM` lib — both of which
  would let client-only code pass typecheck in a server-shared package.
- Workspace deps use `"@igo/core": "*"`, not `"workspace:*"` — npm 11 rejects the
  `workspace:` protocol with `EUNSUPPORTEDPROTOCOL` (pnpm/yarn/bun accept it).
- No `metro.config.js`, on purpose. SDK 56 auto-detects workspaces and sets
  `watchFolders` / `nodeModulesPaths` / `unstable_serverRoot` itself; the
  `watchFolders = [monorepoRoot]` snippets found online are for SDK ≤ 51 and
  break current setups.
- TypeScript is `strict`. Keep `npm run typecheck` clean.
- Source comments reference `SPEC.md` chapters ("SPEC N章"); when adding logic,
  cite the relevant chapter the same way.
