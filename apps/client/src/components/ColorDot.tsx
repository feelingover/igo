// 「石の色を表す印」（SPEC 9章）
// 手番表示（ControlBar）とスコアの凡例（ScorePanel）が同じ見た目を
// 別々に実装していたのを共通化したもの。
import { View } from 'react-native';
import { colors, stoneFill } from '../theme';
import type { StoneColor } from '@igo/core';

type Props = {
  color: StoneColor;
  size?: number;
  /** square は盤上の地マーカー（■）と対応させる凡例用 */
  shape?: 'circle' | 'square';
};

export function ColorDot({ color, size = 14, shape = 'circle' }: Props) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: shape === 'circle' ? size / 2 : 2,
        borderWidth: 1,
        borderColor: colors.stoneOutline,
        backgroundColor: stoneFill(color),
      }}
    />
  );
}
