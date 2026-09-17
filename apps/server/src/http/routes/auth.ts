// /v1/auth/* — DESIGN 6章の認証フローをそのままエンドポイントにしたもの。
import { Hono } from 'hono';

import { isAttestationPlatform } from '../../auth/attestation';
import type { AuthService } from '../../auth/authService';
import { bearerAuth } from '../bearerAuth';
import { badRequest, optionalString, readJsonObject, requireObject, requireString } from '../body';
import type { AuthEnv } from '../env';
import { clientContext } from '../env';
import { registrationResponse, silentReloginResponse, tokenResponse } from '../present';

export function authRoutes(service: AuthService): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();

  /**
   * 初回起動。アテステーション結果を添えてデバイスを登録する。
   * **何の前提もなくアカウントを1つ作れる入口**なので、不正対策の要（DESIGN 5章）。
   */
  routes.post('/device/register', async (c) => {
    const body = await readJsonObject(c);
    const attestation = requireObject(body, 'attestation');
    const platform = attestation.platform;
    if (!isAttestationPlatform(platform)) {
      throw badRequest('attestation.platform は "ios" または "android" です。');
    }

    const result = await service.registerDevice(
      {
        attestation: { platform, token: requireString(attestation, 'token') },
        // 認証には使わない補助情報（DESIGN 5章）。
        deviceHint: optionalString(body, 'device_hint'),
      },
      clientContext(c),
    );
    return c.json(registrationResponse(result), 201);
  });

  /** アクセストークン期限切れ時のリフレッシュ（DESIGN 4章）。 */
  routes.post('/token/refresh', async (c) => {
    const body = await readJsonObject(c);
    const bundle = await service.refresh(requireString(body, 'refresh_token'), clientContext(c));
    return c.json(tokenResponse(bundle));
  });

  /**
   * リフレッシュトークン期限切れ時のサイレント再ログイン（DESIGN 6章）。
   * 実質「少し重いリフレッシュ」で、ユーザーからは何も起きていないように見える。
   */
  routes.post('/device/session', async (c) => {
    const body = await readJsonObject(c);
    const result = await service.silentRelogin(
      { deviceId: requireString(body, 'device_id'), deviceSecret: requireString(body, 'device_secret') },
      clientContext(c),
    );
    return c.json(silentReloginResponse(result));
  });

  /** この端末だけログアウト。アクセストークンの寿命分だけ遅延して効く（DESIGN 7章）。 */
  routes.post('/logout', bearerAuth(service), (c) => {
    service.logoutFamily(c.get('claims'), clientContext(c));
    return c.body(null, 204);
  });

  /** 全端末ログアウト。token_version を上げるので即時（DESIGN 7章）。 */
  routes.post('/logout-all', bearerAuth(service), (c) => {
    const revokedFamilies = service.logoutAllDevices(c.get('claims').sub, clientContext(c));
    return c.json({ revoked_families: revokedFamilies });
  });

  return routes;
}
