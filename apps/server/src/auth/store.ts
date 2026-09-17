// 永続DB相当のインメモリストア。DESIGN 3章のデータモデル。
//
// モックなのでプロセスが落ちれば消えるが、**揮発キャッシュ（cache.ts）とは
// 明確に分けてある**。DESIGN 3章「保存先」と DESIGN 4章の
// 「永続DBには secret_hash しか置かない」という原則は、この分離があって初めて
// コード上で検証できる。実装を差し替えるときも、この境界をまたがせない。
//
// 行は readonly な不変オブジェクトとして持ち、更新は「差し替え」で行う。
// 掴んだ行を直接書き換えられると DB 相当という前提が崩れるので、それを型で塞いでいる。

/** ユーザー1行。 */
export interface UserRow {
  readonly userId: string;
  /** DESIGN 7章。JWT の `tv` クレームと突き合わせる。 */
  readonly tokenVersion: number;
  readonly bannedAt: number | null;
  readonly createdAt: number;
}

/** デバイス認証情報1行。DESIGN 5章。 */
export interface DeviceRow {
  readonly deviceId: string;
  readonly userId: string;
  /** `device_secret` の SHA-256。生値は保存しない。 */
  readonly secretHash: string;
  /** 初回登録時のアテステーション結果（DESIGN 5章の flag ポリシー用）。 */
  readonly attestationVerified: boolean;
  /** OS 提供の端末識別子。**認証には使わない**補助情報（DESIGN 5章）。 */
  readonly deviceHint: string | null;
  readonly createdAt: number;
  readonly lastLoginAt: number;
  /** DESIGN 7章。ここが無いとファミリー失効だけでは端末を止められない。 */
  readonly revokedAt: number | null;
}

/** ファミリー（= 端末セッション）1行。DESIGN 3章の表そのまま。 */
export interface FamilyRow {
  readonly familyId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly generation: number;
  readonly secretHash: string;
  /** 1世代前。グレースピリオド用（DESIGN 4章）。 */
  readonly prevSecretHash: string | null;
  readonly rotatedAt: number;
  /** 絶対有効期限。ローテーションしても引き継ぐ（DESIGN 3章）。 */
  readonly absoluteExpiresAt: number;
  readonly revokedAt: number | null;
  /** 放置端末の掃除用（DESIGN 11章）。 */
  readonly lastUsedAt: number;
}

export interface CreateDeviceInput {
  readonly deviceId: string;
  readonly userId: string;
  readonly secretHash: string;
  readonly attestationVerified: boolean;
  readonly deviceHint: string | null;
  readonly now: number;
}

export interface CreateFamilyInput {
  readonly familyId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly secretHash: string;
  readonly absoluteExpiresAt: number;
  readonly now: number;
}

export interface RotateFamilyInput {
  readonly familyId: string;
  readonly nextSecretHash: string;
  readonly now: number;
}

export class AuthDatabase {
  private readonly users = new Map<string, UserRow>();
  private readonly devices = new Map<string, DeviceRow>();
  private readonly families = new Map<string, FamilyRow>();

  // --- ユーザー -------------------------------------------------------------

  createUser(userId: string, now: number): UserRow {
    const row: UserRow = { userId, tokenVersion: 1, bannedAt: null, createdAt: now };
    this.users.set(userId, row);
    return row;
  }

  getUser(userId: string): UserRow | undefined {
    return this.users.get(userId);
  }

  /** DESIGN 7章。BAN / 全端末ログアウトを即時に効かせる唯一の手段。 */
  bumpTokenVersion(userId: string): number {
    const user = this.requireUser(userId);
    const next = { ...user, tokenVersion: user.tokenVersion + 1 };
    this.users.set(userId, next);
    return next.tokenVersion;
  }

  banUser(userId: string, now: number): void {
    const user = this.requireUser(userId);
    this.users.set(userId, { ...user, bannedAt: now });
  }

  // --- デバイス認証情報 -----------------------------------------------------

  createDevice(input: CreateDeviceInput): DeviceRow {
    const row: DeviceRow = {
      deviceId: input.deviceId,
      userId: input.userId,
      secretHash: input.secretHash,
      attestationVerified: input.attestationVerified,
      deviceHint: input.deviceHint,
      createdAt: input.now,
      lastLoginAt: input.now,
      revokedAt: null,
    };
    this.devices.set(row.deviceId, row);
    return row;
  }

  getDevice(deviceId: string): DeviceRow | undefined {
    return this.devices.get(deviceId);
  }

  /** DESIGN 7章。サイレント再ログインのたびに回して、無期限の固定シークレットを作らない。 */
  rotateDeviceSecret(deviceId: string, nextSecretHash: string, now: number): DeviceRow {
    const device = this.requireDevice(deviceId);
    const next: DeviceRow = { ...device, secretHash: nextSecretHash, lastLoginAt: now };
    this.devices.set(deviceId, next);
    return next;
  }

  revokeDevice(deviceId: string, now: number): void {
    const device = this.devices.get(deviceId);
    if (device === undefined || device.revokedAt !== null) return;
    this.devices.set(deviceId, { ...device, revokedAt: now });
  }

  listDevicesByUser(userId: string): DeviceRow[] {
    return [...this.devices.values()].filter((device) => device.userId === userId);
  }

  // --- ファミリー -----------------------------------------------------------

  createFamily(input: CreateFamilyInput): FamilyRow {
    const row: FamilyRow = {
      familyId: input.familyId,
      userId: input.userId,
      deviceId: input.deviceId,
      generation: 0,
      secretHash: input.secretHash,
      prevSecretHash: null,
      rotatedAt: input.now,
      absoluteExpiresAt: input.absoluteExpiresAt,
      revokedAt: null,
      lastUsedAt: input.now,
    };
    this.families.set(row.familyId, row);
    return row;
  }

  getFamily(familyId: string): FamilyRow | undefined {
    return this.families.get(familyId);
  }

  /**
   * 世代を1つ進める。`absolute_expires_at` は引き継ぐ
   * （スライディング更新をしない = 期限の系統を1本に保つ / DESIGN 3章）。
   */
  rotateFamily(input: RotateFamilyInput): FamilyRow {
    const family = this.requireFamily(input.familyId);
    const next: FamilyRow = {
      ...family,
      generation: family.generation + 1,
      secretHash: input.nextSecretHash,
      prevSecretHash: family.secretHash,
      rotatedAt: input.now,
      lastUsedAt: input.now,
    };
    this.families.set(next.familyId, next);
    return next;
  }

  revokeFamily(familyId: string, now: number): void {
    const family = this.families.get(familyId);
    if (family === undefined || family.revokedAt !== null) return;
    this.families.set(familyId, { ...family, revokedAt: now });
  }

  /** 該当端末の生きているファミリーを一括失効。件数を返す。 */
  revokeFamiliesByDevice(deviceId: string, now: number): number {
    return this.revokeWhere((family) => family.deviceId === deviceId, now);
  }

  /** DESIGN 7章「特定端末のログアウト」をユーザー全体へ広げたもの。 */
  revokeFamiliesByUser(userId: string, now: number): number {
    return this.revokeWhere((family) => family.userId === userId, now);
  }

  listFamiliesByUser(userId: string): FamilyRow[] {
    return [...this.families.values()].filter((family) => family.userId === userId);
  }

  /**
   * DESIGN 11章の定期掃除。物理削除でよいが、呼び出し側で削除ログを残すこと。
   * 削除した `family_id` を返すのはそのため。
   */
  purgeFamilies(now: number, idleTtlMs: number): string[] {
    const purged: string[] = [];
    for (const family of this.families.values()) {
      const expired = family.absoluteExpiresAt <= now;
      const idle = now - family.lastUsedAt >= idleTtlMs;
      if (expired || idle) {
        this.families.delete(family.familyId);
        purged.push(family.familyId);
      }
    }
    return purged;
  }

  // --- 内部 -----------------------------------------------------------------

  private revokeWhere(predicate: (family: FamilyRow) => boolean, now: number): number {
    let revoked = 0;
    for (const family of this.families.values()) {
      if (family.revokedAt !== null || !predicate(family)) continue;
      this.families.set(family.familyId, { ...family, revokedAt: now });
      revoked += 1;
    }
    return revoked;
  }

  private requireUser(userId: string): UserRow {
    const user = this.users.get(userId);
    if (user === undefined) throw new Error(`user ${userId} が存在しない`);
    return user;
  }

  private requireDevice(deviceId: string): DeviceRow {
    const device = this.devices.get(deviceId);
    if (device === undefined) throw new Error(`device ${deviceId} が存在しない`);
    return device;
  }

  private requireFamily(familyId: string): FamilyRow {
    const family = this.families.get(familyId);
    if (family === undefined) throw new Error(`family ${familyId} が存在しない`);
    return family;
  }
}
