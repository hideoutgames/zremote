#if SKIP
import Foundation
import SwiftUI
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import java.nio.ByteBuffer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/// Native Activity Result contracts, contained inside the Compose lifecycle.
/// Only this boundary sees content URIs; copying is bounded and runs on IO.
struct AttachmentLauncher: ContentComposer {
    let source: String
    let request: String
    let completed: (String, String, String, String) -> Void

    @Composable func Compose(context: ComposeContext) {
        let androidContext = LocalContext.current
        let scope = rememberCoroutineScope()
        let cameraPath = rememberSaveable { mutableStateOf("") }
        let activeRequest = rememberSaveable { mutableStateOf("") }
        let latestRequest = rememberUpdatedState(request)
        let accept: (android.net.Uri?, Bool) -> Void = { uri, camera in
            let expectedRequest = activeRequest.value
            guard latestRequest.value == expectedRequest else { return }
            guard let uri else { completed("", "", "", ""); return }
            scope.launch {
                do {
                    let picked = await withContext(Dispatchers.IO) {
                        try await copyAttachment(uri: uri, context: androidContext, camera: camera)
                    }
                    if camera && !cameraPath.value.isEmpty {
                        java.io.File(cameraPath.value).delete(); cameraPath.value = ""
                    }
                    guard latestRequest.value == expectedRequest else { java.io.File(picked.path).delete(); return }
                    completed(picked.path, picked.name, picked.mime, "")
                } catch {
                    if camera && !cameraPath.value.isEmpty {
                        java.io.File(cameraPath.value).delete(); cameraPath.value = ""
                    }
                    if error is CancellationException { throw error }
                    if latestRequest.value == expectedRequest {
                        completed("", "", "", (error as? AttachmentReadError)?.message ?? "This file couldn't be opened. Try choosing it again.")
                    }
                }
            }
        }
        let files = rememberLauncherForActivityResult(contract: ActivityResultContracts.OpenDocument()) { uri in accept(uri, false) }
        let photos = rememberLauncherForActivityResult(contract: ActivityResultContracts.PickVisualMedia()) { uri in accept(uri, false) }
        let camera = rememberLauncherForActivityResult(contract: ActivityResultContracts.TakePicture()) { success in
            if success && !cameraPath.value.isEmpty {
                let file = java.io.File(cameraPath.value)
                let uri = FileProvider.getUriForFile(androidContext, androidContext.packageName + ".attachments", file)
                accept(uri, true)
            } else {
                if !cameraPath.value.isEmpty { java.io.File(cameraPath.value).delete(); cameraPath.value = "" }
                completed("", "", "", "")
            }
        }
        LaunchedEffect(request) {
            guard !request.isEmpty, !source.isEmpty else { return }
            activeRequest.value = request
            do {
                switch source {
                case "files": files.launch(kotlin.arrayOf("*/*"))
                case "photos": photos.launch(PickVisualMediaRequest.Builder().setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly).build())
                case "camera":
                    let directory = java.io.File(androidAttachmentCacheDirectory())
                    directory.mkdirs()
                    pruneAttachmentCache(directory)
                    let file = java.io.File.createTempFile("capture-", ".jpg", directory)
                    cameraPath.value = file.absolutePath
                    camera.launch(FileProvider.getUriForFile(androidContext, androidContext.packageName + ".attachments", file))
                default: completed("", "", "", "")
                }
            } catch {
                if !cameraPath.value.isEmpty { java.io.File(cameraPath.value).delete(); cameraPath.value = "" }
                completed("", "", "", "No app is available to open this picker.")
            }
        }
    }
}

struct PickedAttachment {
    let path: String
    let name: String
    let mime: String
}

struct AttachmentReadError: Error { let message: String }

private func copyAttachment(uri: android.net.Uri, context: android.content.Context, camera: Bool) async throws -> PickedAttachment {
    let maximum = 24 * 1024 * 1024
    let resolver = context.contentResolver
    var name = camera ? "Camera photo.jpg" : "Attachment"
    if let cursor = resolver.query(uri, nil, nil, nil, nil) {
        defer { cursor.close() }
        if cursor.moveToFirst() {
            let nameColumn = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if !camera && nameColumn >= 0 { name = cursor.getString(nameColumn) ?? name }
            let sizeColumn = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE)
            if sizeColumn >= 0 && !cursor.isNull(sizeColumn) && cursor.getLong(sizeColumn) > maximum {
                throw AttachmentReadError(message: "Choose a file smaller than 24 MB.")
            }
        }
    }
    let mime = camera ? "image/jpeg" : (resolver.getType(uri) ?? "application/octet-stream")
    let directory = java.io.File(androidAttachmentCacheDirectory())
    directory.mkdirs()
    pruneAttachmentCache(directory)
    let file = java.io.File.createTempFile("import-", ".tmp", directory)
    var complete = false
    defer { if !complete { file.delete() } }
    guard let input = resolver.openInputStream(uri) else { throw AttachmentReadError(message: "This file couldn't be opened.") }
    defer { input.close() }
    let output = java.io.FileOutputStream(file)
    defer { output.close() }
    let buffer = kotlin.ByteArray(128 * 1024)
    var count = 0
    while true {
        currentCoroutineContext().ensureActive()
        let read = input.read(buffer)
        if read < 0 { break }
        count += read
        guard count <= maximum else { throw AttachmentReadError(message: "Choose a file smaller than 24 MB.") }
        output.write(buffer, 0, read)
    }
    complete = true
    return PickedAttachment(path: file.absolutePath, name: name, mime: mime)
}

private func pruneAttachmentCache(_ directory: java.io.File) {
    let cutoff = java.lang.System.currentTimeMillis() - 3_600_000
    guard let files = directory.listFiles() else { return }
    for file in files {
        if file.isFile && file.lastModified() < cutoff { file.delete() }
    }
}

/* SKIP @bridge */
public func androidAttachmentCacheDirectory() -> String {
    java.io.File(ProcessInfo.processInfo.androidContext.cacheDir, "zremote-attachments").absolutePath
}

/* SKIP @bridge */
public func androidAttachmentThumbnail(_ data: Data) async -> Data? {
    await withContext(Dispatchers.Default) {
        do {
            let bytes = data.kotlin(nocopy: true)
            let bitmap: Bitmap?
            if android.os.Build.VERSION.SDK_INT >= 28 {
                // ImageDecoder also applies EXIF orientation for camera photos.
                bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ in
                    var sample = 1
                    while max(info.size.width, info.size.height) / sample > 512 { sample *= 2 }
                    decoder.setTargetSampleSize(sample)
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE)
                }
            } else {
                let options = BitmapFactory.Options()
                options.inJustDecodeBounds = true
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                guard options.outWidth > 0 && options.outHeight > 0 else { return nil }
                var sample = 1
                while max(options.outWidth, options.outHeight) / sample > 512 { sample *= 2 }
                options.inSampleSize = sample
                options.inJustDecodeBounds = false
                bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            }
            guard let bitmap else { return nil }
            defer { bitmap.recycle() }
            let output = java.io.ByteArrayOutputStream()
            defer { output.close() }
            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, output)
            return Data(platformValue: output.toByteArray())
        } catch { return nil }
    }
}

/* SKIP @bridge */
public func androidPreviewAttachment(path: String, mime: String) -> Bool {
    let context = ProcessInfo.processInfo.androidContext
    do {
        let uri = FileProvider.getUriForFile(context, context.packageName + ".attachments", java.io.File(path))
        let intent = android.content.Intent(android.content.Intent.ACTION_VIEW)
        intent.setDataAndType(uri, mime)
        intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION | android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        return true
    } catch { return false }
}
#endif
