// /v1/me — 保護エンドポイントの例。DESIGN 6章「通常リクエスト」。
//
// 業務ロジック側はトークンを一切知らず、ミドルウェアが載せたクレームだけを見る
// （DESIGN 8章「各サービスは署名 / exp / iss / aud を見るだけ」）。
import { Hono } from 'hono';

import type { AuthService } from '../../auth/authService';
import { bearerAuth } from '../bearerAuth';
import type { AuthEnv } from '../env';

export function meRoutes(service: AuthService): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();

  routes.get('/me', bearerAuth(service), (c) => {
    const profile = service.getProfile(c.get('claims'));
    return c.json({
      user_id: profile.userId,
      // セッション変数のキーに使える不変値（DESIGN 9章）。秘密ではない。
      family_id: profile.familyId,
      token_version: profile.tokenVersion,
      active_sessions: profile.activeSessionCount,
      access_token_expires_at: new Date(profile.accessTokenExpiresAt).toISOString(),
    });
  });

  return routes;
}
