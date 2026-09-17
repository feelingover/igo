// アプリの組み立て。
//
// 依存はすべてここで1回だけ生成し、外へ返す。テストが時計やキャッシュを
// 直接動かせるようにするため（DESIGN 12章のテスト項目は、時刻とキャッシュを
// 操作できないと書けない）。
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { AuditLog } from '../auth/audit';
import { AuthService } from '../auth/authService';
import { VolatileCache } from '../auth/cache';
import { type Clock, systemClock } from '../auth/clock';
import { type AuthConfig, type DeepPartial, resolveAuthConfig } from '../auth/config';
import { AuthError } from '../auth/errors';
import { generateHs256Key, SigningKeyRegistry } from '../auth/keys';
import { InMemoryLock } from '../auth/lock';
import { AuthDatabase } from '../auth/store';
import type { AuthEnv } from './env';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';

export interface AuthAppOptions {
  readonly config?: DeepPartial<AuthConfig>;
  readonly clock?: Clock;
  readonly audit?: AuditLog;
  readonly keys?: SigningKeyRegistry;
  /** アクセスログを出すか。テストでは黙らせる。 */
  readonly requestLog?: boolean;
}

export interface AuthApp {
  readonly app: Hono<AuthEnv>;
  readonly service: AuthService;
  readonly config: AuthConfig;
  readonly db: AuthDatabase;
  readonly cache: VolatileCache;
  readonly keys: SigningKeyRegistry;
  readonly lock: InMemoryLock;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export function createAuthApp(options: AuthAppOptions = {}): AuthApp {
  const config = resolveAuthConfig(options.config);
  const clock = options.clock ?? systemClock;
  const db = new AuthDatabase();
  const cache = new VolatileCache();
  // 起動ごとに鍵を作るのはモックだから。実運用ではシークレットマネージャから
  // 読み込む（DESIGN 11章）。ここで生成する以上、再起動で全トークンが無効になる。
  const keys = options.keys ?? new SigningKeyRegistry(generateHs256Key('v1'));
  const lock = new InMemoryLock();
  const audit = options.audit ?? new AuditLog();
  const service = new AuthService({ config, db, cache, keys, lock, audit, clock });

  const app = new Hono<AuthEnv>();

  // ミドルウェアはルートより先に登録する（後から足すとルートを包めない）。
  // DESIGN 10章: ここで出すのはメソッド・パス・ステータスのみ。
  // Authorization ヘッダやボディを出す実装に変えないこと。
  if (options.requestLog === true) app.use('*', logger());

  app.get('/healthz', (c) => c.json({ status: 'ok' }));
  app.route('/v1/auth', authRoutes(service));
  app.route('/v1', meRoutes(service));
  app.route('/v1/admin', adminRoutes({ service, keys, cache, audit, clock, adminToken: config.adminToken }));

  app.notFound((c) => c.json({ error: { code: 'not_found', message: '存在しないエンドポイントです。' } }, 404));

  app.onError((error, c) => {
    if (error instanceof AuthError) {
      const headers: Record<string, string> = {};
      // 429 / 503 は「再試行してよい」の合図。クライアントは認証情報を破棄しない（DESIGN 6章）。
      if (error.retryAfterSec !== undefined) headers['Retry-After'] = String(error.retryAfterSec);
      if (error.status === 401) headers['WWW-Authenticate'] = `Bearer error="${error.code}"`;
      return c.json({ error: { code: error.code, message: error.message } }, error.status as ContentfulStatusCode, headers);
    }
    console.error(error);
    return c.json({ error: { code: 'internal_error', message: 'サーバ内部エラーです。' } }, 500);
  });

  return { app, service, config, db, cache, keys, lock, audit, clock };
}
