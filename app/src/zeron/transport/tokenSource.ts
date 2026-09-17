// Ported from zeron@853872d — bearer-token source abstraction
// (AppConfig.currentToken + AuthSession's TokenSource role). Dev mode
// (`AUTH_MODE=dev` edge): the bearer IS `user@org` — a fake org claim.

export interface TokenSource {
  /** The current bearer, or undefined when none is available right now
   * (expired + refresh in flight/failed ⇒ undefined, never throws). */
  currentToken(): Promise<string | undefined>;
  /** A socket/fetch was answered 401 — the stored token is invalid. */
  onAuthFailure?(): void;
}

/** Static bearer for dev edges (`token = `${userId}@${orgId}`). */
export const staticTokenSource = (token: string): TokenSource => ({
  currentToken: async () => token,
});
