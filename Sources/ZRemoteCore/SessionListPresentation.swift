import Foundation

/// Account-local list choices. Search text remains transient.
public struct SessionListPreferences: Codable, Equatable, Sendable {
    public var sort: SessionSort = .recent
    public var grouping: SessionGrouping = .none
    public var shownProjectID: String?
    public var collapsedSections: Set<String> = []
    public var status: SessionStatusFilter = .all
    public var pullRequest: SessionPRFilter = .all
    public var archived: SessionArchiveFilter = .active
    public var created: SessionDateFilter = .any
    public var updated: SessionDateFilter = .any
    public var unreadOnly = false
    public var compact = true
    public init() {}
}

public enum SessionListPresentation {
    public static func sections(_ rows: [Session], projects: [Project], hosts: [Host],
                                grouping: SessionGrouping, projectID: String?, heldUnreadIDs: Set<String> = []) -> [SessionSection] {
        if let projectID {
            return [SessionSection(id: "selected-" + projectID, title: "", symbol: "", sessions: rows, showsHeader: false)]
        }
        switch grouping {
        case .none:
            return [SessionSection(id: "all", title: "", symbol: "", sessions: rows, showsHeader: false)]
        case .project:
            var sections = projects.map { project in
                SessionSection(id: "project-" + project.id, title: project.name, symbol: "folder",
                               sessions: rows.filter { $0.projectID == project.id }, collapsible: true)
            }
            let known = Set(projects.map(\.id))
            sections.append(SessionSection(id: "unassigned", title: "Other sessions", symbol: "bubble.left",
                sessions: rows.filter { $0.projectID.map { !known.contains($0) } ?? true }, collapsible: true))
            return byActivity(sections)
        case .host:
            var sections = hosts.map { host in
                SessionSection(id: host.id, title: host.name, symbol: "desktopcomputer", sessions: rows.filter { $0.hostID == host.id })
            }
            let known = Set(hosts.map(\.id))
            sections.append(SessionSection(id: "other-hosts", title: "Other hosts", symbol: "desktopcomputer", sessions: rows.filter { !known.contains($0.hostID) }))
            return byActivity(sections)
        case .status:
            return SessionStatusFilter.allCases.filter { $0 != .all }.map { status in
                SessionSection(id: status.id, title: status.rawValue, symbol: status.symbol, sessions: rows.filter { row in
                    // Hold only newly read, idle rows; new work/errors always win.
                    if heldUnreadIDs.contains(row.id), SessionPresentationRules.indicator(for: row) == .idle { return status == .unread }
                    return status.includes(row)
                }, collapsible: true)
            }.filter { !$0.sessions.isEmpty }
        }
    }

    private static func byActivity(_ sections: [SessionSection]) -> [SessionSection] {
        sections.filter { !$0.sessions.isEmpty }.sorted {
            let lhs = $0.sessions.map(\.updatedAt).max() ?? .distantPast
            let rhs = $1.sessions.map(\.updatedAt).max() ?? .distantPast
            return lhs == rhs ? $0.id < $1.id : lhs > rhs
        }
    }
}

public struct SessionSection: Identifiable, Sendable {
    public var id: String
    public var title: String
    public var symbol: String
    public var sessions: [Session]
    public var showsHeader = true
    public var collapsible = false
}
public enum SessionSort: String, CaseIterable, Identifiable, Codable, Sendable {
    case recent = "Recently updated", created = "Recently created", title = "Title"
    public var id: String { rawValue }
}
public enum SessionGrouping: String, CaseIterable, Identifiable, Codable, Sendable {
    case project = "Project", host = "Host", status = "Status", none = "None"
    public var id: String { rawValue }
}
public enum SessionStatusFilter: String, CaseIterable, Identifiable, Codable, Sendable {
    case all = "All statuses", working = "Working", awaitingInput = "Waiting for response"
    case unread = "Needs attention", failed = "Error", idle = "Finished"
    public var id: String { rawValue }
    public var symbol: String {
        switch self {
        case .all, .idle: return "circle"
        case .working: return "circle.dotted"
        case .awaitingInput: return "questionmark.bubble"
        case .unread: return "circle.fill"
        case .failed: return "exclamationmark.circle"
        }
    }
    public func includes(_ session: Session) -> Bool {
        guard self != .all else { return true }
        switch SessionPresentationRules.indicator(for: session) {
        case .working: return self == .working
        case .awaitingInput: return self == .awaitingInput
        case .unread: return self == .unread
        case .failed: return self == .failed
        case .idle: return self == .idle
        }
    }
}
public enum SessionArchiveFilter: String, CaseIterable, Identifiable, Codable, Sendable {
    case active = "Active", archived = "Archived", all = "All sessions"
    public var id: String { rawValue }
    public func includes(_ session: Session) -> Bool { self == .all || (self == .archived ? session.archived : !session.archived) }
}
public enum SessionPRFilter: String, CaseIterable, Identifiable, Codable, Sendable {
    case all = "Any", withPR = "With pull request", withoutPR = "Without pull request"
    case draft = "Draft", open = "Open", merged = "Merged", closed = "Closed"
    public var id: String { rawValue }
    public func includes(_ session: Session) -> Bool {
        switch self {
        case .all: return true
        case .withPR: return session.pullRequest != nil
        case .withoutPR: return session.pullRequest == nil
        case .draft, .open, .merged, .closed:
            return session.pullRequest.map { PullRequestPresentationState($0).rawValue == rawValue.lowercased() } ?? false
        }
    }
}
public enum SessionDateFilter: String, CaseIterable, Identifiable, Codable, Sendable {
    case any = "Any time", today = "Today", week = "Last 7 days", month = "Last 30 days"
    public var id: String { rawValue }
    public func includes(_ date: Date) -> Bool {
        guard self != .any else { return true }
        let days = self == .today ? 0 : self == .week ? 6 : 29
        let start = Calendar.current.startOfDay(for: Date())
        let lower = Calendar.current.date(byAdding: .day, value: -days, to: start) ?? start
        return date >= lower
    }
}
