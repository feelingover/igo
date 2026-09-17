// トークン認証モックの検証。
//   npm run test:auth
//
// 対象は mobile-game-token-auth-design.md（以降 DESIGN）12章「テスト」の項目。
// 状態遷移が複雑で、目視では踏めない分岐ばかりなのでここで固める。
//
// spike.test.ts と同じ手書きハーネス。失敗時は throw で非ゼロ終了する。
// HTTP は Hono の app.request() で直接叩くため、ポートは開かない。
import { AuditLog } from './audit';
import { TestClock } from './clock';
import type { DeepPartial } from './config';
import type { AuthConfig } from './config';
import { generateHs256Key, SigningKeyRegistry } from './keys';
import { familyLockKey } from './lock';
import { type AuthApp, createAuthApp } from '../http/app';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- ハーネス ---------------------------------------------------------------

interface Harness extends AuthApp {
  readonly testClock: TestClock;
}

function setup(config: DeepPartial<AuthConfig> = {}, keys?: SigningKeyRegistry): Harness {
  const testClock = new TestClock();
  const app = createAuthApp({
    clock: testClock.now,
    config,
    keys,
    // 監査ログは記録するが標準出力には流さない（テスト出力を汚さないため）。
    audit: new AuditLog(() => {}),
  });
  return { ...app, testClock };
}

interface TokenJson {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly family_id: string;
  readonly expires_in: number;
  readonly refresh_token_expires_at: string;
}

interface RegisterJson extends TokenJson {
  readonly user_id: string;
  readonly device_id: string;
  readonly device_secret: string;
  readonly attestation_verified: boolean;
}

interface ErrorJson {
  readonly error: { readonly code: string; readonly message: string };
}

const jsonOf = async <T>(res: Response): Promise<T> => (await res.json()) as T;

// app.request() は同期にも解決しうる型なので、ここで Promise に正規化しておく。
async function post(h: Harness, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return await h.app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const register = async (h: Harness, token = 'attest-ok'): Promise<RegisterJson> =>
  jsonOf<RegisterJson>(await post(h, '/v1/auth/device/register', { attestation: { platform: 'ios', token } }));

const refresh = (h: Harness, refreshToken: string): Promise<Response> =>
  post(h, '/v1/auth/token/refresh', { refresh_token: refreshToken });

async function me(h: Harness, accessToken: string): Promise<Response> {
  return await h.app.request('/v1/me', { headers: { Authorization: `Bearer ${accessToken}` } });
}

const errorCode = async (res: Response): Promise<string> => (await jsonOf<ErrorJson>(res)).error.code;

/** JWT のヘッダだけ差し替える。署名はそのまま（= 署名対象が変わるので壊れる）。 */
function tamperHeader(token: string, mutate: (header: Record<string, unknown>) => Record<string, unknown>): string {
  const [rawHeader, payload, signature] = token.split('.');
  const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString('utf8')) as Record<string, unknown>;
  const next = Buffer.from(JSON.stringify(mutate(header)), 'utf8').toString('base64url');
  return `${next}.${payload}.${signature}`;
}

async function main(): Promise<void> {
  // --- 基本フロー（DESIGN 6章） --------------------------------------------
  console.log('初回登録と通常リクエスト:');
  {
    const h = setup();
    const res = await post(h, '/v1/auth/device/register', { attestation: { platform: 'ios', token: 'attest-ok' } });
    const registered = await jsonOf<RegisterJson>(res);
    check('登録は 201', res.status === 201);
    check('device_id / device_secret が返る', registered.device_id !== '' && registered.device_secret !== '');
    check('access / refresh が揃う', registered.access_token !== '' && registered.refresh_token.startsWith('rt_'));

    const profile = await me(h, registered.access_token);
    check('保護エンドポイントが通る', profile.status === 200);
    const body = await jsonOf<{ user_id: string; family_id: string }>(profile);
    check('クレームの sub / fid が引ける', body.user_id === registered.user_id && body.family_id === registered.family_id);

    const noHeader = await h.app.request(`/v1/me?access_token=${registered.access_token}`);
    // DESIGN 10章: トークンを載せてよいのは Authorization ヘッダだけ。
    check('クエリ文字列のトークンは認証に使われない', noHeader.status === 401);
  }

  // --- アテステーション（DESIGN 5章） ---------------------------------------
  console.log('アテステーション:');
  {
    const enforced = setup({ attestation: { policy: 'enforce' } });
    const denied = await post(enforced, '/v1/auth/device/register', { attestation: { platform: 'android', token: 'invalid-xxx' } });
    check('enforce では失敗すると 403', denied.status === 403 && (await errorCode(denied)) === 'attestation_failed');

    const flagged = setup({ attestation: { policy: 'flag' } });
    const passedThrough = await post(flagged, '/v1/auth/device/register', { attestation: { platform: 'android', token: 'invalid-xxx' } });
    const body = await jsonOf<RegisterJson>(passedThrough);
    check('flag では登録は通り、フラグが落ちる', passedThrough.status === 201 && body.attestation_verified === false);
  }

  // --- ローテーション（DESIGN 4章） -----------------------------------------
  console.log('ローテーション:');
  {
    const h = setup();
    const registered = await register(h);
    const rotated = await jsonOf<TokenJson>(await refresh(h, registered.refresh_token));
    check('新しいリフレッシュトークンが発行される', rotated.refresh_token !== registered.refresh_token);
    check('family_id はローテーションで変わらない', rotated.family_id === registered.family_id);
    check('絶対有効期限は引き継がれる', rotated.refresh_token_expires_at === registered.refresh_token_expires_at);
  }

  // --- グレースピリオド（DESIGN 4章） ---------------------------------------
  console.log('グレースピリオド:');
  {
    const h = setup({ refreshGracePeriodSec: 30 });
    const registered = await register(h);
    const first = await jsonOf<TokenJson>(await refresh(h, registered.refresh_token));

    h.testClock.advanceSec(29);
    const replayed = await refresh(h, registered.refresh_token);
    const replayedBody = await jsonOf<TokenJson>(replayed);
    check('猶予期間内の旧トークンは同じ応答を返す（冪等）', replayed.status === 200 && replayedBody.refresh_token === first.refresh_token);

    h.testClock.advanceSec(2); // 通算 31 秒 → 猶予期間外
    const reused = await refresh(h, registered.refresh_token);
    check('猶予期間外の旧トークンは再利用検知', reused.status === 401 && (await errorCode(reused)) === 'refresh_token_reused');
    check('再利用検知が監査ログに残る', h.audit.countOf('family_revoked_reuse_detected') === 1);

    const afterRevoke = await refresh(h, first.refresh_token);
    check('ファミリー全体が失効し、現行トークンも使えない', afterRevoke.status === 401);
  }

  // --- 並行リフレッシュ（DESIGN 4章・12章） ---------------------------------
  console.log('並行リフレッシュ:');
  {
    const h = setup();
    const registered = await register(h);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => refresh(h, registered.refresh_token)));
    const bodies = await Promise.all(results.map((res) => jsonOf<TokenJson>(res)));

    check('同時に5本叩いても全て 200', results.every((res) => res.status === 200));
    check('全て同一の応答（ロック + 猶予キャッシュで冪等）', new Set(bodies.map((b) => b.refresh_token)).size === 1);
    check('ファミリーは失効していない', h.db.getFamily(registered.family_id)?.revokedAt === null);
    check('世代は1つしか進まない', h.db.getFamily(registered.family_id)?.generation === 1);
  }

  // --- 猶予キャッシュが消えた場合（DESIGN 4章・12章） -----------------------
  console.log('猶予キャッシュ消失:');
  {
    const h = setup();
    const registered = await register(h);
    await refresh(h, registered.refresh_token);

    h.cache.flush(); // キャッシュだけが飛んだ状況
    const res = await refresh(h, registered.refresh_token);
    check('失効させず再ローテーションして返す', res.status === 200);
    check('ファミリーは生きたまま', h.db.getFamily(registered.family_id)?.revokedAt === null);
    check('キャッシュミスが監査ログに残る', h.audit.countOf('refresh_grace_cache_miss') === 1);
    check('再利用検知はしていない', h.audit.countOf('family_revoked_reuse_detected') === 0);
  }

  // --- 「拒否のみ」で済ませる経路（DESIGN 4章の大前提） ---------------------
  console.log('ファミリーに触れない拒否:');
  {
    const h = setup();
    const registered = await register(h);
    const gen1 = await jsonOf<TokenJson>(await refresh(h, registered.refresh_token));
    const gen2 = await jsonOf<TokenJson>(await refresh(h, gen1.refresh_token));

    // 2世代以上古い = 照合対象がない。正規の古いトークンか無関係な値かは区別できない。
    const old = await refresh(h, registered.refresh_token);
    check('2世代前は拒否のみ（再利用検知ではない）', old.status === 401 && (await errorCode(old)) === 'invalid_refresh_token');

    // 正しい family_id + 推測した generation + デタラメなシークレット。
    // これでファミリーが失効するなら、第三者が任意のユーザーを強制ログアウトできてしまう。
    const forged = await refresh(h, `rt_${registered.family_id}.2.dGhpcy1pcy1ub3QtdGhlLXNlY3JldA`);
    check('シークレット不一致は拒否のみ', forged.status === 401 && (await errorCode(forged)) === 'invalid_refresh_token');

    const future = await refresh(h, `rt_${registered.family_id}.99.dGhpcy1pcy1ub3QtdGhlLXNlY3JldA`);
    check('現在より新しい世代も拒否のみ', future.status === 401);

    const unknown = await refresh(h, 'rt_unknownfamilyid.0.dGhpcy1pcy1ub3QtdGhlLXNlY3JldA');
    check('存在しない family_id も拒否のみ', unknown.status === 401);

    const malformed = await refresh(h, 'not-a-refresh-token');
    check('形式不正も拒否のみ', malformed.status === 401);

    check('ここまででファミリー失効はゼロ件', h.audit.countOf('family_revoked_reuse_detected') === 0);
    check('ファミリーは生きている', h.db.getFamily(registered.family_id)?.revokedAt === null);

    const stillWorks = await refresh(h, gen2.refresh_token);
    check('正規の現行トークンは引き続き使える', stillWorks.status === 200);
  }

  // --- ロック競合（DESIGN 4章） ---------------------------------------------
  console.log('ロック競合:');
  {
    const h = setup({ lock: { ttlMs: 5_000, acquireTimeoutMs: 20, retryAfterSec: 2 } });
    const registered = await register(h);

    const held = await h.lock.acquire(familyLockKey(registered.family_id), { ttlMs: 5_000, acquireTimeoutMs: 0 });
    const res = await refresh(h, registered.refresh_token);
    check('ロックを取れなければ 503', res.status === 503 && (await errorCode(res)) === 'lock_contended');
    check('Retry-After が付く', res.headers.get('Retry-After') === '2');
    check('競合でファミリーを失効させない', h.db.getFamily(registered.family_id)?.revokedAt === null);

    held?.release();
    const afterRelease = await refresh(h, registered.refresh_token);
    check('解放後は通常どおり通る', afterRelease.status === 200);
  }

  // --- 絶対有効期限とサイレント再ログイン（DESIGN 3章・6章） ----------------
  console.log('サイレント再ログイン:');
  {
    const h = setup();
    const registered = await register(h);

    h.testClock.advanceSec(31 * 24 * 60 * 60); // 絶対期限（30日）超過
    const expired = await refresh(h, registered.refresh_token);
    check('絶対期限を過ぎたら 401', expired.status === 401 && (await errorCode(expired)) === 'refresh_token_expired');

    const res = await post(h, '/v1/auth/device/session', {
      device_id: registered.device_id,
      device_secret: registered.device_secret,
    });
    const relogin = await jsonOf<RegisterJson>(res);
    check('デバイス認証情報で再ログインできる', res.status === 200);
    check('新しいファミリーが作られる', relogin.family_id !== registered.family_id);
    check('device_secret がローテーションされる', relogin.device_secret !== registered.device_secret);

    const reusedSecret = await post(h, '/v1/auth/device/session', {
      device_id: registered.device_id,
      device_secret: registered.device_secret,
    });
    check('旧 device_secret はもう使えない', reusedSecret.status === 401);

    const fresh = await me(h, relogin.access_token);
    check('新しいアクセストークンで保護エンドポイントが通る', fresh.status === 200);
  }

  // --- 失効（DESIGN 7章） ---------------------------------------------------
  console.log('失効:');
  {
    const h = setup();
    const registered = await register(h);

    const revoked = await post(h, `/v1/admin/devices/${registered.device_id}/revoke`, {}, { 'X-Admin-Token': h.config.adminToken });
    check('デバイス失効は 204', revoked.status === 204);

    const relogin = await post(h, '/v1/auth/device/session', {
      device_id: registered.device_id,
      device_secret: registered.device_secret,
    });
    check('失効済みデバイスでの再ログインは 401', relogin.status === 401 && (await errorCode(relogin)) === 'device_revoked');

    const afterRevoke = await refresh(h, registered.refresh_token);
    check('紐づくファミリーも失効している', afterRevoke.status === 401);
  }

  console.log('token_version:');
  {
    const h = setup();
    const registered = await register(h);
    check('失効前は通る', (await me(h, registered.access_token)).status === 200);

    const res = await post(h, '/v1/auth/logout-all', {}, { Authorization: `Bearer ${registered.access_token}` });
    check('全端末ログアウトは 200', res.status === 200);

    const after = await me(h, registered.access_token);
    // 期限切れを待たずに効くのが token_version の役割（DESIGN 7章）。
    check('発行済みアクセストークンが即座に拒否される', after.status === 401 && (await errorCode(after)) === 'token_version_mismatch');
  }

  console.log('BAN:');
  {
    const h = setup();
    const registered = await register(h);
    await post(h, `/v1/admin/users/${registered.user_id}/ban`, {}, { 'X-Admin-Token': h.config.adminToken });

    check('アクセストークンが即座に無効', (await me(h, registered.access_token)).status === 401);
    const relogin = await post(h, '/v1/auth/device/session', {
      device_id: registered.device_id,
      device_secret: registered.device_secret,
    });
    // token_version だけだと、新しいデバイス認証情報を登録して別アカウントを作る経路が残る。
    check('デバイス認証情報にも効いている', relogin.status === 401);
  }

  // --- キャッシュ障害時の方針（DESIGN 7章） ---------------------------------
  console.log('キャッシュ障害:');
  {
    const h = setup({ tokenVersion: { cacheOutagePolicy: 'database-fallback', failOpenMaxMs: 0 } });
    const registered = await register(h);
    h.cache.setAvailable(false, h.clock());
    check('DBフォールバックなら検証は通る', (await me(h, registered.access_token)).status === 200);
  }
  {
    const h = setup({ tokenVersion: { cacheOutagePolicy: 'fail-closed', failOpenMaxMs: 0 } });
    const registered = await register(h);
    h.cache.setAvailable(false, h.clock());
    const res = await me(h, registered.access_token);
    // 401 にすると、クライアントがサーバ都合の障害で認証情報を捨てる（DESIGN 6章）。
    check('フェイルクローズは 401 ではなく 503', res.status === 503 && (await errorCode(res)) === 'token_version_unavailable');
  }
  {
    const h = setup({ tokenVersion: { cacheOutagePolicy: 'fail-open', failOpenMaxMs: 60_000 } });
    const registered = await register(h);
    h.cache.setAvailable(false, h.clock());
    check('フェイルオープンは上限内なら通す', (await me(h, registered.access_token)).status === 200);
    h.testClock.advanceSec(61);
    check('上限を超えたらフェイルクローズへ倒れる', (await me(h, registered.access_token)).status === 503);
  }

  // --- 鍵のローテーション（DESIGN 11章） ------------------------------------
  console.log('鍵のローテーション:');
  {
    const keys = new SigningKeyRegistry(generateHs256Key('v1'));
    const h = setup({}, keys);

    const registered = await register(h);
    keys.addVerificationKey(generateHs256Key('v2')); // 手順1: 検証側にだけ配る
    check('配布しただけでは署名鍵は変わらない', keys.active.kid === 'v1');

    keys.promote('v2'); // 手順3: 署名鍵を切り替える
    check('旧 kid のトークンも重複期間中は検証できる', (await me(h, registered.access_token)).status === 200);

    const rotated = await jsonOf<TokenJson>(await refresh(h, registered.refresh_token));
    check('新 kid で発行したトークンも検証できる', (await me(h, rotated.access_token)).status === 200);

    // 同じ kid を別の鍵で上書きすると、その kid の生きたトークンが一斉に失効する。
    const duplicated = await post(h, '/v1/admin/keys', { kid: 'v2' }, { 'X-Admin-Token': h.config.adminToken });
    check('既存 kid の上書きは 400 で弾く', duplicated.status === 400);

    keys.retire('v1'); // 手順5: 旧鍵を外す（手順4の待ちを終えた後）
    check('外した後は旧トークンが検証できなくなる', (await me(h, registered.access_token)).status === 401);
    check('新トークンは影響を受けない', (await me(h, rotated.access_token)).status === 200);
  }

  // --- alg すり替え（DESIGN 2章） -------------------------------------------
  console.log('alg すり替え:');
  {
    const h = setup();
    const registered = await register(h);

    const algNone = tamperHeader(registered.access_token, (header) => ({ ...header, alg: 'none' }));
    check('alg: none は拒否', (await me(h, `${algNone.split('.').slice(0, 2).join('.')}.`)).status === 401);
    check('alg だけ書き換えても拒否', (await me(h, algNone)).status === 401);

    const unknownKid = tamperHeader(registered.access_token, (header) => ({ ...header, kid: 'v999' }));
    check('未知の kid は拒否', (await me(h, unknownKid)).status === 401);

    const [head, payload] = registered.access_token.split('.');
    check('署名を落としたら拒否', (await me(h, `${head}.${payload}.`)).status === 401);
  }

  // --- 有効期限と leeway（DESIGN 2章） --------------------------------------
  console.log('アクセストークンの期限:');
  {
    const h = setup({ accessTokenTtlSec: 900, clockSkewLeewaySec: 60 });
    const registered = await register(h);
    h.testClock.advanceSec(900 + 30);
    check('leeway の範囲内なら通る', (await me(h, registered.access_token)).status === 200);
    h.testClock.advanceSec(60);
    const res = await me(h, registered.access_token);
    check('leeway を超えたら 401', res.status === 401 && (await errorCode(res)) === 'access_token_expired');
  }

  // --- レート制限（DESIGN 10章） --------------------------------------------
  console.log('レート制限:');
  {
    const h = setup({ rateLimit: { refresh: { max: 3, windowSec: 60 }, deviceRegister: { max: 10, windowSec: 60 }, deviceSession: { max: 10, windowSec: 60 } } });
    const registered = await register(h);

    // 4回目で 429。ファミリー失効に直行しないことが要（DESIGN 10章）。
    const bogus = `rt_${registered.family_id}.0.d3Jvbmctc2VjcmV0`;
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await refresh(h, bogus)).status);
    check('上限までは 401、超えたら 429', codes.slice(0, 3).every((s) => s === 401) && codes[3] === 429);

    const limited = await refresh(h, bogus);
    check('429 に Retry-After が付く', limited.headers.get('Retry-After') === '60');
    check('連打してもファミリーは失効しない', h.db.getFamily(registered.family_id)?.revokedAt === null);
  }

  // --- 管理エンドポイントの保護 ---------------------------------------------
  console.log('管理エンドポイント:');
  {
    const h = setup();
    const registered = await register(h);
    const noToken = await post(h, `/v1/admin/users/${registered.user_id}/ban`, {});
    check('管理トークンなしは 403', noToken.status === 403);
    const wrongToken = await post(h, `/v1/admin/users/${registered.user_id}/ban`, {}, { 'X-Admin-Token': 'wrong' });
    check('誤った管理トークンも 403', wrongToken.status === 403);
  }

  // --- 定期掃除（DESIGN 11章） ----------------------------------------------
  console.log('定期掃除:');
  {
    const h = setup();
    const registered = await register(h);
    h.testClock.advanceSec(31 * 24 * 60 * 60);
    const res = await post(h, '/v1/admin/maintenance/purge', {}, { 'X-Admin-Token': h.config.adminToken });
    const body = await jsonOf<{ purged_families: number }>(res);
    check('絶対期限を過ぎたファミリーが削除される', body.purged_families === 1);
    check('行が消えている', h.db.getFamily(registered.family_id) === undefined);
  }

  console.log(`\n結果: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} 件の検証に失敗`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
