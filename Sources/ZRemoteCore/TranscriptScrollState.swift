public struct TranscriptScrollState: Equatable, Sendable {
    public private(set) var atBottom: Bool?
    public private(set) var following = true
    public private(set) var userScrolling = false
    public private(set) var jumpPending = false

    public init() {}

    public var showsJump: Bool { atBottom == false }
    public var shouldFollow: Bool { following && !userScrolling }

    public static func isAtBottom(contentHeight: Double, bottomInset: Double, visibleBottom: Double) -> Bool {
        let distance = contentHeight + bottomInset - visibleBottom
        return distance.isFinite && distance <= 24
    }

    public mutating func update(atBottom: Bool) {
        self.atBottom = atBottom
        if atBottom {
            jumpPending = false
            if !userScrolling { following = true }
        }
    }

    public mutating func beginUserScroll() {
        userScrolling = true
        following = false
        jumpPending = false
    }

    public mutating func endUserScroll() {
        userScrolling = false
        if !jumpPending { following = atBottom == true }
    }

    public mutating func requestJump() {
        following = true
        userScrolling = false
        jumpPending = true
    }
}
