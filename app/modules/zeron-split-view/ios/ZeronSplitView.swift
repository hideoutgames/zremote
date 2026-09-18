// ⚠️ WRITTEN BUT UNVERIFIED — never compiled. A Fabric component that wraps
// a UISplitViewController child-VC is architecturally risky: Fabric child
// views are UIView, not UIViewController, so each column view must be hosted
// inside a plain UIViewController wrapper. Verify on a Mac (see
// docs/NATIVE_MODULES.md) before AdaptiveShell flips `useNativeSplitView`.

import UIKit

/// Plain container VC for one RN column view.
final class ZeronColumnController: UIViewController {
  let columnView = UIView()
  override func loadView() { view = columnView }
}

final class ZeronSplitViewContainer: UIView, UISplitViewControllerDelegate {
  private let splitVC = UISplitViewController(style: .tripleColumn)
  private let sidebarHost = ZeronColumnController()
  private let contentHost = ZeronColumnController()
  private let inspectorHost = ZeronColumnController()
  private var didAttach = false

  @objc var preferredDisplayMode: NSNumber = 0 {
    didSet {
      splitVC.preferredDisplayMode =
        UISplitViewController.DisplayMode(rawValue: preferredDisplayMode.intValue) ?? .automatic
    }
  }
  @objc var presentsWithGesture: Bool = true {
    didSet { splitVC.presentsWithGesture = presentsWithGesture }
  }
  // RN event emission is wired in the generated component view (.mm).
  @objc var onDisplayModeChange: ((NSNumber) -> Void)?

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil, !didAttach, let parent = reactViewController() else { return }
    didAttach = true
    splitVC.delegate = self
    splitVC.setViewController(sidebarHost, for: .primary)
    splitVC.setViewController(contentHost, for: .secondary)
    splitVC.setViewController(inspectorHost, for: .supplementary)
    parent.addChild(splitVC)
    addSubview(splitVC.view)
    splitVC.view.frame = bounds
    splitVC.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    splitVC.didMove(toParent: parent)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    splitVC.view.frame = bounds
  }

  /// Fabric mounts children in order: 0 sidebar, 1 content, 2 inspector.
  func mountColumn(_ child: UIView, at index: Int) {
    let host = index == 0 ? sidebarHost : index == 1 ? contentHost : inspectorHost
    host.columnView.subviews.forEach { $0.removeFromSuperview() }
    child.frame = host.columnView.bounds
    child.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    host.columnView.addSubview(child)
  }

  @objc func collapse() {
    splitVC.preferredDisplayMode = .secondaryOnly
  }
  @objc func expand() {
    splitVC.preferredDisplayMode = .oneBesideSecondary
  }

  func splitViewController(
    _ svc: UISplitViewController,
    didChangeTo displayMode: UISplitViewController.DisplayMode
  ) {
    onDisplayModeChange?(NSNumber(value: displayMode.rawValue))
  }

  private func reactViewController() -> UIViewController? {
    var r = next
    while let responder = r {
      if let vc = responder as? UIViewController { return vc }
      r = responder.next
    }
    return nil
  }
}
