// ゲームサービスのインターフェース（SPEC 7章）
// UI/State 層はこのインターフェースしか参照しない。
// Phase1: localGameService（メモリ内）/ Phase2: remoteGameService（API）に差し替え。
import type { GameState, Move } from '../types';

export interface IGameService {
  createGame(boardSize: number): Promise<GameState>;
  submitMove(gameId: string, move: Move): Promise<GameState>;
  getGame(gameId: string): Promise<GameState>;
}
