import Foundation

public enum AuthenticationCallback {
    /// Accept only the pending browser round trip. Never log the returned URL.
    public static func code(from url: URL, expectedState: String) throws -> String {
        guard url.scheme?.lowercased() == "zeron", url.host == "callback",
              url.path.isEmpty || url.path == "/", url.user == nil, url.password == nil,
              url.port == nil, url.fragment == nil,
              !expectedState.isEmpty,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else {
            throw ClientFailure("Invalid sign-in callback.")
        }
        let states = items.filter { $0.name == "state" }
        let codes = items.filter { $0.name == "code" }
        guard !items.contains(where: { $0.name == "error" }),
              states.count == 1, states[0].value == expectedState,
              codes.count == 1, let code = codes[0].value, !code.isEmpty else {
            throw ClientFailure("Sign-in did not match this browser session.")
        }
        return code
    }
}
