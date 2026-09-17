// Hono のコンテキスト型。
import type { Context } from 'hono';

import type { AuditContext } from '../auth/audit';
import type { AccessTokenClaims } from '../auth/jwt';

export interface AuthEnv {
  Variables: {
    /** bearerAuth を通ったリクエストにだけ入る。 */
    claims: AccessTokenClaims;
  };
}

/**
 * 監査ログ用のリクエスト情報（DESIGN 11章）。
 *
 * モックなので信頼できるプロキシの前提は置かず、ヘッダをそのまま読む。
 * 実運用では信頼境界の内側で解決した接続元を使うこと。
 */
export function clientContext(c: Context): AuditContext {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return {
    ip: forwarded !== undefined && forwarded !== '' ? forwarded : (c.req.header('x-real-ip') ?? 'unknown'),
    userAgent: c.req.header('user-agent'),
  };
}
