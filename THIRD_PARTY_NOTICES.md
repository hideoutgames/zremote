# Third-party notices

The shipped inventory and full texts live in
`Sources/ZRemote/Resources/Acknowledgements.json` and `Resources/Licenses`.
Settings exposes these offline.

- Zeron mobile/client core: MIT, revision
  b42fc2b8fbf247dd92796c2917f277535cea91ac. See native/core/LICENSE and its
  provenance record. The existing Zeron-derived app icon is retained.
- Model-picker behavior references the MIT hideoutgames/zeron fork at
  d316f79c2f9ad471d1291c785548be79d893b98b; presentation is independently adapted.
- Session tool presentation adapts MIT zeronsh/zeron iOS/mobile behavior at
  9e1a11158b0626237c814f4bd36f5948483ed797. The rotating working vocabulary and
  session seed follow its iOS Motion.swift at 853872d3660047b28e81f80df7744a7f6f3b4beb.
  The Zeron license is retained in the bundled acknowledgements and native/core/LICENSE.
- Native patch parser adapts Swift-Diffs at
  7005d406fa362f1bbcc5c76551a9bf222c9a8eb6, Apache-2.0, with Pierre notices.
- Skip components retain their licenses in the bundled inventory.

SwiftSideDrawer was an interaction reference only. No source was incorporated:
the inspected repository did not publish a license. The phone sliding
container is independently implemented.

Build-time inventory generation must include resolved transitive dependencies,
vendored code, and licensed assets before accepting a distributable build.
