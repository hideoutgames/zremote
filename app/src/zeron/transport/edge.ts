// Ported from zeron@853872d apps/ios/Zeron/App/AppConfig.swift (URL shapes;
// paths cross-checked against edge/src/index.ts route table).
//
// Tokens ride `Authorization: Bearer` headers — never the URL (query strings
// reach request logs; the edge's bearerFromRequest reads the header). WS
// builders deliberately produce header-authenticated URLs: transports that
// can't set headers may append `?token=` themselves, but nothing here does.

export interface EdgeConfig {
  /** e.g. `https://edge.zeron.sh` — trailing slash tolerated. */
  baseUrl: string;
}

const httpBase = (cfg: EdgeConfig): string => cfg.baseUrl.replace(/\/+$/, '');

/** http(s) → ws(s) swap. */
const wsBase = (cfg: EdgeConfig): string =>
  httpBase(cfg).replace(/^http/, m => (m === 'https' ? 'wss' : 'ws'));

const q = (params: Record<string, string | number | undefined>): string => {
  const search = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    )
    .join('&');
  return search.length > 0 ? `?${search}` : '';
};

// ── Registry room (registry/{orgId}) ────────────────────────────────────────

/** GET (upgraded) /registry/{orgId}/ws?device= */
export const registryWsUrl = (
  cfg: EdgeConfig,
  orgId: string,
  deviceId: string,
): string =>
  `${wsBase(cfg)}/registry/${encodeURIComponent(orgId)}/ws${q({
    device: deviceId,
  })}`;

/** GET /registry/{orgId}/rows?device=&beat=1[&since=] — `beat=1` doubles as
 * a presence beat. */
export const registryRowsUrl = (
  cfg: EdgeConfig,
  orgId: string,
  deviceId: string,
  since?: number,
): string =>
  `${httpBase(cfg)}/registry/${encodeURIComponent(orgId)}/rows${q({
    device: deviceId,
    beat: 1,
    since,
  })}`;

/** POST /registry/{orgId}/push?device= */
export const registryPushUrl = (
  cfg: EdgeConfig,
  orgId: string,
  deviceId: string,
): string =>
  `${httpBase(cfg)}/registry/${encodeURIComponent(orgId)}/push${q({
    device: deviceId,
  })}`;

// ── chat2 rooms ─────────────────────────────────────────────────────────────

/** GET (upgraded) /chat2/{chatId}/ws?device= */
export const chat2WsUrl = (
  cfg: EdgeConfig,
  chatId: string,
  deviceId: string,
): string =>
  `${wsBase(cfg)}/chat2/${encodeURIComponent(chatId)}/ws${q({
    device: deviceId,
  })}`;

/** GET /chat2/{chatId}/checkpoint — Range-resumable; seq rides the
 * `x-chat2-checkpoint-seq` response header. */
export const chat2CheckpointUrl = (cfg: EdgeConfig, chatId: string): string =>
  `${httpBase(cfg)}/chat2/${encodeURIComponent(chatId)}/checkpoint`;

/** GET /chat2/{chatId}/rows?after=&device= — the HTTPS pull twin of the
 * socket backfill. */
export const chat2RowsUrl = (
  cfg: EdgeConfig,
  chatId: string,
  deviceId: string,
  after: number,
): string =>
  `${httpBase(cfg)}/chat2/${encodeURIComponent(chatId)}/rows${q({
    after,
    device: deviceId,
  })}`;

/** POST /chat2/{chatId}/rows?batchId=&device= — the HTTPS push twin. */
export const chat2PushUrl = (
  cfg: EdgeConfig,
  chatId: string,
  deviceId: string,
  batchId: string,
): string =>
  `${httpBase(cfg)}/chat2/${encodeURIComponent(chatId)}/rows${q({
    batchId,
    device: deviceId,
  })}`;

/** GET|PUT /chat2/{chatId}/tail — host-published sidecars, served verbatim. */
export const chat2TailUrl = (cfg: EdgeConfig, chatId: string): string =>
  `${httpBase(cfg)}/chat2/${encodeURIComponent(chatId)}/tail`;

// ── Device room + nudge ─────────────────────────────────────────────────────

/** GET (upgraded) /device/{deviceId}/ws?role=client&connId= — a fresh
 * connId per dial (reusing one can leave two tagged sockets in the
 * hibernating DO and route host replies to the stale peer). */
export const deviceWsUrl = (
  cfg: EdgeConfig,
  deviceId: string,
  connId: string,
): string =>
  `${wsBase(cfg)}/device/${encodeURIComponent(deviceId)}/ws${q({
    role: 'client',
    connId,
  })}`;

/** POST /device/{deviceId}/nudge — body `{chatId}` wakes a cold host. */
export const deviceNudgeUrl = (cfg: EdgeConfig, deviceId: string): string =>
  `${httpBase(cfg)}/device/${encodeURIComponent(deviceId)}/nudge`;

/** GET /device/{deviceId}/status — whether the device's relay HOST socket
 * is attached (distinct from workspace presence). */
export const deviceStatusUrl = (cfg: EdgeConfig, deviceId: string): string =>
  `${httpBase(cfg)}/device/${encodeURIComponent(deviceId)}/status`;

// ── Misc ────────────────────────────────────────────────────────────────────

/** PUT|GET /blob/{chatId}/{partId} — the tool-output sidecar. */
export const blobUrl = (
  cfg: EdgeConfig,
  chatId: string,
  partId: string,
): string =>
  `${httpBase(cfg)}/blob/${encodeURIComponent(chatId)}/${encodeURIComponent(
    partId,
  )}`;

/** /auth/* endpoints (exchange/refresh/orgs) — path without leading slash. */
export const authUrl = (cfg: EdgeConfig, path: string): string =>
  `${httpBase(cfg)}/${path.replace(/^\/+/, '')}`;

/** GET /health — unauthenticated edge liveness. */
export const healthUrl = (cfg: EdgeConfig): string => `${httpBase(cfg)}/health`;

// ── Logging safety ──────────────────────────────────────────────────────────

/** Strip any `token` query param for log lines (header-auth means none
 * should exist; the param exists only for clients that can't set headers). */
export const redactUrl = (url: string): string => {
  const mark = url.indexOf('?');
  if (mark < 0) return url;
  const kept = url
    .slice(mark + 1)
    .split('&')
    .filter(
      p => p.length > 0 && !p.startsWith('token=') && !p.startsWith('token%3D'),
    );
  return kept.length > 0
    ? `${url.slice(0, mark)}?${kept.join('&')}`
    : url.slice(0, mark);
};
