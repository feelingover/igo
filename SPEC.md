# 囲碁クライアント MVP 実装仕様書（React Native / Expo）

## 0. このドキュメントについて

Claude Code 向けの **Phase 1 実装指示書**。
ゴールは「ローカルで二人対局が成立する囲碁クライアント」。ネットワーク対戦・AI は別フェーズ（後述）。

実装着手前に必ず **6章の「エンジンスパイク」を最初に**こなすこと。ここが唯一の不確実ポイント。

---

## 1. スコープ

### Phase 1 でやること（MVP）

- 9 路盤の描画（SVG）
- 同一端末での二人対局（pass-and-play）
- ルール判定：着手禁止点（自殺手）・取り・コウ（同形反復禁止）・パス・両パス終局
- 簡易スコアリング（**中国ルール / area scoring**）
- 着手プレビュー（仮置き → 確定の二段階タップ）
- パス・投了

### 明示的にやらないこと（非スコープ）

- ネットワーク対戦 … 通信は `IGameService` インターフェースだけ定義し、実装は Phase 2
- AI 対戦・検討モード … KataGo 連携は別系統。完全に後回し
- ユーザー認証・マッチング・対局ロビー
- 日本ルールの厳密な死石判定 … 合意処理が複雑なので後フェーズ。MVP は中国ルールで割り切る
- 19 路盤 … 設計は盤サイズ可変にするが、初期値は 9 固定

---

## 2. 技術スタック

| 項目 | 選定 | 補足 |
|---|---|---|
| フレームワーク | Expo (managed workflow) | |
| 言語 | TypeScript | strict 有効 |
| 盤描画 | `react-native-svg` | 碁盤程度なら Skia 不要 |
| 状態管理 | `zustand` | 着手のたびに状態更新が走るので Context より軽い |
| ルールエンジン | 6 章で確定（要検証） | `IRuleEngine` の裏に隔離 |

---

## 3. アーキテクチャ

```
[UI層]  GobanBoard / GameScreen / ControlBar
   │  (タップ → 着手意図)
   ▼
[State層]  gameStore (zustand)   ← 着手列 moves[] が唯一の真実
   │
   ├─▶ [RuleEngine層]  IRuleEngine ← 着手の正当性判定・取り・スコア
   │
   └─▶ [Service層]  IGameService  ← Phase1: ローカル / Phase2: API
```

### 設計原則

1. **盤面は着手列 `moves[]` から導出する**。永続化・同期・リプレイ・待った（undo）が全部これで素直になる。サーバー権威設計（Phase 2）とも一貫する。`currentBoard` は導出結果のキャッシュ。
2. **ルールエンジンとゲームサービスはインターフェースで抽象化**し、実装を差し替え可能にする。UI 層は具体実装を一切知らない。

---

## 4. ディレクトリ構成

> **更新（Phase 2 準備）**: 当初は単一パッケージの `src/` 配下に全部を置く想定だった。
> 現在は npm workspaces のモノレポへ再編済み。**論理構造（層と依存の向き）は Phase 1 から
> 変えていない**。変わったのは配置だけで、「ルール判定はサーバー権威」（末尾の
> 「Phase 2 以降」参照）を満たすために、サーバと共有する層を `packages/core` に切り出してある。

```
packages/core/src/       # @igo/core — クライアントとサーバで共有。RN/DOM 依存ゼロ
  types/
    index.ts             # ドメイン型
  engine/
    types.ts             # IRuleEngine, EngineState
    ruleEngine.ts        # ファクトリ（確定したアダプタを返す）
    selfRuleEngine.ts    # ← スパイクの結果、自前実装を採用（6章）
    spike.test.ts        # エンジン検証スイート
  services/
    gameService.ts       # IGameService
    localGameService.ts  # Phase1 実装（メモリ内）
  index.ts               # 公開バレル（selfRuleEngine は意図的に非公開）

apps/client/src/         # igo-client — Expo アプリ（UI のみ）
  components/
    GobanBoard.tsx       # SVG碁盤本体
    Stone.tsx            # 石（円）
    BoardGrid.tsx        # 線・星・座標ラベル
    ControlBar.tsx       # パス/投了ボタン、手番表示、アゲハマ表示
    ScorePanel.tsx       # 終局時の内訳表示
    TerritoryMarkers.tsx # 地のマーカー
    ColorDot.tsx / boardGeometry.ts / resultFormat.ts
  screens/
    GameScreen.tsx
  state/
    gameStore.ts         # zustand store
  theme.ts

apps/server/src/         # @igo/server — 対戦成績サーバ
  smoke.ts               # 現状は @igo/core の疎通確認のみ（HTTP・永続化は未実装）
```

---

## 5. ドメイン型定義（`packages/core/src/types/index.ts`）

```ts
export type StoneColor = 'black' | 'white';

// 0-indexed, 左上原点。x=列, y=行
export type Point = { x: number; y: number };

export type Move =
  | { type: 'play'; color: StoneColor; point: Point; moveNumber: number }
  | { type: 'pass'; color: StoneColor; moveNumber: number }
  | { type: 'resign'; color: StoneColor; moveNumber: number };

export type BoardState = (StoneColor | null)[][]; // board[y][x]

export type GameStatus = 'playing' | 'finished';

export interface GameState {
  gameId: string;
  boardSize: number;          // 9
  moves: Move[];              // 真実
  currentBoard: BoardState;   // moves から導出したキャッシュ
  nextToPlay: StoneColor;     // 黒先
  captures: { black: number; white: number }; // アゲハマ
  status: GameStatus;
  result?: string;            // 例 "B+5.5", "W+R"(投了)
}
```

> `moveNumber` は Phase 2 での二重送信検出（idempotency）の布石。Phase 1 では単調増加させるだけでよい。

---

## 6. ルールエンジン（`packages/core/src/engine/`）

### インターフェース（`types.ts`）

```ts
export interface IRuleEngine {
  emptyState(size: number): EngineState;
  isLegalMove(state: EngineState, color: StoneColor, point: Point): boolean;
  // 着手後の新状態を返す（取り石反映済み・イミュータブル）
  playMove(state: EngineState, color: StoneColor, point: Point): EngineState;
  // prev→next の差分で取れた石数
  capturesBetween(prev: EngineState, next: EngineState): number;
  isGameOver(state: EngineState): boolean; // 両パス
  // area scoring（中国ルール）。komi は引数で受ける（デフォ 6.5 など）
  score(state: EngineState, komi: number): { winner: StoneColor; margin: number };
  toBoardState(state: EngineState): BoardState;
}

export type EngineState = unknown; // アダプタ内部型。外には漏らさない
```

### ⚠️ 最初にやること：エンジンスパイク（最重要・不確実ポイント）

ルールエンジンに [Tenuki](https://github.com/aprescott/tenuki) を使いたいが、**Tenuki はブラウザ DOM 描画を含むライブラリ**で、React Native (Hermes) 上でルールロジック部分だけ切り出して動くかは未検証。本実装の前に必ず確認すること。

1. Expo プロジェクトに Tenuki を入れ、最小スクリプトで **ゲーム状態クラスだけ** import して着手・取り・コウ判定が動くか試す（DOM 描画 API には触れない）。
2. 動く → `tenukiAdapter.ts` で `IRuleEngine` を実装。
3. 動かない → 以下の代替に差し替え（`IRuleEngine` で隔離してあるので影響は engine 配下のみ）：
   - `godash` … 関数型の囲碁ロジックライブラリ
   - `@sabaki/go-board` … 純ロジックの軽量盤ライブラリ
   - **自前実装** … 着手禁止・取り・コウは数十行で書ける。コウは「直前局面のハッシュと一致する着手を禁止」で対応。最終手段だがコストは低い

> ここで動くエンジンを 1 つ確定させてから 7 章以降に進むこと。先に UI を作らない。

---

## 7. ゲームサービス（`packages/core/src/services/`）

```ts
export interface IGameService {
  createGame(boardSize: number): Promise<GameState>;
  submitMove(gameId: string, move: Move): Promise<GameState>;
  getGame(gameId: string): Promise<GameState>;
}
```

- **Phase 1**：`localGameService.ts` … メモリ内で `GameState` を保持し、`submitMove` で `IRuleEngine` を直叩きして新状態を返す。
- **Phase 2**：`remoteGameService.ts`（API + ポーリング）に差し替え。UI は `IGameService` しか参照しないので変更不要。

`async` で統一しておくこと（ローカルでも Promise を返す）。Phase 2 移行時にインターフェースを変えないため。

---

## 8. 状態管理（`apps/client/src/state/gameStore.ts`）

zustand store。保持するのは `GameState` と派生 UI 状態（プレビュー着手など）。

主なアクション：

- `startGame(size)` → `service.createGame`
- `previewMove(point)` → 仮置き（`isLegalMove` で事前チェックして不正なら無視 or フィードバック）
- `confirmMove()` → `service.submitMove` → 状態反映 → 手番交代
- `pass()` / `resign()`
- 両パス検出時に `service` 側で `status='finished'` と `result` を埋めて返す

---

## 9. 描画仕様（`GobanBoard`）

- `react-native-svg`。盤は正方形、画面幅にフィット。
- 線・星（9 路なら隅 4 + 天元）・座標ラベル（列 A–J で **I を飛ばす**囲碁慣習、行 1–9）。
- 交点タップ → 最近接交点に仮置き石（半透明）→ もう一度同じ点タップ or 確定ボタンで着手。誤タップ対策のため二段階。
- 直前の手にマーカー（小さい円や点）。
- 取られた石は再描画で消える。
- 石の色は黒 `#000`、白 `#fff`（白は薄い境界線を付けて盤上で視認できるように）。

---

## 10. 操作フロー

1. 起動 → `startGame(9)`
2. 手番側が交点タップ → プレビュー表示
3. 確定 → `isLegalMove` → NG ならフィードバック / OK なら `submitMove`
4. 状態更新・手番交代
5. パス 2 連続 → 終局 → 中国ルールでスコア → 結果表示
6. 投了 → 即終局（`W+R` / `B+R`）

---

## 11. 実装順序（Phase 1）

1. **エンジンスパイク**（6 章）→ 使うエンジン確定 ★最初
2. 型定義・zustand store
3. 碁盤描画（まず着手なしで盤と座標だけ）
4. 着手・取り・コウ・パス
5. 終局・簡易スコア
6. UI 仕上げ（最終手マーカー、アゲハマ表示、手番表示）

---

## 12. 受け入れ基準（Phase 1 完了条件）

- [ ] 9 路盤で二人が交互に打てる
- [ ] 自殺手・コウの即時取り返しが弾かれる
- [ ] 石が正しく取られ、アゲハマがカウントされる
- [ ] 両パスで終局し、中国ルールで勝敗（例 `B+5.5`）が表示される
- [ ] 投了で終局できる
- [ ] 盤面が `moves[]` から再構築できる（リロードしても着手列があれば同じ局面に戻る）

---

## 付録：セットアップ

```bash
npx create-expo-app igo-client -t expo-template-blank-typescript
cd igo-client
npx expo install react-native-svg
npm i zustand
# ルールエンジンはスパイク（6章）で確定してから追加する
```

---

## Phase 2 以降（参考・本スペック対象外）

- **Phase 2**：`remoteGameService` 実装。ポーリングで相手着手を取得。バックエンドは Node.js + Lambda（ルール判定はサーバー権威）。盤面はサーバーでも着手列から導出。OCC（version フィールド）+ idempotency key で二重送信・競合対策。
- **Phase 3**：検討モード。対局後 SGF を非同期ワーカーに投げ、オンデマンド GPU で KataGo Analysis Engine（JSON）に解析させる。
