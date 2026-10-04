//! Bounded, ordered presentation parts for the shared SwiftUI client.
//! Labels and detail layout follow official iOS layout/tools.rs at 9e1a111.
//! These are synchronized render parts, never agent execution instructions.

use zeron_doc::MessagePart;
use zeron_proto::ToolCall;

const DETAIL_CHARS: usize = 32_768;
const DETAIL_LINES: usize = 400;

#[derive(Debug, Clone, uniffi::Record)]
pub struct TranscriptPartView {
    pub id: String,
    pub kind: String,
    pub text: String,
    pub tool: Option<TranscriptToolView>,
    pub truncated: bool,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct TranscriptToolView {
    pub kind: String,
    pub label: String,
    pub detail: String,
    pub path: Option<String>,
    pub invocation: String,
    pub output: String,
    pub output_kind: String,
    pub resolved: bool,
    pub failed: bool,
    pub truncated: bool,
}

fn bounded(text: &str) -> (String, bool) {
    let mut end = text.len();
    let mut lines = 1;
    for (count, (offset, ch)) in text.char_indices().enumerate() {
        if count == DETAIL_CHARS || (ch == '\n' && lines == DETAIL_LINES) {
            end = offset;
            break;
        }
        if ch == '\n' { lines += 1; }
    }
    (text[..end].to_owned(), end < text.len())
}

fn invocation(call: &ToolCall) -> String {
    // A spawn may arrive before its child reference. Keep its private prompt
    // out of generic tool details during that window too.
    if call.is_subagent_spawn() { return zeron_proto::view::tool_chip_content(call).1; }
    match call {
        ToolCall::Exec { command } => command.clone(),
        ToolCall::ReadFile { path } | ToolCall::EditFile { path, .. } => path.clone(),
        ToolCall::WriteFile { path, content } => content.as_ref().map(|text| format!("{path}\n{text}")).unwrap_or_else(|| path.clone()),
        ToolCall::ApplyPatch { path } => path.clone().unwrap_or_else(|| "workspace".into()),
        ToolCall::Search { pattern, path } => path.as_ref().map(|path| format!("{pattern} in {path}")).unwrap_or_else(|| pattern.clone()),
        ToolCall::Glob { pattern } => pattern.clone(),
        ToolCall::WebFetch { url, .. } => url.clone(),
        ToolCall::WebSearch { query } => query.clone(),
        ToolCall::Todo { items } => items.iter().map(|item| format!("[{}] {}", if item.done { "x" } else { " " }, item.text)).collect::<Vec<_>>().join("\n"),
        ToolCall::Mcp { server, tool, input } => format!("{server} · {tool}{}", input.as_ref().map(|v| format!("\n{}", serde_json::to_string_pretty(v).unwrap_or_default())).unwrap_or_default()),
        ToolCall::Unknown { name, input } => format!("{name}{}", input.as_ref().map(|v| format!("\n{}", serde_json::to_string_pretty(v).unwrap_or_default())).unwrap_or_default()),
    }
}

fn kind_and_path(call: &ToolCall) -> (&'static str, Option<String>) {
    match call {
        ToolCall::Exec { .. } => ("exec", None),
        ToolCall::ReadFile { path } => ("readFile", Some(path.clone())),
        ToolCall::WriteFile { path, .. } => ("writeFile", Some(path.clone())),
        ToolCall::EditFile { path, .. } => ("editFile", Some(path.clone())),
        ToolCall::ApplyPatch { path } => ("applyPatch", path.clone()),
        ToolCall::Search { .. } => ("search", None),
        ToolCall::Glob { .. } => ("glob", None),
        ToolCall::WebFetch { .. } => ("webFetch", None),
        ToolCall::WebSearch { .. } => ("webSearch", None),
        ToolCall::Todo { .. } => ("todo", None),
        ToolCall::Mcp { .. } => ("mcp", None),
        ToolCall::Unknown { .. } => ("unknown", None),
    }
}

pub(super) fn presentation_parts(parts: &[MessagePart]) -> Vec<TranscriptPartView> {
    parts.iter().filter_map(|part| {
        let mut result = TranscriptPartView { id: part.id().to_owned(), kind: "boundary".into(), text: String::new(), tool: None, truncated: false };
        match part {
            MessagePart::Text { text, .. } => { result.kind = "text".into(); result.text = text.clone(); }
            MessagePart::Reasoning { text, .. } => {
                if text.trim().is_empty() { return None; }
                result.kind = "reasoning".into();
                (result.text, result.truncated) = bounded(text);
            }
            MessagePart::Error { message, .. } => { result.kind = "error".into(); result.text = message.clone(); }
            MessagePart::Tool { subagent_ref: Some(_), .. } => { result.kind = "subagent".into(); }
            MessagePart::Tool { call, resolved, is_error, output, diff, diff_stats, output_ref, diff_ref, .. } => {
                let (kind, path) = kind_and_path(call);
                let (label, detail) = zeron_proto::view::tool_chip_content(call);
                let (invocation, invocation_truncated) = bounded(&invocation(call));
                let (body, output_kind, source_truncated) = if *is_error && output.as_ref().is_some_and(|text| !text.is_empty()) {
                    (output.clone().unwrap_or_default(), "output", false)
                } else if let Some(diff) = diff {
                    let old = diff.old_text.as_deref().unwrap_or("");
                    if old.len() + diff.new_text.len() > 262_144 || old.lines().count() + diff.new_text.lines().count() > 8_000 {
                        ("Diff exceeds the inline preview limit.".to_owned(), "output", true)
                    } else {
                        (similar::TextDiff::from_lines(old, &diff.new_text).unified_diff().context_radius(3)
                            .header(&format!("a/{}", diff.path), &format!("b/{}", diff.path)).to_string(), "diff", false)
                    }
                } else if let Some(stats) = diff_stats.as_ref().filter(|stats| !stats.is_empty()) {
                    (stats.iter().map(|stat| format!("{}  +{} −{}", stat.path, stat.additions, stat.deletions)).collect::<Vec<_>>().join("\n"), "stats", false)
                } else { (output.clone().unwrap_or_default(), "output", false) };
                let (output, output_truncated) = bounded(&body);
                result.kind = "tool".into();
                result.tool = Some(TranscriptToolView {
                    kind: kind.into(), label: label.into(), detail: bounded(&detail).0, path,
                    invocation, output, output_kind: output_kind.into(), resolved: *resolved, failed: *is_error,
                    truncated: invocation_truncated || output_truncated || source_truncated || output_ref.is_some() || diff_ref.is_some(),
                });
            }
            MessagePart::Image { .. } | MessagePart::Input { .. } | MessagePart::Fork { .. } => {}
        }
        Some(result)
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(resolved: bool, output: &str) -> MessagePart {
        MessagePart::Tool { id: "read".into(), call: ToolCall::ReadFile { path: "src/app.swift".into() }, resolved,
            is_error: false, output: Some(output.into()), diff: None, diff_stats: None, output_ref: None,
            output_bytes: None, diff_ref: None, subagent_ref: None, subagent_status: None, subagent_tail: None }
    }

    #[test]
    fn ordered_parts_keep_live_tool_identity_and_results() {
        let parts = vec![MessagePart::Text { id: "intro".into(), text: "Inspecting the source.".into() },
            MessagePart::Reasoning { id: "thought".into(), text: "Check the call sites.".into() },
            tool(false, "first line"), MessagePart::Text { id: "answer".into(), text: "".into() }];
        let live = presentation_parts(&parts);
        assert_eq!(live.iter().map(|p| p.kind.as_str()).collect::<Vec<_>>(), ["text", "reasoning", "tool", "text"]);
        assert_eq!(live[2].tool.as_ref().unwrap().label, "Read");
        assert_eq!(live[2].tool.as_ref().unwrap().path.as_deref(), Some("src/app.swift"));
        assert!(!live[2].tool.as_ref().unwrap().resolved);
        let finished = presentation_parts(&[tool(true, "first line\nsecond line")]);
        assert_eq!(finished[0].id, live[2].id);
        assert_eq!(finished[0].tool.as_ref().unwrap().output, "first line\nsecond line");
        assert!(finished[0].tool.as_ref().unwrap().resolved);
    }

    #[test]
    fn failures_and_unicode_output_are_bounded_without_losing_status() {
        let mut part = tool(true, &"😀\n".repeat(1000));
        if let MessagePart::Tool { is_error, .. } = &mut part { *is_error = true; }
        let result = presentation_parts(&[part]);
        let tool = result[0].tool.as_ref().unwrap();
        assert!(tool.failed && tool.resolved && tool.truncated);
        assert_eq!(tool.output.lines().count(), DETAIL_LINES);
        let (text, truncated) = bounded(&"界".repeat(DETAIL_CHARS + 1));
        assert!(truncated);
        assert_eq!(text.chars().count(), DETAIL_CHARS);
    }

    #[test]
    fn subagents_remain_separate_and_do_not_export_their_prompt() {
        let mut spawn = tool(true, "private tail");
        if let MessagePart::Tool { call, subagent_ref, .. } = &mut spawn {
            *call = ToolCall::Unknown { name: "Agent: Review".into(), input: Some(serde_json::json!({"prompt":"private prompt"})) };
            *subagent_ref = Some("child".into());
        }
        let result = presentation_parts(&[spawn]);
        assert_eq!(result[0].kind, "subagent");
        assert!(result[0].tool.is_none() && result[0].text.is_empty());
    }

    #[test]
    fn file_edits_show_native_diff_and_failures_keep_the_error_output() {
        let mut edit = tool(true, "permission denied");
        if let MessagePart::Tool { call, diff, .. } = &mut edit {
            *call = ToolCall::EditFile { path: "src/app.swift".into(), old_string: None, new_string: None };
            *diff = Some(zeron_proto::ToolDiff { path: "src/app.swift".into(), old_text: Some("old\n".into()), new_text: "new\n".into() });
        }
        let projected = presentation_parts(&[edit.clone()]);
        let body = projected[0].tool.as_ref().unwrap();
        assert_eq!(body.output_kind, "diff");
        assert!(body.output.contains("-old\n+new"));
        if let MessagePart::Tool { is_error, .. } = &mut edit { *is_error = true; }
        let failed = presentation_parts(&[edit]);
        assert_eq!(failed[0].tool.as_ref().unwrap().output, "permission denied");
    }
}
