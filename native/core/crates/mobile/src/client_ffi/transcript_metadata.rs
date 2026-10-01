//! Metadata-only companion to the stable transcript FFI projection. Text-token
//! revisions are inspected once but produce no JSON when metadata is unchanged.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use zeron_client::SessionSnapshot;
use zeron_doc::{MessagePart, MessageRole, MessageStatus, SessionMessageEntry};
use zeron_proto::ToolCall;

#[derive(Default)]
pub(super) struct MetadataCache {
    revision: Option<u64>,
    entries: HashMap<String, (u64, MessageMetadata)>,
}

#[derive(Serialize)]
pub(super) struct MetadataUpdate {
    reset: bool,
    entries: Vec<MessageMetadata>,
    #[serde(rename = "removedIDs")]
    removed_ids: Vec<String>,
}

#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageMetadata {
    id: String,
    role: &'static str,
    created_at_ms: i64,
    duration_ms: Option<i64>,
    status: Option<&'static str>,
    subagent_titles: Vec<SubagentTitle>,
}

#[derive(Clone, PartialEq, Serialize)]
struct SubagentTitle {
    id: String,
    title: String,
}

impl MetadataCache {
    pub(super) fn update(&mut self, snapshot: &SessionSnapshot) -> Option<MetadataUpdate> {
        if self.revision == Some(snapshot.revision) {
            return None;
        }
        let reset = self.revision.is_none();
        let mut entries = Vec::new();
        let mut present = HashSet::new();
        // Only host-written entries have authoritative message timestamps.
        // Optimistic local echoes deliberately do not gain invented metadata.
        for entry in snapshot.transcript() {
            present.insert(entry.id.clone());
            if self.entries.get(&entry.id).map(|cached| cached.0) == Some(entry.rev) {
                continue;
            }
            let metadata = message_metadata(&entry.message);
            if self.entries.get(&entry.id).map(|cached| &cached.1) != Some(&metadata) {
                entries.push(metadata.clone());
            }
            self.entries.insert(entry.id.clone(), (entry.rev, metadata));
        }
        let mut removed_ids: Vec<String> = self.entries.keys()
            .filter(|id| !present.contains(*id)).cloned().collect();
        removed_ids.sort();
        self.entries.retain(|id, _| present.contains(id));
        self.revision = Some(snapshot.revision);
        if !reset && entries.is_empty() && removed_ids.is_empty() {
            return None;
        }
        Some(MetadataUpdate { reset, entries, removed_ids })
    }
}

fn message_metadata(message: &SessionMessageEntry) -> MessageMetadata {
    let subagent_titles = message.parts.iter().filter_map(|part| {
        let MessagePart::Tool { id, call: ToolCall::Unknown { name, .. }, subagent_ref: Some(_), .. } = part else { return None };
        // Drivers already reduce the task description to this display name.
        // Never inspect or serialize Unknown.input, prompts, or subagent tails.
        let title = name.strip_prefix("Agent: ")?.trim();
        if title.is_empty() { return None; }
        Some(SubagentTitle { id: id.clone(), title: title.chars().take(160).collect() })
    }).collect();
    MessageMetadata {
        id: message.id.clone(),
        role: match message.role {
            MessageRole::User => "user",
            MessageRole::Assistant => "assistant",
            MessageRole::System => "system",
        },
        created_at_ms: message.created_at,
        duration_ms: message.duration_ms,
        status: message.status.map(|status| match status {
            MessageStatus::Streaming => "streaming",
            MessageStatus::Complete => "complete",
            MessageStatus::Aborted => "aborted",
        }),
        subagent_titles,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn snapshot(revision: u64, text: &str, duration_ms: Option<i64>) -> SessionSnapshot {
        let mut snapshot = SessionSnapshot::default();
        snapshot.revision = revision;
        snapshot.transcript_len = 1;
        snapshot.entries = vec![Arc::new(zeron_client::Entry {
            id: "assistant".into(), rev: revision, echo: None, append: None,
            message: Arc::new(SessionMessageEntry {
                id: "assistant".into(), role: MessageRole::Assistant,
                parts: vec![MessagePart::Text { id: "text".into(), text: text.into() }],
                created_at: 1_700_000_000_000, device_id: "host".into(),
                status: Some(if duration_ms.is_some() { MessageStatus::Complete } else { MessageStatus::Streaming }),
                continuation_of: None, duration_ms,
            }),
        })];
        snapshot
    }

    #[test]
    fn token_revisions_do_not_repeat_metadata_but_completion_and_removal_do() {
        let mut cache = MetadataCache::default();
        let first = cache.update(&snapshot(1, "private text", None)).unwrap();
        assert!(first.reset);
        assert_eq!(first.entries.len(), 1);
        assert!(!serde_json::to_string(&first).unwrap().contains("private text"));
        assert!(cache.update(&snapshot(2, "private text grew", None)).is_none());
        let completed = cache.update(&snapshot(3, "private text finished", Some(12_000))).unwrap();
        assert!(!completed.reset);
        assert_eq!(completed.entries[0].duration_ms, Some(12_000));
        assert_eq!(completed.entries[0].status, Some("complete"));
        let mut removed = SessionSnapshot::default();
        removed.revision = 4;
        let update = cache.update(&removed).unwrap();
        assert_eq!(update.removed_ids, ["assistant"]);
        assert!(MetadataCache::default().update(&removed).unwrap().reset);
    }

    #[test]
    fn subagent_metadata_exposes_only_the_sanitized_task_name() {
        let mut message = (*snapshot(1, "private transcript", None).entries[0].message).clone();
        message.parts.push(MessagePart::Tool {
            id: "spawn".into(),
            call: ToolCall::Unknown {
                name: "Agent: Review spacing".into(),
                input: Some(serde_json::json!({ "prompt": "private prompt", "token": "private token" })),
            },
            is_error: false, resolved: true, output: None, diff: None, output_ref: None,
            output_bytes: None, diff_ref: None, diff_stats: None,
            subagent_ref: Some("agent-doc".into()), subagent_status: None,
            subagent_tail: Some("private tail".into()),
        });
        let encoded = serde_json::to_string(&message_metadata(&message)).unwrap();
        assert!(encoded.contains("Review spacing"));
        for forbidden in ["private transcript", "private prompt", "private token", "private tail", "\"input\""] {
            assert!(!encoded.contains(forbidden));
        }
    }
}
