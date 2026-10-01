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

public struct UsageWarning: Equatable, Sendable {
    public var remainingFraction: Double
    public var percentRemaining: Int { Int((remainingFraction * 100).rounded()) }
}

public enum UsageLimitRules {
    /// Only an unambiguous active account can be attributed to this provider.
    /// Multiprovider harnesses must select the upstream model provider first.
    public static func remaining(accounts: [AgentAccount], selection: ModelSelection, now: Date = Date()) -> Double? {
        let active = accounts.filter { $0.active && $0.harness == selection.providerID }
        let modelProvider = selection.modelID?.split(separator: "/", maxSplits: 1).first.map(String.init)
        let candidates = active.filter { $0.provider == nil || $0.provider == modelProvider }
        guard candidates.count == 1, let fetched = candidates[0].usageFetchedAt,
              candidates[0].usageError == nil else { return nil }
        let age = now.timeIntervalSince1970 - Double(fetched) / 1000
        guard age >= -60, age <= 15 * 60 else { return nil }
        return candidates[0].remainingFraction
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
}
