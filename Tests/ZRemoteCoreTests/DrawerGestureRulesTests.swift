import XCTest
import ZRemoteCore

final class DrawerGestureRulesTests: XCTestCase {
    func testOpeningRequiresLeadingBandAndHorizontalIntent() {
        XCTAssertEqual(DrawerGestureRules.openingWidth(width: 300), 165)
        XCTAssertEqual(DrawerGestureRules.openingWidth(width: 1_000), 200)
        XCTAssertTrue(DrawerGestureRules.canBegin(isOpen: false, startX: 165, width: 300,
                                                  translationX: 10, translationY: 5, rightToLeft: false))
        XCTAssertFalse(DrawerGestureRules.canBegin(isOpen: false, startX: 166, width: 300,
                                                   translationX: 100, translationY: 0, rightToLeft: false))
        XCTAssertFalse(DrawerGestureRules.canBegin(isOpen: false, startX: 50, width: 300,
                                                   translationX: -40, translationY: 0, rightToLeft: false))
        XCTAssertFalse(DrawerGestureRules.canBegin(isOpen: false, startX: 50, width: 300,
                                                   translationX: 15, translationY: 10, rightToLeft: false))
        XCTAssertFalse(DrawerGestureRules.canBegin(isOpen: false, startX: 50, width: 300,
                                                   translationX: 0, translationY: 40, rightToLeft: false))
        // Once open, dismissal may begin anywhere on the drawer or scrim.
        XCTAssertTrue(DrawerGestureRules.canBegin(isOpen: true, startX: 280, width: 300,
                                                  translationX: -10, translationY: -5, rightToLeft: false))
    }

    func testShortHighVelocityFlickCannotOpenOrCloseDrawer() {
        XCTAssertFalse(DrawerGestureRules.targetIsOpen(wasOpen: false, translationX: 35, velocityX: 10_000,
                                                       distance: 300, rightToLeft: false))
        XCTAssertTrue(DrawerGestureRules.targetIsOpen(wasOpen: true, translationX: -35, velocityX: -10_000,
                                                      distance: 300, rightToLeft: false))
    }

    func testSlowDragCommitsAtThirtyPercentWithoutReleaseVelocity() {
        XCTAssertFalse(DrawerGestureRules.targetIsOpen(wasOpen: false, translationX: 89, velocityX: 0,
                                                       distance: 300, rightToLeft: false))
        XCTAssertTrue(DrawerGestureRules.targetIsOpen(wasOpen: false, translationX: 90, velocityX: 0,
                                                      distance: 300, rightToLeft: false))
        XCTAssertTrue(DrawerGestureRules.targetIsOpen(wasOpen: true, translationX: -89, velocityX: 0,
                                                      distance: 300, rightToLeft: false))
        XCTAssertFalse(DrawerGestureRules.targetIsOpen(wasOpen: true, translationX: -90, velocityX: 0,
                                                       distance: 300, rightToLeft: false))
    }

    func testFlickMustHaveDeliberateTravelMatchingVelocityAndEnoughProjection() {
        XCTAssertTrue(DrawerGestureRules.targetIsOpen(wasOpen: false, translationX: 36, velocityX: 650,
                                                      distance: 300, rightToLeft: false))
        XCTAssertFalse(DrawerGestureRules.targetIsOpen(wasOpen: false, translationX: 36, velocityX: 649,
                                                       distance: 300, rightToLeft: false))
        XCTAssertFalse(DrawerGestureRules.targetIsOpen(wasOpen: false, translationX: 36, velocityX: 650,
                                                       distance: 600, rightToLeft: false))
        XCTAssertFalse(DrawerGestureRules.targetIsOpen(wasOpen: false, translationX: 60, velocityX: -1_000,
                                                       distance: 300, rightToLeft: false))
        XCTAssertTrue(DrawerGestureRules.targetIsOpen(wasOpen: true, translationX: -60, velocityX: 1_000,
                                                      distance: 300, rightToLeft: false))
        XCTAssertFalse(DrawerGestureRules.targetIsOpen(wasOpen: false, translationX: -100, velocityX: 1_000,
                                                       distance: 300, rightToLeft: false))
    }

    func testRightToLeftMirrorsLeadingBandAndOpenCloseDirections() {
        XCTAssertTrue(DrawerGestureRules.canBegin(isOpen: false, startX: 250, width: 300,
                                                  translationX: -20, translationY: 0, rightToLeft: true))
        XCTAssertFalse(DrawerGestureRules.canBegin(isOpen: false, startX: 50, width: 300,
                                                   translationX: -20, translationY: 0, rightToLeft: true))
        for wasOpen in [false, true] {
            let direction = wasOpen ? -1.0 : 1.0
            for travel in [35.0, 36.0, 89.0, 90.0] {
                for velocity in [-650.0, 0.0, 650.0] {
                    let ltr = DrawerGestureRules.targetIsOpen(wasOpen: wasOpen, translationX: direction * travel,
                        velocityX: direction * velocity, distance: 300, rightToLeft: false)
                    let rtl = DrawerGestureRules.targetIsOpen(wasOpen: wasOpen, translationX: -direction * travel,
                        velocityX: -direction * velocity, distance: 300, rightToLeft: true)
                    XCTAssertEqual(ltr, rtl)
                }
            }
            XCTAssertEqual(
                DrawerGestureRules.canBegin(isOpen: wasOpen, startX: 50, width: 300,
                    translationX: direction * 20, translationY: 5, rightToLeft: false),
                DrawerGestureRules.canBegin(isOpen: wasOpen, startX: 250, width: 300,
                    translationX: -direction * 20, translationY: 5, rightToLeft: true))
        }
    }

    func testInvalidGeometryCannotBeginOrChangeDrawerState() {
        for width in [0, -1, Double.nan, Double.infinity] {
            XCTAssertEqual(DrawerGestureRules.openingWidth(width: width), 0)
            XCTAssertFalse(DrawerGestureRules.canBegin(isOpen: false, startX: 0, width: width,
                                                       translationX: 100, translationY: 0, rightToLeft: false))
            for wasOpen in [false, true] {
                XCTAssertEqual(DrawerGestureRules.targetIsOpen(wasOpen: wasOpen, translationX: wasOpen ? -100 : 100,
                    velocityX: 0, distance: width, rightToLeft: false), wasOpen)
            }
        }
        for invalid in [Double.nan, Double.infinity, -Double.infinity] {
            XCTAssertFalse(DrawerGestureRules.canBegin(isOpen: false, startX: invalid, width: 300,
                                                       translationX: 100, translationY: 0, rightToLeft: false))
            XCTAssertFalse(DrawerGestureRules.canBegin(isOpen: false, startX: 0, width: 300,
                                                       translationX: invalid, translationY: 0, rightToLeft: false))
            XCTAssertFalse(DrawerGestureRules.canBegin(isOpen: false, startX: 0, width: 300,
                                                       translationX: 100, translationY: invalid, rightToLeft: false))
            for wasOpen in [false, true] {
                XCTAssertEqual(DrawerGestureRules.targetIsOpen(wasOpen: wasOpen, translationX: invalid,
                    velocityX: 0, distance: 300, rightToLeft: false), wasOpen)
                XCTAssertEqual(DrawerGestureRules.targetIsOpen(wasOpen: wasOpen, translationX: wasOpen ? -100 : 100,
                    velocityX: invalid, distance: 300, rightToLeft: false), wasOpen)
            }
        }
    }
}
