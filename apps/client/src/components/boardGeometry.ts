// 碁盤の座標計算（SPEC 9章）
// 交点(0-indexed) ⇄ ピクセル変換、星(hoshi)、座標ラベルを一元管理する。
import type { Point } from '@igo/core';

export interface BoardGeometry {
  size: number; // 1辺の交点数（9）
  boardPx: number; // SVG の1辺(px)
  padding: number; // 盤端 → 最外周の線まで（ラベル・端の石の余白）
  cell: number; // 線の間隔
  stoneR: number; // 石の半径
}

export function createGeometry(size: number, boardPx: number): BoardGeometry {
  const padding = boardPx * 0.08; // ラベルと端の石が収まる余白
  const cell = (boardPx - padding * 2) / (size - 1);
  const stoneR = cell * 0.46;
  return { size, boardPx, padding, cell, stoneR };
}

// 交点インデックス i → ピクセル座標
export const coord = (g: BoardGeometry, i: number): number => g.padding + i * g.cell;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

// タップ座標 → 最近接交点
export function nearestIntersection(
  g: BoardGeometry,
  px: number,
  py: number,
): Point {
  return {
    x: clamp(Math.round((px - g.padding) / g.cell), 0, g.size - 1),
    y: clamp(Math.round((py - g.padding) / g.cell), 0, g.size - 1),
  };
}

// 星(hoshi)の位置。9路なら隅4 + 天元。
export function starPoints(size: number): Point[] {
  if (size < 7) return [];
  const margin = size >= 13 ? 3 : 2;
  const center = (size - 1) / 2;
  const far = size - 1 - margin;
  const pts: Point[] = [
    { x: margin, y: margin },
    { x: far, y: margin },
    { x: margin, y: far },
    { x: far, y: far },
  ];
  const odd = size % 2 === 1;
  if (odd) pts.push({ x: center, y: center }); // 天元
  // 13路以上は辺の中央にも星
  if (size >= 13 && odd) {
    pts.push({ x: center, y: margin });
    pts.push({ x: center, y: far });
    pts.push({ x: margin, y: center });
    pts.push({ x: far, y: center });
  }
  return pts;
}

// 列ラベル: A から I を飛ばす囲碁慣習
const ALPHABET = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'; // I を除外済み
export const columnLabel = (x: number): string => ALPHABET[x] ?? `${x}`;

// 行ラベル: 下が1、上が size（y=0 が上なので size - y）
export const rowLabel = (g: BoardGeometry, y: number): number => g.size - y;
