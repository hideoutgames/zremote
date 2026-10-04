#if os(iOS)
import Foundation
import CryptoKit
import ZRemoteCore

struct AudioModelManifest: Decodable, Sendable {
    struct Asset: Decodable, Sendable {
        let path: String
        let bytes: Int64
        let sha256: String
    }
    let id: AudioModelID
    let repository: String
    let revision: String
    let files: [Asset]
    var bytes: Int64 { files.reduce(0) { $0 + $1.bytes } }
    var folder: String { String(repository.split(separator: "/").last ?? "") }

    static let catalog: [AudioModelManifest] = {
        guard let url = Bundle.module.url(forResource: "AudioModels", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let models = try? JSONDecoder().decode([AudioModelManifest].self, from: data) else { return [] }
        return models.filter { model in
            model.repository.hasPrefix("FluidInference/parakeet-tdt-0.6b-") && model.repository.split(separator: "/").count == 2 &&
            model.revision.count == 40 && model.revision.allSatisfy(\.isHexDigit) && !model.files.isEmpty &&
            model.files.allSatisfy { file in
                !file.path.hasPrefix("/") && !file.path.contains("\\") &&
                file.path.split(separator: "/").allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." } &&
                file.bytes > 0 && file.sha256.count == 64 && file.sha256.allSatisfy(\.isHexDigit)
            }
        }
    }()
}

/// Public model weights are device-wide; recordings and account preferences are not.
actor AudioModelAssets {
    static let shared = AudioModelAssets()
    private let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("ZRemote/AudioModels", isDirectory: true)

    func directory(_ model: AudioModelManifest) -> URL { root.appendingPathComponent(model.folder, isDirectory: true) }

    func isInstalled(_ model: AudioModelManifest) -> Bool {
        let location = directory(model)
        let marker = try? String(contentsOf: location.appendingPathComponent("installed-revision"), encoding: .utf8)
        return marker == model.revision && model.files.allSatisfy { file in
            let attributes = try? FileManager.default.attributesOfItem(atPath: location.appendingPathComponent(file.path).path)
            return (attributes?[.size] as? NSNumber)?.int64Value == file.bytes
        }
    }

    func install(_ model: AudioModelManifest, progress: @escaping @Sendable (Double) -> Void) async throws {
        if isInstalled(model) { return }
        let manager = FileManager.default
        var base = root
        try manager.createDirectory(at: base, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try base.setResourceValues(values)
        // Retain verified files after interruption; a retry only fetches missing assets.
        let staging = root.appendingPathComponent(".install-" + model.id.rawValue, isDirectory: true)
        let destination = staging.appendingPathComponent(model.folder, isDirectory: true)
        try manager.createDirectory(at: destination, withIntermediateDirectories: true)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        configuration.httpCookieStorage = nil
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 1800
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        var completed: Int64 = 0
        for file in model.files {
            try Task.checkCancellation()
            let target = destination.appendingPathComponent(file.path)
            if (try? validate(file, at: target)) != true {
                let url = URL(string: "https://huggingface.co/\(model.repository)/resolve/\(model.revision)/\(file.path)")!
                let delegate = AudioDownloadProgress(completed: completed, total: model.bytes, progress: progress)
                let (temporary, response) = try await session.download(from: url, delegate: delegate)
                defer { try? manager.removeItem(at: temporary) }
                guard (response as? HTTPURLResponse)?.statusCode == 200, try validate(file, at: temporary) else {
                    throw ClientFailure("The audio model download could not be verified. Try installing again.")
                }
                try Task.checkCancellation()
                try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                if manager.fileExists(atPath: target.path) { try manager.removeItem(at: target) }
                try manager.moveItem(at: temporary, to: target)
            }
            completed += file.bytes
            progress(min(0.99, Double(completed) / Double(model.bytes)))
        }
        try await ParakeetTranscriber.shared.validate(directory: destination, model: model.id)
        try Task.checkCancellation()
        try model.revision.write(to: destination.appendingPathComponent("installed-revision"), atomically: true, encoding: .utf8)
        let installed = directory(model)
        if manager.fileExists(atPath: installed.path) { try manager.removeItem(at: installed) }
        try manager.moveItem(at: destination, to: installed)
        try? manager.removeItem(at: staging)
    }

    func delete(_ model: AudioModelManifest) throws {
        for location in [directory(model), root.appendingPathComponent(".install-" + model.id.rawValue)] {
            if FileManager.default.fileExists(atPath: location.path) { try FileManager.default.removeItem(at: location) }
        }
    }

    private func validate(_ file: AudioModelManifest.Asset, at url: URL) throws -> Bool {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard (attributes[.size] as? NSNumber)?.int64Value == file.bytes else { return false }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty {
            try Task.checkCancellation()
            hash.update(data: data)
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined() == file.sha256
    }
}

private final class AudioDownloadProgress: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let completed: Int64
    private let total: Int64
    private let progress: @Sendable (Double) -> Void
    private let lock = NSLock()
    private var lastPercent = -1
    init(completed: Int64, total: Int64, progress: @escaping @Sendable (Double) -> Void) {
        self.completed = completed; self.total = total; self.progress = progress
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let value = min(0.99, Double(completed + totalBytesWritten) / Double(total))
        lock.lock()
        let changed = Int(value * 100) > lastPercent
        if changed { lastPercent = Int(value * 100) }
        lock.unlock()
        if changed { progress(value) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(request.url?.scheme == "https" ? request : nil)
    }
}
#endif
