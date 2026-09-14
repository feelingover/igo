// エンジンスパイク（SPEC 6章）: 自前エンジンを Node で実走検証する。
//   node src/engine/spike.test.ts
// 取り・自殺手・コウ・スコア・moves再構築を確認する。
import type { Point, StoneColor } from '../types';
import { createRuleEngine, replayMoves } from './ruleEngine';
import { SelfRuleEngine, type SelfEngineState } from './selfRuleEngine';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const engine = createRuleEngine();
const P = (x: number, y: number): Point => ({ x, y });
const boardOf = (s: unknown) => (s as SelfEngineState).board;

// --- 取り（キャプチャ） -------------------------------------------------
// 白(1,0)を黒で囲って取る:  黒(0,0),(2,0),(1,1) で 上辺の白(1,0)は呼吸点ゼロ
console.log('取り:');
{
  let s = engine.emptyState(9);
  s = engine.playMove(s, 'black', P(0, 0));
  s = engine.playMove(s, 'white', P(1, 0));
  s = engine.playMove(s, 'black', P(2, 0));
  const before = s;
  s = engine.playMove(s, 'black', P(1, 1)); // 白(1,0)を取る
  check('白石が盤上から消える', boardOf(s)[0][1] === null);
  check('取り石数=1', engine.capturesBetween(before, s) === 1);
  check('黒のアゲハマ=1', (s as SelfEngineState).captures.black === 1);
}

// --- 自殺手（着手禁止点） ------------------------------------------------
console.log('自殺手:');
{
  // 黒で(0,1),(1,0)を置くと(0,0)は黒に囲まれた空点。白が(0,0)に打つのは自殺手。
  let s = engine.emptyState(9);
  s = engine.playMove(s, 'black', P(0, 1));
  s = engine.playMove(s, 'black', P(1, 0));
  check('白の自殺手は非合法', engine.isLegalMove(s, 'white', P(0, 0)) === false);
  // ただし黒が(0,0)に打つのは（自分の連が呼吸点を持つので）合法
  check('黒の自連手は合法', engine.isLegalMove(s, 'black', P(0, 0)) === true);
}

// --- 取りになる手は自殺手ではない（相手を取れば呼吸点が生まれる） --------
console.log('取り＞自殺判定:');
{
  // 白(0,0),(0,1) を黒(1,0),(1,1),(0,2) で囲み、最後 黒(... )...簡略化して
  // 1線のアタリ：白(0,0) 黒(1,0)。黒(0,1)で白を取れる→自殺ではない。
  let s = engine.emptyState(9);
  s = engine.playMove(s, 'white', P(0, 0));
  s = engine.playMove(s, 'black', P(1, 0));
  check('取れる手は合法（自殺扱いしない）', engine.isLegalMove(s, 'black', P(0, 1)) === true);
}

// --- コウ（同形反復禁止） -----------------------------------------------
console.log('コウ:');
{
  // 教科書的な最小コウ形（コウ点ペア A=(1,1), B=(2,1)）:
  //      x: 0 1 2 3
  //   y0:   . W B .
  //   y1:   W . W B      ← (1,1)=A空, (2,1)=B白
  //   y2:   . W B .
  //   白: (1,0),(0,1),(1,2),(2,1)   黒: (2,0),(3,1),(2,2)
  let s = engine.emptyState(9);
  s = engine.playMove(s, 'white', P(1, 0));
  s = engine.playMove(s, 'white', P(0, 1));
  s = engine.playMove(s, 'white', P(1, 2));
  s = engine.playMove(s, 'white', P(2, 1));
  s = engine.playMove(s, 'black', P(2, 0));
  s = engine.playMove(s, 'black', P(3, 1));
  s = engine.playMove(s, 'black', P(2, 2));
  // 黒が A=(1,1) に打つと白 B=(2,1) を取れる（白Bは呼吸点がAだけ）
  check('黒がコウを取る手は合法', engine.isLegalMove(s, 'black', P(1, 1)) === true);
  s = engine.playMove(s, 'black', P(1, 1));
  check('白(2,1)が取られた', boardOf(s)[1][2] === null);
  // 白が即座に B=(2,1) で取り返すのは直前局面の再現＝同形反復→非合法
  check('白の即コウ取り返しは非合法', engine.isLegalMove(s, 'white', P(2, 1)) === false);
  // コウ立て（別の場所に着手して局面を変える）を挟めば取り返せる
  let s2 = engine.playMove(s, 'white', P(7, 7)); // 遠方にコウ立て
  s2 = engine.playMove(s2, 'black', P(7, 8)); // 黒が応じる（局面が変わる）
  check('別局面を経由すれば白の取り返しは合法', engine.isLegalMove(s2, 'white', P(2, 1)) === true);
}

// --- 同形反復：取りを伴わない着手でも過去局面は再現できない ---------------
console.log('同形反復（取りゼロの手）:');
{
  // 「取りゼロなら同形反復にならない」は誤り、を示す局面。
  // スナップバックを挟むと、盤から石が1個だけ減った状態に戻せるので、
  // 次に「取りを伴わない一手」で過去局面をそのまま再現できてしまう。
  //
  //   H:      x: 0 1 2 3        ← W(0,1),(0,2) は (0,0) が唯一の呼吸点
  //      y0:     . W . .
  //      y1:     W B . .
  //      y2:     W B . .
  //      y3:     B . . .
  let s = engine.emptyState(9);
  for (const p of [P(1, 1), P(1, 2), P(0, 3)]) s = engine.playMove(s, 'black', p);
  for (const p of [P(1, 0), P(0, 1), P(0, 2)]) s = engine.playMove(s, 'white', p);
  const historic = boardOf(s); // ＝ H。history に入っている

  // 黒(0,0) で白2子を取る → 黒(0,0) は自身がアタリ（スナップバック）
  s = engine.playMove(s, 'black', P(0, 0));
  check('黒が白2子を取る', boardOf(s)[1][0] === null && boardOf(s)[2][0] === null);
  // 白(0,1) で取り返す → 盤は「H から白(0,2) を1個抜いた形」に戻る
  s = engine.playMove(s, 'white', P(0, 1));
  check('白が取り返して盤が H−1子 に戻る', boardOf(s)[0][0] === null);

  // ここで白(0,2) は何も取らない（周囲の黒は呼吸点を持つ）。
  // だが結果の盤は H そのもの＝同形反復なので非合法でなければならない。
  check(
    '取りを伴わない手でも過去局面の再現は非合法',
    engine.isLegalMove(s, 'white', P(0, 2)) === false,
  );
  // 念のため：再現先が本当に H と一致することを確認する
  const wouldBe = boardOf(engine.playMove(s, 'white', P(0, 2)));
  check(
    '再現される盤は H と同一',
    JSON.stringify(wouldBe) === JSON.stringify(historic),
  );
  // 同形反復にならない別の空点は当然合法（過剰に禁止していないこと）
  check('無関係な空点は合法のまま', engine.isLegalMove(s, 'white', P(5, 5)) === true);
}

// --- 両パス終局 + スコア -------------------------------------------------
console.log('終局・スコア:');
{
  // 黒が左半分、白が右半分を完全に分ける小規模局面で area scoring を確認。
  // 5路で縦の壁: 黒列x=1, 白列x=3。x=0は黒地, x=4は白地, x=2はダメ。
  let s = engine.emptyState(5);
  for (let y = 0; y < 5; y++) s = engine.playMove(s, 'black', P(1, y));
  for (let y = 0; y < 5; y++) s = engine.playMove(s, 'white', P(3, y));
  s = engine.pass(s, 'black');
  check('1パスでは終局しない', engine.isGameOver(s) === false);
  s = engine.pass(s, 'white');
  check('両パスで終局', engine.isGameOver(s) === true);
  // 黒: 石5(x=1) + 地5(x=0) = 10、白: 石5(x=3) + 地5(x=4) = 10、x=2列はダメ
  // komi=0 なら引き分け相当（diff=0→黒勝ち扱い）。komi=6.5 → 白+6.5
  const r0 = engine.score(s, 0);
  check('komi0: 黒地10 白地10 で差0', r0.margin === 0);
  const r = engine.score(s, 6.5);
  check('komi6.5: 白が6.5勝ち', r.winner === 'white' && r.margin === 6.5);

  // 内訳（UI の地表示に使う）
  check('黒の内訳: 石5 + 地5 = 10目', r.black.stones === 5 && r.black.territory === 5 && r.black.total === 10);
  check('白の内訳: 石5 + 地5 + コミ6.5 = 16.5目', r.white.stones === 5 && r.white.territory === 5 && r.white.total === 16.5);
  check('コミは白だけが持つ', r.black.komi === 0 && r.white.komi === 6.5);

  // 帰属マップ ownership[y][x]
  check('x=0列は黒地', r.ownership[0][0] === 'black' && r.ownership[4][0] === 'black');
  check('x=4列は白地', r.ownership[0][4] === 'white' && r.ownership[4][4] === 'white');
  check('石のある点は石の色', r.ownership[2][1] === 'black' && r.ownership[2][3] === 'white');
  check('x=2列（両者に接する空点）はダメ＝null', r.ownership[0][2] === null && r.ownership[4][2] === null);
}

// --- 地が付かないケース（帰属なし） --------------------------------------
console.log('地なし:');
{
  // 空の盤：全交点がダメ扱い（どちらの色にも囲まれていない）
  const empty = engine.score(engine.emptyState(5), 6.5);
  check('空盤は地ゼロ', empty.black.territory === 0 && empty.white.territory === 0);
  check('空盤の帰属は全て null', empty.ownership.every((row) => row.every((o) => o === null)));
}

// --- moves[] からの再構築（受け入れ基準） --------------------------------
console.log('moves再構築:');
{
  const moves = [
    { type: 'play' as const, color: 'black' as StoneColor, point: P(0, 0), moveNumber: 0 },
    { type: 'play' as const, color: 'white' as StoneColor, point: P(1, 0), moveNumber: 1 },
    { type: 'play' as const, color: 'black' as StoneColor, point: P(2, 0), moveNumber: 2 },
    { type: 'play' as const, color: 'black' as StoneColor, point: P(1, 1), moveNumber: 3 }, // 白を取る
  ];
  const rebuilt = replayMoves(engine, 9, moves);
  check('再構築後も白(1,0)は取られている', boardOf(rebuilt)[0][1] === null);
  check('再構築後 黒アゲハマ=1', (rebuilt as SelfEngineState).captures.black === 1);
}

// 別 instance であることの確認（factory が SelfRuleEngine を返す）
check('factory が SelfRuleEngine を返す', engine instanceof SelfRuleEngine);

console.log(`\n結果: ${passed} passed, ${failed} failed`);
// 失敗時は throw で非ゼロ終了（@types/node 非依存）
if (failed > 0) throw new Error(`${failed} 件のスパイク検証に失敗`);
