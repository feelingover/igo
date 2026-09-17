// 時刻の注入口。
//
// 認証の状態遷移はほぼすべて時刻で決まる（猶予期間・絶対期限・`exp`）ため、
// DESIGN 12章のテスト項目を書くには時計を差し替えられる必要がある。
// `Date.now()` を業務ロジックから直接呼ばない。

/** epoch ミリ秒を返す。 */
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();

/** テスト用。任意の時刻に固定し、明示的に進める。 */
export class TestClock {
  private current: number;

  constructor(start = Date.UTC(2026, 0, 1, 0, 0, 0)) {
    this.current = start;
  }

  readonly now: Clock = () => this.current;

  advanceMs(ms: number): void {
    this.current += ms;
  }

  advanceSec(sec: number): void {
    this.advanceMs(sec * 1000);
  }
}
