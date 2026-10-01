import Foundation

/// Keeps decoration out of every navigation surface, including tablet panels.
public enum PresentationRules {
    public static func showsBackground(enabled: Bool, hasSession: Bool, sessionsVisible: Bool, secondaryVisible: Bool) -> Bool {
        enabled && !hasSession && !sessionsVisible && !secondaryVisible
    }

    public static func visibleFileCount(_ count: Int) -> Int { min(max(0, count), 6) }

    /// Metadata is supplied by Zeron; the client neither discovers nor fetches PRs.
    public static func reviewURL(_ value: String) -> URL? {
        guard let url = URL(string: value), url.scheme?.lowercased() == "https",
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil else { return nil }
        return url
    }
}

public enum ModelCatalogRules {
    public static func filtered(_ models: [AgentModel], provider: String?, query: String, favorites: Set<String>, favoritesOnly: Bool, lockedProvider: String?) -> [AgentModel] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return models.filter { model in
            (lockedProvider == nil || model.providerID == lockedProvider) &&
            (provider == nil || model.providerID == provider) &&
            (!favoritesOnly || favorites.contains(model.id)) &&
            (needle.isEmpty || model.name.lowercased().contains(needle) || model.detail.lowercased().contains(needle))
        }.sorted { left, right in
            let l = rank(left, needle: needle, favorites: favorites)
            let r = rank(right, needle: needle, favorites: favorites)
            return l == r ? left.name.localizedStandardCompare(right.name) == .orderedAscending : l < r
        }
    }

    private static func rank(_ model: AgentModel, needle: String, favorites: Set<String>) -> Int {
        let match = needle.isEmpty ? 0 : model.name.lowercased().hasPrefix(needle) ? 0 : model.name.lowercased().contains(needle) ? 2 : 4
        return match + (favorites.contains(model.id) ? 0 : 1)
    }

    public static func selecting(_ model: AgentModel, previous: ModelSelection) -> ModelSelection {
        var options: [String: String] = [:]
        for option in model.options {
            if let old = previous.options[option.id], option.choices.contains(where: { $0.id == old }) {
                options[option.id] = old
            } else if let fallback = option.defaultChoice, option.choices.contains(where: { $0.id == fallback }) {
                options[option.id] = fallback
            }
        }
        let effort = previous.effort.flatMap { model.efforts.contains($0) ? $0 : nil }
        return ModelSelection(providerID: model.providerID, modelID: model.modelID, effort: effort, options: options)
    }
}
