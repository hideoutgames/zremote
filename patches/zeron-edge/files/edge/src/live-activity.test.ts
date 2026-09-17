import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  apnsConfigured,
  buildLiveActivityPayload,
  resetApnsJwtCache,
  sendLiveActivityPush,
  APNS_HOSTS
} from "./live-activity";
import type { Env } from "./env";

// Minimal P-256 keypair generated at test time — WebCrypto signs real JWTs.
const envBase = {
  APNS_TEAM_ID: "TEAM123456",
  APNS_KEY_ID: "KEY1234567",
  APNS_BUNDLE_ID: "com.zeron.app"
} as unknown as Env;

const props = {
  chatId: "c1",
  title: "Fix bug",
  hostLabel: "mac · zeron",
  phase: "working",
  phaseLabel: "Working",
  startedAt: 1_700_000_000,
  showContext: true
};

describe("apnsConfigured", () => {
  it("requires team+key+p8+bundle", () => {
    expect(apnsConfigured({} as Env)).toBe(false);
    expect(
      apnsConfigured({ ...envBase, APNS_P8: "x" } as Env)
    ).toBe(true);
  });
});

describe("buildLiveActivityPayload", () => {
  it("update carries content-state {name,props-string} + stale-date", () => {
    const p = buildLiveActivityPayload("update", props, 1_000) as {
      aps: Record<string, unknown>;
    };
    expect(p.aps.event).toBe("update");
    expect(p.aps["stale-date"]).toBe(Math.floor(121_000 / 1000));
    const cs = p.aps["content-state"] as { name: string; props: string };
    expect(cs.name).toBe("ZeronSession");
    expect(JSON.parse(cs.props).chatId).toBe("c1");
  });

  it("end carries dismissal-date now+1800s", () => {
    const p = buildLiveActivityPayload("end", props, 1_000) as {
      aps: Record<string, unknown>;
    };
    expect(p.aps.event).toBe("end");
    expect(p.aps["dismissal-date"]).toBe(Math.floor(1_801_000 / 1000));
    expect(p.aps["stale-date"]).toBeUndefined();
  });

  it("start carries attributes-type + attributes.url deep link", () => {
    const p = buildLiveActivityPayload("start", props, 1_000) as {
      aps: Record<string, unknown>;
    };
    expect(p.aps.event).toBe("start");
    expect(p.aps["attributes-type"]).toBe("LiveActivityAttributes");
    expect(
      (p.aps.attributes as { url: string }).url
    ).toBe("zeron://session/c1");
  });
});

describe("sendLiveActivityPush", () => {
  let p8: string;
  beforeEach(async () => {
    resetApnsJwtCache();
    const kp = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"]
    )) as CryptoKeyPair;
    const der = (await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer;
    p8 = `-----BEGIN PRIVATE KEY-----\n${btoa(
      String.fromCharCode(...new Uint8Array(der))
    )}\n-----END PRIVATE KEY-----`;
  });

  const env = () => ({ ...envBase, APNS_P8: p8 }) as Env;

  it("POSTs to production with liveactivity headers, priority 5 for working", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response("{}", { status: 200 });
    });
    const r = await sendLiveActivityPush(env(), "devtoken", "update", props, 0, fetchImpl as typeof fetch);
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe(`${APNS_HOSTS.production}/3/device/devtoken`);
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["apns-push-type"]).toBe("liveactivity");
    expect(h["apns-topic"]).toBe("com.zeron.app.push-type.liveactivity");
    expect(h["apns-priority"]).toBe("5");
    expect(h.authorization.startsWith("bearer ")).toBe(true);
  });

  it("priority 10 for awaitingInput; sandbox host via APNS_ENV", async () => {
    const fetchImpl = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response("{}", { status: 200 }));
    await sendLiveActivityPush(
      { ...env(), APNS_ENV: "sandbox" } as Env,
      "t",
      "update",
      { ...props, phase: "awaitingInput" },
      0,
      fetchImpl as typeof fetch
    );
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["apns-priority"]).toBe("10");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("api.sandbox.push.apple.com");
  });

  it("surfaces BadDeviceToken for pruning", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 })
    );
    const r = await sendLiveActivityPush(env(), "t", "update", props, 0, fetchImpl as typeof fetch);
    expect(r).toEqual({ ok: false, status: 400, reason: "BadDeviceToken" });
  });

  it("caches the JWT (one key import/sign per 50min)", async () => {
    const fetchImpl = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response("{}", { status: 200 }));
    await sendLiveActivityPush(env(), "a", "update", props, 0, fetchImpl as typeof fetch);
    await sendLiveActivityPush(env(), "b", "update", props, 60_000, fetchImpl as typeof fetch);
    const h1 = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const h2 = (fetchImpl.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(h1.authorization).toBe(h2.authorization);
  });
});
