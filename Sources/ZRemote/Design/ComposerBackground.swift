import Foundation
import SwiftUI
import ZRemoteCore
import ZRemoteNative
#if os(iOS)
import UIKit
import ImageIO
#endif

enum BackgroundMode: String, CaseIterable, Identifiable, Sendable {
    case none, dither, ascii, halftone, scanlines
    var id: String { rawValue }
    var label: String { self == .ascii ? "ASCII" : rawValue.capitalized }
    var native: WallpaperEffect {
        switch self {
        case .none: .none
        case .dither: .dither
        case .ascii: .ascii
        case .halftone: .halftone
        case .scanlines: .scanlines
        }
    }
}

struct BackgroundRequest: Hashable {
    let data: Data?
    let effect: String
    let light: Bool
}

struct ComposerSceneFrameKey: EnvironmentKey {
    static let defaultValue: CGRect? = nil
}

extension EnvironmentValues {
    /// The whole window, including safe areas, in global coordinates. Both the
    /// blank Composer and the refresh recess show the same stationary image.
    var composerSceneFrame: CGRect? {
        get { self[ComposerSceneFrameKey.self] }
        set { self[ComposerSceneFrameKey.self] = newValue }
    }
}

struct ComposerBackground: View {
    let data: Data?
    let effect: String
    let fullHeight: Bool
    let fadeEndY: CGFloat?
    @State var image: Image?
    @State var opacity = 0.0
    @Environment(\.colorScheme) var colorScheme
    @Environment(\.composerSceneFrame) var sceneFrame

    var body: some View {
        GeometryReader { geometry in
            let local = geometry.frame(in: .global)
            let scene = sceneFrame ?? local
            let endY = fadeEndY ?? (scene.minY + scene.height * 0.52)
            let end = min(1, max(0, (endY - scene.minY) / max(1, scene.height)))
            Group {
                if let image {
                    image.resizable().scaledToFill()
                        .frame(width: scene.width, height: scene.height).clipped()
                        .opacity(opacity)
                } else if data == nil {
                    RadialGradient(colors: [Color(white: 0.28).opacity(0.45), .clear],
                                   center: .topTrailing, startRadius: 20, endRadius: 580)
                }
            }
            .frame(width: scene.width, height: scene.height)
            .mask(LinearGradient(stops: fullHeight ? [
                .init(color: .black, location: 0),
                .init(color: .black.opacity(0.8), location: 0.35),
                .init(color: .clear, location: 1)
            ] : [
                .init(color: .black, location: 0),
                .init(color: .black.opacity(0.55), location: 0.22),
                .init(color: .black.opacity(0.15), location: 0.68),
                .init(color: .clear, location: 1)
            ], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: fullHeight ? 1 : end)))
            .position(x: scene.midX - local.minX, y: scene.midY - local.minY)
        }
        .clipped()
        .allowsHitTesting(false).accessibilityHidden(true)
        .task(id: BackgroundRequest(data: data, effect: effect, light: colorScheme == .light)) {
            image = nil; opacity = 0
            guard let data, let render = await BackgroundImages.render(data, mode: BackgroundMode(rawValue: effect) ?? .none, light: colorScheme == .light),
                  !Task.isCancelled else { return }
            #if os(iOS) || os(Android)
            if let decoded = UIImage(data: render.data) {
                image = Image(uiImage: decoded); opacity = render.opacity
            }
            #endif
        }
    }
}

enum BackgroundImages {
    struct Render: Sendable { let data: Data; let opacity: Double }

    /// Decode a bounded thumbnail before storing it. Camera metadata and the
    /// original library URI never enter preferences or the host connection.
    static func prepare(_ data: Data) async -> Data? {
        guard data.count <= LocalAttachment.maximumBytes else { return nil }
        #if os(iOS)
        return await Task.detached(priority: .userInitiated) {
            guard let image = thumbnail(data), let encoded = UIImage(cgImage: image).jpegData(compressionQuality: 0.88),
                  encoded.count <= 2_000_000 else { return nil }
            return encoded
        }.value
        #elseif os(Android)
        return await androidPrepareBackground(data)
        #else
        return nil
        #endif
    }

    static func render(_ data: Data, mode: BackgroundMode, light: Bool) async -> Render? {
        guard data.count <= 2_000_000 else { return nil }
        #if os(iOS)
        return await Task.detached(priority: .utility) {
            guard let image = thumbnail(data) else { return nil }
            let width = image.width, height = image.height
            var pixels = Data(count: width * height * 4)
            let drawn = pixels.withUnsafeMutableBytes { bytes -> Bool in
                guard let context = CGContext(data: bytes.baseAddress, width: width, height: height,
                    bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
                context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
                return true
            }
            guard drawn else { return nil }
            let result = transformed(pixels, width: width, height: height, mode: mode, light: light)
            guard let provider = CGDataProvider(data: result.data as CFData),
                  let output = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                    bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                    provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent),
                  let png = UIImage(cgImage: output).pngData() else { return nil }
            return Render(data: png, opacity: result.opacity)
        }.value
        #elseif os(Android)
        guard let decoded = await androidBackgroundPixels(data), decoded.count == 3,
              let width = Int(decoded[0]), let height = Int(decoded[1]), width > 0, height > 0,
              width <= 1024, height <= 1024, let pixels = Data(base64Encoded: decoded[2]),
              pixels.count == width * height * 4 else { return nil }
        let result = await Task.detached(priority: .utility) {
            transformed(pixels, width: width, height: height, mode: mode, light: light)
        }.value
        guard let png = await androidBackgroundPNG(result.data, width: width, height: height) else { return nil }
        return Render(data: png, opacity: result.opacity)
        #else
        return nil
        #endif
    }

    private static func transformed(_ pixels: Data, width: Int, height: Int, mode: BackgroundMode, light: Bool) -> Render {
        // The exact renderer and contrast guard used by the official iOS app.
        let output = wallpaperRender(rgba: pixels, width: UInt32(width), height: UInt32(height), effect: mode.native, light: light)
        let primary = wallpaperSafeOpacity(rgba: output, width: UInt32(width), height: UInt32(height),
            textRgb: light ? 0x141414 : 0xFAFAFA, backgroundRgb: light ? 0xF6F6F6 : 0x141414, region: 1, minContrast: 4.5, maxOpacity: 1)
        let secondary = wallpaperSafeOpacity(rgba: output, width: UInt32(width), height: UInt32(height),
            textRgb: light ? 0x606060 : 0xB3B3B3, backgroundRgb: light ? 0xF6F6F6 : 0x141414, region: 1, minContrast: 3, maxOpacity: 1)
        return Render(data: output, opacity: Double(min(primary, secondary)))
    }

    #if os(iOS)
    private static func thumbnail(_ data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: 1024,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
        ] as CFDictionary)
    }
    #endif
}
