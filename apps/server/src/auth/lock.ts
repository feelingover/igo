// `family_id` 単位の分散ロック相当。DESIGN 4章。
//
// 押さえている性質は3つ。
//   - キーは `family_id`。`user_id` で取ると同一ユーザーの複数端末が不要に競合する
//   - TTL がある。プロセスが落ちてもファミリーが恒久的にロックされない
//   - 取得に失敗したらファミリーを失効させず 503 を返す（競合はエラーであって攻撃ではない）
//
// 時刻に注入した Clock ではなく実時間（Date.now）を使う。ロックの寿命はインフラの
// 都合であり、トークンの有効期限のようなドメイン上の時刻ではないため。

export interface LockHandle {
  release(): void;
}

export interface LockOptions {
  readonly ttlMs: number;
  readonly acquireTimeoutMs: number;
}

interface Held {
  expiresAt: number;
  readonly waiters: Array<() => void>;
}

export class InMemoryLock {
  private readonly held = new Map<string, Held>();

  /** 取得できたらハンドル、タイムアウトしたら null。 */
  async acquire(key: string, options: LockOptions): Promise<LockHandle | null> {
    const deadline = Date.now() + options.acquireTimeoutMs;

    for (;;) {
      const current = this.held.get(key);
      if (current === undefined || current.expiresAt <= Date.now()) {
        if (current !== undefined) this.release(key); // TTL 切れの後始末
        return this.take(key, options.ttlMs);
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await this.waitForRelease(current, Math.min(remaining, current.expiresAt - Date.now()));
    }
  }

  /** 保持中か。モック運用エンドポイントからの確認用。 */
  isHeld(key: string): boolean {
    const current = this.held.get(key);
    return current !== undefined && current.expiresAt > Date.now();
  }

  private take(key: string, ttlMs: number): LockHandle {
    this.held.set(key, { expiresAt: Date.now() + ttlMs, waiters: [] });
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.release(key);
      },
    };
  }

  private release(key: string): void {
    const current = this.held.get(key);
    if (current === undefined) return;
    this.held.delete(key);
    for (const wake of current.waiters) wake();
  }

  private waitForRelease(current: Held, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(finish, Math.max(timeoutMs, 0));
      current.waiters.push(finish);

      function finish(): void {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}

export const familyLockKey = (familyId: string): string => `family:${familyId}`;
