/** Shared across all OpenDota consumers, including replay and metadata requests. */
export class OpenDotaLimit {
  private nextRequestAt = 0;
  private blockedUntil = 0;
  private consecutiveLimits = 0;

  limited(now = Date.now()): boolean { return now < this.blockedUntil; }

  reserve(now = Date.now()): number {
    const at = Math.max(now, this.nextRequestAt);
    this.nextRequestAt = at + 1500;
    return at - now;
  }

  networkFailure(now = Date.now()): void {
    this.blockedUntil = Math.max(this.blockedUntil, now + 2 * 60_000);
  }

  response(status: number, retryAfter: string | null, now = Date.now()): void {
    if (status === 429) {
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const retryMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter ?? '') - now;
      const backoff = Math.min(6 * 60 * 60_000, 15 * 60_000 * 2 ** Math.min(this.consecutiveLimits++, 5));
      this.blockedUntil = Math.max(this.blockedUntil, now + backoff, now + (Number.isFinite(retryMs) ? Math.max(0, retryMs) : 0));
    } else if (status >= 200 && status < 300) {
      this.consecutiveLimits = 0;
    }
  }
}
