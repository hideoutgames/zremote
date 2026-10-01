/// Shared intent and release rules for the native Sessions drawer gestures.
/// Platform recognizers own touch slop; this policy does not add another delay.
public enum DrawerGestureRules {
    public static func openingWidth(width: Double) -> Double {
        guard width.isFinite, width > 0 else { return 0 }
        return min(200, width * 0.55)
    }

    public static func canBegin(isOpen: Bool, startX: Double, width: Double,
                                translationX: Double, translationY: Double,
                                rightToLeft: Bool) -> Bool {
        guard width.isFinite, width > 0, startX.isFinite, (0...width).contains(startX),
              translationX.isFinite, translationY.isFinite else { return false }
        let direction = (isOpen ? -1.0 : 1.0) * (rightToLeft ? -1.0 : 1.0)
        guard translationX * direction > 0, abs(translationX) >= 1.8 * abs(translationY) else { return false }
        if isOpen { return true }
        let leadingDistance = rightToLeft ? width - startX : startX
        return leadingDistance <= openingWidth(width: width)
    }

    public static func targetIsOpen(wasOpen: Bool, translationX: Double, velocityX: Double,
                                    distance: Double, rightToLeft: Bool) -> Bool {
        guard distance.isFinite, distance > 0, translationX.isFinite, velocityX.isFinite else { return wasOpen }
        let direction = (wasOpen ? -1.0 : 1.0) * (rightToLeft ? -1.0 : 1.0)
        let travel = translationX * direction
        guard travel > 0 else { return wasOpen }
        if travel >= distance * 0.30 { return !wasOpen }

        let velocity = velocityX * direction
        guard travel >= 36, velocity >= 650 else { return wasOpen }
        // A fast release may help finish deliberate movement, but its projection
        // cannot contribute more than half of the drawer's travel distance.
        let projectedTravel = travel + min(velocity * 0.18, distance * 0.5)
        return projectedTravel >= distance * 0.5 ? !wasOpen : wasOpen
    }
}
