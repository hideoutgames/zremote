# Provider marks and model picker

The model picker follows the native picker in
[`hideoutgames/zeron` at `d316f79c`](https://github.com/hideoutgames/zeron/tree/d316f79c2f9ad471d1291c785548be79d893b98b/apps/ios/Zeron/Composer):
44-point provider icon tabs, scoped search, favorite stars, retained selections,
a pinned settings tray, and an independent configuration popover for models
with a `lead` option (the Devin Fusion test fixture). Android presents the same
controls in a centered card within the picker because Skip does not support
native popovers.

Live models, reasoning defaults and option choices come only from the connected
host. An unavailable current model remains visible but cannot be selected.
Test mode has its own offline Claude Code, Codex and Devin Fusion fixtures.
The composer displays the selected provider mark, model, effective effort and
Fast when a supported speed setting is enabled.

The nine marks in `Sources/ZRemote/Resources/ProviderMarks.xcassets` are raster
exports of the original SVGs under
[`apps/landing/public/assets/icons`](https://github.com/hideoutgames/zeron/tree/d316f79c2f9ad471d1291c785548be79d893b98b/apps/landing/public/assets/icons)
(`brand/antigravity-mark.svg` for Antigravity). They were rasterized at 96 pixels
wide with resvg 2.6.2, retaining transparency and source geometry. SwiftUI uses
them as template images; Claude retains the reference orange. Unknown host
providers receive a neutral processor glyph instead of another provider's mark.
No generated artwork or network image fetching is involved.

The source project is copyright 2026 Wing, MIT licensed. Its notice is retained
in `Sources/ZRemote/Resources/Licenses/Zeron-MIT.txt`. Provider names and marks
identify their respective providers; the source license does not grant
trademark rights.
