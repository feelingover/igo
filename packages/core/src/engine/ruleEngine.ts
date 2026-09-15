// ルールエンジンのファクトリ（SPEC 6章）
// スパイクの結果、自前実装（SelfRuleEngine）を採用。
// 別エンジンに差し替える場合はここだけ変えれば UI/State 層は無変更。
import type { Move } from '../types';
import { SelfRuleEngine } from './selfRuleEngine';
import type { EngineState, IRuleEngine } from './types';

export function createRuleEngine(): IRuleEngine {
  return new SelfRuleEngine();
}

// 着手列 moves[] から局面（EngineState）を再構築する。
// 「盤面は moves[] から導出する」という設計原則の実体（SPEC 3章）。
// resign は盤面に影響しないのでスキップする。
export function replayMoves(
  engine: IRuleEngine,
  size: number,
  moves: Move[],
): EngineState {
  let state = engine.emptyState(size);
  for (const move of moves) {
    if (move.type === 'play') {
      state = engine.playMove(state, move.color, move.point);
    } else if (move.type === 'pass') {
      state = engine.pass(state, move.color);
    }
  }
  return state;
}
