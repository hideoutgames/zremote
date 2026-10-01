import SwiftUI
import ZRemoteCore

struct ComposerSuggestions: View {
    let kind: ComposerTokenKind
    let items: [ComposerCompletion]
    let loading: Bool
    var unavailableMessage: String? = nil
    let choose: (ComposerCompletion) -> Void

    private var title: String {
        switch kind { case .command: return "Commands"; case .skill: return "Skills"; case .file: return "Files" }
    }
    private var symbol: String {
        switch kind { case .command: return "slash.circle"; case .skill: return "sparkles"; case .file: return "doc.text" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(title).font(.caption.weight(.medium)).foregroundStyle(Palette.secondary)
                Spacer()
                if loading {
                    ProgressView().tint(Palette.secondary)
                        #if !os(Android)
                        .controlSize(.small)
                        #endif
                }
            }.padding(.horizontal, 14).padding(.vertical, 10)
            if items.isEmpty && !loading {
                Text(unavailableMessage ?? "No matching \(title.lowercased()).")
                    .font(.subheadline).foregroundStyle(Palette.secondary)
                    .padding(.horizontal, 14).padding(.bottom, 14)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(items) { item in
                            Button { choose(item) } label: {
                                HStack(spacing: 11) {
                                    Image(systemName: symbol).foregroundStyle(Palette.addition)
                                        .frame(width: 24)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(item.title).font(.subheadline.weight(.medium)).foregroundStyle(Palette.text)
                                            .lineLimit(1)
                                        if !item.detail.isEmpty {
                                            Text(item.detail).font(.caption).foregroundStyle(Palette.secondary).lineLimit(2)
                                        }
                                    }
                                    Spacer(minLength: 0)
                                    Image(systemName: "arrow.turn.down.left").font(.caption)
                                        .foregroundStyle(Palette.secondary)
                                }
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .padding(.horizontal, 14).padding(.vertical, 6)
                                .contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }
                }.frame(maxHeight: 196)
            }
        }
        .background(Palette.raised, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.line))
        .accessibilityLabel("\(title) suggestions")
    }
}
