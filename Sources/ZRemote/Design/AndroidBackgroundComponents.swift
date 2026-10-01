#if SKIP
import Foundation
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import java.nio.ByteBuffer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private func backgroundBitmap(_ data: Data) -> Bitmap? {
    let bytes = data.kotlin(nocopy: true)
    if android.os.Build.VERSION.SDK_INT >= 28 {
        return ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ in
            var sample = 1
            while max(info.size.width, info.size.height) / sample > 1024 { sample *= 2 }
            decoder.setTargetSampleSize(sample)
            decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE)
        }
    }
    let options = BitmapFactory.Options()
    options.inJustDecodeBounds = true
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    guard options.outWidth > 0 && options.outHeight > 0 else { return nil }
    var sample = 1
    while max(options.outWidth, options.outHeight) / sample > 1024 { sample *= 2 }
    options.inSampleSize = sample
    options.inJustDecodeBounds = false
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
}

/* SKIP @bridge */
public func androidPrepareBackground(_ data: Data) async -> Data? {
    await withContext(Dispatchers.Default) {
        do {
            guard data.count <= 24 * 1024 * 1024, let bitmap = backgroundBitmap(data) else { return nil }
            defer { bitmap.recycle() }
            let output = java.io.ByteArrayOutputStream()
            defer { output.close() }
            guard bitmap.compress(Bitmap.CompressFormat.JPEG, 88, output), output.size() <= 2_000_000 else { return nil }
            return Data(platformValue: output.toByteArray())
        } catch { return nil }
    }
}

/* SKIP @bridge */
public func androidBackgroundPixels(_ data: Data) async -> [String]? {
    await withContext(Dispatchers.Default) {
        do {
            guard data.count <= 2_000_000, let bitmap = backgroundBitmap(data) else { return nil }
            defer { bitmap.recycle() }
            let width = bitmap.width, height = bitmap.height
            let colors = kotlin.IntArray(width * height)
            bitmap.getPixels(colors, 0, width, 0, 0, width, height)
            let bytes = kotlin.ByteArray(width * height * 4)
            for i in 0..<(width * height) {
                let color = colors[i]
                bytes[i * 4] = ((color >> 16) & 255).toByte()
                bytes[i * 4 + 1] = ((color >> 8) & 255).toByte()
                bytes[i * 4 + 2] = (color & 255).toByte()
                bytes[i * 4 + 3] = (-1).toByte()
            }
            return [String(width), String(height), android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)]
        } catch { return nil }
    }
}

/* SKIP @bridge */
public func androidBackgroundPNG(_ data: Data, width: Int, height: Int) async -> Data? {
    await withContext(Dispatchers.Default) {
        do {
            guard width > 0, height > 0, width <= 1024, height <= 1024, data.count == width * height * 4 else { return nil }
            let bytes = data.kotlin(nocopy: true)
            let colors = kotlin.IntArray(width * height)
            for i in 0..<(width * height) {
                let r = bytes[i * 4].toInt() & 255
                let g = bytes[i * 4 + 1].toInt() & 255
                let b = bytes[i * 4 + 2].toInt() & 255
                colors[i] = android.graphics.Color.rgb(r, g, b)
            }
            let bitmap = Bitmap.createBitmap(colors, width, height, Bitmap.Config.ARGB_8888)
            defer { bitmap.recycle() }
            let output = java.io.ByteArrayOutputStream()
            defer { output.close() }
            guard bitmap.compress(Bitmap.CompressFormat.PNG, 100, output) else { return nil }
            return Data(platformValue: output.toByteArray())
        } catch { return nil }
    }
}
#endif
