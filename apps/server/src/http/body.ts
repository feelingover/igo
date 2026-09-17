// リクエストボディの読み取り。境界での明示的な検証に限定する。
import type { Context } from 'hono';

import { AuthError } from '../auth/errors';

export type JsonObject = Record<string, unknown>;

export async function readJsonObject(c: Context): Promise<JsonObject> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw badRequest('JSON ボディが必要です。');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw badRequest('JSON オブジェクトが必要です。');
  }
  return parsed as JsonObject;
}

export function requireString(body: JsonObject, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value === '') {
    throw badRequest(`${key} は空でない文字列である必要があります。`);
  }
  return value;
}

export function optionalString(body: JsonObject, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest(`${key} は文字列である必要があります。`);
  return value;
}

export function requireObject(body: JsonObject, key: string): JsonObject {
  const value = body[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badRequest(`${key} はオブジェクトである必要があります。`);
  }
  return value as JsonObject;
}

export function badRequest(message: string): AuthError {
  return new AuthError('invalid_request', 400, message);
}
