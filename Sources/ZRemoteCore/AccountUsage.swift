import Foundation

public struct ConnectedDevice: Identifiable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var platform: String
    public var online: Bool
    public var isExecutionHost: Bool
    public var isCurrent: Bool
    public init(id: String, name: String, platform: String, online: Bool, isExecutionHost: Bool, isCurrent: Bool = false) {
        self.id = id; self.name = name; self.platform = platform; self.online = online
        self.isExecutionHost = isExecutionHost; self.isCurrent = isCurrent
    }
}

/// Host-reported plan quota. This is independent of a conversation's token context.
public struct AgentUsageWindow: Codable, Equatable, Sendable {
    public var label: String
    public var usedFraction: Double
    public var resetsAt: String?
    public init(label: String, usedFraction: Double, resetsAt: String? = nil) {
        self.label = label; self.usedFraction = usedFraction; self.resetsAt = resetsAt
    }
    public var remainingFraction: Double? {
        guard usedFraction.isFinite, (0...1).contains(usedFraction) else { return nil }
        return 1 - usedFraction
    }
}

public struct AgentAccount: Identifiable, Codable, Equatable, Sendable {
    public var id: String
    public var harness: String
    public var email: String?
    public var planLabel: String?
    public var active: Bool
    public var usageWindows: [AgentUsageWindow]
    public var usageFetchedAt: Int64?
    public var usageError: String?
    public var displayName: String?
    public var provider: String?
    public init(id: String, harness: String, email: String? = nil, planLabel: String? = nil, active: Bool = true,
                usageWindows: [AgentUsageWindow] = [], usageFetchedAt: Int64? = nil, usageError: String? = nil,
                displayName: String? = nil, provider: String? = nil) {
        self.id = id; self.harness = harness; self.email = email; self.planLabel = planLabel; self.active = active
        self.usageWindows = usageWindows; self.usageFetchedAt = usageFetchedAt; self.usageError = usageError
        self.displayName = displayName; self.provider = provider
    }
    public var remainingFraction: Double? { usageWindows.compactMap(\.remainingFraction).min() }
}

public struct AgentAccountWarning: Codable, Equatable, Sendable {
    public var harness: String
    public var message: String
}

public struct AgentAccountsSnapshot: Equatable, Sendable {
    public var available: Bool
    public var accounts: [AgentAccount]
    public var warnings: [AgentAccountWarning]
    public init(available: Bool = true, accounts: [AgentAccount] = [], warnings: [AgentAccountWarning] = []) {
        self.available = available; self.accounts = accounts; self.warnings = warnings
    }
}

/// Identity of the fresh observation that raised a retained warning. It stays
/// attached to the original session/provider when the composer moves elsewhere.
public struct UsageWarningSource: Codable, Equatable, Sendable {
    public var sessionID: String
    public var hostID: String
    public var providerID: String
    public var accountID: String
    public var upstreamProviderID: String?
    public var modelID: String?
    public var usageLabel: String?
    public var observedAt: Date
    public init(sessionID: String, hostID: String, providerID: String, accountID: String,
                upstreamProviderID: String? = nil, modelID: String? = nil, usageLabel: String? = nil, observedAt: Date) {
        self.sessionID = sessionID; self.hostID = hostID; self.providerID = providerID; self.accountID = accountID
        self.upstreamProviderID = upstreamProviderID; self.modelID = modelID; self.observedAt = observedAt
        self.usageLabel = usageLabel
    }
}

public struct UsageWarning: Codable, Equatable, Sendable {
    public var remainingFraction: Double
    public var source: UsageWarningSource?
    public var percentRemaining: Int { Int((remainingFraction * 100).rounded()) }
    public init(remainingFraction: Double, source: UsageWarningSource? = nil) {
        self.remainingFraction = remainingFraction; self.source = source
    }
}

public enum UsageLimitRules {
    public static func matches(_ source: UsageWarningSource, sessionID: String?, hostID: String, selection: ModelSelection) -> Bool {
        guard source.sessionID == sessionID, source.hostID == hostID, source.providerID == selection.providerID else { return false }
        if let upstream = source.upstreamProviderID {
            return selection.modelID?.split(separator: "/", maxSplits: 1).first.map(String.init) == upstream
        }
        return true
    }
    /// Only an unambiguous active account can be attributed to this provider.
    /// Multiprovider harnesses must select the upstream model provider first.
    public static func account(accounts: [AgentAccount], selection: ModelSelection, now: Date = Date()) -> AgentAccount? {
        let active = accounts.filter { $0.active && $0.harness == selection.providerID }
        let modelProvider = selection.modelID?.split(separator: "/", maxSplits: 1).first.map(String.init)
        let candidates = active.filter { $0.provider == nil || $0.provider == modelProvider }
        guard candidates.count == 1, !candidates[0].id.isEmpty, let fetched = candidates[0].usageFetchedAt,
              candidates[0].usageError == nil else { return nil }
        let age = now.timeIntervalSince1970 - Double(fetched) / 1000
        guard age >= -60, age <= 15 * 60 else { return nil }
        return candidates[0]
    }
    public static func remaining(accounts: [AgentAccount], selection: ModelSelection, now: Date = Date()) -> Double? {
        account(accounts: accounts, selection: selection, now: now)?.remainingFraction
    }
    public static func warning(remaining: Double?) -> UsageWarning? {
        guard let remaining, remaining.isFinite, remaining >= 0, remaining <= 0.100_000_1 else { return nil }
        return UsageWarning(remainingFraction: remaining)
    }
    public static func crossedThreshold(previous: Double?, remaining: Double?, working: Bool, alreadyNotified: Bool) -> Bool {
        guard working, !alreadyNotified, let previous, let remaining,
              previous.isFinite, remaining.isFinite, (0...1).contains(previous), (0...1).contains(remaining) else { return false }
        return previous >= 0.099_999_9 && remaining < 0.099_999_9
    }

    /// Restore retained observations without reviving dismissals or silently
    /// replacing an unresolved warning with another provider's quota.
    public static func mergeWarnings(_ restored: [UsageWarning], observations: [UsageWarning], dismissed: Set<String>) -> [UsageWarning] {
        var result: [UsageWarning] = []
        for notice in restored + observations {
            guard let source = notice.source, !source.sessionID.isEmpty, !source.hostID.isEmpty,
                  !source.providerID.isEmpty, !source.accountID.isEmpty,
                  !dismissed.contains(source.sessionID), warning(remaining: notice.remainingFraction) != nil else { continue }
            if let index = result.firstIndex(where: {
                $0.source?.sessionID == source.sessionID && $0.source?.hostID == source.hostID &&
                $0.source?.providerID == source.providerID && $0.source?.accountID == source.accountID &&
                $0.source?.upstreamProviderID == source.upstreamProviderID
            }) {
                guard let existing = result[index].source,
                      existing.hostID == source.hostID, existing.accountID == source.accountID,
                      existing.providerID == source.providerID, existing.upstreamProviderID == source.upstreamProviderID,
                      existing.observedAt <= source.observedAt else { continue }
                result[index] = notice
            } else { result.append(notice) }
        }
        return result
    }
}
