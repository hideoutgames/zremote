import SwiftUI
import ZRemoteCore

struct CheckoutPickerView: View {
    @Bindable var model: AppModel
    @State private var context: String?
    @State private var selectionError: String?

    private var contextMatches: Bool { context == model.checkoutContext }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let name = model.project?.name, !name.isEmpty {
                    Text(name).font(.title2.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                }
                if context != nil, !contextMatches {
                    message("The project changed. Close this picker and choose a checkout again.")
                } else if !model.canChooseCheckout {
                    message("Choose a repository for a new session to select a checkout.")
                } else {
                    choice(title: "New worktree", detail: nil, selected: model.checkoutSelection == .newWorktree) {
                        choose(.newWorktree)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Existing checkouts").font(.subheadline.weight(.medium)).foregroundStyle(Palette.secondary)
                            .padding(.horizontal, 4)
                        if model.loadingCheckouts || context == nil {
                            ProgressView().tint(Palette.secondary)
                                .frame(maxWidth: .infinity).padding(.vertical, 20)
                        } else {
                            if let error = model.checkoutError {
                                VStack(spacing: 12) {
                                    message(error)
                                    Button("Retry") {
                                        selectionError = nil
                                        Task { await model.loadCheckouts() }
                                    }
                                        .font(.subheadline.weight(.medium)).frame(minHeight: 44)
                                }
                            }
                            if model.checkouts.isEmpty {
                                if model.checkoutError == nil { message("No existing checkouts are available.") }
                            } else {
                                ForEach(model.checkouts) { checkout in
                                    choice(title: checkout.branch.isEmpty ? (checkout.isCurrent ? "Current checkout" : "Checkout") : checkout.branch,
                                           detail: checkout.path, selected: isSelected(checkout)) {
                                        choose(checkout.isCurrent ? .current : .existing(checkout))
                                    }
                                }
                            }
                        }
                    }
                    if let selectionError { message(selectionError) }
                }
            }
            .frame(maxWidth: 660, alignment: .leading)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.background)
        .foregroundStyle(Palette.text)
        .navigationTitle("Choose checkout")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("checkout-picker")
        .task {
            if context == nil { context = model.checkoutContext }
            guard contextMatches else { return }
            await model.loadCheckouts()
        }
    }

    private func choice(title: String, detail: String?, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(title).font(.body.weight(.medium)).multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if let detail, !detail.isEmpty {
                        Text(detail).font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Palette.secondary).multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 21)).foregroundStyle(selected ? Palette.text : Palette.secondary)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 32).padding(16)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(selected ? Palette.text.opacity(0.25) : Palette.line))
            .contentShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .disabled(!contextMatches)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func message(_ text: String) -> some View {
        Text(text).font(.subheadline).foregroundStyle(Palette.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func isSelected(_ checkout: ProjectCheckout) -> Bool {
        switch model.checkoutSelection {
        case .current: checkout.isCurrent
        case .newWorktree: false
        case .existing(let selected): selected.id == checkout.id
        }
    }

    private func choose(_ selection: CheckoutSelection) {
        guard let context, contextMatches else { return }
        if !model.selectCheckout(selection, context: context) {
            selectionError = "This checkout is no longer available. Please try again."
        }
    }
}
