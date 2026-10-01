import Foundation

public enum MessageSendMode: String, Sendable { case queue, steer }

public struct MessageQueueCapabilities: Equatable, Sendable {
    public var canQueue: Bool
    public var canQueueAttachments: Bool
    public var canSteer: Bool
    public var canEdit: Bool
    public var canAct: Bool
    public init(canQueue: Bool = false, canQueueAttachments: Bool = false, canSteer: Bool = false, canEdit: Bool = false, canAct: Bool = false) {
        self.canQueue = canQueue; self.canQueueAttachments = canQueueAttachments
        self.canSteer = canSteer; self.canEdit = canEdit; self.canAct = canAct
    }
}

public struct QueuedMessage: Identifiable, Equatable, Sendable {
    public var id: String
    public var text: String
    public var attachments: [String]
    public var holdForTurnEnd: Bool
    public var deliveryBlocked: Bool
    public var actionPending: Bool
    public init(id: String, text: String, attachments: [String] = [], holdForTurnEnd: Bool = true, deliveryBlocked: Bool = false, actionPending: Bool = false) {
        self.id = id; self.text = text; self.attachments = attachments
        self.holdForTurnEnd = holdForTurnEnd; self.deliveryBlocked = deliveryBlocked; self.actionPending = actionPending
    }
}

/// Host-issued edit identity. Text updates preserve the row's existing files.
public struct QueuedMessageEdit: Identifiable, Equatable, Sendable {
    public var id: String
    public var sessionID: String
    public var leaseID: String
    public var text: String
    public var baseTextHash: String
    public var expiresAtMilliseconds: Int64
    public var hasAttachments: Bool
    public init(id: String, sessionID: String, leaseID: String, text: String, baseTextHash: String, expiresAtMilliseconds: Int64, hasAttachments: Bool = false) {
        self.id = id; self.sessionID = sessionID; self.leaseID = leaseID; self.text = text
        self.baseTextHash = baseTextHash; self.expiresAtMilliseconds = expiresAtMilliseconds; self.hasAttachments = hasAttachments
    }
}
