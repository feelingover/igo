// 結果・目数の日本語表記（SPEC 9章）
// ControlBar / ScorePanel が共通で使う表示フォーマット。
import type { GameResult, StoneColor } from '../types';

export const colorJa = (c: StoneColor): string => (c === 'black' ? '黒' : '白');

// 目数の表記。コミ込みで .5 が出るので、整数はそのまま／端数は小数1桁。
export const formatPoints = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

// GameResult → 日本語表記。構造をそのまま読むので解析も分岐漏れも無い。
export function formatResult(result?: GameResult): string {
  if (!result) return '';
  if (result.kind === 'resign') return `${colorJa(result.winner)} 中押し勝ち`;
  if (result.winner === 'draw') return '持碁（引き分け）';
  return `${colorJa(result.winner)} ${formatPoints(result.margin)}目勝ち`;
}
