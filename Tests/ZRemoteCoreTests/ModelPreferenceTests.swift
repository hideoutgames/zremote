import Foundation
import XCTest
import ZRemoteCore

final class ModelPreferenceTests: XCTestCase {
    private func model(_ id: String, provider: String = "second") -> AgentModel {
        AgentModel(providerID: provider, providerName: provider, modelID: id, name: id,
                   efforts: ["medium", "high"], options: [
                    ModelOption(id: "speed", label: "Speed", choices: [
                        ModelChoice(id: "standard", label: "Standard"), ModelChoice(id: "fast", label: "Fast")
                    ], defaultChoice: "standard")
                   ], defaultEffort: "medium")
    }

    @MainActor
    func testModelsAndFavoritesKeepTheirOwnEffortOptionsAndExplicitDefaults() async {
        let app = AppModel(client: DemoClient(), makeLiveClient: { DemoClient() })
        let a = model("a"), b = model("b"), otherProvider = model("a", provider: "first")
        app.catalog = [otherProvider, a, b]
        app.toggleFavorite(a.id)
        var aSelection = app.selection(for: a)
        aSelection.effort = "high"
        aSelection.options["speed"] = "fast"
        await app.chooseModel(aSelection)
        let bDefault = app.selection(for: b)
        XCTAssertNil(bDefault.effort)
        XCTAssertEqual(bDefault.options["speed"], "standard")
        var bSelection = bDefault
        bSelection.effort = "medium"
        await app.chooseModel(bSelection)
        XCTAssertEqual(app.selection(for: a), aSelection)
        XCTAssertNil(app.selection(for: otherProvider).effort)
        XCTAssertEqual(app.selection(for: otherProvider).options["speed"], "standard")
        await app.chooseModel(app.selection(for: a))
        aSelection.effort = nil
        aSelection.options["speed"] = "standard"
        await app.chooseModel(aSelection)
        await app.chooseModel(app.selection(for: b))
        app.toggleFavorite(a.id)
        app.toggleFavorite(a.id)
        XCTAssertEqual(app.selection(for: a), aSelection, "Starring never replaces a model's saved configuration")
        XCTAssertEqual(app.selection(for: b), bSelection)
        app.newSession()
        XCTAssertEqual(app.newSelection, bSelection)
    }

    func testNewSessionKeepsProviderWhenSavedModelDisappearsAndRevalidatesOptions() {
        let first = model("first", provider: "first"), replacement = model("replacement")
        let saved = ModelSelection(providerID: "second", modelID: "retired", effort: "high", options: ["speed": "fast"])
        var replacementSettings = ModelSelection(providerID: "second", modelID: "replacement", effort: "retired",
                                                options: ["speed": "removed", "unsupported": "on"])
        let selection = ModelCatalogRules.newSessionSelection(in: [first, replacement], preferred: saved,
            remembered: [replacement.id: replacementSettings])
        XCTAssertEqual(selection.providerID, "second")
        XCTAssertEqual(selection.modelID, "replacement")
        XCTAssertNil(selection.effort)
        XCTAssertEqual(selection.options, ["speed": "standard"])
        replacementSettings.effort = "medium"
        replacementSettings.options = ["speed": "fast"]
        XCTAssertEqual(ModelCatalogRules.newSessionSelection(in: [first, replacement], preferred: saved,
            remembered: [replacement.id: replacementSettings]), replacementSettings)
        let unavailable = ModelCatalogRules.newSessionSelection(in: [], preferred: saved, remembered: [:])
        XCTAssertEqual(unavailable.providerID, saved.providerID)
        XCTAssertNil(unavailable.modelID, "An empty catalog cannot enable sending with an unavailable model")
        XCTAssertEqual(ModelCatalogRules.newSessionSelection(in: [first], preferred: saved, remembered: [:]).providerID, "first")
    }

    func testCompatibleOptionsNeverTransferBetweenModelsOrProviders() {
        let target = model("same")
        for previous in [ModelSelection(providerID: "second", modelID: "different", effort: "high", options: ["speed": "fast"]),
                         ModelSelection(providerID: "first", modelID: "same", effort: "high", options: ["speed": "fast"])] {
            let selection = ModelCatalogRules.selecting(target, previous: previous)
            XCTAssertNil(selection.effort)
            XCTAssertEqual(selection.options, ["speed": "standard"])
        }
    }

    func testModelPreferencesRoundTripStayAccountScopedAndMigrateOlderFiles() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let a = model("a")
        let selection = ModelSelection(providerID: a.providerID, modelID: a.modelID, effort: "high", options: ["speed": "fast"])
        var preferences = LocalPreferences()
        preferences.favorites = [a.id]
        preferences.modelSelections[a.id] = selection
        preferences.lastModelSelection = selection
        try await LocalStateStore(accountKey: "one", root: root).save(preferences)
        let restored = try await LocalStateStore(accountKey: "one", root: root).load()
        let other = try await LocalStateStore(accountKey: "two", root: root).load()
        XCTAssertEqual(restored.modelSelections[a.id], selection)
        XCTAssertEqual(restored.lastModelSelection, selection)
        XCTAssertEqual(restored.favorites, [a.id])
        XCTAssertTrue(other.modelSelections.isEmpty)
        XCTAssertNil(other.lastModelSelection)
        let legacy = try JSONDecoder().decode(LocalPreferences.self, from: Data("{\"favorites\":[\"old\"]}".utf8))
        XCTAssertEqual(legacy.favorites, ["old"])
        XCTAssertTrue(legacy.modelSelections.isEmpty)
        XCTAssertNil(legacy.lastModelSelection)
    }
}
