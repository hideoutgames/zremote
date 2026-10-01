import SwiftUI
import ZRemoteCore

extension ComposerTokenKind {
    var referenceColor: Color {
        switch self { case .command: return Palette.addition; case .skill: return Palette.merged; case .file: return .blue }
    }
    var referenceColorIndex: Int {
        switch self { case .command: return 0; case .skill: return 1; case .file: return 2 }
    }
}
