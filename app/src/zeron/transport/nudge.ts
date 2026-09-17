// Ported from zeron@853872d apps/ios/Zeron/App/AppConfig.swift `nudge` —
// POST /device/{deviceId}/nudge {"chatId": …} wakes a cold host to drain
// the command queue. Fire-and-forget with one retry.

import { deviceNudgeUrl, type EdgeConfig } from './edge';
import { edgeFetch, type FetchImpl } from './edgeHttp';
import type { TokenSource } from './tokenSource';

export const nudgeHost = async (
  cfg: EdgeConfig,
  tokenSource: TokenSource,
  deviceId: string,
  chatId: string,
  fetchImpl?: FetchImpl,
): Promise<void> => {
  const url = deviceNudgeUrl(cfg, deviceId);
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId }),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await edgeFetch(url, tokenSource, init, fetchImpl);
      if (res.status < 500) return; // 4xx isn't transient — don't retry it
    } catch {
      // transport error — retry once
    }
  }
};
