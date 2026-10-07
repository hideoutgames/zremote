import Foundation

/// Foreground interaction events, distinct from system notifications.
public enum InteractionFeedback: String, Sendable {
    case selection, send, voiceStart, voiceFinish, refresh, finished
}
