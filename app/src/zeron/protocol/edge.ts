// Deep-link validation + the edge's ID grammar (edge/src/index.ts `ID_RE`,
// mirrored so the phone never forwards a malformed id into a room URL).

/** edge/src/index.ts ID_RE — session ids, device ids, part namespaces. */
export const EDGE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export type DeepLink =
  | { kind: 'session'; chatId: string }
  | { kind: 'authCallback'; code: string; state: string };

const queryParams = (url: string): Record<string, string> => {
  const q = url.indexOf('?');
  if (q < 0) return {};
  const out: Record<string, string> = {};
  for (const pair of url.slice(q + 1).split(/[&#]/)) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    try {
      out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(
        pair.slice(eq + 1),
      );
    } catch {
      // malformed encoding — skip the pair
    }
  }
  return out;
};

const authCallback = (url: string): DeepLink | undefined => {
  const q = queryParams(url);
  return q.code !== undefined && q.state !== undefined
    ? { kind: 'authCallback', code: q.code, state: q.state }
    : undefined;
};

/**
 * Recognized links:
 *  - `zeron://session/{chatId}` (chatId must match the edge ID grammar)
 *  - `zeron://auth/callback?code&state`
 *  - `https://{edgeHost}/auth/cli/callback?code&state` (universal link)
 * Anything else is ignored (undefined).
 */
export const parseZeronLink = (
  url: string,
  edgeHost: string,
): DeepLink | undefined => {
  if (url.startsWith('zeron://')) {
    const rest = url.slice('zeron://'.length);
    if (rest.startsWith('session/')) {
      const chatId = rest.slice('session/'.length).split(/[/?#]/)[0];
      return EDGE_ID_RE.test(chatId) ? { kind: 'session', chatId } : undefined;
    }
    if (rest.startsWith('auth/callback')) return authCallback(url);
    return undefined;
  }
  const httpsPrefix = `https://${edgeHost}/`;
  if (url.startsWith(httpsPrefix)) {
    const path = url.slice(httpsPrefix.length).split(/[?#]/)[0];
    if (path === 'auth/cli/callback') return authCallback(url);
  }
  return undefined;
};
