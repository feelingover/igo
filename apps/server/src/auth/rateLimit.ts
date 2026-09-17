// レート制限。DESIGN 10章。
//
// 目的はエンドポイントごとに違う。
//   デバイス登録     : IP 単位。大量アカウント作成（リセマラ・BOT）
//   リフレッシュ     : family_id 単位。総当たり、暴走クライアント
//   サイレント再ログイン: device_id / IP 単位。device_secret の総当たり
//
// DESIGN 10章の但し書きどおり、リフレッシュの失敗が集中してもファミリー失効へ
// 直行させない。まず 429 で止めてから判断する。
import type { RateLimitRule } from './config';
import { CacheUnavailableError, type VolatileCache } from './cache';
import { AuthError } from './errors';

export interface RateLimitScope {
  /** エンドポイント識別子。 */
  readonly name: string;
  /** 制限の単位になる値（IP / family_id / device_id）。 */
  readonly key: string;
}

/**
 * 固定ウィンドウのカウンタ。超過したら 429 を投げる。
 *
 * キャッシュ全断時は素通しにする。レート制限は可用性のための仕組みであって
 * 認証境界ではないため、ここで落とすと障害が全リクエストの拒否に広がる。
 * （token_version の方針とは別物。あちらは DESIGN 7章で明示的に選ぶ。）
 */
export function enforceRateLimit(
  cache: VolatileCache,
  scope: RateLimitScope,
  rule: RateLimitRule,
  now: number,
): void {
  const window = Math.floor(now / (rule.windowSec * 1000));
  const cacheKey = `rl:${scope.name}:${scope.key}:${window}`;

  let count: number;
  try {
    count = cache.increment(cacheKey, rule.windowSec, now);
  } catch (error) {
    if (error instanceof CacheUnavailableError) return;
    throw error;
  }

  if (count > rule.max) {
    throw new AuthError('rate_limited', 429, 'リクエストが多すぎます。', rule.windowSec);
  }
}
