import { describe, expect, it, vi, afterEach } from "vitest";
import { appleAssociation } from "./apple-association";
import { exchange } from "./workos";
import { handleAuthRoute, isIosMobileUa, shouldHopToApp } from "./auth-routes";
import type { Env } from "./env";

describe("apple-app-site-association", () => {
  it("404s when IOS_APP_IDS is unset", () => {
    const res = appleAssociation({} as Env);
    expect(res.status).toBe(404);
  });

  it("serves applinks details for configured app ids", async () => {
    const res = appleAssociation({
      IOS_APP_IDS: "TEAM123.com.zeron.app, TEAM123.com.zeron.app-dev "
    } as Env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = (await res.json()) as {
      applinks: { details: { appIDs: string[]; components: { "/": string }[] }[] };
    };
    expect(body.applinks.details[0].appIDs).toEqual([
      "TEAM123.com.zeron.app",
      "TEAM123.com.zeron.app-dev"
    ]);
    expect(body.applinks.details[0].components[0]["/"]).toBe(
      "/auth/cli/callback*"
    );
  });
});

describe("workos exchange PKCE", () => {
  afterEach(() => vi.unstubAllGlobals());

  const wireOk = {
    user: { id: "u1", email: "a@b.c", first_name: "A", last_name: "B" },
    access_token: "at",
    refresh_token: "rt"
  };

  it("forwards codeVerifier as code_verifier", async () => {
    const fetchSpy = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify(wireOk), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchSpy);
    await exchange(
      { WORKOS_CLIENT_ID: "client_x" } as Env,
      "secret",
      "code123",
      "verifier-abc"
    );
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.code_verifier).toBe("verifier-abc");
    expect(body.grant_type).toBe("authorization_code");
  });

  it("omits code_verifier when not provided", async () => {
    const fetchSpy = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify(wireOk), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchSpy);
    await exchange({ WORKOS_CLIENT_ID: "c" } as Env, "secret", "code123");
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect("code_verifier" in body).toBe(false);
  });
});

describe("cli callback iOS hop", () => {
  const callback = async (state: string, ua: string) => {
    const request = new Request(
      `https://edge.test/auth/cli/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { "user-agent": ua } }
    );
    return handleAuthRoute(request, {} as Env, new URL(request.url));
  };

  const iphoneUa =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
  const ipadMobileUa =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
  const desktopUa =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  it("treats iPhone and iPadOS user agents as mobile", () => {
    expect(isIosMobileUa(iphoneUa)).toBe(true);
    expect(isIosMobileUa(ipadMobileUa)).toBe(true);
    expect(isIosMobileUa(desktopUa)).toBe(false);
  });

  it("hops iOS user agents and zr1. states", () => {
    expect(shouldHopToApp(iphoneUa, "xyz")).toBe(true);
    expect(shouldHopToApp(desktopUa, "zr1.abc")).toBe(true);
    expect(shouldHopToApp(desktopUa, "xyz")).toBe(false);
  });

  it("302-redirects iOS user agents to zeron://auth/callback", async () => {
    const res = await callback("xyz", iphoneUa);
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")).toBe(
      "zeron://auth/callback?code=abc&state=xyz"
    );
    const body = await res!.text();
    expect(body).toContain("zeron://auth/callback?code=abc&state=xyz");
    expect(body).toContain("Open ZRemote");
    expect(body).toContain("If nothing happens, this code still works");
    expect(body).toContain('id="paste"');
    expect(body).toContain("xyz.abc");
    expect(body).toContain("Copy code");
  });

  it("302-redirects zr1. state even on a desktop user agent", async () => {
    const res = await callback("zr1.abc", desktopUa);
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")).toBe(
      "zeron://auth/callback?code=abc&state=zr1.abc"
    );
    const body = await res!.text();
    expect(body).toContain("zr1.abc.abc");
    expect(body).toContain('id="paste"');
  });

  it("keeps the paste-code page for desktop user agents", async () => {
    const res = await callback("xyz", desktopUa);
    expect(res?.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain("Paste this code into the terminal");
    expect(body).not.toContain("location.replace");
    expect(res?.headers.get("location")).toBeNull();
  });
});
