import Foundation

public enum SessionIndicator: String, Sendable {
    case working, awaitingInput, failed, unread, idle

    public var accessibilityLabel: String {
        switch self {
        case .working: return "Agent working"
        case .awaitingInput: return "Waiting for response"
        case .failed: return "Error"
        case .unread: return "Finished, unread"
        case .idle: return "Read, not running"
        }
    }
}

public enum SessionPresentationRules {
    /// A project heading or an explicit project filter already supplies this
    /// context. Project-less sessions use the official client's Home tile.
    public static func projectMonogram(for session: Session, projects: [Project],
                                       groupedByProject: Bool, selectedProjectID: String?) -> ProjectMonogram? {
        guard !groupedByProject, selectedProjectID == nil else { return nil }
        return ProjectMonogram(project: projects.first { $0.id == session.projectID })
    }

    /// Host metadata is authoritative while present. Retain the latest observed
    /// PR when a branch change removes it from the workspace projection.
    public static func pullRequest(for session: Session, observed: [ObservedPullRequest]) -> PullRequest? {
        session.pullRequest ?? observed.last(where: { $0.sessionID == session.id })?.request
    }

    public static func indicator(for session: Session) -> SessionIndicator {
        if session.failed { return .failed }
        if session.awaitingInput { return .awaitingInput }
        if session.working { return .working }
        return session.unread ? .unread : .idle
    }

    /// Message previews and general update dates are not completion timestamps.
    public static func detail(for session: Session, now: Date = Date()) -> String? {
        if session.awaitingInput { return "Waiting for response" }
        if session.working {
            let activity = session.activity.trimmingCharacters(in: .whitespacesAndNewlines)
            return activity.isEmpty ? "Working" : activity
        }
        guard let finished = session.lastFinishedAt else { return nil }
        let seconds = max(0, now.timeIntervalSince(finished))
        if seconds < 60 { return "Just now" }
        if seconds < 3_600 { return elapsed(Int(seconds / 60), unit: "minute") }
        if seconds < 86_400 { return elapsed(Int(seconds / 3_600), unit: "hour") }
        return elapsed(Int(seconds / 86_400), unit: "day")
    }

    private static func elapsed(_ value: Int, unit: String) -> String {
        "\(value) \(unit)\(value == 1 ? "" : "s") ago"
    }
}

public enum PullRequestPresentationState: String, Sendable {
    case draft, open, merged, closed, unknown

    public init(_ request: PullRequest) {
        let state = request.state.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch state {
        case "merged": self = .merged
        case "closed": self = .closed
        case "draft": self = .draft
        case "open": self = request.isDraft ? .draft : .open
        default: self = request.isDraft ? .draft : .unknown
        }
    }

    public var label: String { self == .unknown ? "Pull request" : rawValue.capitalized }
}
