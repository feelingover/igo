// /v1/admin/* — モック運用用エンドポイント。
//
// **これは本番の API ではない。** DESIGN 7章（失効）と 11章（鍵ローテーション・
// キャッシュ障害時の方針）は、外から叩けないと挙動を確かめようがないため、
// モックとして手で起こせるようにしてある。
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { AuditLog } from '../../auth/audit';
import type { AuthService } from '../../auth/authService';
import type { VolatileCache } from '../../auth/cache';
import type { Clock } from '../../auth/clock';
import { timingSafeEqualString } from '../../auth/crypto';
import { AuthError } from '../../auth/errors';
import { generateHs256Key, type SigningKeyRegistry } from '../../auth/keys';
import { badRequest, readJsonObject, requireString } from '../body';
import { type AuthEnv, clientContext } from '../env';
import { auditRecordResponse, userSnapshotResponse } from '../present';

export interface AdminDeps {
  readonly service: AuthService;
  readonly keys: SigningKeyRegistry;
  readonly cache: VolatileCache;
  readonly audit: AuditLog;
  readonly clock: Clock;
  readonly adminToken: string;
}

export function adminRoutes(deps: AdminDeps): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  routes.use('*', adminGuard(deps.adminToken));

  // --- 失効（DESIGN 7章） ---------------------------------------------------

  /** BAN。token_version とデバイス認証情報の両方に効かせる。 */
  routes.post('/users/:userId/ban', (c) => {
    deps.service.banUser(c.req.param('userId'), clientContext(c));
    return c.body(null, 204);
  });

  /** 全端末ログアウト。 */
  routes.post('/users/:userId/logout-all', (c) => {
    const revoked = deps.service.logoutAllDevices(c.req.param('userId'), clientContext(c));
    return c.json({ revoked_families: revoked });
  });

  /** 端末の永久遮断。再ログインの入口を塞ぐ。 */
  routes.post('/devices/:deviceId/revoke', (c) => {
    deps.service.revokeDevice(c.req.param('deviceId'), clientContext(c));
    return c.body(null, 204);
  });

  /** 状態の確認。ハッシュは出さない。 */
  routes.get('/users/:userId', (c) => c.json(userSnapshotResponse(deps.service.describeUser(c.req.param('userId')))));

  // --- 鍵ローテーション（DESIGN 11章） --------------------------------------

  routes.get('/keys', (c) => c.json({ keys: deps.keys.list() }));

  /** 手順1: 新しい鍵を検証側にだけ配る。まだ署名には使わない。 */
  routes.post('/keys', async (c) => {
    const kid = requireString(await readJsonObject(c), 'kid');
    const keys = withKeyErrors(() => deps.keys.addVerificationKey(generateHs256Key(kid)), deps.keys);
    return c.json({ keys }, 201);
  });

  /** 手順3: 署名鍵を切り替える。 */
  routes.post('/keys/:kid/promote', (c) => {
    return c.json({ keys: withKeyErrors(() => deps.keys.promote(c.req.param('kid')), deps.keys) });
  });

  /** 手順5: 旧鍵を検証側から外す。手順4（旧トークンの失効待ち）を終えてから。 */
  routes.delete('/keys/:kid', (c) => {
    return c.json({ keys: withKeyErrors(() => deps.keys.retire(c.req.param('kid')), deps.keys) });
  });

  // --- 障害の再現（DESIGN 4章・7章） ----------------------------------------

  /** キャッシュ全断の開始・復旧。token_version の方針を実地で確かめる用。 */
  routes.post('/cache/outage', async (c) => {
    const body = await readJsonObject(c);
    const available = body.available;
    if (typeof available !== 'boolean') throw badRequest('available は真偽値です。');
    deps.cache.setAvailable(available, deps.clock());
    return c.json({ cache_available: deps.cache.available });
  });

  /** グレースピリオド用キャッシュが飛んだ状況の再現。 */
  routes.post('/cache/flush', (c) => {
    deps.cache.flush();
    return c.body(null, 204);
  });

  // --- 定期処理（DESIGN 11章） ----------------------------------------------

  routes.post('/maintenance/purge', (c) => {
    const purged = deps.service.purgeExpiredFamilies(clientContext(c));
    return c.json({ purged_families: purged.length });
  });

  routes.get('/audit', (c) => {
    const limit = Number(c.req.query('limit') ?? '50');
    if (!Number.isSafeInteger(limit) || limit <= 0) throw badRequest('limit は正の整数です。');
    return c.json({ records: deps.audit.recent(limit).map(auditRecordResponse) });
  });

  return routes;
}

function adminGuard(adminToken: string) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const presented = c.req.header('X-Admin-Token') ?? '';
    if (!timingSafeEqualString(presented, adminToken)) {
      throw new AuthError('forbidden', 403, '管理トークンが必要です。');
    }
    await next();
  });
}

/** レジストリの不変条件違反（未登録の kid など）を 400 に落とす。 */
function withKeyErrors(action: () => void, keys: SigningKeyRegistry): ReturnType<SigningKeyRegistry['list']> {
  try {
    action();
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : '鍵を操作できません。');
  }
  return keys.list();
}
