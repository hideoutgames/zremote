// swift-tools-version: 6.1
import Foundation
import PackageDescription

// The domain tests do not resolve UI or platform dependencies.
let coreOnly = ProcessInfo.processInfo.environment["ZREMOTE_CORE_ONLY"] == "1"
let package = Package(
    name: "zremote",
    defaultLocalization: "en",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "ZRemoteCore", targets: ["ZRemoteCore"])],
    targets: [
        .target(name: "ZRemoteCore", dependencies: coreOnly ? [] : [
            .product(name: "SkipFuse", package: "skip-fuse"),
        ]),
        .testTarget(name: "ZRemoteCoreTests", dependencies: ["ZRemoteCore"]),
    ]
)

if !coreOnly {
    package.products.append(.library(name: "ZRemote", type: .dynamic, targets: ["ZRemote"]))
    package.dependencies += [
        .package(url: "https://github.com/skiptools/skip.git", exact: "1.9.12"),
        .package(url: "https://github.com/skiptools/skip-fuse-ui.git", exact: "1.19.0"),
        .package(url: "https://github.com/skiptools/skip-fuse.git", exact: "1.0.3"),
        .package(url: "https://github.com/skiptools/skip-keychain.git", exact: "0.3.4"),
        .package(url: "https://github.com/skiptools/skip-authentication-services.git", exact: "0.1.0"),
    ]
    if let abi = ProcessInfo.processInfo.environment["SKIP_ZREMOTE_ANDROID_ABI"] {
        precondition(["arm64-v8a", "x86_64"].contains(abi), "Unsupported Android architecture")
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path
        package.targets.append(.target(
            name: "zeron_coreFFI", path: "native/ffi", publicHeadersPath: "include",
            linkerSettings: [.unsafeFlags(["-L\(root)/native/artifacts/android/\(abi)", "-lzeron_mobile"])]
        ))
    } else {
        package.targets.append(.binaryTarget(name: "zeron_coreFFI", path: "native/artifacts/zeron_coreFFI.xcframework"))
    }
    let nativeDependencies: [Target.Dependency] = [
        "ZRemoteCore",
        "zeron_coreFFI",
        .product(name: "SkipKeychain", package: "skip-keychain"),
    ]
    package.targets += [
        .target(name: "ZRemoteNative", dependencies: nativeDependencies, linkerSettings: [
            // Carry the Rust static archive's Apple framework requirements into SwiftPM.
            .linkedFramework("CoreFoundation", .when(platforms: [.iOS, .macOS])),
            .linkedFramework("SystemConfiguration", .when(platforms: [.macOS])),
            .linkedFramework("Network", .when(platforms: [.macOS])),
        ]),
        .target(
            name: "ZRemote",
            dependencies: ["ZRemoteCore", "ZRemoteNative", .product(name: "SkipFuseUI", package: "skip-fuse-ui"), .product(name: "SkipAuthenticationServices", package: "skip-authentication-services")],
            resources: [.process("Resources")],
            plugins: [.plugin(name: "skipstone", package: "skip")]
        ),
    ]
}
