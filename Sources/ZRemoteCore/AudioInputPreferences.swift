import Foundation

public enum AudioInputMode: String, Codable, CaseIterable, Sendable {
    case dictation, audioModel
}

public enum AudioModelID: String, Codable, CaseIterable, Identifiable, Sendable {
    case multilingual, english
    public var id: String { rawValue }
    public var label: String { self == .multilingual ? "Multilingual" : "English" }
    public var modelName: String { self == .multilingual ? "Parakeet TDT 0.6B v3" : "Parakeet TDT 0.6B v2" }
}

public struct AudioInputPreferences: Codable, Equatable, Sendable {
    public var mode = AudioInputMode.dictation
    public var model = AudioModelID.multilingual
    /// Empty follows the device language. Recognition must still be on-device.
    public var dictationLocale = ""
    public init() {}
    private enum CodingKeys: String, CodingKey { case mode, model, dictationLocale }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        mode = AudioInputMode(rawValue: try values.decodeIfPresent(String.self, forKey: .mode) ?? "") ?? .dictation
        model = AudioModelID(rawValue: try values.decodeIfPresent(String.self, forKey: .model) ?? "") ?? .multilingual
        dictationLocale = try values.decodeIfPresent(String.self, forKey: .dictationLocale) ?? ""
    }
}

extension AppModel {
    /// Commit only accepted speech, to the exact account/session that recorded it.
    @discardableResult public func appendTranscription(_ text: String, context: String) -> Bool {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard attachmentContext == context, !text.isEmpty else { return false }
        let separator = draft.isEmpty || draft.last?.isWhitespace == true ? "" : " "
        draft += separator + text
        return true
    }
}
