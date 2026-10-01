package no.hideout.zremote

// A concrete provider subclass is required for reliable behavior across devices.
// The manifest restricts it to the app's private attachment cache directory.
class AttachmentFileProvider : androidx.core.content.FileProvider()
