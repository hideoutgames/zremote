#if os(iOS)
import Foundation
@preconcurrency import UserNotifications
import ZRemoteCore

/// TEMPORARY mobile-only delivery: the connected peer schedules local alerts.
/// This cannot wake a suspended/terminated app to discover new host events.
/// Replace delivery with an independent push service when one is available;
/// never register this app's device token with Zeron's unrelated APNs topic.
@MainActor public final class AppleSessionNotifications: NSObject, NotificationService, UNUserNotificationCenterDelegate {
    public static let shared = AppleSessionNotifications()
    public var onSession: (@MainActor (String) -> Void)?
    public let supported = true
    private var generation = 0

    private override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    public func authorization(request: Bool) async -> NotificationAuthorization {
        let center = UNUserNotificationCenter.current()
        let status = await center.notificationSettings().authorizationStatus
        if status == .notDetermined, request {
            return (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) == true ? .authorized : .denied
        }
        switch status {
        case .authorized, .provisional, .ephemeral: return .authorized
        case .notDetermined: return .notDetermined
        default: return .denied
        }
    }

    public func deliver(_ event: SessionNotification) async throws {
        let epoch = generation
        let content = UNMutableNotificationContent()
        content.title = "ZRemote"
        switch event.kind {
        case .question: content.body = "Your agent is waiting for a response."
        case .finished: content.body = "Your agent finished working."
        case .usageLimit: content.body = "Usage limits approaching."
        }
        content.sound = .default
        content.userInfo = ["chatId": event.sessionID]
        let request = UNNotificationRequest(identifier: event.id, content: content, trigger: nil)
        let center = UNUserNotificationCenter.current()
        try Task.checkCancellation()
        try await center.add(request)
        if epoch != generation || Task.isCancelled {
            center.removePendingNotificationRequests(withIdentifiers: [event.id])
            center.removeDeliveredNotifications(withIdentifiers: [event.id])
            throw CancellationError()
        }
    }

    public func stop() {
        generation += 1
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }

    nonisolated public func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                                   withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    nonisolated public func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                                   withCompletionHandler completionHandler: @escaping @Sendable () -> Void) {
        let sessionID = response.notification.request.content.userInfo["chatId"] as? String
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                if let sessionID, !sessionID.isEmpty, sessionID.utf8.count <= 256 { self.onSession?(sessionID) }
            }
            completionHandler()
        }
    }
}
#endif
