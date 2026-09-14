// 終局時の地マーカー（SPEC 9章）
// 空点のうち片方の色だけに囲まれた点（＝その色の地）に、小さな四角を描く。
// 石の上には描かない（盤面がそのまま読めるように）。ダメ（帰属なし）は無印。
import { G, Rect } from 'react-native-svg';
import { colors, stoneFill } from '../theme';
import type { BoardState, PointOwner } from '../types';
import { coord, type BoardGeometry } from './boardGeometry';

export function TerritoryMarkers({
  geometry: g,
  board,
  ownership,
}: {
  geometry: BoardGeometry;
  board: BoardState;
  ownership: PointOwner[][];
}) {
  const side = g.stoneR * 0.78; // 石よりはっきり小さく＝石と見間違えない大きさ
  const marks = [];
  for (let y = 0; y < g.size; y++) {
    for (let x = 0; x < g.size; x++) {
      if (board[y][x] !== null) continue; // 石のある点は帰属＝石の色なのでマーカー不要
      const owner = ownership[y][x];
      if (!owner) continue; // ダメ
      marks.push(
        <Rect
          key={`t${x}-${y}`}
          x={coord(g, x) - side / 2}
          y={coord(g, y) - side / 2}
          width={side}
          height={side}
          rx={1}
          fill={stoneFill(owner)}
          // 盤色の上で白マーカーの輪郭が消えないよう、両色とも濃い縁取り
          stroke={colors.stoneOutline}
          strokeWidth={1}
        />,
      );
    }
  }
  return <G>{marks}</G>;
}
