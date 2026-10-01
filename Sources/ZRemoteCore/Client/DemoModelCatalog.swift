import Foundation

/// Offline fixture from the pinned Zeron catalog plus its native Fusion demo.
/// Kept separate from live discovery; these models never enter a host catalog.
enum DemoModelCatalog {
    static var models: [AgentModel] {
        let ultra = ["low", "medium", "high", "xhigh", "max", "ultra"]
        let xhigh = ["low", "medium", "high", "xhigh"]
        let claude = ["low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"]
        let claudeXhigh = ["low", "medium", "high", "xhigh", "max", "ultrathink"]
        let tier = ModelOption(id: "serviceTier", label: "Service Tier", choices: [
            ModelChoice(id: "default", label: "Standard"), ModelChoice(id: "fast", label: "Fast")
        ], defaultChoice: "default")
        let context = ModelOption(id: "contextWindow", label: "Context Window", choices: [
            ModelChoice(id: "200k", label: "200K"), ModelChoice(id: "1m", label: "1M")
        ], defaultChoice: "200k")
        let fast = toggle("fastMode", label: "Fast Mode")
        return [
            codex("gpt-6-astra", "GPT-6 Astra", efforts: ultra, options: [tier]),
            codex("gpt-5.6-sol", "GPT-5.6 Sol", efforts: ultra, options: [tier]),
            codex("gpt-5.6-terra", "GPT-5.6 Terra", efforts: ultra, options: [tier]),
            codex("gpt-5.6-luna", "GPT-5.6 Luna", efforts: ["low", "medium", "high", "xhigh", "max"], options: [tier]),
            codex("gpt-daybreak-blue-latest", "Daybreak Blue", efforts: ultra),
            codex("gpt-5.5", "GPT-5.5", efforts: xhigh, options: [tier]),
            codex("gpt-5.4", "GPT-5.4", efforts: xhigh, options: [tier]),
            codex("gpt-5.4-mini", "GPT-5.4 Mini", efforts: xhigh, options: [tier]),
            codex("gpt-5.3-codex-spark", "GPT-5.3 Codex Spark", efforts: xhigh, options: [tier]),
            anthropic("claude-fable-5-1", "Fable 5.1", efforts: claude, options: [context]),
            anthropic("claude-fable-5", "Fable 5", efforts: claude, options: [context]),
            anthropic("claude-opus-5", "Opus 5", efforts: claude, options: [context, fast]),
            anthropic("claude-opus-4-8", "Opus 4.8", efforts: claude, options: [fast]),
            anthropic("claude-opus-4-7", "Opus 4.7", efforts: claudeXhigh, options: [fast]),
            anthropic("claude-sonnet-5", "Sonnet 5", efforts: claudeXhigh, options: [context]),
            anthropic("claude-haiku-4-5", "Haiku 4.5", efforts: [], options: [toggle("thinking", label: "Thinking")]),
            AgentModel(providerID: "devin", providerName: "Devin", modelID: "fusion", name: "Fusion",
                       detail: "Demo model with simulated responses", efforts: xhigh, options: [
                ModelOption(id: "lead", label: "Lead", choices: [
                    ModelChoice(id: "claude-fable-5-1", label: "Claude Fable 5.1"),
                    ModelChoice(id: "gpt-6-sol", label: "GPT-6 Sol")
                ], defaultChoice: "claude-fable-5-1"),
                ModelOption(id: "sidekick", label: "Sidekick", choices: [
                    ModelChoice(id: "swe-2-medium", label: "SWE-2 Medium"),
                    ModelChoice(id: "swe-2-high", label: "SWE-2 High")
                ], defaultChoice: "swe-2-medium"),
                ModelOption(id: "speed", label: "Fast Mode", choices: [
                    ModelChoice(id: "standard", label: "Standard"), ModelChoice(id: "fast", label: "Fast")
                ], defaultChoice: "standard")
            ], defaultEffort: "high")
        ]
    }

    private static func codex(_ id: String, _ name: String, efforts: [String], options: [ModelOption] = []) -> AgentModel {
        AgentModel(providerID: "codex", providerName: "Codex", modelID: id, name: name,
                   detail: "Test mode · pinned Zeron catalog", efforts: efforts, options: options)
    }

    private static func anthropic(_ id: String, _ name: String, efforts: [String], options: [ModelOption]) -> AgentModel {
        AgentModel(providerID: "claude-code", providerName: "Claude Code", modelID: id, name: name,
                   detail: "Test mode · pinned Zeron catalog", efforts: efforts, options: options)
    }

    private static func toggle(_ id: String, label: String) -> ModelOption {
        ModelOption(id: id, label: label, choices: [ModelChoice(id: "off", label: "Off"), ModelChoice(id: "on", label: "On")], defaultChoice: "off")
    }
}
