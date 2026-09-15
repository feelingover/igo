// UI 全体の配色（SPEC 9章）
//
// 色はこのファイルでだけ定義する。コンポーネント側に生のカラーコードを
// 書かないこと（同じ色に別の値が混ざるのを防ぐため）。
import type { StoneColor } from '@igo/core';

export const colors = {
  // --- 盤 ---
  board: '#e3b96b', // 榧(かや)っぽい盤の色
  boardLine: '#000',
  boardLabel: '#5a4632',

  // --- 石。手番ドットも終局時の地マーカーもこの色に揃える ---
  stoneBlack: '#000',
  stoneWhite: '#fff',
  stoneWhiteEdge: '#888', // 盤上で白石を見失わないための薄い縁
  stoneOutline: '#3a2f1c', // 盤色・カード色どちらの上でも消えない濃茶

  // --- 面 ---
  appBg: '#f3ead9',
  cardBg: '#f6f0e3',
  cardBorder: '#d8cbb0',
  divider: '#e2d8c2',

  // --- 文字 ---
  heading: '#3a2f1c',
  text: '#222',
  textMuted: '#555',
  textSubtle: '#7a6a52',
  textFaint: '#9a8b72',
  error: '#c0392b',

  // --- ボタン ---
  buttonBg: '#ece3d2',
  buttonBorder: '#c9bda3',
  buttonText: '#3a2f1c',
  buttonTextOnFill: '#fff',
  primaryBg: '#3a7d44',
  primaryBorder: '#2f6638',
  dangerBg: '#b23b3b',
  dangerBorder: '#8f2f2f',
  disabledBg: '#eee',
  disabledBorder: '#ddd',
  disabledText: '#aaa',
} as const;

// 石の色 → 塗り色。石・地マーカー・凡例ドットが同じ色になることを保証する。
export const stoneFill = (color: StoneColor): string =>
  color === 'black' ? colors.stoneBlack : colors.stoneWhite;
