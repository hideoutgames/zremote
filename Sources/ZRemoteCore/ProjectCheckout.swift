import Foundation

/// A branch that already has a real checkout on the execution host.
/// Unchecked-out refs are not destinations: choosing one must not run git checkout.
public struct ProjectCheckout: Identifiable, Hashable, Codable, Sendable {
    public var id: String { path }
    public var branch: String
    public var path: String
    public var isCurrent: Bool
    public init(branch: String, path: String, isCurrent: Bool = false) {
        self.branch = branch; self.path = path; self.isCurrent = isCurrent
    }
}

public enum CheckoutSelection: Hashable, Codable, Sendable {
    case current
    case newWorktree
    case existing(ProjectCheckout)
}

/// Restore the host-validated destination, never an arbitrary local path.
public struct ComposerDestination: Codable, Equatable, Sendable {
    public var hostID = ""
    public var projectID: String?
    public var checkout: CheckoutSelection = .current
    public init() {}
}
