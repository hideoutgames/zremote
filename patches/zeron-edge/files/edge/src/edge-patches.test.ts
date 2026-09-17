import { describe, expect, it, vi, afterEach } from "vitest";
import { appleAssociation } from "./apple-association";
import { exchange } from "./workos";
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
