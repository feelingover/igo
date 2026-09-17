// トークン認証モックの設定。
//
// 値の根拠はすべて設計ドキュメント mobile-game-token-auth-design.md にある。
// 以降このディレクトリでは、その章を「DESIGN N章」と表記して参照する
// （SPEC.md を「SPEC N章」と書くのと同じ流儀）。
//
// すべて注入可能にしてあるのは、DESIGN 12章のテスト項目
// （猶予期間の境界・絶対期限超過・ロック競合）が、既定値のままでは
// 現実的な時間内に再現できないため。

/** 固定ウィンドウのレート制限ルール（DESIGN 10章）。 */
export interface RateLimitRule {
  /** ウィンドウあたりの許容回数。 */
  readonly max: number;
  /** ウィンドウ幅（秒）。 */
  readonly windowSec: number;
}

/**
 * `token_version` を参照するキャッシュが全断したときの方針（DESIGN 7章）。
 * 決めずに実装すると、障害時の挙動が実装の偶然で決まる。
 */
export type CacheOutagePolicy =
  /** 永続DBへフォールバックする。同一キーの問い合わせはシングルフライトで1本に束ねる。推奨。 */
  | 'database-fallback'
  /** 参照できなければ検証を通す。可用性優先。`failOpenMaxMs` を超えたらフェイルクローズへ切り替える。 */
  | 'fail-open'
  /** 参照できなければ全拒否。安全優先。 */
  | 'fail-closed';

/** 端末アテステーション失敗時の方針（DESIGN 5章）。 */
export type AttestationPolicy =
  /** 失敗したら登録を拒否する。 */
  | 'enforce'
  /** 失敗しても登録は通し、フラグを立てて後段で絞る。 */
  | 'flag';

export interface AuthConfig {
  /** JWT の `iss`。当面は単一値でよいが、最初から入れておく（DESIGN 2章・8章）。 */
  readonly issuer: string;
  /** JWT の `aud`。サービス分割時にここを分ける（DESIGN 8章）。 */
  readonly audience: string;
  /** アクセストークンの寿命（秒）。DESIGN 1章では 15〜30 分。 */
  readonly accessTokenTtlSec: number;
  /** 端末の時計ずれを吸収する leeway（秒）。DESIGN 2章。 */
  readonly clockSkewLeewaySec: number;
  /** リフレッシュトークンの絶対有効期限（秒）。スライディング更新はしない（DESIGN 3章）。 */
  readonly refreshAbsoluteTtlSec: number;
  /** ローテーション直後の猶予期間（秒）。DESIGN 4章。 */
  readonly refreshGracePeriodSec: number;
  readonly lock: {
    /** ロックの TTL（ミリ秒）。プロセス落ちで恒久ロックにしないための天井。 */
    readonly ttlMs: number;
    /** ロック取得を諦めるまでの待ち時間（ミリ秒）。 */
    readonly acquireTimeoutMs: number;
    /** 503 応答に載せる `Retry-After`（秒）。 */
    readonly retryAfterSec: number;
  };
  readonly rateLimit: {
    /** デバイス登録。IP 単位（DESIGN 10章）。 */
    readonly deviceRegister: RateLimitRule;
    /** リフレッシュ。`family_id` 単位。 */
    readonly refresh: RateLimitRule;
    /** サイレント再ログイン。`device_id` と IP の両方。 */
    readonly deviceSession: RateLimitRule;
  };
  readonly attestation: { readonly policy: AttestationPolicy };
  readonly tokenVersion: {
    readonly cacheOutagePolicy: CacheOutagePolicy;
    /** `fail-open` を許容する上限（ミリ秒）。超えたらフェイルクローズへ倒す（DESIGN 7章）。 */
    readonly failOpenMaxMs: number;
  };
  /**
   * 再利用検知時にデバイス認証情報まで失効させるか（DESIGN 7章）。
   *
   * false が既定。ファミリー失効は自動、デバイス失効は手動対応のみ、が
   * ドキュメントの示す落としどころで、true にすると正規ユーザーが
   * 引き継ぎ手段なしに復帰できなくなる。
   */
  readonly revokeDeviceOnReuseDetection: boolean;
  /** モック運用用エンドポイント（/v1/admin/*）の共有トークン。 */
  readonly adminToken: string;
}

const MINUTE = 60;
const DAY = 24 * 60 * 60;

export const defaultAuthConfig: AuthConfig = {
  issuer: 'https://auth.igo.example',
  audience: 'igo-api',
  accessTokenTtlSec: 15 * MINUTE,
  clockSkewLeewaySec: 60,
  refreshAbsoluteTtlSec: 30 * DAY,
  refreshGracePeriodSec: 30,
  lock: { ttlMs: 5_000, acquireTimeoutMs: 3_000, retryAfterSec: 1 },
  rateLimit: {
    deviceRegister: { max: 10, windowSec: 60 },
    refresh: { max: 30, windowSec: 60 },
    deviceSession: { max: 10, windowSec: 60 },
  },
  attestation: { policy: 'enforce' },
  tokenVersion: { cacheOutagePolicy: 'database-fallback', failOpenMaxMs: 5 * MINUTE * 1000 },
  revokeDeviceOnReuseDetection: false,
  adminToken: 'mock-admin-token',
};

/** 既定値に部分的な上書きを重ねる。ネストは1段だけなので手で畳む。 */
export function resolveAuthConfig(overrides: DeepPartial<AuthConfig> = {}): AuthConfig {
  return {
    ...defaultAuthConfig,
    ...overrides,
    lock: { ...defaultAuthConfig.lock, ...overrides.lock },
    rateLimit: { ...defaultAuthConfig.rateLimit, ...overrides.rateLimit },
    attestation: { ...defaultAuthConfig.attestation, ...overrides.attestation },
    tokenVersion: { ...defaultAuthConfig.tokenVersion, ...overrides.tokenVersion },
  };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
