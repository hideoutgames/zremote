import SwiftUI
import ZRemoteCore

/// A shared compact presentation for host-reported PR and sub-agent activity.
struct SessionEventCard: View {
    let symbol: String
    let title: String
    let subtitle: String
    let badge: String
    var active = false
    var disclosure = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(active ? Palette.addition : Palette.secondary)
                .frame(width: 34, height: 34)
                .background(Palette.raised, in: RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 6) {
                Text(badge).font(.caption).foregroundStyle(Palette.secondary)
                Text(title).font(.subheadline.weight(.medium)).foregroundStyle(Palette.text)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    if active { Circle().fill(Palette.addition).frame(width: 5, height: 5) }
                    Text(subtitle).font(.caption).foregroundStyle(Palette.secondary)
                        .multilineTextAlignment(.leading)
                }
            }
            Spacer(minLength: 0)
            if disclosure {
                Image(systemName: "chevron.right").font(.caption.weight(.medium))
                    .foregroundStyle(Palette.secondary).padding(.top, 10)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.line))
    }
}

struct PullRequestDetailView: View {
    let request: PullRequest

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                SessionEventCard(symbol: "arrow.triangle.pull", title: request.title,
                                 subtitle: request.state.capitalized, badge: "Pull request #\(request.number)",
                                 active: request.state.lowercased() == "open")
                if !request.baseRef.isEmpty {
                    HStack(spacing: 8) {
                        if !request.headRef.isEmpty {
                            Text(request.headRef).lineLimit(1)
                            Image(systemName: "arrow.right").font(.caption)
                        }
                        Text(request.baseRef).lineLimit(1)
                    }.font(.system(.footnote, design: .monospaced)).foregroundStyle(Palette.secondary)
                }
                if let url = PresentationRules.reviewURL(request.url) {
                    Label(url.host ?? "Pull request", systemImage: "link")
                        .font(.subheadline).foregroundStyle(Palette.secondary)
                    SelectableText(request.url).font(.footnote).foregroundStyle(Palette.secondary)
                }
            }.padding(20)
        }
        .background(Palette.background)
        .navigationTitle("Pull request")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if let url = PresentationRules.reviewURL(request.url) {
                    Menu {
                        Link(destination: url) { Label("Open in browser", systemImage: "safari") }
                        Button { NativeClipboard.copy(url.absoluteString) } label: {
                            Label("Copy link", systemImage: "link")
                        }
                    } label: {
                        Image(systemName: "arrow.up.right.square").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Open pull request")
                }
            }
        }
    }
}
