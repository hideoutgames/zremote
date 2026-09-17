# Host/edge changes required by the iOS client

Patches live in `patches/zeron-edge/` (`*.patch` from
`git format-patch 853872d` on branch `zremote-edge-patches`, worktree
`../_ref/zeron-edge-patch`; full file copies under `files/` for
readability). Apply to a zeron edge deployment at revision 853872d
(v0.2.72). Unit tests: `cd edge && npm run test:unit` (53 tests incl. the
new `live-activity` + `edge-patches` suites; workerd pool not run on
Windows).

## 1. Apple App Site Association — `edge/src/apple-association.ts`

`GET /.well-known/apple-app-site-association` →
`{"applinks":{"details":[{"appIDs":[…],"components":[{"/":"/auth/cli/callback*"}]}]}}`.
Public (pre-bearer), `application/json`, 404 when `IOS_APP_IDS` is unset.
Required for the iOS sign-in universal link; without it the app falls back
to paste-code sign-in (fully working).

Env: `IOS_APP_IDS` — comma-separated `TEAMID.bundleid` entries.

## 2. PKCE exchange — `edge/src/auth-routes.ts` + `workos.ts`

`POST /auth/exchange` accepts an optional `codeVerifier` and forwards it to
WorkOS `user_management/authenticate` as `code_verifier`. Required for the
public-client PKCE flow on iOS (no client secret on the phone). Without it,
HTTPS-callback sign-in fails PKCE validation; paste-code sign-in still works.

## 3. Live Activity push producer — `edge/src/registry-room.ts` +
`edge/src/live-activity.ts` + routes in `index.ts`

The per-user RegistryRoom DO gains:

- Table `live_activity_tokens(chat_id, token, kind, device, updated_at)` —
  scoped to the owning user's registry by construction.
- `PUT`/`DELETE /live-activity` (same auth shape as `/registry/*`: org claim
  check at the Worker, `x-zeron-auth-user` at the DO).
- On every applied op batch: `sessions` rows whose `status` changed push a
  Live Activity update to each registered `activity` token for that chat.
  Content state is expo-widgets' `{name:"ZeronSession", props:<json string>}`
  with the session row + chat title + device name. `working` updates
  throttle to 1/5s per chat; awaitingInput/errored push immediately at
  priority 10 (working is 5). Returning to `idle` after
  working/awaitingInput sends `event:"end"` (dismissal 30min); updates
  carry `stale-date` now+120s. `BadDeviceToken`/410 prune the token.
- Push-to-start: a `sessions` flip to `working` with no activity token but
  a registered `push_to_start` token sends `event:"start"` with
  `attributes-type:"LiveActivityAttributes"` +
  `attributes:{url:"zeron://session/{chatId}"}`.
- ES256 APNs JWT from `APNS_TEAM_ID`/`APNS_KEY_ID`/`APNS_P8` (WebCrypto),
  cached ≤50min. Endpoint `api.push.apple.com`, or sandbox with
  `APNS_ENV=sandbox`. Topic `${APNS_BUNDLE_ID}.push-type.liveactivity`.

Env/secrets: `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_BUNDLE_ID`,
`APNS_P8` (PKCS8 PEM), `APNS_ENV` (`sandbox` optional). Everything is gated
on the secrets being set — without them the producer is inert and the
registry routes still answer.

## Deploy

```sh
cd <edge checkout>
git am <zremote>/patches/zeron-edge/0001-*.patch
wrangler secret put APNS_P8        # PKCS8 PEM
wrangler secret put APNS_KEY_ID
wrangler secret put APNS_TEAM_ID
# vars (wrangler.toml or dashboard): APNS_BUNDLE_ID, APNS_ENV, IOS_APP_IDS
npm run test:unit && wrangler deploy
```

## What works WITHOUT these patches

- Sign-in via paste-code (the in-app fallback) — everything except the
  HTTPS/universal-link callback.
- All sync: registry, chat2 rooms, device relay, attachments, queue.
- Live Activities still render locally while the app is foregrounded; only
  APNs-driven updates/start are missing.
