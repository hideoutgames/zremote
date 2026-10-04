import SwiftUI
import ZRemoteCore

/// SwiftUI adaptation of official iOS ToolViews.swift / layout/tools.rs
/// (zeronsh/zeron 9e1a111). Disclosure state belongs to the stable group ID.
struct TranscriptActivityView: View {
    let segment: TranscriptSegment
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @State var openOverride: Bool?
    @State var detailOverrides: [String: Bool] = [:]

    var expanded: Bool { TranscriptActivity.expanded(override: openOverride, live: segment.live) }
    var failed: Bool { segment.parts.contains { $0.tool?.failed == true } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { openOverride = !expanded } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .medium))
                        .rotationEffect(.degrees(expanded ? 90 : 0)).frame(width: 28)
                    if segment.live && !failed { ShimmerText(text: segment.summary).lineLimit(1) }
                    else { Text(segment.summary).foregroundStyle(failed ? Palette.deletion : Palette.secondary).lineLimit(1) }
                    Spacer(minLength: 0)
                }.font(.system(size: 13.5)).frame(minHeight: 29.25).contentShape(Rectangle())
            }
            .buttonStyle(.plain).foregroundStyle(Palette.secondary)
            .accessibilityLabel(segment.summary)
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            .accessibilityIdentifier("tool-group-toggle")

            if expanded {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(segment.parts) { part in
                        let liveThought = segment.live && segment.parts.last?.id == part.id && part.kind == "reasoning"
                        let open = TranscriptActivity.expanded(override: detailOverrides[part.id], live: liveThought)
                        TranscriptActivityRow(part: part, expanded: open, live: liveThought, active: segment.live,
                            continues: part.id != segment.parts.last?.id,
                            toggle: { detailOverrides[part.id] = !open })
                            .transition(.opacity.combined(with: .offset(y: 4)))
                    }
                }
                .animation(reduceMotion ? nil : .easeOut(duration: 0.36), value: segment.parts.map(\.id))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("tool-group")
    }
}

struct TranscriptActivityRow: View {
    let part: TranscriptPart
    let expanded: Bool
    let live: Bool
    let active: Bool
    let continues: Bool
    let toggle: () -> Void

    var statusLabel: String {
        if part.tool?.failed == true { return "Failed, " }
        if active && part.tool?.resolved == false { return "Running, " }
        return ""
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                HStack(spacing: 9) {
                    Image(systemName: part.tool?.symbol ?? "text.bubble")
                        .font(.system(size: 18)).frame(width: 18)
                    Text(part.tool?.label ?? "Thought process").lineLimit(1)
                    if let tool = part.tool {
                        if let name = tool.fileName {
                            HStack(spacing: 5) {
                                Image(systemName: "doc.text").font(.system(size: 12))
                                Text(name).lineLimit(1)
                            }
                            .padding(.horizontal, 5).padding(.vertical, 3)
                            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 5))
                        } else if !tool.detail.isEmpty { Text(tool.detail).lineLimit(1) }
                        if tool.failed { Text("Failed").font(.caption2) }
                        else if active && !tool.resolved { Text("Running").font(.caption2) }
                    }
                    Spacer(minLength: 0)
                }
                .font(.system(size: 13.5)).foregroundStyle(part.tool?.failed == true ? Palette.deletion : Palette.secondary)
                .frame(minHeight: 36, alignment: .leading).padding(.leading, 36).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(part.tool.map { "\($0.label), \($0.detail)" } ?? "Thought process")
            .accessibilityValue(statusLabel + (expanded ? "Expanded" : "Collapsed"))
            .accessibilityIdentifier(part.kind == "reasoning" ? "reasoning-row" : "tool-row")
            .nativeContextMenu {
                Button { NativeClipboard.copy(part.tool?.copyText ?? part.text) } label: {
                    Label("Copy details", systemImage: "doc.on.doc")
                }
            }

            if expanded {
                VStack(alignment: .leading, spacing: 8) {
                    if let tool = part.tool {
                        if !tool.invocation.isEmpty { TranscriptDetailText(text: tool.invocation) }
                        if !tool.output.isEmpty { TranscriptDetailText(text: tool.output, diff: tool.outputKind == "diff") }
                        if tool.truncated { Text("Showing the available preview").font(.caption).foregroundStyle(Palette.secondary) }
                    } else {
                        TranscriptDetailText(text: part.text, thought: true, live: live)
                        if part.truncated { Text("Showing the available preview").font(.caption).foregroundStyle(Palette.secondary) }
                    }
                }.padding(.leading, 63).padding(.top, 6).padding(.bottom, 8)
            }
        }
        .background(alignment: .leading) {
            ActivityRail(continues: continues).stroke(Palette.line, lineWidth: 1)
                .frame(width: 32).allowsHitTesting(false).accessibilityHidden(true)
        }
    }
}

struct ActivityRail: Shape {
    let continues: Bool
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 14, y: 0))
        path.addLine(to: CGPoint(x: 14, y: 12))
        path.addQuadCurve(to: CGPoint(x: 20, y: 18), control: CGPoint(x: 14, y: 18))
        path.addLine(to: CGPoint(x: 32, y: 18))
        if continues {
            path.move(to: CGPoint(x: 14, y: 12))
            path.addLine(to: CGPoint(x: 14, y: rect.height))
        }
        return path
    }
}

struct TranscriptDetailText: View {
    let text: String
    var diff = false
    var thought = false
    var live = false
    @State var showAll = false
    @State var thoughtHeight: CGFloat = 18

    var lines: [String] { text.components(separatedBy: "\n") }
    var preview: String { showAll ? text : lines.prefix(24).joined(separator: "\n") }
    var visibleLines: [String] { showAll ? lines : Array(lines.prefix(24)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if thought {
                ScrollView(.vertical) {
                    AgentSelectableText(value: preview, markdown: !live, secondary: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { thoughtHeight = $0 }
                }.frame(height: min(240, max(18, thoughtHeight)))
            } else {
                ScrollView([.horizontal, .vertical]) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(visibleLines.enumerated()), id: \.offset) { _, line in
                            SelectableText(line.isEmpty ? " " : line)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(color(line)).frame(minHeight: 18, alignment: .leading)
                        }
                    }.fixedSize(horizontal: true, vertical: false)
                }.frame(height: min(240, CGFloat(visibleLines.count) * 18))
            }
            if lines.count > 24 {
                Button(showAll ? "Show less" : "Show all \(lines.count) lines") { showAll.toggle() }
                    .font(.caption).buttonStyle(.plain).foregroundStyle(Palette.text)
            }
        }
    }

    private func color(_ line: String) -> Color {
        if diff && line.hasPrefix("+") { return Palette.addition }
        if diff && line.hasPrefix("-") { return Palette.deletion }
        return Palette.secondary
    }
}
