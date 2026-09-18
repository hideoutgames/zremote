import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  apnsConfigured,
  buildAlertPayload,
  buildLiveActivityPayload,
  isRunFinished,
  resetApnsJwtCache,
  sendAlertPush,
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

describe("isRunFinished", () => {
  it("is true for working/awaitingInput → idle and for errored", () => {
    expect(isRunFinished("working", "idle")).toBe(true);
    expect(isRunFinished("awaitingInput", "idle")).toBe(true);
    expect(isRunFinished("working", "errored")).toBe(true);
    expect(isRunFinished(undefined, "errored")).toBe(true);
  });

  it("is false for still-running and first-seen idle", () => {
    expect(isRunFinished("idle", "working")).toBe(false);
    expect(isRunFinished("working", "awaitingInput")).toBe(false);
    expect(isRunFinished("awaitingInput", "working")).toBe(false);
    expect(isRunFinished(undefined, "idle")).toBe(false);
    expect(isRunFinished("idle", "idle")).toBe(false);
  });
});

describe("buildAlertPayload", () => {
  it("carries aps.alert + thread-id + deep link, no message text", () => {
    const p = buildAlertPayload({
      chatId: "c1",
      title: "Fix bug",
      body: "Run completed"
    }) as {
      aps: {
        alert: { title: string; body: string };
        sound: string;
        "thread-id": string;
      };
      chatId: string;
      url: string;
    };
    expect(p.aps.alert).toEqual({ title: "Fix bug", body: "Run completed" });
    expect(p.aps.sound).toBe("default");
    expect(p.aps["thread-id"]).toBe("c1");
    expect(p.chatId).toBe("c1");
    expect(p.url).toBe("zeron://session/c1");
  });
});

describe("sendAlertPush", () => {
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
  const alert = { chatId: "c1", title: "Fix bug", body: "Run completed" };

  it("POSTs to production with alert headers and bundle-id topic", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response("{}", { status: 200 });
    });
    const r = await sendAlertPush(env(), "devtoken", alert, 0, fetchImpl as typeof fetch);
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe(`${APNS_HOSTS.production}/3/device/devtoken`);
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["apns-push-type"]).toBe("alert");
    expect(h["apns-topic"]).toBe("com.zeron.app");
    expect(h["apns-priority"]).toBe("10");
    expect(h.authorization.startsWith("bearer ")).toBe(true);
    const body = JSON.parse(calls[0].init.body as string) as {
      aps: { alert: { body: string } };
    };
    expect(body.aps.alert.body).toBe("Run completed");
  });

  it("uses sandbox host via APNS_ENV", async () => {
    const fetchImpl = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response("{}", { status: 200 }));
    await sendAlertPush(
      { ...env(), APNS_ENV: "sandbox" } as Env,
      "t",
      { ...alert, body: "Run failed" },
      0,
      fetchImpl as typeof fetch
    );
    expect(String(fetchImpl.mock.calls[0][0])).toContain("api.sandbox.push.apple.com");
  });

  it("surfaces BadDeviceToken for pruning", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 })
    );
    const r = await sendAlertPush(env(), "t", alert, 0, fetchImpl as typeof fetch);
    expect(r).toEqual({ ok: false, status: 400, reason: "BadDeviceToken" });
  });
});
