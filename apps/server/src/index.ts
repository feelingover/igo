// トークン認証モックサーバの起動エントリ。
//
// 設計は mobile-game-token-auth-design.md（以降 DESIGN）。
// 永続化は無く、プロセスを落とせば全状態が消える。署名鍵も起動ごとに変わる。
import { serve } from '@hono/node-server';

import { defaultAuthConfig } from './auth/config';
import { createAuthApp } from './http/app';

const port = Number(process.env.PORT ?? 8787);
if (!Number.isSafeInteger(port) || port <= 0) {
  throw new Error(`PORT が不正です: ${process.env.PORT}`);
}

const adminToken = process.env.AUTH_MOCK_ADMIN_TOKEN ?? defaultAuthConfig.adminToken;

const { app, config } = createAuthApp({
  config: {
    adminToken,
    // 既定は enforce。モックのアテステーションは "invalid-" 始まりだけを失敗にするので、
    // 手で叩いて試すぶんには enforce のままで困らない（DESIGN 5章）。
    attestation: { policy: (process.env.AUTH_MOCK_ATTESTATION ?? 'enforce') === 'flag' ? 'flag' : 'enforce' },
  },
  requestLog: true,
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`igo auth mock: http://localhost:${info.port}`);
  console.log(`  iss=${config.issuer} aud=${config.audience}`);
  console.log(`  アクセストークン ${config.accessTokenTtlSec}秒 / 猶予期間 ${config.refreshGracePeriodSec}秒`);
  console.log(`  管理トークン（X-Admin-Token）: ${adminToken}`);
  console.log('  ※ インメモリのモック。再起動で全トークンが無効になります。');
});
