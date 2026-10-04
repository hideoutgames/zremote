import Foundation

/// Zeron's project tile identity. Colors depend on the project path, never its
/// position in a filtered list, display name, host, or session checkout.
/// Adapted from zeronsh/zeron at 9e1a1115; see THIRD_PARTY_NOTICES.md.
public struct ProjectMonogram: Equatable, Sendable {
    public let name: String
    public let letter: String
    public let colorIndex: Int

    public init(project: Project?) {
        name = project?.name ?? "Home"
        letter = String(name.trimmingCharacters(in: .whitespaces).first ?? "?").uppercased()
        let path = project?.path ?? "home"
        let hash = path.utf8.reduce(UInt32(2_166_136_261)) { ($0 ^ UInt32($1)) &* 16_777_619 }
        colorIndex = Int(hash % 8)
    }
}
