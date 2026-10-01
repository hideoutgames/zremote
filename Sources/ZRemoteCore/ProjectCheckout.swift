import Foundation

/// A branch that already has a real checkout on the execution host.
/// Unchecked-out refs are not destinations: choosing one must not run git checkout.
public struct ProjectCheckout: Identifiable, Hashable, Sendable {
    public var id: String { path }
    public var branch: String
    public var path: String
    public var isCurrent: Bool
    public init(branch: String, path: String, isCurrent: Bool = false) {
        self.branch = branch; self.path = path; self.isCurrent = isCurrent
    }
}

public enum CheckoutSelection: Hashable, Sendable {
    case current
    case newWorktree
    case existing(ProjectCheckout)
}
