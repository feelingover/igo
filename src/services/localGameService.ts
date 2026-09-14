// Phase1 ゲームサービス実装（SPEC 7章）
// メモリ内で対局を保持し、submitMove で IRuleEngine を直叩きして新状態を返す。
// async で統一（Phase2 で remoteGameService に差し替えてもインターフェースを変えないため）。
import { createRuleEngine } from '../engine/ruleEngine';
import type { EngineState, IRuleEngine } from '../engine/types';
import type { GameResult, GameState, Move, ScoreResult } from '../types';
import { opponent } from '../types';
import type { IGameService } from './gameService';

// 9路の中国ルールのコミ。環境によって差し替えたくなったら引数化する（Phase1 は定数）。
const DEFAULT_KOMI = 6.5;

// 対局ごとに保持するのは「engine から導出できない事実」だけ。
// 盤・手番・アゲハマは engineState から毎回導出する（＝二重管理しない）。
interface GameRecord {
  gameId: string;
  boardSize: number;
  komi: number;
  engine: IRuleEngine;
  engineState: EngineState; // moves[] を反映した現在局面（キャッシュ）
  moves: Move[]; // 真実（SPEC 3章）
  result?: GameResult; // 終局時のみ。投了は engineState に現れないのでここが唯一の記録
  score?: ScoreResult; // 両パス終局時のみ（投了は地を数えない）
}

// GameRecord → GameState。派生フィールドはすべて engineState から導く。
// 手で1つずつ同期していた頃と違い、追加漏れや case ごとの写経ミスが起きない。
const project = (rec: GameRecord): GameState => ({
  gameId: rec.gameId,
  boardSize: rec.boardSize,
  moves: rec.moves.slice(),
  currentBoard: rec.engine.toBoardState(rec.engineState),
  nextToPlay: rec.engine.toPlay(rec.engineState),
  captures: rec.engine.captures(rec.engineState),
  status: rec.result ? 'finished' : 'playing',
  result: rec.result,
  score: rec.score,
});

export class LocalGameService implements IGameService {
  private games = new Map<string, GameRecord>();
  private seq = 0;

  async createGame(boardSize: number): Promise<GameState> {
    if (!Number.isInteger(boardSize) || boardSize < 2) {
      throw new Error(`invalid board size: ${boardSize}`);
    }
    const engine = createRuleEngine();
    const rec: GameRecord = {
      gameId: `local-${Date.now()}-${this.seq++}`,
      boardSize,
      komi: DEFAULT_KOMI,
      engine,
      engineState: engine.emptyState(boardSize),
      moves: [],
    };
    this.games.set(rec.gameId, rec);
    return project(rec);
  }

  async submitMove(gameId: string, move: Move): Promise<GameState> {
    const rec = this.require(gameId);

    if (rec.result) throw new Error('game is already finished');
    if (move.color !== rec.engine.toPlay(rec.engineState)) {
      throw new Error(`not ${move.color}'s turn`);
    }

    switch (move.type) {
      case 'play': {
        if (!rec.engine.isLegalMove(rec.engineState, move.color, move.point)) {
          throw new Error('illegal move');
        }
        rec.engineState = rec.engine.playMove(rec.engineState, move.color, move.point);
        break;
      }
      case 'pass': {
        rec.engineState = rec.engine.pass(rec.engineState, move.color);
        // 両パス → 終局して中国ルールでスコア。
        // score は内訳（石・地・コミ）と交点ごとの帰属を含み、UI の地表示に使う。
        if (rec.engine.isGameOver(rec.engineState)) {
          rec.score = rec.engine.score(rec.engineState, rec.komi);
          rec.result = {
            kind: 'score',
            winner: rec.score.winner,
            margin: rec.score.margin,
          };
        }
        break;
      }
      case 'resign': {
        // 投了 → 相手の勝ち（中押し）。盤面には影響しないので engineState は進めない。
        rec.result = { kind: 'resign', winner: opponent(move.color) };
        break;
      }
    }

    rec.moves.push(move);
    return project(rec);
  }

  async getGame(gameId: string): Promise<GameState> {
    return project(this.require(gameId));
  }

  private require(gameId: string): GameRecord {
    const rec = this.games.get(gameId);
    if (!rec) throw new Error(`game not found: ${gameId}`);
    return rec;
  }
}

// Phase1 はシングルトンで十分
export const localGameService = new LocalGameService();
