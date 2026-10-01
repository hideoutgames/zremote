import SwiftUI
import ZRemoteCore

/// A compact presentation of the sub-agent's task and current activity.
struct SessionEventCard: View {
    let symbol: String
    let title: String
    let subtitle: String
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
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Text("Pull request #\(request.number)").font(.subheadline)
                            .foregroundStyle(Palette.secondary)
                        Spacer()
                        PullRequestBadge(request: request)
                    }
                    Text(request.title).font(.title2.weight(.semibold)).foregroundStyle(Palette.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !request.headRef.isEmpty || !request.baseRef.isEmpty {
                    VStack(alignment: .leading, spacing: 16) {
                        if !request.headRef.isEmpty { branch(request.headRef, label: "From", symbol: "arrow.triangle.branch") }
                        if !request.headRef.isEmpty && !request.baseRef.isEmpty { Divider().overlay(Palette.line) }
                        if !request.baseRef.isEmpty { branch(request.baseRef, label: "Into", symbol: "arrow.turn.down.right") }
                    }
                    .padding(18).background(Palette.surface, in: RoundedRectangle(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.line))
                }

                if let url = PresentationRules.reviewURL(request.url) {
                    VStack(spacing: 12) {
                        Link(destination: url) {
                            HStack(spacing: 10) {
                                Text("Open pull request").font(.subheadline.weight(.semibold))
                                Image(systemName: "arrow.up.right").font(.system(size: 13, weight: .semibold))
                            }
                            .foregroundStyle(Palette.background).frame(maxWidth: .infinity)
                            .padding(.vertical, 16).background(Palette.text, in: Capsule())
                        }.buttonStyle(.plain)
                        Text(url.host ?? "").font(.caption).foregroundStyle(Palette.secondary)
                    }
                }
            }.padding(24)
        }
        .background(Palette.background)
        .navigationTitle("Pull request")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if let url = PresentationRules.reviewURL(request.url) {
                    Button { NativeClipboard.copy(url.absoluteString) } label: {
                        Image(systemName: "link").frame(minWidth: 44, minHeight: 44)
                    }.accessibilityLabel("Copy pull request link")
                }
            }
        }
    }

    private func branch(_ name: String, label: String, symbol: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).font(.system(size: 15)).foregroundStyle(Palette.secondary)
                .frame(width: 18).padding(.top, 2)
            VStack(alignment: .leading, spacing: 5) {
                Text(label).font(.caption).foregroundStyle(Palette.secondary)
                SelectableText(name).font(.system(.subheadline, design: .monospaced)).foregroundStyle(Palette.text)
            }
        }
    }
}

struct PullRequestBadge: View {
    let request: PullRequest
    var compact = false

    var body: some View {
        let state = PullRequestPresentationState(request)
        HStack(spacing: 5) {
            PullRequestIcon(request: request, size: compact ? 13 : 14)
            Text(compact ? "\(request.number)" : state.label)
                .font(compact ? .system(.caption2, design: .monospaced).weight(.medium) : .caption.weight(.medium))
        }
        .foregroundStyle(state.color)
        .padding(.horizontal, compact ? 7 : 9).padding(.vertical, compact ? 4 : 5)
        .background(state.color.opacity(0.1), in: RoundedRectangle(cornerRadius: compact ? 6 : 8))
        .overlay(RoundedRectangle(cornerRadius: compact ? 6 : 8).strokeBorder(state.color.opacity(0.15)))
        .fixedSize()
        #if !os(Android)
        .accessibilityElement(children: .ignore)
        #endif
        .accessibilityLabel("Pull request \(request.number), \(state.label)")
    }
}

struct PullRequestSummary: View {
    let request: PullRequest

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Text("Pull request #\(request.number)").font(.caption.weight(.medium)).foregroundStyle(Palette.secondary)
                Spacer(minLength: 8)
                PullRequestBadge(request: request)
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Palette.secondary).accessibilityHidden(true)
            }
            Text(request.title).font(.subheadline.weight(.medium)).foregroundStyle(Palette.text)
                .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            if !request.headRef.isEmpty || !request.baseRef.isEmpty {
                HStack(spacing: 7) {
                    Image(systemName: "arrow.triangle.branch").font(.system(size: 12))
                    if !request.headRef.isEmpty { Text(request.headRef).lineLimit(1) }
                    if !request.headRef.isEmpty && !request.baseRef.isEmpty {
                        Image(systemName: "arrow.right").font(.system(size: 10))
                    }
                    if !request.baseRef.isEmpty { Text(request.baseRef).lineLimit(1) }
                }.font(.system(.caption, design: .monospaced)).foregroundStyle(Palette.secondary)
            }
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.line))
        .contentShape(RoundedRectangle(cornerRadius: 18))
    }
}
