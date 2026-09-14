// パス/投了ボタン・手番表示・アゲハマ表示（SPEC 9章）
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useGameStore } from '../state/gameStore';
import { colors } from '../theme';
import { ColorDot } from './ColorDot';
import { ScorePanel } from './ScorePanel';
import { colorJa, formatResult } from './resultFormat';

function Button({
  label,
  onPress,
  disabled,
  variant = 'default',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'danger' && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          (variant === 'primary' || variant === 'danger') && styles.buttonTextLight,
          disabled && styles.buttonTextDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ControlBar() {
  const game = useGameStore((s) => s.game);
  const preview = useGameStore((s) => s.preview);
  const error = useGameStore((s) => s.error);
  const busy = useGameStore((s) => s.busy);
  const confirmMove = useGameStore((s) => s.confirmMove);
  const cancelPreview = useGameStore((s) => s.cancelPreview);
  const pass = useGameStore((s) => s.pass);
  const resign = useGameStore((s) => s.resign);
  const startGame = useGameStore((s) => s.startGame);

  if (!game) return null;

  const finished = game.status === 'finished';

  return (
    <View style={styles.container}>
      {/* ステータス行：手番 or 結果 + アゲハマ */}
      <View style={styles.statusRow}>
        {finished ? (
          <Text style={styles.result}>
            終局 — {formatResult(game.result)}
          </Text>
        ) : (
          <View style={styles.turnWrap}>
            <ColorDot color={game.nextToPlay} size={18} />
            <Text style={styles.turnText}>{colorJa(game.nextToPlay)}番</Text>
          </View>
        )}
        <Text style={styles.captures}>
          アゲハマ  黒 {game.captures.black} / 白 {game.captures.white}
        </Text>
      </View>

      {/* 終局時の地の内訳（両パス終局のみ。投了は地を数えない） */}
      {finished && game.score && <ScorePanel score={game.score} />}

      {/* フィードバック */}
      {error && <Text style={styles.error}>{error}</Text>}
      {!error && preview && !finished && (
        <Text style={styles.hint}>もう一度同じ点 or「確定」で着手</Text>
      )}

      {/* 操作ボタン */}
      <View style={styles.buttonRow}>
        {finished ? (
          <Button label="新しい対局" variant="primary" onPress={() => void startGame(game.boardSize)} />
        ) : (
          <>
            <Button
              label="確定"
              variant="primary"
              disabled={!preview || busy}
              onPress={() => void confirmMove()}
            />
            <Button label="取消" disabled={!preview || busy} onPress={cancelPreview} />
            <Button label="パス" disabled={busy} onPress={() => void pass()} />
            <Button label="投了" variant="danger" disabled={busy} onPress={() => void resign()} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  turnWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  turnText: { fontSize: 18, fontWeight: '600', color: colors.text },
  result: { fontSize: 18, fontWeight: '700', color: colors.text },
  captures: { fontSize: 14, color: colors.textMuted },
  error: { color: colors.error, fontSize: 14 },
  hint: { color: colors.textSubtle, fontSize: 13 },
  buttonRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: colors.buttonBg,
    borderWidth: 1,
    borderColor: colors.buttonBorder,
  },
  buttonPrimary: { backgroundColor: colors.primaryBg, borderColor: colors.primaryBorder },
  buttonDanger: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
  buttonDisabled: { backgroundColor: colors.disabledBg, borderColor: colors.disabledBorder },
  buttonPressed: { opacity: 0.7 },
  buttonText: { fontSize: 15, fontWeight: '600', color: colors.buttonText },
  buttonTextLight: { color: colors.buttonTextOnFill },
  buttonTextDisabled: { color: colors.disabledText },
});
