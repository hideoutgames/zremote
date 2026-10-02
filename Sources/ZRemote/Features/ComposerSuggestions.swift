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
    private var heightLimit: CGFloat { min(168, max(32, maximumHeight)) }

    private var content: some View {
        Group {
            if items.isEmpty {
                HStack(spacing: 8) {
                    if loading { ProgressView().tint(Palette.secondary) }
                    Text(unavailableMessage ?? (loading ? "Finding \(title.lowercased())…" : "No matching \(title.lowercased())."))
                        .font(.caption).foregroundStyle(Palette.secondary).lineLimit(2)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxHeight: heightLimit, alignment: .topLeading)
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
                .frame(height: min(CGFloat(items.count) * 32, heightLimit))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    var body: some View {
        surface
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel("\(title) suggestions")
            .accessibilityIdentifier("composer-suggestions")
    }

    @ViewBuilder private var surface: some View {
        #if os(iOS)
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: 12))
        } else {
            content
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.line))
        }
        #else
        content
            .background(Palette.raised, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.line))
        #endif
    }
}
