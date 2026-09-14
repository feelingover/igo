// 線・星・座標ラベル（SPEC 9章）
import { Circle, G, Line, Text as SvgText } from 'react-native-svg';
import { colors } from '../theme';
import {
  columnLabel,
  coord,
  rowLabel,
  starPoints,
  type BoardGeometry,
} from './boardGeometry';

const LINE_COLOR = colors.boardLine;
const LABEL_COLOR = colors.boardLabel;

export function BoardGrid({ geometry: g }: { geometry: BoardGeometry }) {
  const min = coord(g, 0);
  const max = coord(g, g.size - 1);
  const labelFont = Math.max(8, g.cell * 0.34);

  const lines = [];
  for (let i = 0; i < g.size; i++) {
    const p = coord(g, i);
    // 横線
    lines.push(
      <Line key={`h${i}`} x1={min} y1={p} x2={max} y2={p} stroke={LINE_COLOR} strokeWidth={1} />,
    );
    // 縦線
    lines.push(
      <Line key={`v${i}`} x1={p} y1={min} x2={p} y2={max} stroke={LINE_COLOR} strokeWidth={1} />,
    );
  }

  const stars = starPoints(g.size).map((s, i) => (
    <Circle
      key={`star${i}`}
      cx={coord(g, s.x)}
      cy={coord(g, s.y)}
      r={Math.max(2, g.cell * 0.06)}
      fill={LINE_COLOR}
    />
  ));

  const labels = [];
  for (let i = 0; i < g.size; i++) {
    const p = coord(g, i);
    // 列ラベル（上）
    labels.push(
      <SvgText
        key={`cl${i}`}
        x={p}
        y={min - g.cell * 0.55}
        fontSize={labelFont}
        fill={LABEL_COLOR}
        textAnchor="middle"
      >
        {columnLabel(i)}
      </SvgText>,
    );
    // 行ラベル（左）
    labels.push(
      <SvgText
        key={`rl${i}`}
        x={min - g.cell * 0.6}
        y={p + labelFont * 0.35}
        fontSize={labelFont}
        fill={LABEL_COLOR}
        textAnchor="middle"
      >
        {rowLabel(g, i)}
      </SvgText>,
    );
  }

  return (
    <G>
      {lines}
      {stars}
      {labels}
    </G>
  );
}
