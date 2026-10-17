/** In-process HTTP admission limits. No provider credentials are bucket keys. */
import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";

export interface HttpLimits {
  ipPerMinute: number;
  ipBurst: number;
  globalPerMinute: number;
  globalBurst: number;
  sessionsPerIp: number;
  maxSessions: number;
  sessionIdleMs: number;
}

export const DEFAULT_HTTP_LIMITS: Readonly<HttpLimits> = {
  ipPerMinute: 120, ipBurst: 30,
  globalPerMinute: 1200, globalBurst: 100,
  sessionsPerIp: 20, maxSessions: 200,
  sessionIdleMs: 30 * 60_000,
};

const ENV_FIELDS: Record<keyof HttpLimits, string> = {
  ipPerMinute: "HTTP_RATE_LIMIT_PER_IP",
  ipBurst: "HTTP_RATE_LIMIT_BURST_PER_IP",
  globalPerMinute: "HTTP_RATE_LIMIT_GLOBAL",
  globalBurst: "HTTP_RATE_LIMIT_BURST_GLOBAL",
  sessionsPerIp: "HTTP_MAX_SESSIONS_PER_IP",
  maxSessions: "HTTP_MAX_SESSIONS",
  sessionIdleMs: "HTTP_SESSION_IDLE_TIMEOUT_MS",
};

export function validateHttpLimits(limits: HttpLimits): HttpLimits {
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`HTTP limit ${key} must be a positive safe integer`);
    }
  }
  // Node timers clamp larger delays to 1ms.
  if (limits.sessionIdleMs > 2_147_483_647) {
    throw new Error("HTTP session idle timeout exceeds the supported timer range");
  }
  return limits;
}

export function httpLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): HttpLimits {
  const limits = { ...DEFAULT_HTTP_LIMITS };
  for (const key of Object.keys(ENV_FIELDS) as (keyof HttpLimits)[]) {
    const value = env[ENV_FIELDS[key]];
    if (value !== undefined) {
      if (!/^\d+$/.test(value)) throw new Error(`Invalid ${ENV_FIELDS[key]}`);
      limits[key] = Number(value);
    }
  }
  return validateHttpLimits(limits);
}

export function normalizeIp(value: string): string | undefined {
  const ip = value.toLowerCase();
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) return ip.slice(7);
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) === 6) {
    try { return new URL(`http://[${ip}]/`).hostname.slice(1, -1); }
    catch { return undefined; }
  }
  return undefined;
}

/** Only the immediate peer allowlist enables X-Real-IP. Never trust XFF blindly. */
export function clientIpResolver(trustedProxies: string[] = []): (req: IncomingMessage) => string {
  const peers = new BlockList();
  for (const entry of trustedProxies) {
    const parts = entry.trim().split("/");
    const address = normalizeIp(parts[0]);
    if (!address || parts.length > 2) throw new Error("Invalid trusted proxy IP/CIDR");
    const family = isIP(address) === 4 ? "ipv4" : "ipv6";
    if (parts.length === 1) peers.addAddress(address, family);
    else {
      const prefix = Number(parts[1]);
      if (!/^\d+$/.test(parts[1]) || prefix < 0 || prefix > (family === "ipv4" ? 32 : 128)) {
        throw new Error("Invalid trusted proxy CIDR prefix");
      }
      peers.addSubnet(address, prefix, family);
    }
  }
  return (req) => {
    const peer = normalizeIp(req.socket.remoteAddress ?? "") ?? "unknown";
    const header = req.headers["x-real-ip"];
    if (isIP(peer) && peers.check(peer, isIP(peer) === 4 ? "ipv4" : "ipv6") && typeof header === "string") {
      return normalizeIp(header) ?? peer;
    }
    return peer;
  };
}

interface Bucket { tokens: number; updated: number }

export class HttpRateLimiter {
  private readonly ips = new Map<string, Bucket>();
  private readonly global: Bucket;
  private nextSweep = 0;

  constructor(
    private readonly limits: HttpLimits,
    private readonly now: () => number = () => performance.now(),
    private readonly maxIpBuckets = 10_000,
  ) {
    validateHttpLimits(limits);
    this.global = { tokens: limits.globalBurst, updated: now() };
  }

  /** Zero admits; otherwise whole seconds until the limiting bucket refills. */
  take(ip: string): number {
    const now = this.now();
    if (now >= this.nextSweep) {
      for (const [key, bucket] of this.ips) {
        if (now - bucket.updated >= this.limits.ipBurst * 60_000 / this.limits.ipPerMinute) this.ips.delete(key);
      }
      this.nextSweep = now + 1000;
    }
    let local = this.ips.get(ip);
    const isNew = !local;
    if (!local) {
      // Bound memory under rotating/spoofed source addresses; fail closed.
      if (this.ips.size >= this.maxIpBuckets) return 1;
      local = { tokens: this.limits.ipBurst, updated: now };
    }
    const wait = (bucket: Bucket, rate: number, burst: number) => {
      bucket.tokens = Math.min(burst, bucket.tokens + Math.max(0, now - bucket.updated) * rate / 60_000);
      bucket.updated = now;
      return bucket.tokens >= 1 ? 0 : Math.max(1, Math.ceil((1 - bucket.tokens) * 60 / rate));
    };
    const localWait = wait(local, this.limits.ipPerMinute, this.limits.ipBurst);
    const globalWait = wait(this.global, this.limits.globalPerMinute, this.limits.globalBurst);
    if (localWait || globalWait) return Math.max(localWait, globalWait);
    if (isNew) this.ips.set(ip, local);
    local.tokens--;
    this.global.tokens--;
    return 0;
  }
}
