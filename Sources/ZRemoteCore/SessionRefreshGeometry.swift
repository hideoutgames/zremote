import Foundation

/// Keep the resting inset while UIKit expands and collapses its refresh inset.
/// Subtracting the live inset would hide the recess during native refreshing.
public struct SessionRefreshGeometry: Sendable {
    private var restingTopInset: Double
    private var systemTopInset: Double
    private var preservingInset = false

    public init(restingTopInset: Double, systemTopInset: Double = 0) {
        self.restingTopInset = restingTopInset
        self.systemTopInset = systemTopInset
    }

    public mutating func reveal(contentOffsetY: Double, adjustedTopInset: Double,
                                systemTopInset: Double = 0,
                                dragging: Bool, refreshing: Bool) -> Double {
        guard contentOffsetY.isFinite, adjustedTopInset.isFinite, systemTopInset.isFinite else { return 0 }
        // Rotation can change the safe-area contribution before the refresh
        // inset collapses. Move the resting baseline with that system delta.
        restingTopInset += systemTopInset - self.systemTopInset
        self.systemTopInset = systemTopInset
        if !preservingInset {
            if dragging || refreshing { preservingInset = true }
            else { restingTopInset = adjustedTopInset }
        }
        let height = max(0, -contentOffsetY - restingTopInset)
        if preservingInset, !dragging, !refreshing, height < 0.5,
           abs(adjustedTopInset - restingTopInset) < 0.5 {
            preservingInset = false
            restingTopInset = adjustedTopInset
        }
        return height
    }
}
