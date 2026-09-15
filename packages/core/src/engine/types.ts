// ルールエンジンのインターフェース（SPEC 6章）
import type { BoardState, Captures, Point, ScoreResult, StoneColor } from '../types';

export interface IRuleEngine {
  emptyState(size: number): EngineState;
  isLegalMove(state: EngineState, color: StoneColor, point: Point): boolean;
  // 着手後の新状態を返す（取り石反映済み・イミュータブル）
  playMove(state: EngineState, color: StoneColor, point: Point): EngineState;
  // パス後の新状態を返す。
  // NOTE: SPEC の IRuleEngine には pass が無かったが、EngineState は外部から
  // 不透明（unknown）なため「両パス終局（isGameOver）」を engine 内で正しく
  // 判定するにはパスも状態遷移として engine を通す必要がある。最小の追加。
  pass(state: EngineState, color: StoneColor): EngineState;
  // 次に着手する色。EngineState が不透明なので、手番も engine 経由で取得する。
  // これが無いと上位層が手番を二重管理することになる。
  toPlay(state: EngineState): StoneColor;
  // 累計アゲハマ。取り石の集計は engine が唯一の権威で、上位層は差分を数えない。
  captures(state: EngineState): Captures;
  isGameOver(state: EngineState): boolean; // 両パス
  // area scoring（中国ルール）。komi は引数で受ける（デフォ 6.5 など）
  // NOTE: SPEC では戻り値が { winner, margin } だけだったが、終局時に「どこが
  // 黒地／白地か」を UI で示すため、内訳（石・地・コミ）と交点ごとの帰属
  // （ownership）を含む ScoreResult に拡張している。数え方自体は変更なし。
  score(state: EngineState, komi: number): ScoreResult;
  toBoardState(state: EngineState): BoardState;
}

export type EngineState = unknown; // アダプタ内部型。外には漏らさない
