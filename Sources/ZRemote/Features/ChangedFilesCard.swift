import SwiftUI
import ZRemoteCore

struct ChangedFilesCard: View {
    let turn: CapturedTurnChanges
    let openFile: (CapturedFileChange) -> Void
    let showAll: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(turn.files.count) files changed").font(.subheadline.weight(.medium)).padding(16)
            ForEach(Array(turn.files.prefix(6))) { file in
                Button { openFile(file) } label: { ChangedFileRow(file: file) }.buttonStyle(.plain)
            }
            if turn.files.count > 6 {
                Button(action: showAll) {
                    HStack { Text("Show all…"); Spacer(); Image(systemName: "chevron.right").font(.caption) }
                        .font(.subheadline).foregroundStyle(Palette.secondary).padding(16)
                }.buttonStyle(.plain)
            }
        }
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.line))
    }
}

struct ChangedFileRow: View {
    let file: CapturedFileChange
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "doc.text").foregroundStyle(Palette.secondary)
            Text(file.path).font(.subheadline)
                #if os(Android)
                .lineLimit(2)
                #else
                .lineLimit(1).truncationMode(.middle)
                #endif
            Spacer(minLength: 4)
            if let additions = file.additions, let deletions = file.deletions {
                HStack(spacing: 8) {
                    Text("+\(additions)").foregroundStyle(Palette.addition)
                    Text("−\(deletions)").foregroundStyle(Palette.deletion)
                }.font(.system(.caption, design: .monospaced))
            } else {
                Text(file.isBinary ? "Binary" : "Partial").font(.caption).foregroundStyle(Palette.secondary)
            }
        }
        .foregroundStyle(Palette.text)
        .padding(.horizontal, 16).padding(.vertical, 13)
        .contentShape(Rectangle())
        #if !os(Android)
        .accessibilityElement(children: .combine)
        #endif
    }
}

struct ChangedFilesList: View {
    let turn: CapturedTurnChanges
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(turn.files) { file in
                    NavigationLink { NativeDiffView(document: file.document) } label: { ChangedFileRow(file: file) }
                        .buttonStyle(.plain)
                }
            }.padding(.vertical, 8)
        }.navigationTitle("Changed files").navigationBarTitleDisplayMode(.inline)
    }
}

struct PullRequestCard: View {
    let request: PullRequest
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pull request").font(.caption).foregroundStyle(Palette.secondary)
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "arrow.triangle.pull").foregroundStyle(Palette.secondary)
                VStack(alignment: .leading, spacing: 5) {
                    Text(request.title).font(.subheadline.weight(.medium))
                    Text("#\(request.number) · \(request.state.capitalized)").font(.caption).foregroundStyle(Palette.secondary)
                }
                Spacer(minLength: 0)
                if let url = PresentationRules.reviewURL(request.url) {
                    Link(destination: url) { Image(systemName: "arrow.up.right").frame(width: 44, height: 44) }
                        .accessibilityLabel("Open pull request \(request.number) in browser")
                }
            }
        }
        .padding(16).foregroundStyle(Palette.text)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 20))
    }
}
