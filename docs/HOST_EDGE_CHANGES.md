# Host/edge changes required by the iOS client

Patches live in `patches/zeron-edge/` (`*.patch` from
`git format-patch 853872d` on branch `zremote-edge-patches`, worktree
`../_ref/zeron-edge-patch`; full file copies under `files/` for
readability). Apply to a zeron edge deployment at revision 853872d
(v0.2.72). Unit tests: `cd edge && npm run test:unit` (live-activity + edge-patches
suites; workerd pool not run on Windows).

## 1. Apple App Site Association — `edge/src/apple-association.ts`

`GET /.well-known/apple-app-site-association` →
`{"applinks":{"details":[{"appIDs":[…],"components":[{"/":"/auth/cli/callback*"}]}]}}`.
Public (pre-bearer), `application/json`, 404 when `IOS_APP_IDS` is unset.
Required for the iOS sign-in universal link; without it HTTPS-callback
sign-in does not return into the app.

Env: `IOS_APP_IDS` — comma-separated `TEAMID.bundleid` entries.

## 2. PKCE exchange — `edge/src/auth-routes.ts` + `workos.ts`

`POST /auth/exchange` accepts an optional `codeVerifier` and forwards it to
WorkOS `user_management/authenticate` as `code_verifier`. Required for the
public-client PKCE flow on iOS (no client secret on the phone). Without it,
HTTPS-callback sign-in fails PKCE validation.

## 3. Live Activity push producer — `edge/src/registry-room.ts` +

`edge/src/live-activity.ts` + routes in `index.ts`

The per-user RegistryRoom DO gains:

- Table `live_activity_tokens(chat_id, token, kind, device, updated_at)` —
  scoped to the owning user's registry by construction. `kind` is
  `activity`, `push_to_start`, or `alert`.
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

## 4. Alert banners when a run finishes — same files as §3

The phone has no background socket, so finish banners cannot be local.
On the same `sessions` status-change path:

- `kind: "alert"` tokens (`chatId: "*"`) are native APNs device tokens
  registered by `expo-notifications` (`getDevicePushTokenAsync`). They
  are not ActivityKit tokens and cannot share the liveactivity topic.
- A flip `working`/`awaitingInput` → `idle`, or any flip to `errored`,
  sends `apns-push-type: alert` to every `alert` token on that user's
  registry. Topic is `${APNS_BUNDLE_ID}` (no `.push-type.liveactivity`
  suffix). Priority 10. Payload:

```json
{
  "aps": {
    "alert": { "title": "<chat title>", "body": "Run completed" },
    "sound": "default",
    "thread-id": "<chatId>"
  },
  "chatId": "<chatId>",
  "url": "zeron://session/<chatId>"
}
```

`errored` uses body `"Run failed"`. No prompt or message text.

- First-seen `idle` (no previous working/awaitingInput) does not notify.
- Same JWT, host, prune-on-`BadDeviceToken`/410 as Live Activities.
  Inert without `APNS_*`.

## 5. Question alerts when the agent needs input — same files as §3–4

Patch `0003`. On `working` → `awaitingInput` the edge sends `kind: "alert"`
APNs to the same token table as finish banners:

```json
{
  "aps": {
    "alert": { "title": "<chat title>", "body": "The agent needs your input" },
    "sound": "default",
    "thread-id": "<chatId>"
  },
  "chatId": "<chatId>",
  "url": "zeron://session/<chatId>"
}
```

No prompt or question text. The phone has no background socket, so
lock-screen question alerts cannot be local. While the app is active the
client still presents the flip via `shouldPresentBanner` (hides only when
that thread is selected). One Settings toggle covers finish **and**
questions. Helper: `isQuestionAlert` in `live-activity.ts`.

Env/secrets: `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_BUNDLE_ID`,
`APNS_P8` (PKCS8 PEM), `APNS_ENV` (`sandbox` optional). Everything is gated
on the secrets being set — without them the producer is inert and the
registry routes still answer.

## 5. iOS AuthKit callback hop — `edge/src/auth-routes.ts`

`GET /auth/cli/callback` still renders the paste-code page for desktop CLI
(`zeron login`). iPhone/iPad (and iPadOS desktop-class) user-agents, and
pending states the iOS app prefixes with `zr1.`, are **302**-redirected to
`zeron://auth/callback?code&state` so `ASWebAuthenticationSession` can
complete without pasting. Patch `0004` introduced the hop as an HTML
page; patch `0005` makes it an HTTP 302. Patch `0006` keeps the 302 and
puts the copy-code fallback back on the hop HTML so dismissing the sheet
still leaves a pasteable `state.code`. Desktop browsers without the
prefix are unchanged. If the hop is missing or the sheet is dismissed,
the app still offers an in-app paste field (`completePastedCode`) as
fallback.

## 6. iOS AuthKit hop copy-code — `edge/src/auth-routes.ts`

The 302 `Location: zeron://auth/callback?code&state` is unchanged. The
hop HTML body again includes `#paste` (`state.code`) and a Copy button,
matching the 0004 fallback when ASWebAuthenticationSession does not
intercept the custom-scheme redirect.

## Deploy

```sh
cd <edge checkout>
git am <zremote>/patches/zeron-edge/0001-*.patch
git am <zremote>/patches/zeron-edge/0002-*.patch
git am <zremote>/patches/zeron-edge/0003-*.patch
git am <zremote>/patches/zeron-edge/0004-*.patch
git am <zremote>/patches/zeron-edge/0005-*.patch
git am <zremote>/patches/zeron-edge/0006-*.patch
wrangler secret put APNS_P8        # PKCS8 PEM
wrangler secret put APNS_KEY_ID
wrangler secret put APNS_TEAM_ID
# vars (wrangler.toml or dashboard): APNS_BUNDLE_ID, APNS_ENV, IOS_APP_IDS
npm run test:unit && wrangler deploy
```

## What works WITHOUT these patches

- Without `0001`, PKCE exchange fails on every path (hop, HTTPS, or paste).
  Without `0004`/`0005`, iOS 17.0–17.3 / Safari fallback land on the
  Copy-code page; the in-app paste field is the fallback. iOS 17.4+
  intercepts the HTTPS WorkOS callback in-session without the hop.
- All sync: registry, chat2 rooms, device relay, attachments, queue.
- Live Activities still render locally while the app is foregrounded; only
  APNs-driven updates/start are missing.
- Finish-banner and question-alert pushes are missing (no `kind: "alert"`
  producer).
