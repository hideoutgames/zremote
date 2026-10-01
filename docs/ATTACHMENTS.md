# Native attachments

The Composer's + control opens native Files, Photos and Camera actions. Pick one
item at a time; repeat to add more. Draft attachments show removable tiles, and
sent attachments remain inline with their message. An attachment-only message is
supported. Failed sends retain the draft's text and files.

iOS uses UIDocumentPickerViewController with security-scoped reads,
[PHPickerViewController](https://developer.apple.com/documentation/photosui/phpickerviewcontroller)
for selected images, and UIImagePickerController for the camera. Camera access
is requested only for that action, with a usage description in the app metadata.
The camera presents full screen on iPhone and iPad. Photos selection does not
request access to the whole library. Quick Look handles document previews.

Android uses custom Skip ContentComposer components around native Activity Result
contracts: OpenDocument, [PickVisualMedia](https://developer.android.com/training/data-storage/shared/photo-picker)
and [TakePicture](https://developer.android.com/reference/androidx/activity/result/contract/ActivityResultContracts.TakePicture).
The camera app receives a temporary output URI through a non-exported
[FileProvider](https://developer.android.com/reference/androidx/core/content/FileProvider).
The provider exposes only the private `zremote-attachments` cache directory.
No broad media/storage permission or direct camera permission is requested;
capture runs in the user's camera app. Missing handlers and cancellation return
to the draft. Document previews grant temporary read access to the chosen viewer.

Each file is limited to 24 MB; pending drafts are limited to 48 MB per message
and 96 MB across sessions. Reaching a limit reports an error and preserves
existing draft attachments. Import uses 128 KB chunks and rejects oversized
streams even when the provider reports no size. Android content streams are
copied on its IO dispatcher, then loaded by native Swift; iOS file reads and
camera encoding run away from the UI thread. The session/account context captured
when a picker opens must still match when its result is added. Device-local URLs
stay in this layer; the service receives only names, MIME types and bytes.

Attachment strips have bounded heights that follow the caption text size, and
load visible items lazily. Image thumbnails are decoded to at most 512 pixels per dimension. Chat rows keep
the thumbnail after loading rather than retaining each original image. Original
bytes are loaded again only for explicit previews. iOS removes preview files
when dismissed. Android viewers may still be reading after launch, so stale
preview files expire after an hour and are removed on the next cache operation.
Temporary imported copies are removed after bounded reading. No URI, prompt,
filename or file content is logged.

Platform compilation and actual device picker/camera permission checks are still
required. Swift syntax parsing and XML parsing do not validate UIKit delegates,
Skip-generated JNI/Compose code, camera hardware or external document providers.
