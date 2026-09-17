// 認証の中核。DESIGN 4章〜7章。
//
// HTTP のことは一切知らない。ルート層（http/）はこのクラスを呼んで
// 結果を JSON に整形するだけにしてある（DESIGN 8章「認証ロジックを1箇所に閉じる」）。
import { type AttestationInput, verifyAttestation } from './attestation';
import { type AuditContext, AuditLog } from './audit';
import { CacheUnavailableError, VolatileCache } from './cache';
import type { Clock } from './clock';
import type { AuthConfig } from './config';
import { randomId, randomToken, sha256, timingSafeEqualString } from './crypto';
import { AuthError, rejectRefresh } from './errors';
import { type AccessTokenClaims, signAccessToken, verifyAccessTokenSignature } from './jwt';
import type { SigningKeyRegistry } from './keys';
import { familyLockKey, type InMemoryLock } from './lock';
import { enforceRateLimit } from './rateLimit';
import { formatRefreshToken, requireParsedRefreshToken } from './refreshToken';
import type { AuthDatabase, FamilyRow } from './store';

/** token_version のキャッシュ TTL。ミスしても永続DBへフォールバックできる（DESIGN 7章）。 */
const TOKEN_VERSION_CACHE_TTL_SEC = 300;

/** 放置端末の掃除しきい値（DESIGN 11章）。 */
const IDLE_FAMILY_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface TokenBundle {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSec: number;
  /** セッション変数のキーに使える不変値（DESIGN 9章）。秘密ではない。 */
  readonly familyId: string;
  readonly refreshTokenExpiresAt: number;
}

export interface DeviceCredentials {
  readonly deviceId: string;
  /** 平文で返るのはここだけ。TLS が前提（DESIGN 10章）。 */
  readonly deviceSecret: string;
}

export interface RegistrationResult extends TokenBundle {
  readonly userId: string;
  readonly device: DeviceCredentials;
  /** flag ポリシー時、false でも登録は通る（DESIGN 5章）。 */
  readonly attestationVerified: boolean;
}

export interface SilentReloginResult extends TokenBundle {
  readonly userId: string;
  /** DESIGN 7章。再ログインのたびに device_secret を回す。 */
  readonly device: DeviceCredentials;
}

export interface RegisterDeviceInput {
  readonly attestation: AttestationInput;
  /** OS 提供の端末識別子。認証には使わない補助情報（DESIGN 5章）。 */
  readonly deviceHint: string | null;
}

export interface SilentReloginInput {
  readonly deviceId: string;
  readonly deviceSecret: string;
}

export interface Profile {
  readonly userId: string;
  readonly familyId: string;
  readonly tokenVersion: number;
  readonly activeSessionCount: number;
  readonly accessTokenExpiresAt: number;
}

export interface UserSnapshot {
  readonly userId: string;
  readonly tokenVersion: number;
  readonly bannedAt: number | null;
  readonly devices: ReadonlyArray<{
    readonly deviceId: string;
    readonly attestationVerified: boolean;
    readonly lastLoginAt: number;
    readonly revokedAt: number | null;
  }>;
  readonly families: ReadonlyArray<{
    readonly familyId: string;
    readonly deviceId: string;
    readonly generation: number;
    readonly rotatedAt: number;
    readonly absoluteExpiresAt: number;
    readonly revokedAt: number | null;
  }>;
}

export interface AuthServiceDeps {
  readonly config: AuthConfig;
  readonly db: AuthDatabase;
  readonly cache: VolatileCache;
  readonly keys: SigningKeyRegistry;
  readonly lock: InMemoryLock;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

/** token_version の参照結果。`skip` はフェイルオープン中（DESIGN 7章）。 */
type TokenVersionLookup = { readonly kind: 'value'; readonly tokenVersion: number } | { readonly kind: 'skip' };

export class AuthService {
  private readonly config: AuthConfig;
  private readonly db: AuthDatabase;
  private readonly cache: VolatileCache;
  private readonly keys: SigningKeyRegistry;
  private readonly lock: InMemoryLock;
  private readonly audit: AuditLog;
  private readonly clock: Clock;

  /** token_version の永続DB問い合わせを同一キーで1本に束ねる（DESIGN 7章）。 */
  private readonly tokenVersionInflight = new Map<string, Promise<number>>();

  constructor(deps: AuthServiceDeps) {
    this.config = deps.config;
    this.db = deps.db;
    this.cache = deps.cache;
    this.keys = deps.keys;
    this.lock = deps.lock;
    this.audit = deps.audit;
    this.clock = deps.clock;
  }

  // ---------------------------------------------------------------------------
  // 初回起動: デバイス登録（DESIGN 6章）
  // ---------------------------------------------------------------------------

  async registerDevice(input: RegisterDeviceInput, ctx: AuditContext): Promise<RegistrationResult> {
    const now = this.clock();
    // DESIGN 10章: 大量アカウント作成（リセマラ・BOT）対策。IP 単位。
    enforceRateLimit(this.cache, { name: 'device_register', key: ctx.ip ?? 'unknown' }, this.config.rateLimit.deviceRegister, now);

    const attestation = verifyAttestation(input.attestation);
    if (!attestation.verified) {
      this.audit.record({ at: now, event: 'attestation_failed', ...ctx, detail: attestation.reason });
      // DESIGN 5章: 正規の環境でも失敗しうるので、即拒否か通すかは方針で決める。
      if (this.config.attestation.policy === 'enforce') {
        throw new AuthError('attestation_failed', 403, 'アテステーションの検証に失敗しました。');
      }
    }

    const user = this.db.createUser(randomId(), now);
    const deviceSecret = randomToken();
    const device = this.db.createDevice({
      deviceId: randomId(),
      userId: user.userId,
      secretHash: sha256(deviceSecret),
      attestationVerified: attestation.verified,
      deviceHint: input.deviceHint,
      now,
    });

    const { family, secret } = this.createFamily(user.userId, device.deviceId, now);
    this.audit.record({ at: now, event: 'device_registered', userId: user.userId, deviceId: device.deviceId, familyId: family.familyId, ...ctx });

    return {
      ...this.issueBundle(family, secret, now),
      userId: user.userId,
      device: { deviceId: device.deviceId, deviceSecret },
      attestationVerified: attestation.verified,
    };
  }

  // ---------------------------------------------------------------------------
  // アクセストークン期限切れ: リフレッシュ（DESIGN 4章）
  // ---------------------------------------------------------------------------

  async refresh(rawToken: string, ctx: AuditContext): Promise<TokenBundle> {
    const parsed = requireParsedRefreshToken(rawToken);
    const now = this.clock();

    // DESIGN 10章: 制限の単位は family_id。総当たりと暴走クライアントの両方に効く。
    enforceRateLimit(this.cache, { name: 'refresh', key: parsed.familyId }, this.config.rateLimit.refresh, now);

    // DESIGN 4章: ロックキーは family_id（端末単位）。user_id で取ると複数端末が不要に競合する。
    const handle = await this.lock.acquire(familyLockKey(parsed.familyId), this.config.lock);
    if (handle === null) {
      this.audit.record({ at: now, event: 'lock_contended', familyId: parsed.familyId, ...ctx });
      // 競合はエラーであって攻撃ではない。ファミリーには触れず 503 + Retry-After。
      throw new AuthError('lock_contended', 503, '処理が混み合っています。', this.config.lock.retryAfterSec);
    }

    try {
      // ロックを取ってから DB を読む＝ダブルチェック。
      // 先行リクエストがローテーション済みなら、下の「猶予期間内」分岐に落ちて同じ応答が返る。
      return this.rotateUnderLock(parsed.familyId, parsed.generation, parsed.secret, ctx);
    } finally {
      handle.release();
    }
  }

  /**
   * DESIGN 4章「判定ロジック」の表をそのまま写したもの。
   *
   * **ファミリー失効に至る経路が、ハッシュ一致を前提にしている点が要。**
   * `family_id` は JWT の `fid` から誰でも読め、`generation` も小さい整数なので推測できる。
   * 検証なしに失効させると、アクセストークンを一度観測した第三者が
   * 任意のユーザーを全端末ログアウトさせられる。
   */
  private rotateUnderLock(familyId: string, generation: number, secret: string, ctx: AuditContext): TokenBundle {
    const now = this.clock();
    const family = this.db.getFamily(familyId);

    // 未知の family_id: 拒否のみ。
    if (family === undefined) {
      this.audit.record({ at: now, event: 'refresh_rejected', familyId, ...ctx, detail: 'unknown family' });
      throw rejectRefresh();
    }

    const presentedHash = sha256(secret);

    // 現在世代 + ハッシュ一致 → 通常のローテーション。
    if (generation === family.generation && timingSafeEqualString(presentedHash, family.secretHash)) {
      this.assertFamilyUsable(family, now);
      const bundle = this.rotate(family, now);
      this.audit.record({ at: now, event: 'refresh_rotated', userId: family.userId, familyId, deviceId: family.deviceId, ...ctx });
      return bundle;
    }

    // 1世代前 + ハッシュ一致 → 猶予期間の内か外かで運命が分かれる。
    if (
      generation === family.generation - 1 &&
      family.prevSecretHash !== null &&
      timingSafeEqualString(presentedHash, family.prevSecretHash)
    ) {
      this.assertFamilyUsable(family, now);
      const withinGrace = now - family.rotatedAt <= this.config.refreshGracePeriodSec * 1000;

      if (withinGrace) {
        const cached = this.readGraceResponse(presentedHash, now);
        if (cached !== undefined) {
          // 並行リフレッシュ・応答の取りこぼしを冪等に吸収する。
          this.audit.record({ at: now, event: 'refresh_replayed_in_grace', userId: family.userId, familyId, ...ctx });
          return cached;
        }
        // DESIGN 4章: キャッシュが飛んだら応答は再現できない。
        // ファミリーは失効させず、現在の世代からもう一度ローテーションして返す。
        // 冪等性は失われるが正しさは失われない（キャッシュは最適化であって前提ではない）。
        this.audit.record({ at: now, event: 'refresh_grace_cache_miss', userId: family.userId, familyId, ...ctx });
        return this.rotate(family, now);
      }

      // 猶予期間外にハッシュが一致した = 無効化済みトークンが使われた = 再利用検知。
      this.db.revokeFamily(familyId, now);
      this.audit.record({
        at: now,
        event: 'family_revoked_reuse_detected',
        userId: family.userId,
        familyId,
        deviceId: family.deviceId,
        ...ctx,
      });
      // DESIGN 7章: デバイス認証情報まで失効させるかは方針で決める。
      // 失効させないとファミリーを潰しても同じ端末が再登録で復活できるが、
      // 失効させると正規ユーザーも引き継ぎ手段なしには戻れない。
      if (this.config.revokeDeviceOnReuseDetection) {
        this.db.revokeDevice(family.deviceId, now);
        this.audit.record({ at: now, event: 'device_revoked', userId: family.userId, deviceId: family.deviceId, ...ctx, detail: 'reuse detection' });
      }
      throw new AuthError('refresh_token_reused', 401, 'リフレッシュトークンの再利用を検知しました。');
    }

    // 残りはすべて「拒否のみ」。
    //   - 現在値より新しい世代（照合対象なし）
    //   - 2世代以上古い世代（照合対象なし。正規の古いトークンか無関係な値かは区別できない）
    //   - どの世代でもハッシュ不一致
    // ファミリーには触れない。監査ログとレート制限で頻度を見る（DESIGN 4章・11章）。
    this.audit.record({ at: now, event: 'refresh_rejected', userId: family.userId, familyId, ...ctx, detail: `generation=${generation} current=${family.generation}` });
    throw rejectRefresh();
  }

  /**
   * 失効・絶対期限の確認。
   *
   * **ハッシュ検証を通った後にだけ呼ぶ。** 先に呼ぶと、シークレットを持たない相手に
   * 「その family_id は失効済み／生きている」を教えることになる。
   */
  private assertFamilyUsable(family: FamilyRow, now: number): void {
    if (family.revokedAt !== null) {
      throw new AuthError('family_revoked', 401, 'このセッションは失効しています。');
    }
    // DESIGN 3章: 絶対有効期限のみ。スライディング更新はしない。
    if (family.absoluteExpiresAt <= now) {
      throw new AuthError('refresh_token_expired', 401, 'リフレッシュトークンの有効期限が切れています。');
    }
  }

  private rotate(family: FamilyRow, now: number): TokenBundle {
    const nextSecret = randomToken();
    const rotated = this.db.rotateFamily({ familyId: family.familyId, nextSecretHash: sha256(nextSecret), now });
    const bundle = this.issueBundle(rotated, nextSecret, now);

    // DESIGN 4章: 応答一式を「いま無効化したトークンのハッシュ」をキーに保存する。
    // 生値の保持範囲を猶予期間のキャッシュだけに限定することで、
    // 永続DBが漏洩しても有効なトークンは出てこない、という性質を保つ。
    this.writeGraceResponse(family.secretHash, bundle, now);
    return bundle;
  }

  private readGraceResponse(secretHash: string, now: number): TokenBundle | undefined {
    try {
      return this.cache.get<TokenBundle>(graceKey(secretHash), now);
    } catch (error) {
      if (error instanceof CacheUnavailableError) return undefined;
      throw error;
    }
  }

  private writeGraceResponse(secretHash: string, bundle: TokenBundle, now: number): void {
    try {
      this.cache.set(graceKey(secretHash), bundle, this.config.refreshGracePeriodSec, now);
    } catch (error) {
      if (!(error instanceof CacheUnavailableError)) throw error;
      // 書けなくても正しさは失われない。冪等性だけを諦める。
    }
  }

  // ---------------------------------------------------------------------------
  // リフレッシュトークン期限切れ: サイレント再ログイン（DESIGN 6章）
  // ---------------------------------------------------------------------------

  async silentRelogin(input: SilentReloginInput, ctx: AuditContext): Promise<SilentReloginResult> {
    const now = this.clock();
    // DESIGN 10章: device_secret の総当たり対策。device_id と IP の両方で絞る。
    enforceRateLimit(this.cache, { name: 'device_session', key: input.deviceId }, this.config.rateLimit.deviceSession, now);
    enforceRateLimit(this.cache, { name: 'device_session_ip', key: ctx.ip ?? 'unknown' }, this.config.rateLimit.deviceSession, now);

    const device = this.db.getDevice(input.deviceId);
    const invalid = new AuthError('invalid_device_credentials', 401, 'デバイス認証情報が無効です。');
    if (device === undefined) throw invalid;
    if (!timingSafeEqualString(sha256(input.deviceSecret), device.secretHash)) {
      this.audit.record({ at: now, event: 'refresh_rejected', deviceId: input.deviceId, ...ctx, detail: 'device secret mismatch' });
      throw invalid;
    }

    // リフレッシュと同じ理由で、状態の確認はハッシュ検証の後に置く。
    // DESIGN 7章: ここで revoked_at を見ないと、ファミリーを失効させても端末が復活する。
    if (device.revokedAt !== null) {
      throw new AuthError('device_revoked', 401, 'この端末は失効しています。');
    }
    const user = this.db.getUser(device.userId);
    if (user === undefined) throw invalid;
    if (user.bannedAt !== null) {
      throw new AuthError('user_banned', 401, 'このアカウントは利用できません。');
    }

    // DESIGN 7章: 無期限の固定シークレットを作らないため、毎回ローテーションする。
    const nextDeviceSecret = randomToken();
    this.db.rotateDeviceSecret(device.deviceId, sha256(nextDeviceSecret), now);

    // モックの方針: 端末につきセッションは1つ。旧ファミリーはここで畳む。
    // DESIGN には明記がないが、放置すると再ログインのたびに行が積み上がる。
    this.db.revokeFamiliesByDevice(device.deviceId, now);

    const { family, secret } = this.createFamily(device.userId, device.deviceId, now);
    this.audit.record({ at: now, event: 'silent_relogin', userId: device.userId, deviceId: device.deviceId, familyId: family.familyId, ...ctx });

    return {
      ...this.issueBundle(family, secret, now),
      userId: device.userId,
      device: { deviceId: device.deviceId, deviceSecret: nextDeviceSecret },
    };
  }

  // ---------------------------------------------------------------------------
  // 通常リクエスト: アクセストークンの検証（DESIGN 2章）
  // ---------------------------------------------------------------------------

  async verifyAccessToken(rawToken: string, ctx: AuditContext): Promise<AccessTokenClaims> {
    // 手順1・2。kid から鍵とアルゴリズムを引き、alg ヘッダは見ない。
    const claims = verifyAccessTokenSignature(rawToken, (kid) => this.keys.resolve(kid));

    const nowSec = Math.floor(this.clock() / 1000);
    const leeway = this.config.clockSkewLeewaySec;

    // 手順3。端末の時計ずれ用に leeway を許容する。
    if (claims.exp + leeway <= nowSec) {
      throw new AuthError('access_token_expired', 401, 'アクセストークンの有効期限が切れています。');
    }
    if (claims.iat - leeway > nowSec) {
      throw new AuthError('invalid_access_token', 401, 'アクセストークンが無効です。');
    }

    // 手順4。
    if (claims.iss !== this.config.issuer || claims.aud !== this.config.audience) {
      throw new AuthError('invalid_access_token', 401, 'アクセストークンが無効です。');
    }

    // 手順5。ここだけが毎リクエストの状態参照（DESIGN 1章の但し書き）。
    const lookup = await this.lookupTokenVersion(claims.sub, ctx);
    if (lookup.kind === 'value' && lookup.tokenVersion !== claims.tv) {
      throw new AuthError('token_version_mismatch', 401, 'セッションが無効化されています。');
    }

    // ファミリーやデバイスの失効はここでは見ない。DESIGN 7章のとおり、
    // それらはアクセストークンの寿命分だけ遅れて効く仕様である。
    // 毎リクエストで引くと「状態を持たない」という設計の利点が消える。
    return claims;
  }

  /** 保護エンドポイントの例。アクセストークンから引ける範囲だけを返す。 */
  getProfile(claims: AccessTokenClaims): Profile {
    const now = this.clock();
    const user = this.db.getUser(claims.sub);
    if (user === undefined) throw new AuthError('invalid_access_token', 401, 'アクセストークンが無効です。');

    const activeSessionCount = this.db
      .listFamiliesByUser(user.userId)
      .filter((family) => family.revokedAt === null && family.absoluteExpiresAt > now).length;

    return {
      userId: user.userId,
      familyId: claims.fid,
      tokenVersion: user.tokenVersion,
      activeSessionCount,
      accessTokenExpiresAt: claims.exp * 1000,
    };
  }

  /**
   * 運用確認用のスナップショット。
   * **ハッシュは含めない。** 秘密ではないが、出す理由もない。
   */
  describeUser(userId: string): UserSnapshot {
    const user = this.db.getUser(userId);
    if (user === undefined) throw new AuthError('invalid_request', 404, '対象のユーザーが存在しません。');
    return {
      userId: user.userId,
      tokenVersion: user.tokenVersion,
      bannedAt: user.bannedAt,
      devices: this.db.listDevicesByUser(userId).map((device) => ({
        deviceId: device.deviceId,
        attestationVerified: device.attestationVerified,
        lastLoginAt: device.lastLoginAt,
        revokedAt: device.revokedAt,
      })),
      families: this.db.listFamiliesByUser(userId).map((family) => ({
        familyId: family.familyId,
        deviceId: family.deviceId,
        generation: family.generation,
        rotatedAt: family.rotatedAt,
        absoluteExpiresAt: family.absoluteExpiresAt,
        revokedAt: family.revokedAt,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // 失効（DESIGN 7章）
  // ---------------------------------------------------------------------------

  /** 特定端末のログアウト。アクセストークンの寿命分だけ遅延して効く。 */
  logoutFamily(claims: AccessTokenClaims, ctx: AuditContext): void {
    const now = this.clock();
    const family = this.db.getFamily(claims.fid);
    // 他人のファミリーを畳めないように所有者を確認する。
    if (family === undefined || family.userId !== claims.sub) {
      throw new AuthError('forbidden', 403, 'このセッションは操作できません。');
    }
    this.db.revokeFamily(family.familyId, now);
    this.audit.record({ at: now, event: 'family_revoked', userId: claims.sub, familyId: family.familyId, deviceId: family.deviceId, ...ctx, detail: 'logout' });
  }

  /** 全端末ログアウト。token_version を上げるので即時に効く。 */
  logoutAllDevices(userId: string, ctx: AuditContext): number {
    const now = this.clock();
    const revoked = this.db.revokeFamiliesByUser(userId, now);
    this.bumpTokenVersion(userId, now, ctx, 'logout-all');
    return revoked;
  }

  /**
   * BAN。DESIGN 7章より、token_version とデバイス認証情報の**両方**に効かせる。
   * token_version だけだと、BAN されたユーザーが新しいデバイス認証情報を
   * 登録して別アカウントを作る経路が残る。
   */
  banUser(userId: string, ctx: AuditContext): void {
    const now = this.clock();
    if (this.db.getUser(userId) === undefined) {
      throw new AuthError('invalid_request', 404, '対象のユーザーが存在しません。');
    }
    this.db.banUser(userId, now);
    this.db.revokeFamiliesByUser(userId, now);
    for (const device of this.db.listDevicesByUser(userId)) {
      this.db.revokeDevice(device.deviceId, now);
      this.audit.record({ at: now, event: 'device_revoked', userId, deviceId: device.deviceId, ...ctx, detail: 'ban' });
    }
    this.bumpTokenVersion(userId, now, ctx, 'ban');
  }

  /** 端末の永久遮断。再ログインの入口を塞ぐ。 */
  revokeDevice(deviceId: string, ctx: AuditContext): void {
    const now = this.clock();
    const device = this.db.getDevice(deviceId);
    if (device === undefined) {
      throw new AuthError('invalid_request', 404, '対象の端末が存在しません。');
    }
    this.db.revokeDevice(deviceId, now);
    this.db.revokeFamiliesByDevice(deviceId, now);
    this.audit.record({ at: now, event: 'device_revoked', userId: device.userId, deviceId, ...ctx, detail: 'manual' });
  }

  /** DESIGN 11章の定期掃除。削除ログは残す。 */
  purgeExpiredFamilies(ctx: AuditContext): string[] {
    const now = this.clock();
    const purged = this.db.purgeFamilies(now, IDLE_FAMILY_TTL_MS);
    for (const familyId of purged) {
      this.audit.record({ at: now, event: 'family_revoked', familyId, ...ctx, detail: 'purged' });
    }
    return purged;
  }

  // ---------------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------------

  private createFamily(userId: string, deviceId: string, now: number): { family: FamilyRow; secret: string } {
    const secret = randomToken();
    const family = this.db.createFamily({
      familyId: randomId(),
      userId,
      deviceId,
      secretHash: sha256(secret),
      absoluteExpiresAt: now + this.config.refreshAbsoluteTtlSec * 1000,
      now,
    });
    return { family, secret };
  }

  private issueBundle(family: FamilyRow, refreshSecret: string, now: number): TokenBundle {
    const user = this.db.getUser(family.userId);
    if (user === undefined) throw new Error(`family ${family.familyId} のユーザーが存在しない`);

    const iat = Math.floor(now / 1000);
    const claims: AccessTokenClaims = {
      sub: user.userId,
      iss: this.config.issuer,
      aud: this.config.audience,
      iat,
      exp: iat + this.config.accessTokenTtlSec,
      fid: family.familyId,
      tv: user.tokenVersion,
      jti: randomId(12),
    };

    return {
      accessToken: signAccessToken(claims, this.keys.active),
      refreshToken: formatRefreshToken(family.familyId, family.generation, refreshSecret),
      expiresInSec: this.config.accessTokenTtlSec,
      familyId: family.familyId,
      refreshTokenExpiresAt: family.absoluteExpiresAt,
    };
  }

  private bumpTokenVersion(userId: string, now: number, ctx: AuditContext, reason: string): void {
    const next = this.db.bumpTokenVersion(userId);
    // 書き込みスルーで即時に効かせる。書けなくても、次の参照がDBへ落ちるだけ。
    try {
      this.cache.set(tokenVersionKey(userId), next, TOKEN_VERSION_CACHE_TTL_SEC, now);
    } catch (error) {
      if (!(error instanceof CacheUnavailableError)) throw error;
    }
    this.audit.record({ at: now, event: 'token_version_bumped', userId, ...ctx, detail: `${reason} → tv=${next}` });
  }

  private async lookupTokenVersion(userId: string, ctx: AuditContext): Promise<TokenVersionLookup> {
    const now = this.clock();
    try {
      const cached = this.cache.get<number>(tokenVersionKey(userId), now);
      if (cached !== undefined) return { kind: 'value', tokenVersion: cached };
    } catch (error) {
      if (!(error instanceof CacheUnavailableError)) throw error;
      return this.lookupTokenVersionUnderOutage(userId, now, ctx);
    }
    return { kind: 'value', tokenVersion: await this.loadTokenVersion(userId, now) };
  }

  /**
   * キャッシュミス時のフォールバック（DESIGN 7章）。
   * 同一ユーザーへの問い合わせを1本に束ねてスタンピードを防ぐ。
   * このモックの DB は同期なので実際には束ならないが、非同期DBに差し替えても
   * 構造が変わらないようにここに置いてある。
   */
  private loadTokenVersion(userId: string, now: number): Promise<number> {
    const inflight = this.tokenVersionInflight.get(userId);
    if (inflight !== undefined) return inflight;

    const promise = (async () => {
      const user = this.db.getUser(userId);
      if (user === undefined) {
        throw new AuthError('invalid_access_token', 401, 'アクセストークンが無効です。');
      }
      try {
        this.cache.set(tokenVersionKey(userId), user.tokenVersion, TOKEN_VERSION_CACHE_TTL_SEC, now);
      } catch (error) {
        if (!(error instanceof CacheUnavailableError)) throw error;
      }
      return user.tokenVersion;
    })().finally(() => {
      this.tokenVersionInflight.delete(userId);
    });

    this.tokenVersionInflight.set(userId, promise);
    return promise;
  }

  /** キャッシュ全断時（DESIGN 7章「キャッシュ障害時の方針」）。 */
  private lookupTokenVersionUnderOutage(userId: string, now: number, ctx: AuditContext): TokenVersionLookup {
    this.audit.record({ at: now, event: 'token_version_cache_outage', userId, ...ctx, detail: this.config.tokenVersion.cacheOutagePolicy });

    switch (this.config.tokenVersion.cacheOutagePolicy) {
      case 'database-fallback': {
        const user = this.db.getUser(userId);
        if (user === undefined) throw new AuthError('invalid_access_token', 401, 'アクセストークンが無効です。');
        return { kind: 'value', tokenVersion: user.tokenVersion };
      }
      case 'fail-open': {
        // 許容する時間に上限を設ける。上限がないと BAN が無期限に無効化される。
        if (this.cache.outageDurationMs(now) <= this.config.tokenVersion.failOpenMaxMs) {
          return { kind: 'skip' };
        }
        throw unavailable();
      }
      case 'fail-closed':
        throw unavailable();
    }
  }
}

/**
 * キャッシュ障害で検証しきれないときの応答。
 *
 * **401 にしてはいけない。** DESIGN 6章のとおり、クライアントは 401 を
 * 「失効した」と解釈して認証情報を破棄する。サーバ都合の一時障害で
 * 全ユーザーを再ログインに追い込むことになる。
 */
function unavailable(): AuthError {
  return new AuthError('token_version_unavailable', 503, '一時的に検証できません。', 5);
}

const tokenVersionKey = (userId: string): string => `tv:${userId}`;
const graceKey = (secretHash: string): string => `grace:${secretHash}`;
