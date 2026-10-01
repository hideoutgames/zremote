import Foundation

/// Remote paths belong to their host and must never be resolved on the phone.
public enum ProjectFolderRules {
    public static func project(at path: String, hostID: String, projects: [Project]) -> Project? {
        guard !path.isEmpty, !hostID.isEmpty else { return nil }
        let target = identity(path)
        return projects.first { $0.hostID == hostID && identity($0.path) == target }
    }

    public static func visible(_ folder: RemoteFolder) -> Bool {
        folder.name.lowercased() != ".git" && visiblePath(folder.path)
    }

    public static func visiblePath(_ path: String) -> Bool {
        !path.replacingOccurrences(of: "\\", with: "/").split(separator: "/").contains { $0.lowercased() == ".git" }
    }

    private static func identity(_ path: String) -> String {
        let characters = Array(path)
        let windowsDrive = characters.count >= 2 && characters[0].isLetter && characters[1] == ":"
        let windows = windowsDrive || path.hasPrefix("\\\\") || path.hasPrefix("//")
        var value = windows ? path.replacingOccurrences(of: "\\", with: "/").lowercased() : path
        let minimumLength = windowsDrive ? 3 : 1
        while value.count > minimumLength && value.hasSuffix("/") { value.removeLast() }
        return value
    }
}
