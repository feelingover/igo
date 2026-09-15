// zustand store（SPEC 8章）
// 保持するのは GameState と派生 UI 状態（プレビュー着手など）。
import { create } from 'zustand';
import {
  createRuleEngine,
  localGameService,
  replayMoves,
  type GameState,
  type IGameService,
  type Move,
  type Point,
} from '@igo/core';

// 合法手の事前チェック専用エンジン（盤面は moves[] から都度再構築する）。
// 着手の権威はサービス側（submitMove）にあり、ここはプレビュー判定だけ。
const previewEngine = createRuleEngine();
const service: IGameService = localGameService;

interface GameStore {
  game: GameState | null;
  preview: Point | null; // 仮置き（半透明）。null なら無し
  error: string | null; // 直近の不正着手フィードバック
  busy: boolean;

  startGame: (size: number) => Promise<void>;
  tapPoint: (point: Point) => void; // 二段階タップの入口
  previewMove: (point: Point) => void;
  cancelPreview: () => void;
  confirmMove: () => Promise<void>;
  pass: () => Promise<void>;
  resign: () => Promise<void>;
}

const samePoint = (a: Point | null, b: Point): boolean =>
  a !== null && a.x === b.x && a.y === b.y;

export const useGameStore = create<GameStore>((set, get) => {
  // 着手・パス・投了に共通の送信手順。
  // 多重送信ガード → 送信 → 反映、失敗時はメッセージ表示、で三者の挙動を揃える。
  const submit = async (
    buildMove: (game: GameState) => Move,
    failureMessage: string,
  ): Promise<void> => {
    const { game, busy } = get();
    if (!game || busy || game.status !== 'playing') return;
    set({ busy: true });
    try {
      const updated = await service.submitMove(game.gameId, buildMove(game));
      set({ game: updated, preview: null, error: null });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : failureMessage,
        preview: null,
      });
    } finally {
      set({ busy: false });
    }
  };

  return {
    game: null,
    preview: null,
    error: null,
    busy: false,

    async startGame(size: number) {
      const game = await service.createGame(size);
      set({ game, preview: null, error: null });
    },

    tapPoint(point: Point) {
      const { game, preview } = get();
      if (!game || game.status !== 'playing') return;
      // 同じ点をもう一度タップ → 確定（二段階タップ）
      if (samePoint(preview, point)) {
        void get().confirmMove();
        return;
      }
      get().previewMove(point);
    },

    previewMove(point: Point) {
      const { game } = get();
      if (!game || game.status !== 'playing') return;
      // moves[] から現局面を再構築して合法性を事前チェック
      const engineState = replayMoves(previewEngine, game.boardSize, game.moves);
      if (!previewEngine.isLegalMove(engineState, game.nextToPlay, point)) {
        set({ error: '着手禁止点です', preview: null });
        return;
      }
      set({ preview: point, error: null });
    },

    cancelPreview() {
      set({ preview: null });
    },

    async confirmMove() {
      const { preview } = get();
      if (!preview) return;
      await submit(
        (game) => ({
          type: 'play',
          color: game.nextToPlay,
          point: preview,
          moveNumber: game.moves.length,
        }),
        '着手に失敗しました',
      );
    },

    async pass() {
      await submit(
        (game) => ({
          type: 'pass',
          color: game.nextToPlay,
          moveNumber: game.moves.length,
        }),
        'パスに失敗しました',
      );
    },

    async resign() {
      await submit(
        (game) => ({
          type: 'resign',
          color: game.nextToPlay,
          moveNumber: game.moves.length,
        }),
        '投了に失敗しました',
      );
    },
  };
});
