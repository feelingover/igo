// 終局時のスコア内訳表示（SPEC 9章）
// 中国ルールの area scoring を「石 ＋ 地（＋ コミ）＝ 合計」で見せる。
// 盤上の地マーカー（TerritoryMarkers）と色を対応させ、凡例で地の数を示す。
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import type { ScoreBreakdown, ScoreResult, StoneColor } from '../types';
import { ColorDot } from './ColorDot';
import { colorJa, formatPoints } from './resultFormat';

function ScoreRow({ color, score }: { color: StoneColor; score: ScoreBreakdown }) {
  return (
    <View style={styles.row}>
      <ColorDot color={color} size={14} />
      <Text style={styles.rowLabel}>{colorJa(color)}</Text>
      <Text style={styles.rowFormula}>
        石 {score.stones} ＋ 地 {score.territory}
        {score.komi > 0 ? ` ＋ コミ ${formatPoints(score.komi)}` : ''}
      </Text>
      <Text style={styles.rowTotal}>{formatPoints(score.total)} 目</Text>
    </View>
  );
}

function LegendItem({ color, territory }: { color: StoneColor; territory: number }) {
  return (
    <View style={styles.legendItem}>
      <ColorDot color={color} size={12} shape="square" />
      <Text style={styles.legendText}>
        {colorJa(color)}地 {territory} 目
      </Text>
    </View>
  );
}

export function ScorePanel({ score }: { score: ScoreResult }) {
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>地の内訳（中国ルール／石＋地）</Text>
      <ScoreRow color="black" score={score.black} />
      <ScoreRow color="white" score={score.white} />
      <View style={styles.legend}>
        <LegendItem color="black" territory={score.black.territory} />
        <LegendItem color="white" territory={score.white.territory} />
        <Text style={styles.legendNote}>■ は盤上のマーカーと同じ色です</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  heading: { fontSize: 13, fontWeight: '700', color: colors.textSubtle },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { fontSize: 15, fontWeight: '700', color: colors.text, width: 24 },
  rowFormula: { flex: 1, fontSize: 14, color: colors.textMuted },
  rowTotal: { fontSize: 15, fontWeight: '700', color: colors.text },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 6,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: 13, color: colors.textMuted },
  legendNote: { fontSize: 12, color: colors.textFaint },
});
