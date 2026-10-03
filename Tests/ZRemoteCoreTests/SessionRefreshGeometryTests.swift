import XCTest
import ZRemoteCore

final class SessionRefreshGeometryTests: XCTestCase {
    func testSlowHeldPullRemainsContinuousWhenNativeRefreshInsetExpands() {
        var geometry = SessionRefreshGeometry(restingTopInset: 20, systemTopInset: 20)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -100, adjustedTopInset: 20, systemTopInset: 20, dragging: true, refreshing: false), 80)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -100, adjustedTopInset: 40, systemTopInset: 20, dragging: true, refreshing: false), 80)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -100, adjustedTopInset: 80, systemTopInset: 20, dragging: true, refreshing: true), 80)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -140, adjustedTopInset: 80, systemTopInset: 20, dragging: true, refreshing: true), 120)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -70, adjustedTopInset: 80, systemTopInset: 20, dragging: true, refreshing: true), 50)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -80, adjustedTopInset: 80, systemTopInset: 20, dragging: false, refreshing: true), 60)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -20, adjustedTopInset: 20, systemTopInset: 20, dragging: false, refreshing: false), 0)
    }

    func testSafeAreaChangesDuringRefreshDoNotLeaveARecessOrShiftTheNextPull() {
        var geometry = SessionRefreshGeometry(restingTopInset: 20, systemTopInset: 20)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -80, adjustedTopInset: 80, systemTopInset: 20, dragging: false, refreshing: true), 60)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -104, adjustedTopInset: 104, systemTopInset: 44, dragging: false, refreshing: true), 60)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -44, adjustedTopInset: 44, systemTopInset: 44, dragging: false, refreshing: false), 0)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -74, adjustedTopInset: 44, systemTopInset: 44, dragging: true, refreshing: false), 30)
        // Rotate back while the second pull is active, then let it cancel.
        XCTAssertEqual(geometry.reveal(contentOffsetY: -30, adjustedTopInset: 0, systemTopInset: 0, dragging: true, refreshing: false), 30)
        XCTAssertEqual(geometry.reveal(contentOffsetY: 0, adjustedTopInset: 0, systemTopInset: 0, dragging: false, refreshing: false), 0)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -30, adjustedTopInset: 0, systemTopInset: 0, dragging: true, refreshing: false), 30)
    }

    func testPullUsesRestingInsetThroughRefreshExpansionAndCollapse() {
        var geometry = SessionRefreshGeometry(restingTopInset: 20)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -20, adjustedTopInset: 20, dragging: false, refreshing: false), 0)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -64, adjustedTopInset: 20, dragging: true, refreshing: false), 44)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -80, adjustedTopInset: 80, dragging: false, refreshing: true), 60)
        // endRefreshing flips the flag before the native inset animation ends.
        XCTAssertEqual(geometry.reveal(contentOffsetY: -80, adjustedTopInset: 80, dragging: false, refreshing: false), 60)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -45, adjustedTopInset: 45, dragging: false, refreshing: false), 25)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -20, adjustedTopInset: 20, dragging: false, refreshing: false), 0)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -20, adjustedTopInset: 20, dragging: true, refreshing: false), 0)
    }

    func testCancelledPullAndScrolledContentDoNotLeaveARecess() {
        var geometry = SessionRefreshGeometry(restingTopInset: 0)
        XCTAssertEqual(geometry.reveal(contentOffsetY: 120, adjustedTopInset: 0, dragging: true, refreshing: false), 0)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -25, adjustedTopInset: 0, dragging: true, refreshing: false), 25)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -8, adjustedTopInset: 0, dragging: false, refreshing: false), 8)
        XCTAssertEqual(geometry.reveal(contentOffsetY: 0, adjustedTopInset: 0, dragging: false, refreshing: false), 0)
        XCTAssertEqual(geometry.reveal(contentOffsetY: 40, adjustedTopInset: 0, dragging: false, refreshing: false), 0)
    }

    func testIdleInsetChangesAndProgrammaticRefreshUseTheLatestRestingPosition() {
        var geometry = SessionRefreshGeometry(restingTopInset: 0)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -44, adjustedTopInset: 44, dragging: false, refreshing: false), 0)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -104, adjustedTopInset: 104, dragging: false, refreshing: true), 60)
        XCTAssertEqual(geometry.reveal(contentOffsetY: -44, adjustedTopInset: 44, dragging: false, refreshing: false), 0)
        XCTAssertEqual(geometry.reveal(contentOffsetY: 0, adjustedTopInset: 0, dragging: false, refreshing: false), 0)
    }
}
