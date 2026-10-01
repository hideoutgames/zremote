import Foundation

/// Presentation rules shared by the picker and the composer. Live choices are
/// always supplied by the host; an unavailable current pick is display-only.
public enum ModelPresentation {
    public struct Row: Identifiable, Equatable, Sendable {
        public var id: String { model.id }
        public let model: AgentModel
        public let unavailable: Bool
    }

    public static func resolvedModel(in catalog: [AgentModel], selection: ModelSelection) -> AgentModel? {
        catalog.first { $0.providerID == selection.providerID && (selection.modelID == nil || $0.modelID == selection.modelID) }
    }

    public static func displayName(_ name: String) -> String {
        // Keep GPT's version separator, while matching the reference's readable
        // model names in narrow composer controls.
        name.hasPrefix("GPT-") ? "GPT-" + name.dropFirst(4).replacingOccurrences(of: "-", with: " ") : name
    }

    public static func effectiveEffort(model: AgentModel, selection: ModelSelection) -> String? {
        if let effort = selection.effort, model.efforts.contains(effort) { return effort }
        if let effort = model.defaultEffort, model.efforts.contains(effort) { return effort }
        // Matches the pinned peer core's default_reasoning fallback.
        return ["high", "medium"].first(where: { model.efforts.contains($0) }) ?? model.efforts.first
    }

    public static func effortLabel(_ effort: String) -> String {
        switch effort {
        case "ultracode": "UltraCode"
        case "ultrathink": "UltraThink"
        default: effort.capitalized
        }
    }

    public static func composerLabel(model: AgentModel?, selection: ModelSelection) -> String {
        let resolved = model.flatMap {
            $0.providerID == selection.providerID && (selection.modelID == nil || $0.modelID == selection.modelID) ? $0 : nil
        }
        var parts = [displayName(resolved?.name ?? selection.modelID ?? "Choose model")]
        let effort = resolved.map { effectiveEffort(model: $0, selection: selection) } ?? selection.effort
        if let effort, !effort.isEmpty { parts.append(effortLabel(effort)) }
        if isFast(model: resolved, selection: selection) { parts.append("Fast") }
        return parts.joined(separator: " ")
    }

    public static func isFast(model: AgentModel?, selection: ModelSelection) -> Bool {
        ["serviceTier", "fastMode", "speed"].contains { id in
            let value: String?
            if let model {
                guard let option = model.options.first(where: { $0.id == id }) else { return false }
                let selected = selection.options[id]
                value = (option.choices.first(where: { $0.id == selected }) ??
                    option.choices.first(where: { $0.id == option.defaultChoice }))?.id
            } else {
                value = selection.options[id]
            }
            return value == "fast" || (id == "fastMode" && value == "on")
        }
    }

    public static func configuredInPlace(_ model: AgentModel) -> Bool {
        model.options.contains { $0.id == "lead" }
    }

    public static func rows(_ catalog: [AgentModel], provider: String?, query: String,
                            favorites: Set<String>, favoritesOnly: Bool,
                            selection: ModelSelection, lockedProvider: String?) -> [Row] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var seen: Set<String> = []
        let candidates = catalog.enumerated().filter { _, model in
            (lockedProvider == nil || model.providerID == lockedProvider) &&
            (provider == nil || model.providerID == provider) &&
            (!favoritesOnly || favorites.contains(model.id)) &&
            (needle.isEmpty || model.name.lowercased().contains(needle) || displayName(model.name).lowercased().contains(needle) || model.detail.lowercased().contains(needle)) &&
            seen.insert(model.id).inserted
        }
        let sorted = candidates.sorted { left, right in
            let leftRank = searchRank(left.element, needle: needle)
            let rightRank = searchRank(right.element, needle: needle)
            if leftRank != rightRank { return leftRank < rightRank }
            if !needle.isEmpty || !favoritesOnly {
                let leftStarred = favorites.contains(left.element.id)
                let rightStarred = favorites.contains(right.element.id)
                if leftStarred != rightStarred { return leftStarred }
            }
            return left.offset < right.offset
        }
        var rows = sorted.map { Row(model: $0.element, unavailable: false) }
        if !favoritesOnly, provider == selection.providerID,
           lockedProvider == nil || lockedProvider == selection.providerID,
           let modelID = selection.modelID,
           !catalog.contains(where: { $0.providerID == selection.providerID && $0.modelID == modelID }),
           needle.isEmpty || modelID.lowercased().contains(needle) {
            let name = catalog.first(where: { $0.providerID == selection.providerID })?.providerName ?? selection.providerID
            let current = AgentModel(providerID: selection.providerID, providerName: name, modelID: modelID, name: modelID)
            rows.insert(Row(model: current, unavailable: true), at: 0)
        }
        return rows
    }

    private static func searchRank(_ model: AgentModel, needle: String) -> Int {
        guard !needle.isEmpty else { return 0 }
        let name = displayName(model.name).lowercased()
        let wireLabel = model.name.lowercased()
        return name.hasPrefix(needle) || wireLabel.hasPrefix(needle) ? 0 :
            name.contains(needle) || wireLabel.contains(needle) ? 1 : 2
    }
}
