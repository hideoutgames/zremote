import XCTest
import ZRemoteCore

final class AuthenticationCallbackTests: XCTestCase {
    func testQueryCredentialsRemainValidWithRedirectFragments() throws {
        for fragment in ["", "_=_", "code=ignored&state=ignored"] {
            let callback = try XCTUnwrap(URL(string: "zeron://callback?code=one%2Btwo&state=expected#\(fragment)"))
            XCTAssertEqual(try AuthenticationCallback.code(from: callback, expectedState: "expected"), "one+two")
        }
    }

    func testFragmentCannotSupplyOrOverrideQueryCredentials() throws {
        let callbacks = [
            "zeron://callback#code=value&state=expected",
            "zeron://callback?code=value#state=expected",
            "zeron://callback?state=expected#code=value",
            "zeron://callback?code=value&state=wrong#state=expected",
            "zeron://callback?code=value&state=expected&state=expected#",
            "zeron://callback?code=value&code=other&state=expected#",
            "zeron://callback?code=&state=expected#code=value"
        ]
        for raw in callbacks {
            let callback = try XCTUnwrap(URL(string: raw))
            XCTAssertThrowsError(try AuthenticationCallback.code(from: callback, expectedState: "expected"))
        }
    }

    func testFragmentDoesNotHideProviderRejection() throws {
        let callback = try XCTUnwrap(URL(string: "zeron://callback?state=expected&error=denied&error_description=private#_=_"))
        XCTAssertThrowsError(try AuthenticationCallback.code(from: callback, expectedState: "expected")) { error in
            XCTAssertEqual((error as? ClientFailure)?.message, "The login provider declined sign-in. Please start again.")
        }
    }

    func testRedirectFragmentDoesNotRelaxEndpointValidation() throws {
        let callbacks = [
            "https://callback?code=value&state=expected#",
            "zeron://elsewhere?code=value&state=expected#",
            "zeron://callback/elsewhere?code=value&state=expected#",
            "zeron://user@callback?code=value&state=expected#",
            "zeron://callback:123?code=value&state=expected#"
        ]
        for raw in callbacks {
            let callback = try XCTUnwrap(URL(string: raw))
            XCTAssertThrowsError(try AuthenticationCallback.code(from: callback, expectedState: "expected"))
        }
    }
}
