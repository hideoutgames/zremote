// Adapted from hideoutgames/zeron's native ModelPicker and ModelCatalog,
// copyright 2026 Wing. MIT license: Resources/Licenses/Zeron-MIT.txt.
import SwiftUI
import ZRemoteCore

struct ModelPickerView: View {
    @Bindable var model: AppModel
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @Environment(\.colorScheme) var colorScheme
    #if os(iOS)
    @Environment(\.sizeCategory) var sizeCategory
    #endif
    @Environment(\.layoutDirection) var layoutDirection
    @State var provider = ""
    @State var query = ""
    @State var applying = false
    @State var configurationModel: AgentModel?
    @FocusState var searchFocused: Bool
    @ScaledMetric(relativeTo: .body) var rowHeight = 44.0

    private let favoritesTab = "__favorites__"
    private var motion: Animation? { reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.88) }
    private var tabIndex: Int { ([favoritesTab] + providers.map(\.providerID)).firstIndex(of: provider) ?? 0 }
    private var edgePadding: CGFloat { model.usesSessionPanel ? 0 : 20 }
    private var lockedProvider: String? {
        model.selectedSessionID == nil ? nil : (model.state?.selection.providerID ?? "")
    }
    private var selectedModel: AgentModel? {
        ModelPresentation.resolvedModel(in: model.catalog, selection: model.selection)
    }
    private var providers: [AgentModel] {
        var seen: Set<String> = []
        var values = model.catalog.filter {
            (lockedProvider == nil || lockedProvider == $0.providerID) && seen.insert($0.providerID).inserted
        }
        let selection = model.selection
        if !selection.providerID.isEmpty && !seen.contains(selection.providerID), selection.modelID != nil {
            values.insert(AgentModel(providerID: selection.providerID, providerName: selection.providerID,
                                     modelID: selection.modelID ?? "", name: selection.modelID ?? ""), at: 0)
        }
        return values
    }
    private var visibleModels: [ModelPresentation.Row] {
        ModelPresentation.rows(model.catalog, provider: provider == favoritesTab ? nil : provider,
                               query: query, favorites: model.preferences.favorites,
                               favoritesOnly: provider == favoritesTab, selection: model.selection,
                               lockedProvider: lockedProvider)
    }

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                tabs
                    #if os(iOS)
                    .padding(.top, edgePadding)
                    #endif
                rule
                search
                rule
                modelList
                if let choice = selectedModel, !ModelPresentation.configuredInPlace(choice),
                   !choice.efforts.isEmpty || !choice.options.isEmpty {
                    rule
                    ScrollView {
                        configuration(choice)
                            .padding(.vertical, 6)
                    }
                    #if os(iOS)
                    .contentMargins(.vertical, 0, for: .scrollContent)
                    #endif
                    .frame(height: min(trayHeight(choice), max(rowHeight, geometry.size.height * 0.4)))
                }
            }
            .animation(motion, value: selectedModel?.id)
            #if os(iOS)
            .padding(.bottom, edgePadding)
            #endif
        }
        #if os(iOS)
        .ignoresSafeArea(.container, edges: .bottom)
        #endif
        .foregroundStyle(Palette.text)
        .background(Palette.background)
        #if os(iOS)
        .sensoryFeedback(.selection, trigger: model.selection) { _, _ in model.preferences.hapticsEnabled }
        #endif
        .navigationTitle("Model")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(model.usesSessionPanel ? .visible : .hidden, for: .navigationBar)
        #endif
        .task {
            if provider.isEmpty {
                let preferred = lockedProvider ?? model.selection.providerID
                if lockedProvider == nil, !model.preferences.favorites.isEmpty {
                    provider = favoritesTab
                } else {
                    provider = providers.contains(where: { $0.providerID == preferred }) ? preferred : (providers.first?.providerID ?? preferred)
                }
            }
            if model.catalog.isEmpty && !model.fetchingModels { model.loadModels() }
        }
        .onChange(of: model.catalog) { _, _ in
            if provider != favoritesTab && !providers.contains(where: { $0.providerID == provider }) {
                let preferred = lockedProvider ?? model.selection.providerID
                provider = providers.contains(where: { $0.providerID == preferred }) ? preferred : (providers.first?.providerID ?? preferred)
            }
            if let current = configurationModel {
                configurationModel = model.catalog.first { $0.id == current.id }
            }
        }
        .onChange(of: model.selection.providerID) { _, value in
            if lockedProvider != nil { provider = value }
            if configurationModel?.providerID != value { configurationModel = nil }
        }
        .onChange(of: model.selection.modelID) { _, value in
            if configurationModel?.modelID != value { configurationModel = nil }
        }
        #if os(Android)
        .accessibilityHidden(configurationModel != nil)
        .overlay {
            if let choice = configurationModel {
                ZStack {
                    Color.black.opacity(0.5).ignoresSafeArea()
                        .onTapGesture { configurationModel = nil }
                    configurationCard(choice)
                        .frame(maxWidth: 340)
                        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 22))
                        .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Palette.line))
                        .padding(16)
                        .accessibilityAddTraits(.isModal)
                    ModalBackHandler { configurationModel = nil }
                }
            }
        }
        #endif
    }

    private func configurationPresented(_ choice: AgentModel) -> Binding<Bool> {
        Binding(get: {
            configurationModel?.id == choice.id
        }, set: { visible in
            if !visible, configurationModel?.id == choice.id {
                configurationModel = nil
            }
        })
    }

    private func configurationCard(_ choice: AgentModel) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 9) {
                ProviderIcon(providerID: choice.providerID)
                Text(ModelPresentation.displayName(choice.name)).font(.headline)
                Spacer(minLength: 8)
                Button { configurationModel = nil } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close model options")
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .fixedSize(horizontal: false, vertical: true)
            .layoutPriority(1)
            rule
            ScrollView {
                configuration(choice).padding(.vertical, 6)
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(minHeight: 0, idealHeight: trayHeight(choice), maxHeight: trayHeight(choice))
        }
        .foregroundStyle(Palette.text)
    }

    private var rule: some View { Rectangle().fill(Palette.line).frame(height: 0.5) }

    private var tabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                tab("Favorites", id: favoritesTab)
                ForEach(providers, id: \.providerID) { choice in
                    tab(choice.providerName, id: choice.providerID)
                }
            }
            .overlay(alignment: .bottomLeading) {
                Capsule().fill(Palette.text).frame(width: 22, height: 2)
                    .offset(x: (11 + CGFloat(tabIndex) * 44) * (layoutDirection == .rightToLeft ? -1 : 1))
                    .animation(motion, value: provider)
                    .allowsHitTesting(false)
            }
            .padding(.horizontal, 6)
        }
    }

    private func tab(_ title: String, id: String) -> some View {
        Button {
            withAnimation(motion) { provider = id }
        } label: {
            VStack(spacing: 0) {
                Group {
                    if id == favoritesTab {
                        Image(systemName: "star.fill").font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(provider == id ? Palette.text : Palette.secondary)
                    } else {
                        ProviderIcon(providerID: id, muted: provider != id)
                    }
                }
                .frame(width: 44, height: 42)
                Color.clear.frame(width: 22, height: 2)
            }
            .contentShape(Rectangle())
        }
        .modelPickerPressFeedback()
        .accessibilityLabel(title)
        .accessibilityAddTraits(provider == id ? .isSelected : [])
        .accessibilityIdentifier("model-tab-" + (id == favoritesTab ? "favorites" : id))
    }

    private var search: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .medium))
                .foregroundStyle(Palette.secondary).accessibilityHidden(true)
            TextField("Search models…", text: $query)
                .font(.subheadline)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .focused($searchFocused)
                .onSubmit { searchFocused = false }
                .accessibilityLabel("Search models in selected tab")
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.secondary)
                        .frame(width: 32, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear model search")
            }
        }
        .padding(.horizontal, 18)
        .frame(minHeight: 44)
    }

    private var modelList: some View {
        Group {
            if model.fetchingModels && model.catalog.isEmpty {
                ProgressView("Loading models…").frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if visibleModels.isEmpty {
                Text(provider == favoritesTab && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                     ? "No starred models yet — tap a row’s star" : "No models found")
                    .font(.subheadline).foregroundStyle(Palette.secondary)
                    .multilineTextAlignment(.center).padding(20)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { scroll in
                    ScrollView {
                        LazyVStack(spacing: 2) {
                            ForEach(visibleModels) { row in modelRow(row).id(row.id) }
                        }
                        .padding(.horizontal, 6)
                        .padding(.vertical, 4)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: provider) { _, _ in
                        if let selected = selectedModel, visibleModels.contains(where: { $0.id == selected.id }) {
                            scroll.scrollTo(selected.id, anchor: .center)
                        } else if let first = visibleModels.first {
                            scroll.scrollTo(first.id, anchor: .top)
                        }
                    }
                    .onChange(of: query) { _, _ in
                        if let first = visibleModels.first { scroll.scrollTo(first.id, anchor: .top) }
                    }
                }
            }
        }
    }

    private func modelRow(_ row: ModelPresentation.Row) -> some View {
        let choice = row.model
        let selected = model.selection.providerID == choice.providerID &&
            (model.selection.modelID == choice.modelID || selectedModel?.id == choice.id)
        let favorite = model.preferences.favorites.contains(choice.id)
        let configurable = ModelPresentation.configuredInPlace(choice)
        return HStack(spacing: 0) {
            Button {
                apply(model.selection(for: choice), configure: configurable ? choice : nil)
            } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(ModelPresentation.displayName(choice.name))
                            .font(.subheadline.weight(.medium)).lineLimit(1)
                        if provider == favoritesTab {
                            HStack(spacing: 5) {
                                ProviderIcon(providerID: choice.providerID, size: 12, muted: true)
                                Text(choice.providerName).font(.caption)
                            }
                            .foregroundStyle(Palette.secondary)
                        } else if row.unavailable {
                            Text("Current model · unavailable on host").font(.caption).foregroundStyle(Palette.secondary)
                        }
                    }
                    Spacer(minLength: 2)
                    if configurable {
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Palette.secondary)
                    }
                }
                .frame(minHeight: provider == favoritesTab || row.unavailable ? rowHeight + 10 : rowHeight)
                .padding(.leading, 12)
                .contentShape(Rectangle())
            }
            .modelPickerPressFeedback()
            .disabled(applying || row.unavailable)
            .accessibilityAddTraits(selected ? .isSelected : [])
            .accessibilityHint(configurable ? "Shows model settings" : "")
            #if os(iOS)
            .background {
                AnchoredModelPopover(isPresented: configurationPresented(choice), height: trayHeight(choice) + 56) {
                    configurationCard(choice)
                        .environment(\.colorScheme, colorScheme)
                        .environment(\.sizeCategory, sizeCategory)
                }
            }
            #elseif !os(Android)
            .popover(isPresented: configurationPresented(choice), attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) {
                configurationCard(choice)
                    .frame(width: 320)
                    .presentationCompactAdaptation(.popover)
            }
            #endif
            if !row.unavailable {
                Button { withAnimation(motion) { model.toggleFavorite(choice.id) } } label: {
                    Image(systemName: favorite ? "star.fill" : "star")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(favorite ? Color.orange : Palette.secondary.opacity(0.8))
                        #if os(iOS)
                        .symbolEffect(.bounce, value: !reduceMotion && favorite)
                        #endif
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .modelPickerPressFeedback()
                .accessibilityLabel("\(favorite ? "Remove" : "Add") \(choice.name) \(favorite ? "from" : "to") favorites")
            } else {
                Image(systemName: "checkmark").font(.caption.weight(.semibold)).frame(width: 44)
            }
        }
        .background(selected ? Palette.surface : .clear, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? Palette.line : .clear, lineWidth: 1))
        .animation(motion, value: selected)
        .transition(.opacity)
    }

    private func trayHeight(_ choice: AgentModel) -> CGFloat {
        CGFloat((choice.efforts.isEmpty ? 0 : 1) + choice.options.filter { !$0.choices.isEmpty }.count) * rowHeight + 12
    }

    private func configuration(_ choice: AgentModel) -> some View {
        VStack(spacing: 0) {
            if let lead = choice.options.first(where: { $0.id == "lead" }) { option(lead, model: choice) }
            if !choice.efforts.isEmpty {
                choiceMenu("Effort", choices: [ModelChoice(id: "", label: "Default")] + choice.efforts.map {
                    ModelChoice(id: $0, label: ModelPresentation.effortLabel($0))
                }, selected: model.selection.effort ?? "",
                value: ModelPresentation.effectiveEffort(model: choice, selection: model.selection).map(ModelPresentation.effortLabel) ?? "Default") { value in
                    var selection = model.selection(for: choice)
                    selection.effort = value.isEmpty ? nil : value
                    apply(selection)
                }
            }
            ForEach(choice.options.filter { $0.id != "lead" && !$0.choices.isEmpty }) { option in
                self.option(option, model: choice)
            }
        }
        .disabled(applying)
    }

    @ViewBuilder
    private func option(_ option: ModelOption, model choice: AgentModel) -> some View {
        let selected = option.choices.first(where: { $0.id == model.selection.options[option.id] })?.id ?? option.defaultChoice ?? ""
        if ModelPresentation.configuredInPlace(choice), option.id != "lead", option.id != "sidekick",
           option.choices.count == 2, let defaultChoice = option.defaultChoice,
           option.choices.contains(where: { $0.id == defaultChoice }) {
            Toggle(option.label, isOn: Binding(get: { selected != defaultChoice }, set: { enabled in
                let value = enabled ? option.choices.first(where: { $0.id != defaultChoice })?.id : nil
                var selection = model.selection(for: choice)
                selection.options[option.id] = value
                apply(selection)
            }))
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 18)
            .frame(minHeight: rowHeight)
            .appSwitch()
        } else {
            choiceMenu(option.label, choices: option.choices, selected: selected,
                       value: option.choices.first(where: { $0.id == selected })?.label ?? "Default") { value in
                var selection = model.selection(for: choice)
                selection.options[option.id] = value == option.defaultChoice ? nil : value
                apply(selection)
            }
        }
    }

    private func choiceMenu(_ title: String, choices: [ModelChoice], selected: String, value: String,
                            action: @escaping (String) -> Void) -> some View {
        HStack(spacing: 8) {
            Text(title)
                .fontWeight(.medium)
                .accessibilityHidden(true)
            Spacer(minLength: 12)
            Menu {
                ForEach(choices) { choice in
                    Button { action(choice.id) } label: {
                        if selected == choice.id { Label(choice.label, systemImage: "checkmark") }
                        else { Text(choice.label) }
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Text(value).foregroundStyle(Palette.secondary).lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Palette.secondary)
                }
                .frame(minHeight: rowHeight)
                .contentShape(Rectangle())
            }
            .accessibilityLabel(title)
            .accessibilityValue(value)
        }
        .font(.subheadline)
        .padding(.horizontal, 18)
        .frame(minHeight: rowHeight)
    }

    private func apply(_ selection: ModelSelection, configure choice: AgentModel? = nil) {
        guard !applying else { return }
        applying = true
        Task {
            let applied = await model.chooseModel(selection)
            applying = false
            if applied, let choice, model.selection.providerID == choice.providerID,
               model.selection.modelID == choice.modelID {
                withAnimation(motion) { configurationModel = choice }
            }
        }
    }
}

extension View {
    @ViewBuilder func modelPickerPressFeedback() -> some View {
        #if os(iOS)
        buttonStyle(ModelPickerPressStyle())
        #else
        buttonStyle(.plain)
        #endif
    }
}

#if os(iOS)
struct ModelPickerPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.7 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(reduceMotion ? nil : .spring(response: 0.24, dampingFraction: 0.85), value: configuration.isPressed)
    }
}
#endif
