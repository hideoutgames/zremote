import Foundation
import XCTest
import ZRemoteCore

final class ModelPresentationTests: XCTestCase {
    func testComposerShowsProviderReportedDefaultAndExplicitEffortWithFastMode() {
        let model = AgentModel(providerID: "codex", providerName: "Codex", modelID: "astra", name: "GPT-6-Astra",
                               efforts: ["medium", "high", "xhigh"], options: [
            ModelOption(id: "serviceTier", label: "Service Tier", choices: [
                ModelChoice(id: "default", label: "Standard"), ModelChoice(id: "fast", label: "Fast")
            ], defaultChoice: "default")
        ], defaultEffort: "medium")
        var selection = ModelSelection(providerID: "codex", modelID: "astra")
        XCTAssertEqual(ModelPresentation.composerLabel(model: model, selection: selection), "GPT-6 Astra Medium")
        selection.effort = "xhigh"
        selection.options["serviceTier"] = "fast"
        XCTAssertEqual(ModelPresentation.composerLabel(model: model, selection: selection), "GPT-6 Astra Xhigh Fast")
        selection.effort = "retired-effort"
        selection.options["serviceTier"] = "retired-tier"
        XCTAssertEqual(ModelPresentation.composerLabel(model: model, selection: selection), "GPT-6 Astra Medium")
    }

    func testComposerDoesNotBorrowAnotherModelAndUnderstandsOtherAdvertisedFastControls() {
        let claude = AgentModel(providerID: "claude-code", providerName: "Claude Code", modelID: "opus", name: "Opus",
                                options: [ModelOption(id: "fastMode", label: "Fast Mode", choices: [
                                    ModelChoice(id: "off", label: "Off"), ModelChoice(id: "on", label: "On")
                                ], defaultChoice: "off")])
        let selection = ModelSelection(providerID: "claude-code", modelID: "opus", options: ["fastMode": "on"])
        XCTAssertEqual(ModelPresentation.composerLabel(model: claude, selection: selection), "Opus Fast")
        let otherSelection = ModelSelection(providerID: "codex", modelID: "unlisted", effort: "high")
        XCTAssertEqual(ModelPresentation.composerLabel(model: claude, selection: otherSelection), "unlisted High")
        XCTAssertNil(ModelPresentation.resolvedModel(in: [claude], selection: otherSelection))
        XCTAssertEqual(ModelPresentation.resolvedModel(in: [claude], selection: .init(providerID: "claude-code")), claude)
    }

    func testPickerPreservesCatalogOrderScopesSearchAndRanksExactNamesBeforeStarredDescriptionMatches() {
        let flagship = AgentModel(providerID: "codex", providerName: "Codex", modelID: "new", name: "Zeta")
        let older = AgentModel(providerID: "codex", providerName: "Codex", modelID: "old", name: "Alpha", detail: "Zeta predecessor")
        let other = AgentModel(providerID: "other", providerName: "Other", modelID: "new", name: "Zeta")
        let catalog = [flagship, older, other, flagship]
        let selection = ModelSelection(providerID: "codex", modelID: "new")
        let rows = ModelPresentation.rows(catalog, provider: "codex", query: "", favorites: [],
                                          favoritesOnly: false, selection: selection, lockedProvider: nil)
        XCTAssertEqual(rows.map(\.id), [flagship.id, older.id])
        let search = ModelPresentation.rows(catalog, provider: "codex", query: " zeta ", favorites: [older.id],
                                            favoritesOnly: false, selection: selection, lockedProvider: nil)
        XCTAssertEqual(search.map(\.id), [flagship.id, older.id])
        let favorites = ModelPresentation.rows(catalog, provider: nil, query: "", favorites: [older.id, other.id],
                                               favoritesOnly: true, selection: selection, lockedProvider: "codex")
        XCTAssertEqual(favorites.map(\.id), [older.id])
    }

    func testUnavailableCurrentModelIsVisibleReadOnlyAndNeverInventedInOtherTabs() throws {
        let listed = AgentModel(providerID: "codex", providerName: "Codex", modelID: "new", name: "New")
        let selection = ModelSelection(providerID: "codex", modelID: "retired")
        let rows = ModelPresentation.rows([listed], provider: "codex", query: "", favorites: [],
                                          favoritesOnly: false, selection: selection, lockedProvider: "codex")
        let current = try XCTUnwrap(rows.first)
        XCTAssertEqual(current.model.modelID, "retired")
        XCTAssertTrue(current.unavailable)
        XCTAssertFalse(rows[1].unavailable)
        XCTAssertTrue(ModelPresentation.rows([listed], provider: "other", query: "", favorites: [],
                                             favoritesOnly: false, selection: selection, lockedProvider: nil).isEmpty)
        XCTAssertTrue(ModelPresentation.rows([listed], provider: nil, query: "", favorites: [current.id],
                                             favoritesOnly: true, selection: selection, lockedProvider: nil).isEmpty)
    }

    @MainActor
    func testDemoFusionUsesSharedSelectionInterfaceAndRetainsPairAndSpeedChoices() async throws {
        let client = DemoClient(intervalNanoseconds: 0)
        try await client.restore()
        let catalog = try await client.models(hostID: "demo-mac")
        XCTAssertEqual(Set(catalog.map(\.providerID)), ["codex", "claude-code", "devin"])
        let fusion = try XCTUnwrap(catalog.first { $0.providerID == "devin" && $0.modelID == "fusion" })
        XCTAssertTrue(ModelPresentation.configuredInPlace(fusion))
        var selection = ModelCatalogRules.selecting(fusion, previous: ModelSelection())
        let sessionID = try await client.createSession(projectID: "demo-project", hostID: "demo-mac", selection: selection)
        var received: ModelSelection?
        client.onUpdate = { update in
            if case .session(let state) = update, state.id == sessionID { received = state.selection }
        }
        selection.effort = "xhigh"
        selection.options["lead"] = "gpt-6-sol"
        selection.options["sidekick"] = "swe-2-high"
        selection.options["speed"] = "fast"
        try await client.setModel(sessionID: sessionID, selection: selection)
        XCTAssertEqual(received, selection)
        XCTAssertEqual(ModelPresentation.composerLabel(model: fusion, selection: selection), "Fusion Xhigh Fast")
        try await client.signOut()
    }
}
