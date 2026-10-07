#if os(iOS)
import Foundation
import Observation
import ZRemoteCore

enum AudioModelState: Equatable {
    case available, downloading(Double), installed, deleting
    var installed: Bool { self == .installed }
    var progress: Double? { if case .downloading(let value) = self { return value }; return nil }
}

@MainActor @Observable final class AudioModelLibrary {
    static let shared = AudioModelLibrary()
    private(set) var states: [AudioModelID: AudioModelState] = [:]
    private(set) var busy = false
    var error: String?
    @ObservationIgnored private var operation: Task<Void, Never>?
    @ObservationIgnored private var revision = 0

    func state(_ id: AudioModelID) -> AudioModelState { states[id] ?? .available }

    func refresh() async {
        let revision = revision
        for model in AudioModelManifest.catalog {
            let installed = await AudioModelAssets.shared.isInstalled(model)
            guard !Task.isCancelled else { return }
            if !busy, revision == self.revision { states[model.id] = installed ? .installed : .available }
        }
    }

    func install(_ id: AudioModelID, isDemo: Bool) {
        guard !isDemo, !busy, !state(id).installed else { return }
        guard let model = AudioModelManifest.catalog.first(where: { $0.id == id }) else {
            error = "Audio models aren't available in this build."
            return
        }
        revision += 1
        let operationRevision = revision
        busy = true
        states[id] = .downloading(0)
        error = nil
        operation = Task {
            defer { busy = false; operation = nil }
            do {
                try await AudioModelAssets.shared.install(model) { [weak self] value in
                    Task { @MainActor in
                        guard let self, self.revision == operationRevision, !Task.isCancelled,
                              let current = self.states[id]?.progress else { return }
                        self.states[id] = .downloading(max(current, value))
                    }
                }
                states[id] = .installed
            } catch {
                states[id] = .available
                if !Task.isCancelled {
                    self.error = "Couldn't install \(id.label). Check your connection and free storage, then try again."
                }
            }
        }
    }

    func cancel(_ id: AudioModelID) {
        guard state(id).progress != nil, let operation else { return }
        revision += 1
        operation.cancel()
        states[id] = .available
    }

    func delete(_ id: AudioModelID, isDemo: Bool) async -> Bool {
        guard !isDemo, !busy, let model = AudioModelManifest.catalog.first(where: { $0.id == id }) else { return false }
        revision += 1
        busy = true
        states[id] = .deleting
        defer { busy = false }
        do {
            try await AudioModelAssets.shared.delete(model)
            states[id] = .available
            return true
        } catch {
            states[id] = await AudioModelAssets.shared.isInstalled(model) ? .installed : .available
            self.error = "Couldn't delete \(id.label). Try again."
            return false
        }
    }
}
#endif
