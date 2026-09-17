/**
 * Apple App Site Association — public, pre-bearer universal links for the
 * iOS client's /auth/cli/callback* path. Served only when IOS_APP_IDS is
 * configured (comma-separated "TEAMID.bundle" ids); otherwise a plain 404.
 */
import type { Env } from "./env";

export const appleAssociation = (env: Env): Response => {
  const appIDs = (env.IOS_APP_IDS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (appIDs.length === 0) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" }
    });
  }
  return new Response(
    JSON.stringify({
      applinks: {
        details: [{ appIDs, components: [{ "/": "/auth/cli/callback*" }] }]
      }
    }),
    { headers: { "content-type": "application/json" } }
  );
};
