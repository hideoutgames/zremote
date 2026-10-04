Vendored engine-free Zeron peer client and transcript core.

Source: https://github.com/zeronsh/zeron
Revision: b42fc2b8fbf247dd92796c2917f277535cea91ac (v0.2.101).
License: MIT; see LICENSE.

Only client, mobile, proto, doc, sync, rpc, text, markdown, syntax and the data-only file-icon manifest are included. No host engine, terminal runner or desktop UI crate is linked. Local changes add CreateRepo, latest-turn-diff and composer-catalog peer APIs over existing host methods; optional profile-photo decoding; and a bounded transcript projection with typed attachments and subagent lifecycle data. Metadata-only deltas expose host-recorded message times, durations and safe sub-agent titles through the existing JSON signal method. Local continuation joins preserve the latest segment's status, including aborted or unknown endings. See ADAPTER.md for behavior and limitations. Host behavior is unchanged.

The local projection also carries ordered reasoning/tool parts with stable IDs,
bounded invocation/output/diff previews and tool status through generated UniFFI
records. Presentation follows official iOS `ToolViews.swift` / `layout/tools.rs`
at 9e1a11158b0626237c814f4bd36f5948483ed797; this is not a peer-core version update.
