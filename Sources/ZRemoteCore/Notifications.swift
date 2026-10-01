import Foundation

public struct NotificationPreferences: Codable, Equatable, Sendable {
    public var enabled = false
    public var questions = true
    public var finished = true
    public var usageLimits = true
    public init() {}
}

public enum NotificationAuthorization: String, Sendable {
    case unavailable, notDetermined, denied, authorized
}

public enum SessionNotificationKind: String, Sendable { case question, finished, usageLimit }
public struct SessionNotification: Sendable, Equatable {
    public var id: String
    public var sessionID: String
    public var kind: SessionNotificationKind
    public init(id: String, sessionID: String, kind: SessionNotificationKind) {
        self.id = id; self.sessionID = sessionID; self.kind = kind
    }
}

/// TEMPORARY: mobile-only alerts for events received by the connected peer.
/// The OS may suspend the peer. Reliable background push requires an independent
/// service; this boundary deliberately does not register with Zeron's APNs relay.
@MainActor public protocol NotificationService: AnyObject {
    var onSession: (@MainActor (String) -> Void)? { get set }
    var supported: Bool { get }
    func authorization(request: Bool) async -> NotificationAuthorization
    func deliver(_ event: SessionNotification) async throws
    func stop()
}

@MainActor public final class UnavailableNotifications: NotificationService {
    public var onSession: (@MainActor (String) -> Void)?
    public let supported = false
    public init() {}
    public func authorization(request: Bool) async -> NotificationAuthorization { .unavailable }
    public func deliver(_ event: SessionNotification) async throws { throw ClientFailure("Notifications are unavailable on this device.") }
    public func stop() {}
}

/// Keeps an unopened session's input episode stable across registry heartbeats.
/// A host request ID replaces the temporary identity when its warm doc arrives.
public struct InputNotificationIdentity: Sendable {
    private var fallback: String?
    private var concreteRequest: String?
    public init() {}
    public mutating func resolve(awaitingInput: Bool, requestID: String?, updatedAtMs: Int64?) -> String? {
        guard awaitingInput else { fallback = nil; concreteRequest = nil; return nil }
        if fallback == nil, let updatedAtMs { fallback = "pending:" + String(updatedAtMs) }
        if let requestID { concreteRequest = requestID }
        return concreteRequest ?? fallback
    }
}
