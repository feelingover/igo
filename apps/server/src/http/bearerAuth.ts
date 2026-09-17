// アクセストークン検証ミドルウェア。DESIGN 2章・10章。
import { createMiddleware } from 'hono/factory';

import type { AuthService } from '../auth/authService';
import { AuthError } from '../auth/errors';
import { type AuthEnv, clientContext } from './env';

const SCHEME = 'Bearer ';

/**
 * トークンを受け取るのは `Authorization: Bearer` ヘッダのみ。
 *
 * **クエリ文字列は見ない。** 見る実装にすると、アクセスログ・プロキシ・
 * リファラ・CDN のキャッシュキーにトークンが残る経路をサーバ側から開くことになる
 * （DESIGN 10章）。
 */
export function bearerAuth(service: AuthService) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header('Authorization');
    if (header === undefined || !header.startsWith(SCHEME)) {
      throw new AuthError('missing_access_token', 401, 'アクセストークンが必要です。');
    }

    const claims = await service.verifyAccessToken(header.slice(SCHEME.length).trim(), clientContext(c));
    c.set('claims', claims);
    await next();
  });
}
