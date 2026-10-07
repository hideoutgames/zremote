#if os(iOS)
import SwiftUI
import Speech
import ZRemoteCore

struct AudioInputSettings: View {
    @Bindable var model: AppModel
    @State var library = AudioModelLibrary.shared
    @State var details: AudioModelID?
    @Environment(\.accessibilityReduceMotion) var reduceMotion

    private var preferences: AudioInputPreferences { model.preferences.audioInput }
    private var motion: Animation? { reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.9) }
    private var locales: [String] {
        SFSpeechRecognizer.supportedLocales().map(\.identifier).sorted {
            language($0).localizedStandardCompare(language($1)) == .orderedAscending
        }
    }

    var body: some View {
        Section {
            Picker("Microphone", selection: Binding(get: { preferences.mode }, set: { mode in
                var next = preferences; next.mode = mode
                withAnimation(motion) { model.setAudioInput(next) }
            })) {
                Text("Dictation").tag(AudioInputMode.dictation)
                Text("Audio Model").tag(AudioInputMode.audioModel)
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("audio-input-mode")
            if preferences.mode == .dictation {
                Picker("Language", selection: Binding(get: { preferences.dictationLocale }, set: { locale in
                    var next = preferences; next.dictationLocale = locale; model.setAudioInput(next)
                })) {
                    Text("System").tag("")
                    ForEach(locales, id: \.self) { locale in Text(language(locale)).tag(locale) }
                }
                .pickerStyle(.menu)
                .id("dictation-language")
                .transition(.opacity)
            } else {
                ForEach(AudioModelID.allCases) { id in audioModel(id) }
            }
        }
        .listRowBackground(Palette.surface)
        .animation(motion, value: preferences.mode)
        .task { await library.refresh() }
        .sheet(item: $details) { id in
            NavigationStack {
                AudioModelDetails(id: id)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { details = nil } } }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            .presentationBackground(Palette.background)
        }
        .alert("Audio Model", isPresented: Binding(get: { library.error != nil }, set: { if !$0 { library.error = nil } })) {
            Button("OK", role: .cancel) { library.error = nil }
        } message: { Text(library.error ?? "") }
    }

    private func language(_ identifier: String) -> String { Locale.current.localizedString(forIdentifier: identifier) ?? identifier }

    private func select(_ id: AudioModelID) {
        let state = library.state(id)
        guard state.installed || (!library.busy && !model.isDemo) else { return }
        var next = preferences; next.model = id
        withAnimation(motion) { model.setAudioInput(next) }
        if !state.installed { library.install(id, isDemo: model.isDemo) }
    }

    private func audioModel(_ id: AudioModelID) -> some View {
        let state = library.state(id)
        let selected = state.installed && preferences.model == id
        return Button { select(id) } label: {
            HStack {
                Text(id.label).foregroundStyle(Palette.text)
                Spacer()
                if let progress = state.progress {
                    HStack(spacing: 6) {
                        Text("\(Int(progress * 100))%")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(Palette.secondary)
                        ZStack {
                            Circle().stroke(Palette.line, lineWidth: 2)
                            Circle().trim(from: 0, to: max(0.02, progress))
                                .stroke(Palette.secondary, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                                .rotationEffect(.degrees(-90))
                        }
                        .frame(width: 18, height: 18)
                        .animation(reduceMotion ? nil : .linear(duration: 0.2), value: progress)
                    }
                } else if state == .deleting {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: state.installed ? (selected ? "checkmark.circle.fill" : "checkmark.circle") : "arrow.down.circle")
                        .foregroundStyle(selected ? Palette.text : Palette.secondary)
                        .contentTransition(reduceMotion ? .identity : .symbolEffect(.replace))
                }
            }
            .frame(minHeight: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("audio-model-" + id.rawValue)
        .accessibilityValue(state.progress.map { "Downloading \(Int($0 * 100)) percent" } ?? (state.installed ? (selected ? "Selected" : "Installed") : "Not installed"))
        .accessibilityHint("Touch and hold for details and download options")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .nativeContextMenu {
            Button { details = id } label: { Label("Details", systemImage: "info.circle") }
            if state.progress != nil {
                Button(role: .destructive) {
                    library.cancel(id)
                    if model.preferences.audioInput.model == id {
                        var next = model.preferences.audioInput; next.mode = .dictation
                        withAnimation(motion) { model.setAudioInput(next) }
                    }
                } label: { Label("Cancel Download", systemImage: "xmark.circle") }
            } else if state.installed {
                Button(role: .destructive) {
                    let context = model.attachmentContext
                    Task {
                        if await library.delete(id, isDemo: model.isDemo), model.attachmentContext == context,
                           model.preferences.audioInput.model == id {
                            var next = model.preferences.audioInput; next.mode = .dictation
                            withAnimation(motion) { model.setAudioInput(next) }
                        }
                    }
                } label: { Label("Delete", systemImage: "trash") }
                .disabled(library.busy || model.isDemo)
            } else {
                Button { select(id) } label: { Label("Install", systemImage: "arrow.down.circle") }
                    .disabled(library.busy || model.isDemo)
            }
        }
        .transition(.opacity)
        .animation(motion, value: state.installed)
    }
}

struct AudioModelDetails: View {
    let id: AudioModelID
    private var manifest: AudioModelManifest? { AudioModelManifest.catalog.first { $0.id == id } }
    var body: some View {
        List {
            Section {
                Text(id.modelName).font(.headline)
                LabeledContent("Language", value: id.label)
                if let manifest { LabeledContent("Download", value: ByteCountFormatter.string(fromByteCount: manifest.bytes, countStyle: .file)) }
                Text("Transcribes on this device. Audio stays on your device and is deleted after transcription or cancellation.")
                    .font(.subheadline).foregroundStyle(Palette.secondary)
            }
            .listRowBackground(Palette.surface)
            if id == .multilingual {
                Section("Languages") {
                    Text("Bulgarian, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, German, Greek, Hungarian, Italian, Latvian, Lithuanian, Maltese, Polish, Portuguese, Romanian, Russian, Slovak, Slovenian, Spanish, Swedish, Ukrainian.")
                        .font(.subheadline).foregroundStyle(Palette.secondary)
                }.listRowBackground(Palette.surface)
            }
            Section {
                Text("NVIDIA Parakeet · Core ML conversion by Fluid Inference. 600 million parameters. CC BY 4.0. Licenses and attribution are in Acknowledgements.")
                    .font(.footnote).foregroundStyle(Palette.secondary)
            }.listRowBackground(Palette.surface)
        }
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .foregroundStyle(Palette.text)
        .navigationTitle("Audio Model")
        .navigationBarTitleDisplayMode(.inline)
    }
}
#endif
