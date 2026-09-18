/**
 * APNs producer (zremote iOS client) — ES256 JWT auth, Live Activity
 * update/end/start payloads, and alert banners when a run finishes.
 *
 * Live Activity content-state is expo-widgets' `{name, props}` (props is a
 * JSON string decoded by the widget). Alert pushes use `apns-push-type:
 * alert` on a device token (`kind: "alert"`), not an ActivityKit token.
 *
 * Everything here is inert until APNS_TEAM_ID/APNS_KEY_ID/APNS_P8/
 * APNS_BUNDLE_ID are configured (wrangler secrets); callers gate on
 * `apnsConfigured`.
 */
import type { Env } from "./env";

export const APNS_HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com"
} as const;

export const apnsConfigured = (env: Env): boolean =>
  env.APNS_TEAM_ID !== undefined &&
  env.APNS_KEY_ID !== undefined &&
  env.APNS_P8 !== undefined &&
  env.APNS_BUNDLE_ID !== undefined;

const apnsHost = (env: Env): string =>
  APNS_HOSTS[env.APNS_ENV === "sandbox" ? "sandbox" : "production"];

const b64url = (bytes: ArrayBuffer | Uint8Array | string): string => {
  const data =
    typeof bytes === "string"
      ? new TextEncoder().encode(bytes)
      : bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes);
  let bin = "";
  for (const b of data) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const pemToDer = (pem: string): Uint8Array => {
  const body = pem
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der;
};

const JWT_TTL_MS = 50 * 60 * 1000; // Apple allows ≤60min; refresh early.
let cachedJwt: { token: string; exp: number } | undefined;

/** ES256 JWT (`kid` = APNS_KEY_ID, `iss` = APNS_TEAM_ID), cached ≤50min. */
export const apnsJwt = async (env: Env, now = Date.now()): Promise<string> => {
  if (cachedJwt !== undefined && cachedJwt.exp > now) return cachedJwt.token;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(env.APNS_P8 as string) as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const header = b64url(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID }));
  const claims = b64url(
    JSON.stringify({ iss: env.APNS_TEAM_ID, iat: Math.floor(now / 1000) })
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${claims}`)
  );
  const token = `${header}.${claims}.${b64url(sig)}`;
  cachedJwt = { token, exp: now + JWT_TTL_MS };
  return token;
};

/** Test hook — JWT cache is module-scoped. */
export const resetApnsJwtCache = (): void => {
  cachedJwt = undefined;
};

export type LiveActivityEvent = "update" | "end" | "start";

export type SessionPushProps = {
  chatId: string;
  title: string;
  hostLabel?: string;
  phase: string;
  phaseLabel: string;
  startedAt: number;
  showContext: boolean;
};

const contentState = (props: SessionPushProps) => ({
  // expo-widgets decodes `{name, props}` — props is a JSON STRING.
  name: "ZeronSession",
  props: JSON.stringify(props)
});

const priorityFor = (phase: string): number =>
  phase === "awaitingInput" || phase === "errored" || phase === "completed"
    ? 10
    : 5;

export const buildLiveActivityPayload = (
  event: LiveActivityEvent,
  props: SessionPushProps,
  now = Date.now()
): Record<string, unknown> => {
  const aps: Record<string, unknown> = {
    timestamp: Math.floor(now / 1000),
    event,
    "content-state": contentState(props)
  };
  if (event === "update") aps["stale-date"] = Math.floor((now + 120_000) / 1000);
  if (event === "end") {
    aps["dismissal-date"] = Math.floor((now + 1_800_000) / 1000);
  }
  if (event === "start") {
    // LiveActivityAttributes { url } — expo-widgets' attributes type name.
    aps["attributes-type"] = "LiveActivityAttributes";
    aps["attributes"] = { url: `zeron://session/${props.chatId}` };
  }
  return { aps };
};

export type ApnsResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

/** True when a sessions.status flip means the agent finished a turn. */
export const isRunFinished = (
  prevStatus: string | undefined,
  status: string
): boolean =>
  (status === "idle" &&
    (prevStatus === "working" || prevStatus === "awaitingInput")) ||
  status === "errored";

export type AlertPushProps = {
  chatId: string;
  title: string;
  body: string;
};

/** User-visible banner. No prompt/message text — title is the chat title. */
export const buildAlertPayload = (
  props: AlertPushProps
): Record<string, unknown> => ({
  aps: {
    alert: { title: props.title, body: props.body },
    sound: "default",
    "thread-id": props.chatId
  },
  chatId: props.chatId,
  url: `zeron://session/${props.chatId}`
});

const postApns = async (
  env: Env,
  deviceToken: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  now: number,
  fetchImpl: typeof fetch
): Promise<ApnsResult> => {
  const jwt = await apnsJwt(env, now);
  const res = await fetchImpl(`${apnsHost(env)}/3/device/${deviceToken}`, {
    method: "POST",
    headers: { authorization: `bearer ${jwt}`, ...headers },
    body: JSON.stringify(body)
  });
  if (res.ok) return { ok: true };
  let reason = "";
  try {
    reason = ((await res.json()) as { reason?: string }).reason ?? "";
  } catch {
    /* body-less error */
  }
  return { ok: false, status: res.status, reason };
};

/** POST one Live Activity push to APNs for a device token. */
export const sendLiveActivityPush = async (
  env: Env,
  deviceToken: string,
  event: LiveActivityEvent,
  props: SessionPushProps,
  now = Date.now(),
  fetchImpl: typeof fetch = fetch
): Promise<ApnsResult> =>
  postApns(
    env,
    deviceToken,
    {
      "apns-push-type": "liveactivity",
      "apns-topic": `${env.APNS_BUNDLE_ID}.push-type.liveactivity`,
      "apns-priority": String(
        event === "update" ? priorityFor(props.phase) : 10
      )
    },
    buildLiveActivityPayload(event, props, now),
    now,
    fetchImpl
  );

/** POST one alert banner to APNs for a native device token (`kind: "alert"`). */
export const sendAlertPush = async (
  env: Env,
  deviceToken: string,
  props: AlertPushProps,
  now = Date.now(),
  fetchImpl: typeof fetch = fetch
): Promise<ApnsResult> =>
  postApns(
    env,
    deviceToken,
    {
      "apns-push-type": "alert",
      "apns-topic": env.APNS_BUNDLE_ID as string,
      "apns-priority": "10"
    },
    buildAlertPayload(props),
    now,
    fetchImpl
  );
