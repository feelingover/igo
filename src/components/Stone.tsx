// 石（円）。SPEC 9章: 黒 #000、白 #fff（白は薄い境界線）。色は theme を参照。
import { Circle } from 'react-native-svg';
import { colors, stoneFill } from '../theme';
import type { StoneColor } from '../types';

type Props = {
  cx: number;
  cy: number;
  r: number;
  color: StoneColor;
  opacity?: number; // プレビュー時は半透明
};

export function Stone({ cx, cy, r, color, opacity = 1 }: Props) {
  const isBlack = color === 'black';
  return (
    <Circle
      cx={cx}
      cy={cy}
      r={r}
      fill={stoneFill(color)}
      // 白石は盤上で視認できるよう薄い境界線。黒石にもごく薄い縁取りで立体感。
      stroke={isBlack ? colors.stoneBlack : colors.stoneWhiteEdge}
      strokeWidth={isBlack ? 0 : 1}
      opacity={opacity}
    />
  );
}
