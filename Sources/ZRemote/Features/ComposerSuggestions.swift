import SwiftUI
import ZRemoteCore

struct ComposerSuggestions: View {
    let kind: ComposerTokenKind
    let items: [ComposerCompletion]
    let loading: Bool
    var maximumHeight: CGFloat = 168
    var unavailableMessage: String? = nil
    let choose: (ComposerCompletion) -> Void

    private var title: String {
        switch kind { case .command: return "Commands"; case .skill: return "Skills"; case .file: return "Files" }
    }
    var body: some View {
        Group {
            if items.isEmpty {
                HStack(spacing: 8) {
                    if loading { ProgressView().tint(Palette.secondary) }
                    Text(unavailableMessage ?? (loading ? "Finding \(title.lowercased())…" : "No matching \(title.lowercased())."))
                        .font(.caption).foregroundStyle(Palette.secondary).lineLimit(2)
                    Spacer(minLength: 0)
                }.padding(.horizontal, 10).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).padding(.top, 8)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(items) { item in
                            Button { choose(item) } label: {
                                HStack(spacing: 6) {
                                    if let symbol = item.fileSymbol {
                                        Image(systemName: symbol).font(.system(size: 12)).foregroundStyle(Palette.secondary)
                                            .frame(width: 14).accessibilityHidden(true)
                                    }
                                    HStack(spacing: 0) {
                                        Text(item.displayTitle).foregroundStyle(Palette.text).fontWeight(.medium).layoutPriority(1)
                                        if !item.displayDetail.isEmpty { Text(" ≈ " + item.displayDetail).foregroundStyle(Palette.secondary) }
                                    }
                                        .font(.subheadline).lineLimit(1).truncationMode(.tail)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .frame(maxWidth: .infinity, minHeight: 32, maxHeight: 32, alignment: .leading)
                                .padding(.horizontal, 10)
                                .contentShape(Rectangle())
                            }.buttonStyle(.plain).accessibilityLabel(item.displayTitle + ", " + item.displayDetail)
                                .accessibilityHint(item.kind == .file ? item.title : "Insert \(item.displayTitle)")
                        }
                    }
                }
            }
        }
        .frame(height: min(168, max(32, maximumHeight)))
        .background(Palette.raised, in: RoundedRectangle(cornerRadius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.line))
        .accessibilityLabel("\(title) suggestions")
    }
}
