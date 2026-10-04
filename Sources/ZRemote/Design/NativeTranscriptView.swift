// Viewport reuse, stable anchors and follow state adapted from Zeron's
// TranscriptListView, copyright 2026 Wing. MIT: Resources/Licenses/Zeron-MIT.txt.
#if os(iOS)
import Foundation
import SwiftUI
import UIKit
import ZRemoteCore

struct NativeTranscriptView: UIViewControllerRepresentable {
    let model: AppModel
    @Binding var scroll: TranscriptScrollState
    let request: Int
    let animated: Bool
    let topPadding: CGFloat
    let colorScheme: ColorScheme
    let sizeCategory: ContentSizeCategory
    let reduceMotion: Bool

    func makeUIViewController(context: Context) -> NativeTranscriptController {
        NativeTranscriptController()
    }

    func updateUIViewController(_ controller: NativeTranscriptController, context: Context) {
        controller.update(model: model, scroll: scroll, request: request, animated: animated,
                          topPadding: topPadding, colorScheme: colorScheme, sizeCategory: sizeCategory,
                          reduceMotion: reduceMotion) { scroll = $0 }
    }

    static func dismantleUIViewController(_ controller: NativeTranscriptController, coordinator: ()) {
        controller.close()
    }
}

private struct TranscriptInput: Equatable, Sendable {
    var messages: [TranscriptMessage]
    var changes: [String: CapturedTurnChanges]
    var pullRequests: [String: [PullRequest]]
    var unanchored: [PullRequest]
    var working: Bool
}

private struct PreparedTranscriptRow: Equatable, Sendable {
    var row: TranscriptRenderRow
    var markdown: AttributedString?
}

private actor TranscriptPreparation {
    private let builder = TranscriptRowBuilder()
    private var cache: [TranscriptRowID: PreparedTranscriptRow] = [:]

    func prepare(_ input: TranscriptInput) async throws -> [PreparedTranscriptRow] {
        let rows = try await builder.rows(messages: input.messages, changes: input.changes,
                                          pullRequests: input.pullRequests, unanchored: input.unanchored,
                                          working: input.working)
        var retained: [TranscriptRowID: PreparedTranscriptRow] = [:]
        var output: [PreparedTranscriptRow] = []
        for row in rows {
            try Task.checkCancellation()
            if let cached = cache[row.id], cached.row == row {
                retained[row.id] = cached
                output.append(cached)
            } else {
                var markdown: AttributedString?
                if case let .text(text, enabled, _) = row.content, enabled {
                    markdown = try? AttributedString(markdown: text,
                        options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
                }
                let prepared = PreparedTranscriptRow(row: row, markdown: markdown)
                retained[row.id] = prepared
                output.append(prepared)
            }
        }
        cache = retained
        return output
    }
}

final class NativeTranscriptController: UIViewController, UICollectionViewDelegate {
    private var preparation = TranscriptPreparation()
    private var prepareTask: Task<Void, Never>?
    private var input: TranscriptInput?
    private var pendingInput: TranscriptInput?
    private var sessionID: String?
    private var model: AppModel?
    private var rows: [TranscriptRowID: PreparedTranscriptRow] = [:]
    private var scroll = TranscriptScrollState()
    private var lastRequest = 0
    private var topPadding: CGFloat = 18
    private var colorScheme = ColorScheme.light
    private var sizeCategory = ContentSizeCategory.large
    private var reduceMotion = false
    private var onScroll: ((TranscriptScrollState) -> Void)?
    private var reportedScroll: TranscriptScrollState?
    private var reporting = false
    private var animatingJump = false
    private var lastSize = CGSize.zero
    private var applying = false
    private var waitingRows: [PreparedTranscriptRow]?
    private let spinner = UIActivityIndicatorView(style: .medium)

    private lazy var collection = TranscriptCollectionView(frame: .zero, collectionViewLayout: makeLayout())
    private lazy var dataSource = UICollectionViewDiffableDataSource<Int, TranscriptRowID>(collectionView: collection) { [weak self] collection, path, id in
        guard let self, let prepared = rows[id], let model, let sessionID else { return nil }
        let cell = collection.dequeueReusableCell(withReuseIdentifier: "row", for: path)
        cell.backgroundColor = .clear
        cell.contentConfiguration = UIHostingConfiguration {
            NativeTranscriptRow(prepared: prepared, model: model, sessionID: sessionID)
                .environment(\.colorScheme, colorScheme)
                .environment(\.sizeCategory, sizeCategory)
                .foregroundStyle(Palette.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, prepared.row.spacing)
                .scaleEffect(x: 1, y: -1)
        }.margins(.all, 0)
        return cell
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        collection.backgroundColor = .clear
        collection.transform = CGAffineTransform(scaleX: 1, y: -1)
        collection.alwaysBounceVertical = true
        collection.keyboardDismissMode = .interactive
        collection.contentInsetAdjustmentBehavior = .never
        collection.delegate = self
        collection.register(UICollectionViewCell.self, forCellWithReuseIdentifier: "row")
        collection.geometryChanged = { [weak self] in self?.geometryChanged() }
        view.addSubview(collection)
        spinner.hidesWhenStopped = true
        spinner.startAnimating()
        spinner.accessibilityLabel = "Loading conversation"
        view.addSubview(spinner)
        _ = dataSource
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        collection.frame = view.bounds
        spinner.center = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
        let insets = UIEdgeInsets(top: view.safeAreaInsets.bottom + 24, left: 0,
                                 bottom: view.safeAreaInsets.top + topPadding, right: 0)
        if collection.contentInset != insets { collection.contentInset = insets }
        if lastSize.width != view.bounds.width {
            lastSize = view.bounds.size
            collection.collectionViewLayout.invalidateLayout()
        }
        geometryChanged()
    }

    func update(model: AppModel, scroll: TranscriptScrollState, request: Int, animated: Bool,
                topPadding: CGFloat, colorScheme: ColorScheme, sizeCategory: ContentSizeCategory,
                reduceMotion: Bool, onScroll: @escaping (TranscriptScrollState) -> Void) {
        loadViewIfNeeded()
        self.model = model
        self.onScroll = onScroll
        self.topPadding = topPadding
        self.reduceMotion = reduceMotion
        if sessionID != model.selectedSessionID {
            close()
            preparation = TranscriptPreparation()
            sessionID = model.selectedSessionID
            input = nil; pendingInput = nil
            self.scroll = TranscriptScrollState()
            reportedScroll = nil
            rows = [:]
            dataSource.apply(NSDiffableDataSourceSnapshot<Int, TranscriptRowID>(), animatingDifferences: false)
            spinner.startAnimating()
            lastRequest = request
        }
        if self.colorScheme != colorScheme || self.sizeCategory != sizeCategory {
            self.colorScheme = colorScheme
            self.sizeCategory = sizeCategory
            var snapshot = dataSource.snapshot()
            snapshot.reconfigureItems(snapshot.itemIdentifiers)
            dataSource.apply(snapshot, animatingDifferences: false)
        }
        let next = TranscriptInput(messages: model.state?.messages ?? [], changes: model.changesAfterMessage,
                                   pullRequests: model.pullRequestsAfterMessage,
                                   unanchored: model.unanchoredPullRequests, working: model.working)
        if next != input {
            input = next
            pendingInput = next
            prepare()
        }
        view.setNeedsLayout()
        if lastRequest != request {
            lastRequest = request
            self.scroll.requestJump()
            jump(animated: animated && !reduceMotion)
        }
    }

    func close() {
        prepareTask?.cancel()
        prepareTask = nil
        pendingInput = nil
        waitingRows = nil
        animatingJump = false
    }

    private func makeLayout() -> UICollectionViewLayout {
        UICollectionViewCompositionalLayout { _, environment in
            let width = environment.container.effectiveContentSize.width
            let inset = max(24, (width - 760) / 2)
            let item = NSCollectionLayoutItem(layoutSize: .init(widthDimension: .fractionalWidth(1),
                                                               heightDimension: .estimated(140)))
            let group = NSCollectionLayoutGroup.vertical(layoutSize: item.layoutSize, subitems: [item])
            let section = NSCollectionLayoutSection(group: group)
            section.contentInsets = .init(top: 0, leading: inset, bottom: 0, trailing: inset)
            return section
        }
    }

    private func prepare() {
        guard prepareTask == nil else { return }
        let currentPreparation = preparation
        prepareTask = Task { [weak self] in
            while let self, let next = pendingInput {
                pendingInput = nil
                do {
                    let prepared = try await currentPreparation.prepare(next)
                    guard !Task.isCancelled else { return }
                    apply(prepared)
                } catch { return }
            }
            self?.prepareTask = nil
        }
    }

    private func apply(_ prepared: [PreparedTranscriptRow]) {
        guard !applying else { waitingRows = prepared; return }
        applying = true
        let anchor = readingAnchor()
        let previous = rows
        rows = Dictionary(uniqueKeysWithValues: prepared.map { ($0.row.id, $0) })
        var snapshot = NSDiffableDataSourceSnapshot<Int, TranscriptRowID>()
        snapshot.appendSections([0])
        snapshot.appendItems(prepared.reversed().map(\.row.id))
        snapshot.reconfigureItems(prepared.compactMap {
            previous[$0.row.id] != nil && previous[$0.row.id] != $0 ? $0.row.id : nil
        })
        dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in
            guard let self else { return }
            collection.layoutIfNeeded()
            if scroll.shouldFollow {
                jump(animated: false)
            } else if let anchor, let path = dataSource.indexPath(for: anchor.id),
                      let rect = collection.layoutAttributesForItem(at: path)?.frame {
                collection.contentOffset.y = rect.maxY - collection.bounds.height - anchor.delta
            }
            spinner.stopAnimating()
            applying = false
            geometryChanged()
            if let waiting = waitingRows {
                waitingRows = nil
                apply(waiting)
            }
        }
    }

    private func readingAnchor() -> (id: TranscriptRowID, delta: CGFloat)? {
        guard !scroll.shouldFollow else { return nil }
        let edge = collection.contentOffset.y + collection.bounds.height
        let paths = collection.indexPathsForVisibleItems.sorted { $0.item > $1.item }
        for path in paths {
            guard let id = dataSource.itemIdentifier(for: path),
                  let rect = collection.layoutAttributesForItem(at: path)?.frame,
                  rect.minY < edge else { continue }
            return (id, rect.maxY - edge)
        }
        return nil
    }

    private func jump(animated: Bool) {
        animatingJump = animated
        collection.setContentOffset(CGPoint(x: 0, y: -collection.adjustedContentInset.top), animated: animated)
        if !animated { geometryChanged() }
    }

    private func geometryChanged() {
        guard !rows.isEmpty, collection.bounds.height > 0, !applying else { return }
        if scroll.shouldFollow && !animatingJump {
            let tail = -collection.adjustedContentInset.top
            if abs(collection.contentOffset.y - tail) > 0.5 { collection.contentOffset.y = tail }
        }
        scroll.update(atBottom: collection.contentOffset.y + collection.adjustedContentInset.top <= 24)
        reportScroll()
    }

    private func reportScroll() {
        guard !reporting else { return }
        reporting = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            reporting = false
            if reportedScroll != scroll {
                reportedScroll = scroll
                onScroll?(scroll)
            }
        }
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) { geometryChanged() }
    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        animatingJump = false
        scroll.beginUserScroll()
        reportScroll()
    }
    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate { finishUserScroll() }
    }
    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { finishUserScroll() }
    func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
        animatingJump = false
        geometryChanged()
    }
    private func finishUserScroll() {
        scroll.update(atBottom: collection.contentOffset.y + collection.adjustedContentInset.top <= 24)
        scroll.endUserScroll()
        geometryChanged()
    }
}

private final class TranscriptCollectionView: UICollectionView {
    var geometryChanged: (() -> Void)?
    override func layoutSubviews() {
        super.layoutSubviews()
        geometryChanged?()
    }
}

private struct NativeTranscriptRow: View {
    let prepared: PreparedTranscriptRow
    let model: AppModel
    let sessionID: String

    @ViewBuilder var body: some View {
        switch prepared.row.content {
        case .prompt(let message):
            MessageContentView(message: message)
        case let .text(text, markdown, secondary):
            AgentSelectableText(value: text, markdown: markdown, secondary: secondary, parsed: prepared.markdown)
        case let .code(code, language):
            CodeBlockView(code: code, language: language)
        case .activity(let segment):
            TranscriptActivityView(segment: segment)
        case let .attachments(attachments, timestamp):
            MessageAttachments(attachments: attachments, timestamp: timestamp) {
                try await model.attachmentData(sessionID: sessionID, attachment: $0)
            }
        case .subagent(let agent):
            SessionEventCard(title: agent.title, subtitle: agent.status.capitalized, active: agent.active)
        case let .completion(turn, duration):
            VStack(alignment: .leading, spacing: 10) {
                if let turn {
                    ChangedFilesCard(turn: turn, openFile: { model.route = .diff($0.document) },
                                     showAll: { model.route = .changes(turn) })
                }
                if let label = TranscriptMetadata.workLabel(duration: duration) {
                    Text(label).font(.caption2).foregroundStyle(Palette.secondary.opacity(0.85))
                        .accessibilityIdentifier("turn-work-duration")
                }
            }
        case .pullRequest(let request):
            PullRequestCard(request: request) { model.route = .pullRequest(request) }
        case .working:
            if let startedAt = model.state?.workingStartedAt {
                WorkingStatusView(sessionID: sessionID, startedAt: startedAt)
            }
        }
    }
}
#endif
