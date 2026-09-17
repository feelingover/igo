// 署名鍵のレジストリ。DESIGN 8章・11章。
//
// `kid` → {アルゴリズム, 鍵} の対応表をサーバ側に持つ。この形にしておくことで
//   - `alg` ヘッダを信用しない検証ができる（DESIGN 2章）
//   - 鍵のローテーションと HS256 → ES256 の移行を無停止でできる（DESIGN 11章）
import { randomBytes } from 'node:crypto';

import type { JwtAlgorithm, SigningKey } from './jwt';

/** HS256 用の鍵を生成する。256bit（32バイト）以上（DESIGN 11章）。 */
export function generateHs256Key(kid: string): SigningKey {
  return { kid, alg: 'HS256', secret: randomBytes(32) };
}

export interface SigningKeyInfo {
  readonly kid: string;
  readonly alg: JwtAlgorithm;
  /** 現在この鍵で署名しているか。 */
  readonly active: boolean;
}

export class SigningKeyRegistry {
  private readonly keys = new Map<string, SigningKey>();
  private activeKid: string;

  constructor(initial: SigningKey) {
    this.keys.set(initial.kid, initial);
    this.activeKid = initial.kid;
  }

  /** 署名に使う鍵。 */
  get active(): SigningKey {
    const key = this.keys.get(this.activeKid);
    if (key === undefined) throw new Error(`署名鍵 ${this.activeKid} がレジストリにない`);
    return key;
  }

  /** 検証用の鍵引き。未知の `kid` は undefined（呼び出し側で即拒否）。 */
  resolve(kid: string): SigningKey | undefined {
    return this.keys.get(kid);
  }

  /**
   * 手順1: 新しい鍵を検証側にだけ配る。この時点ではまだ署名には使わない。
   *
   * 既存の `kid` への上書きは許さない。同じ `kid` で別の鍵に差し替えると、
   * その `kid` で署名済みの生きたトークンが一斉に検証失敗する。
   */
  addVerificationKey(key: SigningKey): void {
    if (this.keys.has(key.kid)) throw new Error(`kid が既に存在する: ${key.kid}`);
    this.keys.set(key.kid, key);
  }

  /** 手順3: 署名鍵を切り替える。全サーバが検証できるようになってから呼ぶ。 */
  promote(kid: string): void {
    if (!this.keys.has(kid)) throw new Error(`未登録の kid には切り替えられない: ${kid}`);
    this.activeKid = kid;
  }

  /**
   * 手順5: 旧鍵を検証側から外す。
   * 手順4（旧鍵で署名されたアクセストークンが全て期限切れになるまで待つ）を
   * 飛ばして呼ぶと、生きているトークンが一斉に検証失敗する。
   */
  retire(kid: string): void {
    if (kid === this.activeKid) throw new Error('署名中の鍵は retire できない');
    this.keys.delete(kid);
  }

  /** 運用確認用。鍵そのものは絶対に出さない（DESIGN 11章）。 */
  list(): SigningKeyInfo[] {
    return [...this.keys.values()].map((key) => ({
      kid: key.kid,
      alg: key.alg,
      active: key.kid === this.activeKid,
    }));
  }
}
