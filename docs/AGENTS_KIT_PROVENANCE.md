# Agents Kit provenance

Source: `C:\Users\torea\Documents\GitHub\_ref\agents-kit` (Agents Kit by
Abhishek Gahlot). The kit's **root `LICENSE.md` is non-commercial** and covers
the kit author's own `components/agents-ui/*` — **nothing is ported from
`agents-ui`**. Ports come only from the separately, permissively licensed
collections vendored inside the kit:

| Collection                         | License    | Copyright                     |
| ---------------------------------- | ---------- | ----------------------------- |
| `components/beautiful-ui/*`        | MIT        | Shane Levine                  |
| `components/beui/*`                | MIT        | Saurabh Chauhan               |
| `components/effects/border-beam/*` | MIT        | Jakub Antalik (Libraries.dev) |
| `components/prompt-kit/*`          | MIT        | Julien Thibeaut               |
| `components/ai-elements/*`         | Apache-2.0 | Vercel, Inc.                  |

License texts are appended to `THIRD_PARTY_NOTICES.md` at the repo root.

## Port map

| Agents Kit component       | Upstream source (license)                                                                  | Our file                                                                       | States preserved                                                                     | Notes                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Message / message rows     | `components/beui/message` + `components/prompt-kit/message` (MIT)                          | `app/src/components/transcript/UserMessage.tsx`, `AssistantMessage.tsx`        | role variants, streaming text, attachments-as-chips, content fold                    | No avatar chrome; markdown via `EnrichedMarkdownText`                                                                       |
| ToolChips + ToolResult     | `components/beautiful-ui/tool-chips.tsx` (MIT) + `components/beui/…tool-result` (MIT)      | `app/src/components/agentsKit/ToolActivity.tsx`                                | running spinner, error red, expand → summary + truncated output + "show full output" | Chip labels/icons come from the Zeron proto port (`transcript/toolLabel.ts`), not the kit                                   |
| Task rows                  | `components/beautiful-ui/task-rows.tsx` (MIT)                                              | `app/src/components/agentsKit/TaskRows.tsx`                                    | done tick, dimmed/struck done rows                                                   | Driven by `todo` tool calls                                                                                                 |
| ApprovalCard / Question    | `components/beautiful-ui/approval-card` (MIT) + `components/prompt-kit/question.tsx` (MIT) | `app/src/components/agentsKit/QuestionPanel.tsx`                               | options-as-buttons, multiSelect toggles, disabled submit until complete              | Submits `UserInputAnswer[]` to `respondInput`                                                                               |
| LoadingState / TextShimmer | (kit patterns)                                                                             | fork's existing `app/src/components/ShimmerText.tsx`                           | shimmer sweep                                                                        | Native equivalent kept — Skia-based, no port needed                                                                         |
| ContextUsage               | `components/ai-elements/context.tsx` (Apache-2.0)                                          | `app/src/components/agentsKit/ContextUsageBar.tsx`                             | tokens/window meter                                                                  | Rendered only when `meta.contextUsage` exists                                                                               |
| CodeBlock                  | —                                                                                          | markdown renderer (`EnrichedMarkdownText` + `markdownStyle.ts`)                | fenced blocks                                                                        | No separate component needed                                                                                                |
| ScrollButton               | —                                                                                          | fork's existing `app/src/components/ScrollToBottomButton.tsx`                  | appears off-bottom, zoom in/out                                                      | Native equivalent kept                                                                                                      |
| Border Beam                | `components/effects/border-beam/upstream` (MIT, Libraries.dev)                             | `app/src/components/agentsKit/BorderBeam.tsx` + `beamState.ts`                 | sweep / static / stale / fading modes, reduced-motion static ring                    | Skia `SweepGradient` + Reanimated; state mapping is a pure tested function                                                  |
| FileDiff / diff table      | `components/beui/file-diff` + `components/beautiful-ui/diff-table` (MIT)                   | `app/src/components/agentsKit/FileDiff.tsx` + `src/zeron/diff/parseUnified.ts` | old/new gutter line numbers, hunk headers, +/- tinted rows, no-newline meta rows     | Unified patches parsed by a pure tested parser; patch text from the host's `CheckoutDiff.patch` / `GetCheckoutFileDiffText` |

## Excluded

- `components/agents-ui/*` — non-commercial root license, not ported.
- `components/effects/border-beam/*` — MIT; ported as `agentsKit/BorderBeam`.
