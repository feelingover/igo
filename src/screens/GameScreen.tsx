// 対局画面（SPEC 4章/10章）
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ControlBar } from '../components/ControlBar';
import { GobanBoard } from '../components/GobanBoard';
import { useGameStore } from '../state/gameStore';
import { colors } from '../theme';

const BOARD_SIZE = 9; // Phase1 は 9 路固定（設計はサイズ可変）

export function GameScreen() {
  const game = useGameStore((s) => s.game);
  const startGame = useGameStore((s) => s.startGame);
  const { width, height } = useWindowDimensions();

  // 起動 → startGame(9)
  useEffect(() => {
    if (!game) void startGame(BOARD_SIZE);
  }, [game, startGame]);

  // 盤は正方形・画面幅にフィット（縦長すぎないよう高さでも制限）
  const boardPx = Math.floor(Math.min(width - 24, height * 0.62));

  // 終局時はスコア内訳が加わって画面に収まらないことがあるのでスクロール可能にする
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>囲碁 — 9路 二人対局</Text>
      <View style={styles.boardWrap}>
        {game ? <GobanBoard boardPx={boardPx} /> : <Text>準備中…</Text>}
      </View>
      <ControlBar />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.heading },
  boardWrap: { alignItems: 'center', justifyContent: 'center' },
});
