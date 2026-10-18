// UAT-only signed sessions for the local Node backend.
// The browser never supplies an authoritative user ID.
import crypto from "node:crypto";

export const UAT_SESSION_SECONDS = 4 * 60 * 60;

export function createSessionManager(secret, { clock = () => Date.now(), lifetimeSeconds = UAT_SESSION_SECONDS } = {}) {
  if (!secret || String(secret).length < 32) throw new Error("Session secret must have at least 32 characters");
  const sign = (payload) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return {
    issue(userId) {
      if (!userId) throw new Error("Session user ID required");
      const now = Math.floor(clock() / 1000);
      const payload = Buffer.from(JSON.stringify({
        v: 1, sub: String(userId), iat: now, exp: now + lifetimeSeconds,
      })).toString("base64url");
      return payload + "." + sign(payload);
    },
    verify(token) {
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
      const [payload, mac] = token.split(".");
      const expected = Buffer.from(sign(payload), "base64url");
      const supplied = Buffer.from(mac, "base64url");
      if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
      try {
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        const now = Math.floor(clock() / 1000);
        if (data.v !== 1 || typeof data.sub !== "string" || !data.sub ||
            !Number.isInteger(data.iat) || !Number.isInteger(data.exp) ||
            data.iat > now + 60 || data.exp <= now || data.exp - data.iat > lifetimeSeconds) return null;
        return data.sub;
      } catch {
        return null;
      }
    },
  };
}
