// API エラー。HTTP ステータスまで型に持たせ、ルート側で分岐させない。
//
// ステータスの選び分けは DESIGN 6章「クライアント側の失敗ハンドリング」に直結する。
//   401 → クライアントは認証情報を破棄しうる
//   429 / 503 → 認証情報は破棄せず再試行する
// この境界を間違えると、サーバ都合の一時障害で全ユーザーがログアウトする。

export type AuthErrorCode =
  | 'invalid_request'
  | 'attestation_failed'
  | 'missing_access_token'
  | 'invalid_access_token'
  | 'access_token_expired'
  | 'token_version_mismatch'
  | 'invalid_refresh_token'
  | 'refresh_token_expired'
  | 'refresh_token_reused'
  | 'family_revoked'
  | 'invalid_device_credentials'
  | 'device_revoked'
  | 'user_banned'
  | 'forbidden'
  | 'rate_limited'
  | 'lock_contended'
  | 'token_version_unavailable';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;
  /** 429 / 503 で返す `Retry-After`（秒）。 */
  readonly retryAfterSec?: number;

  constructor(code: AuthErrorCode, status: number, message: string, retryAfterSec?: number) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * リフレッシュ系の「拒否のみ」応答。
 *
 * DESIGN 4章の大前提より、ハッシュ検証を通らなかったリクエストは
 * すべてこの一種類に潰す。`family_id` の存在有無すら応答から読み取れないようにして、
 * 推測可能な値による探索を無意味にする。
 */
export function rejectRefresh(): AuthError {
  return new AuthError('invalid_refresh_token', 401, 'リフレッシュトークンが無効です。');
}
