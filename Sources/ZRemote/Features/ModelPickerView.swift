// Provider tabs, favorites, scoped search and retained-sheet selection adapted
// from hideoutgames/zeron ModelPicker.swift (d316f79c), copyright 2026 Wing.
// MIT license is included in Resources/Licenses/Zeron-MIT.txt.
import SwiftUI
import ZRemoteCore

struct ModelPickerView: View {
    @Bindable var model: AppModel
    @State private var provider = ""
    @State private var query = ""
    @State private var applying = false

    private let favoritesTab = "__favorites__"
    private var lockedProvider: String? {
        model.selectedSessionID == nil ? nil : (model.state?.selection.providerID ?? "")
    }
    private var providers: [AgentModel] {
        var seen: Set<String> = []
        return model.catalog.filter {
            (lockedProvider == nil || lockedProvider == $0.providerID) && seen.insert($0.providerID).inserted
        }
    }
    private var visibleModels: [AgentModel] {
        ModelCatalogRules.filtered(model.catalog, provider: provider == favoritesTab ? nil : provider,
                                   query: query, favorites: model.preferences.favorites,
                                   favoritesOnly: provider == favoritesTab, lockedProvider: lockedProvider)
    }

    var body: some View {
        VStack(spacing: 0) {
            tabs
            search
            if model.fetchingModels && model.catalog.isEmpty {
                ProgressView("Loading models…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if visibleModels.isEmpty {
                EmptyState(symbol: provider == favoritesTab ? "star" : "magnifyingglass",
                           title: provider == favoritesTab && query.isEmpty ? "No favorites yet" : "No models found",
                           detail: provider == favoritesTab && query.isEmpty
                               ? "Star a model to keep it close." : "Try another search or check that your host is online.")
            } else {
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(visibleModels) { choice in modelRow(choice) }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 20)
                }
            }
            if let choice = model.selectedModel, !choice.efforts.isEmpty || !choice.options.isEmpty {
                configuration(choice)
            }
        }
        .foregroundStyle(Palette.text)
        .background(Palette.background)
        .navigationTitle("Model")
        .task {
            if provider.isEmpty {
                let preferred = lockedProvider ?? model.selection.providerID
                provider = providers.contains(where: { $0.providerID == preferred }) ? preferred : (providers.first?.providerID ?? preferred)
            }
            if model.catalog.isEmpty && !model.fetchingModels { model.loadModels() }
        }
        .onChange(of: model.catalog) { _, _ in
            if provider != favoritesTab && !providers.contains(where: { $0.providerID == provider }) {
                provider = providers.first?.providerID ?? ""
            }
        }
    }

    private var tabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                tab("Favorites", id: favoritesTab, symbol: "star")
                ForEach(providers, id: \.providerID) { choice in
                    tab(choice.providerName, id: choice.providerID)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }

    private func tab(_ title: String, id: String, symbol: String? = nil) -> some View {
        Button { provider = id } label: {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol) }
                Text(title)
            }
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .foregroundStyle(provider == id ? Palette.text : Palette.secondary)
            .background(provider == id ? Palette.raised : Palette.surface, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(provider == id ? .isSelected : [])
    }

    private var search: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Palette.secondary).accessibilityHidden(true)
            TextField("Search models", text: $query)
                .font(.subheadline)
                .autocorrectionDisabled()
                .accessibilityLabel("Search models in selected tab")
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.secondary)
                }
                .accessibilityLabel("Clear model search")
            }
        }
        .padding(13)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }

    private func modelRow(_ choice: AgentModel) -> some View {
        let selected = model.selection.providerID == choice.providerID && model.selection.modelID == choice.modelID
        let favorite = model.preferences.favorites.contains(choice.id)
        return HStack(spacing: 8) {
            Button {
                apply(ModelCatalogRules.selecting(choice, previous: model.selection))
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selected ? Palette.text : Palette.secondary.opacity(0.5))
                        .font(.system(size: 19))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(choice.name).font(.body.weight(.medium)).foregroundStyle(Palette.text)
                        if !choice.detail.isEmpty {
                            Text(choice.detail).font(.caption).foregroundStyle(Palette.secondary)
                                .lineLimit(2)
                        }
                    }
                    Spacer(minLength: 4)
                }
                .frame(minHeight: 58)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(applying)
            .accessibilityAddTraits(selected ? .isSelected : [])
            Button { model.toggleFavorite(choice.id) } label: {
                Image(systemName: favorite ? "star.fill" : "star")
                    .foregroundStyle(favorite ? Palette.text : Palette.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(favorite ? "Remove" : "Add") \(choice.name) \(favorite ? "from" : "to") favorites")
        }
        .padding(.leading, 14)
        .padding(.trailing, 5)
        .padding(.vertical, 6)
        .background(selected ? Palette.surface : Color.clear, in: RoundedRectangle(cornerRadius: 16))
    }

    private func configuration(_ choice: AgentModel) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if !choice.efforts.isEmpty {
                optionRow("Reasoning", choices: [ModelChoice(id: "", label: "Default")] + choice.efforts.map {
                    ModelChoice(id: $0, label: $0.capitalized)
                }, selected: model.selection.effort ?? "") { value in
                    var selection = model.selection
                    selection.effort = value.isEmpty ? nil : value
                    apply(selection)
                }
            }
            ForEach(choice.options) { option in
                if !option.choices.isEmpty {
                    optionRow(option.label, choices: option.choices,
                              selected: model.selection.options[option.id] ?? option.defaultChoice ?? "") { value in
                        var selection = model.selection
                        selection.options[option.id] = value
                        apply(selection)
                    }
                }
            }
        }
        .padding(16)
        .background(Palette.surface)
        .disabled(applying)
    }

    private func optionRow(_ title: String, choices: [ModelChoice], selected: String,
                           action: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption.weight(.medium)).foregroundStyle(Palette.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(choices) { choice in
                        Button { action(choice.id) } label: {
                            Text(choice.label).font(.subheadline)
                                .padding(.horizontal, 12).padding(.vertical, 9)
                                .foregroundStyle(selected == choice.id ? Palette.background : Palette.text)
                                .background(selected == choice.id ? Palette.text : Palette.raised, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(title), \(choice.label)")
                        .accessibilityAddTraits(selected == choice.id ? .isSelected : [])
                    }
                }
            }
        }
    }

    private func apply(_ selection: ModelSelection) {
        guard !applying else { return }
        applying = true
        Task {
            await model.chooseModel(selection)
            applying = false
        }
    }
}
