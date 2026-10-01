import SwiftUI
import ZRemoteCore
#if os(iOS)
import UIKit
#endif

struct PullRequestMenu: View {
    let requests: [PullRequest]
    let select: @MainActor (PullRequest) -> Void
    @Environment(\.colorScheme) private var colorScheme

    @ViewBuilder var body: some View {
        #if os(iOS)
        NativeGlassButton(image: PullRequestIcon.menuImage(for: requests.last, colorScheme: colorScheme), menu: nativeMenu,
                          accessibilityLabel: "Session pull requests", accessibilityValue: "", enabled: !requests.isEmpty, size: 44)
            .frame(width: 44, height: 44)
        #else
        standardMenu
        #endif
    }

    private var standardMenu: some View {
        Menu {
            ForEach(requests) { request in
                Button { select(request) } label: {
                    HStack {
                        PullRequestIcon(request: request, size: 18)
                        Text("#\(request.number) · \(request.title)")
                    }
                }
            }
        } label: {
            PullRequestIcon(request: requests.last, size: 18)
                .frame(width: 44, height: 44).nativeGlassControl()
        }
        .disabled(requests.isEmpty).accessibilityLabel("Session pull requests")
    }

    #if os(iOS)
    private var nativeMenu: UIMenu {
        let action = select
        return UIMenu(children: requests.map { request in
            UIAction(title: "#\(request.number) · \(request.title)", image: PullRequestIcon.menuImage(for: request, colorScheme: colorScheme)) { _ in
                Task { @MainActor in action(request) }
            }
        })
    }
    #endif
}

#if os(iOS)
@available(iOS 26.0, *)
struct NativeProfileMenu: View {
    let avatarURL: URL?
    let name: String
    let accessibilityLabel: String
    let signingOut: Bool
    let settings: @MainActor () -> Void
    let signOut: @MainActor () -> Void
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        AsyncImage(url: avatarURL) { phase in
            let photo = phase.image.flatMap { avatarImage($0) }
            NativeGlassButton(image: photo ?? fallbackImage, title: photo == nil && !initials.isEmpty ? initials : nil, menu: menu,
                              accessibilityLabel: accessibilityLabel, accessibilityValue: name, enabled: true, size: 46)
        }
    }

    private var initials: String {
        name.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined().uppercased()
    }

    private var fallbackImage: UIImage? {
        initials.isEmpty ? UIImage(systemName: "person.crop.circle", withConfiguration: UIImage.SymbolConfiguration(pointSize: 24)) : nil
    }

    /// Rasterize only the loaded photo, not the AsyncImage/control hierarchy.
    /// UIKit then owns the image during the button-to-menu transition.
    private func avatarImage(_ image: Image) -> UIImage? {
        let renderer = ImageRenderer(content: image.resizable().scaledToFill().frame(width: 30, height: 30).clipShape(Circle()))
        renderer.scale = displayScale
        return renderer.uiImage?.withRenderingMode(.alwaysOriginal)
    }

    private var menu: UIMenu {
        let showSettings = settings, disconnect = signOut
        return UIMenu(children: [
            UIAction(title: "Settings", image: UIImage(systemName: "gearshape")) { _ in
                Task { @MainActor in showSettings() }
            },
            UIAction(title: "Sign out", attributes: signingOut ? [.destructive, .disabled] : [.destructive]) { _ in
                Task { @MainActor in disconnect() }
            },
        ])
    }
}

/// The native configuration owns all visible content, so symbols, initials and
/// photos participate in the same Liquid Glass transition as the button.
struct NativeGlassButton: UIViewRepresentable {
    let image: UIImage?
    var title: String? = nil
    var menu: UIMenu? = nil
    let accessibilityLabel: String
    let accessibilityValue: String
    let enabled: Bool
    let size: CGFloat
    var action: (@MainActor () -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(configuration: configuration)
        button.addAction(UIAction { [weak coordinator = context.coordinator] _ in
            Task { @MainActor in coordinator?.action?() }
        }, for: .primaryActionTriggered)
        return button
    }

    private var configuration: UIButton.Configuration {
        var configuration: UIButton.Configuration
        if #available(iOS 26.0, *) { configuration = .glass() }
        else {
            configuration = .filled()
            configuration.baseBackgroundColor = UIColor(Palette.surface)
        }
        configuration.cornerStyle = .capsule
        configuration.contentInsets = .zero
        configuration.baseForegroundColor = UIColor(Palette.text)
        configuration.image = image
        configuration.title = title
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var attributes = incoming
            attributes.font = .systemFont(ofSize: UIFont.preferredFont(forTextStyle: .subheadline).pointSize, weight: .semibold)
            return attributes
        }
        return configuration
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIButton, context: Context) -> CGSize? {
        CGSize(width: size, height: size)
    }

    func updateUIView(_ button: UIButton, context: Context) {
        context.coordinator.action = action
        button.configuration = configuration
        button.menu = menu
        button.showsMenuAsPrimaryAction = menu != nil
        button.tintColor = UIColor(Palette.text)
        button.isEnabled = enabled && context.environment.isEnabled
        button.accessibilityLabel = accessibilityLabel
        button.accessibilityValue = accessibilityValue
    }

    @MainActor final class Coordinator {
        var action: (@MainActor () -> Void)?
    }
}
#endif
