import XCTest
import ZRemoteCore

final class TranscriptScrollStateTests: XCTestCase {
    func testComposerInsetAndKeyboardChangeBottomDetection() {
        XCTAssertTrue(TranscriptScrollState.isAtBottom(contentHeight: 6376, bottomInset: 169,
                                                       visibleBottom: 6545))
        XCTAssertFalse(TranscriptScrollState.isAtBottom(contentHeight: 6376, bottomInset: 463,
                                                        visibleBottom: 6545))
        XCTAssertTrue(TranscriptScrollState.isAtBottom(contentHeight: 6376, bottomInset: 463,
                                                       visibleBottom: 6839))
        XCTAssertFalse(TranscriptScrollState.isAtBottom(contentHeight: 6376, bottomInset: 169,
                                                        visibleBottom: 6159.33))
        XCTAssertTrue(TranscriptScrollState.isAtBottom(contentHeight: 200, bottomInset: 200,
                                                       visibleBottom: 1000))
    }

    func testBottomToleranceAndNonfiniteGeometry() {
        XCTAssertTrue(TranscriptScrollState.isAtBottom(contentHeight: 6376, bottomInset: 169,
                                                       visibleBottom: 6521))
        XCTAssertFalse(TranscriptScrollState.isAtBottom(contentHeight: 6376, bottomInset: 169,
                                                        visibleBottom: 6520))
        XCTAssertTrue(TranscriptScrollState.isAtBottom(contentHeight: 6376, bottomInset: 169,
                                                       visibleBottom: 6600))
        XCTAssertFalse(TranscriptScrollState.isAtBottom(contentHeight: 6376, bottomInset: 169,
                                                        visibleBottom: .infinity))
    }

    func testJumpRemainsVisibleUntilGeometryConfirmsArrival() {
        var state = TranscriptScrollState()
        state.update(atBottom: false)
        state.beginUserScroll()
        state.requestJump()
        XCTAssertTrue(state.showsJump)
        XCTAssertTrue(state.shouldFollow)
        state.update(atBottom: false)
        state.endUserScroll()
        XCTAssertTrue(state.jumpPending)
        XCTAssertTrue(state.shouldFollow)
        XCTAssertTrue(state.showsJump)
        state.update(atBottom: true)
        XCTAssertFalse(state.jumpPending)
        XCTAssertFalse(state.showsJump)
    }

    func testUserScrollKeepsFollowingPausedThroughMomentum() {
        var state = TranscriptScrollState()
        state.update(atBottom: true)
        state.beginUserScroll()
        state.update(atBottom: true)
        XCTAssertFalse(state.shouldFollow)
        state.update(atBottom: false)
        XCTAssertTrue(state.showsJump)
        XCTAssertFalse(state.shouldFollow)
        state.endUserScroll()
        XCTAssertFalse(state.shouldFollow)
        state.update(atBottom: false)
        XCTAssertFalse(state.shouldFollow)
    }

    func testManualReturnToBottomResumesOnlyAfterScrollingSettles() {
        var state = TranscriptScrollState()
        state.beginUserScroll()
        state.update(atBottom: false)
        state.update(atBottom: true)
        XCTAssertFalse(state.showsJump)
        XCTAssertFalse(state.shouldFollow)
        state.endUserScroll()
        XCTAssertTrue(state.shouldFollow)
    }

    func testNewGestureCancelsPendingJump() {
        var state = TranscriptScrollState()
        state.update(atBottom: false)
        state.requestJump()
        state.beginUserScroll()
        state.update(atBottom: false)
        state.endUserScroll()
        XCTAssertFalse(state.jumpPending)
        XCTAssertFalse(state.shouldFollow)
        XCTAssertTrue(state.showsJump)
    }

    func testContentGrowthPreservesFollowIntentButStillShowsActualPosition() {
        var state = TranscriptScrollState()
        XCTAssertFalse(state.showsJump)
        state.update(atBottom: true)
        state.update(atBottom: false)
        XCTAssertTrue(state.shouldFollow)
        XCTAssertTrue(state.showsJump)
        state.update(atBottom: true)
        XCTAssertFalse(state.showsJump)
    }
}
