// @igo/core の疎通確認。
//
// このモノレポの存在理由は SPEC「Phase 2：ルール判定はサーバー権威」にある。
// つまりサーバ側でも自殺手判定・同形反復・中国ルール面積計算が動く必要がある。
// このスクリプトは、クライアントと"同一の"エンジン実装が素の Node で動くことを示す。
// HTTP 層も永続化もまだ無い。ここにあるのは seam の証明だけ。
import { LocalGameService, opponent, type Point } from '@igo/core';

const BOARD_SIZE = 9;

const fmt = (p: Point) => `(${p.x},${p.y})`;

async function main(): Promise<void> {
  const service = new LocalGameService();
  const created = await service.createGame(BOARD_SIZE);
  console.log(`対局を作成: ${created.gameId} / ${created.boardSize}路 / 手番=${created.nextToPlay}`);

  // 隅の黒1子を白が取る手順。tenuki を挟んで手番を合わせている。
  const plays: Array<{ color: 'black' | 'white'; point: Point }> = [
    { color: 'black', point: { x: 0, y: 0 } },
    { color: 'white', point: { x: 1, y: 0 } },
    { color: 'black', point: { x: 4, y: 4 } }, // 手抜き
    { color: 'white', point: { x: 0, y: 1 } }, // ← ここで黒(0,0)が取られる
  ];

  let moveNumber = 1;
  let state = created;
  for (const { color, point } of plays) {
    state = await service.submitMove(created.gameId, { type: 'play', color, point, moveNumber: moveNumber++ });
    console.log(`  ${moveNumber - 1}. ${color} ${fmt(point)} → アゲハマ 黒${state.captures.black} 白${state.captures.white}`);
  }

  console.log(`取り判定: 黒(0,0) は ${state.currentBoard[0][0] === null ? '盤上から消えた ✓' : '残っている ✗'}`);

  // サーバ権威の本体：手番違反と非合法手を弾けること。
  // 手番は engine が唯一の権威なので、状態から導いて「手番でない側」を作る。
  const onTurn = state.nextToPlay;
  const offTurn = opponent(onTurn);
  await expectRejected(`手番違反（${onTurn}の番に${offTurn}が打つ）`, () =>
    service.submitMove(created.gameId, {
      type: 'play', color: offTurn, point: { x: 5, y: 5 }, moveNumber: 99,
    }),
  );
  await expectRejected(`着手禁止点（(0,0) は白に囲まれ呼吸点ゼロ）`, () =>
    service.submitMove(created.gameId, {
      type: 'play', color: onTurn, point: { x: 0, y: 0 }, moveNumber: 99,
    }),
  );

  // 両パスで終局 → 中国ルール area scoring
  for (const color of ['black', 'white'] as const) {
    state = await service.submitMove(created.gameId, { type: 'pass', color, moveNumber: moveNumber++ });
  }

  console.log(`終局: status=${state.status}`);
  if (state.result?.kind !== 'score' || !state.score) {
    throw new Error(`両パスで score 終局にならなかった: ${JSON.stringify(state.result)}`);
  }
  const { winner, margin } = state.result;
  const { black, white } = state.score;
  console.log(`  勝敗: ${winner}${winner === 'draw' ? '（持碁）' : ` +${margin}`}`);
  console.log(`  黒: 石${black.stones} + 地${black.territory} + コミ${black.komi} = ${black.total}`);
  console.log(`  白: 石${white.stones} + 地${white.territory} + コミ${white.komi} = ${white.total}`);

  // moves[] が唯一の真実であること（SPEC 3章）。盤はそこから導出されている。
  const reloaded = await service.getGame(created.gameId);
  const sameBoard = JSON.stringify(reloaded.currentBoard) === JSON.stringify(state.currentBoard);
  console.log(`moves[] は ${reloaded.moves.length} 手 / 再取得した盤は一致: ${sameBoard ? '✓' : '✗'}`);
  if (!sameBoard) throw new Error('getGame の盤が submitMove の盤と一致しない');

  console.log('\n@igo/core は素の Node で動作する ✓（サーバー権威のルール判定が可能）');
}

async function expectRejected(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.log(`  拒否: ${label} → "${(err as Error).message}" ✓`);
    return;
  }
  throw new Error(`${label} が拒否されなかった`);
}

// 失敗時は throw で非ゼロ終了（spike.test.ts と同じ方針）
void main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
