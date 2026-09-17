// 内部モデル → JSON の変換。
//
// 内部は camelCase、ワイヤは snake_case（RFC 6749 系のトークン応答に揃える）。
// この変換をここだけに閉じ込めるのは、GameResult を文字列化する場所を
// resultFormat.ts に閉じているのと同じ理由（境界で整形し、内部に持ち込まない）。
import type { AuditRecord } from '../auth/audit';
import type { RegistrationResult, SilentReloginResult, TokenBundle, UserSnapshot } from '../auth/authService';

export interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly family_id: string;
  readonly refresh_token_expires_at: string;
}

export function tokenResponse(bundle: TokenBundle): TokenResponse {
  return {
    access_token: bundle.accessToken,
    refresh_token: bundle.refreshToken,
    token_type: 'Bearer',
    expires_in: bundle.expiresInSec,
    family_id: bundle.familyId,
    refresh_token_expires_at: new Date(bundle.refreshTokenExpiresAt).toISOString(),
  };
}

export function registrationResponse(result: RegistrationResult): TokenResponse & {
  readonly user_id: string;
  readonly device_id: string;
  readonly device_secret: string;
  readonly attestation_verified: boolean;
} {
  return {
    ...tokenResponse(result),
    user_id: result.userId,
    device_id: result.device.deviceId,
    // 平文の device_secret が降るのはここだけ。TLS 前提（DESIGN 10章）。
    device_secret: result.device.deviceSecret,
    attestation_verified: result.attestationVerified,
  };
}

export function silentReloginResponse(result: SilentReloginResult): TokenResponse & {
  readonly user_id: string;
  readonly device_id: string;
  readonly device_secret: string;
} {
  return {
    ...tokenResponse(result),
    user_id: result.userId,
    device_id: result.device.deviceId,
    // DESIGN 7章: 毎回ローテーションするので、クライアントは必ず保存し直す。
    device_secret: result.device.deviceSecret,
  };
}

/** モック運用エンドポイントの応答。内部モデルを素通しせず、ここで snake_case に揃える。 */
export function userSnapshotResponse(snapshot: UserSnapshot) {
  return {
    user_id: snapshot.userId,
    token_version: snapshot.tokenVersion,
    banned_at: isoOrNull(snapshot.bannedAt),
    devices: snapshot.devices.map((device) => ({
      device_id: device.deviceId,
      attestation_verified: device.attestationVerified,
      last_login_at: new Date(device.lastLoginAt).toISOString(),
      revoked_at: isoOrNull(device.revokedAt),
    })),
    families: snapshot.families.map((family) => ({
      family_id: family.familyId,
      device_id: family.deviceId,
      generation: family.generation,
      rotated_at: new Date(family.rotatedAt).toISOString(),
      absolute_expires_at: new Date(family.absoluteExpiresAt).toISOString(),
      revoked_at: isoOrNull(family.revokedAt),
    })),
  };
}

/** 監査ログの応答。トークンを持たない AuditRecord をそのまま写すだけ（DESIGN 11章）。 */
export function auditRecordResponse(record: AuditRecord) {
  return {
    at: new Date(record.at).toISOString(),
    event: record.event,
    user_id: record.userId ?? null,
    family_id: record.familyId ?? null,
    device_id: record.deviceId ?? null,
    ip: record.ip ?? null,
    user_agent: record.userAgent ?? null,
    detail: record.detail ?? null,
  };
}

const isoOrNull = (at: number | null): string | null => (at === null ? null : new Date(at).toISOString());
