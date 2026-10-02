import Foundation

struct DemoFixtures {
    var workspace: WorkspaceState
    var sessions: [String: SessionState]
    var checkouts: [String: [ProjectCheckout]]
    var attachments: [String: Data]
    var queuedAttachments: [String: [RemoteAttachment]]
    var patches: [String: TurnDiff]

    static let runningID = "demo-running"
    static let progressID = "demo-running-progress"
    static let activities = ["Reviewing layout", "Checking keyboard spacing", "Comparing light and dark", "Reviewing touch targets"]
    static let progress = [
        "This agent keeps working in Try mode. Stop pauses it; leaving Try cancels it. No agent or command is executed.",
        "Reviewing the Composer layout…",
        "Reviewing the Composer layout…\nThe project and checkout controls line up above the editor.",
        "Checking the keyboard spacing…",
        "Checking the keyboard spacing…\nThe entire Composer stays above the keyboard.",
        "Comparing light and dark appearance…",
        "Comparing light and dark appearance…\nStatus dots stay readable in both themes.",
        "Reviewing the touch targets…",
        "Reviewing the touch targets…\nThe next simulated review pass is starting."
    ]

    @MainActor static func make(now: Date = Date()) -> DemoFixtures {
        let personal = Project(id: "demo-project", name: "Personal project", path: "/Users/demo/Projects/personal", hostID: "demo-mac", isRepository: true)
        let app = Project(id: "demo-app", name: "Mobile app", path: "/Users/demo/Projects/mobile", hostID: "demo-mac", isRepository: true)
        let notes = Project(id: "demo-notes", name: "Design notes", path: "/Users/demo/Projects/notes", hostID: "demo-mac")
        let server = Project(id: "demo-server", name: "API service", path: "/home/demo/projects/api", hostID: "demo-linux", isRepository: true)
        let offline = Project(id: "demo-offline-project", name: "Offline workspace", path: "/Users/demo/Projects/archive", hostID: "demo-offline", isRepository: true)
        let projects = [personal, app, notes, server, offline]
        var rows: [Session] = []
        var states: [String: SessionState] = [:]
        var patches: [String: TurnDiff] = [:]

        func add(_ id: String, _ title: String, project: Project, selection: ModelSelection = .init(providerID: "codex", modelID: "gpt-6-astra"),
                 preview: String, age: TimeInterval, pinned: Bool = false, unread: Bool = false,
                 archived: Bool = false, pr: PullRequest? = nil, messages: [TranscriptMessage]? = nil) {
            let finished = now.addingTimeInterval(-age)
            rows.append(Session(id: id, title: title, projectID: project.id, hostID: project.hostID, path: project.path,
                preview: preview, unread: unread, pullRequest: pr, pinned: pinned, archived: archived,
                createdAt: finished.addingTimeInterval(-3600), updatedAt: finished,
                lastFinishedAt: finished, completedTurnID: id + "-turn", providerID: selection.providerID, modelID: selection.modelID, branch: project.isRepository ? "main" : nil))
            states[id] = SessionState(id: id, messages: messages ?? [
                TranscriptMessage(id: id + "-prompt", role: "user", text: title, timestamp: finished.addingTimeInterval(-90)),
                TranscriptMessage(id: id + "-reply", role: "assistant", text: preview + "\n\nThis is an offline sample. Try the session menus, model options, or send a follow-up to see streaming and queued messages.", timestamp: finished, workedDuration: 90)
            ], selection: selection, turnID: id + "-turn")
        }

        let fusion = ModelSelection(providerID: "devin", modelID: "fusion", effort: "high",
                                    options: ["lead": "claude-fable-5-1", "sidekick": "swe-2-medium", "speed": "fast"])
        let claude = ModelSelection(providerID: "claude-code", modelID: "claude-opus-5", effort: "high",
                                    options: ["contextWindow": "1m", "fastMode": "on"])
        add(runningID, "Live agent playground", project: app, selection: fusion, preview: progress[0], age: 0, messages: [
            TranscriptMessage(id: "demo-running-prompt", role: "user", text: "Keep reviewing the mobile layout. Show the progress and delegate an accessibility review.", timestamp: now.addingTimeInterval(-90)),
            TranscriptMessage(id: "demo-running-tool", role: "tool", text: "Offline simulation: layout and accessibility reviews started. No remote tools were run.", timestamp: now.addingTimeInterval(-60)),
            TranscriptMessage(id: progressID, role: "assistant", text: progress[0], streaming: true, subagents: [
                SubagentStatus(id: "demo-layout-agent", title: "Layout review", status: "running", detail: activities[0]),
                SubagentStatus(id: "demo-a11y-agent", title: "Accessibility review", status: "done", detail: "Labels and touch targets checked in this offline sample.")
            ], timestamp: now.addingTimeInterval(-30))
        ])
        rows[0].working = true
        rows[0].activity = activities[0]
        rows[0].lastFinishedAt = nil
        rows[0].completedTurnID = nil
        states[runningID]?.working = true
        states[runningID]?.queue = [
            QueuedMessage(id: "demo-queue-layout", text: "Then review the tablet sidebar."),
            QueuedMessage(id: "demo-queue-notes", text: "Use the attached review checklist.", attachments: ["demo://" + runningID + "/review-notes"]),
            QueuedMessage(id: "demo-queue-summary", text: "Summarize the findings when you finish.")
        ]

        add("demo-welcome", "A quieter workspace", project: personal, preview: "Seven changed files ready to review", age: 720, pinned: true,
            pr: PullRequest(number: 42, title: "Sample interface changes", url: "", state: "open", provider: "Test mode", baseRef: "main", headRef: "demo/interface"), messages: [
                TranscriptMessage(id: "demo-message-1", role: "user", text: "Make this workspace feel calmer.", timestamp: now.addingTimeInterval(-780)),
                TranscriptMessage(id: "demo-message-tool", role: "tool", text: "Sample review: 7 files, 14 additions, 7 deletions. No files were changed.", timestamp: now.addingTimeInterval(-750)),
                TranscriptMessage(id: "demo-message-2", role: "assistant", text: """
                    ## A calmer workspace

                    - Increased spacing around the important actions.
                    - Kept the mobile navigation native.
                    - Preserved keyboard and Reduce Motion behavior.

                    ```swift
                    let spacing = 12
                    let respectsReducedMotion = true
                    ```

                    Open a changed file below, or choose **Show all…** for all seven sample diffs.
                    Send a follow-up to try streaming, steering and the message queue.
                    """, timestamp: now.addingTimeInterval(-720), workedDuration: 60)
            ])
        states["demo-welcome"]?.turnID = "demo-history-turn"
        rows[1].completedTurnID = "demo-history-turn"
        patches["demo-welcome"] = DemoClient.sampleDiff

        add("demo-question", "A quick design choice", project: personal, preview: "Choose several priorities or write your own answer", age: 1800)
        rows[2].awaitingInput = true
        rows[2].activity = "Waiting for response"
        rows[2].inputRequestID = "demo-input"
        rows[2].lastFinishedAt = nil
        rows[2].completedTurnID = nil
        states["demo-question"]?.turnID = nil
        states["demo-question"]?.messages = [
            TranscriptMessage(id: "demo-question-message", role: "assistant", text: "Before I continue, which details should I focus on? You can choose several or write your own answer.", timestamp: now.addingTimeInterval(-1800))
        ]
        states["demo-question"]?.input = InputRequest(id: "demo-input", questions: [
            InputQuestion(id: "details", title: "What matters most?", options: ["Spacing", "Typography", "Motion"], multiple: true)
        ])

        add("demo-release-choice", "Choose a release approach", project: server, selection: claude, preview: "Two questions waiting for your answer", age: 2400)
        rows[3].awaitingInput = true
        rows[3].activity = "Waiting for response"
        rows[3].inputRequestID = "demo-release-input"
        rows[3].lastFinishedAt = nil
        rows[3].completedTurnID = nil
        states["demo-release-choice"]?.turnID = nil
        states["demo-release-choice"]?.input = InputRequest(id: "demo-release-input", questions: [
            InputQuestion(id: "release", title: "How should we ship this?", options: ["Small rollout", "All at once"]),
            InputQuestion(id: "checks", title: "Which checks should come first?", options: ["Accessibility", "Offline behavior", "Tablet layout"], multiple: true)
        ])

        let attachment = RemoteAttachment(path: "demo://demo-attachments/review-notes", name: "review-notes.txt", mimeType: "text/plain")
        let queuedAttachment = RemoteAttachment(path: "demo://" + runningID + "/review-notes", name: attachment.name, mimeType: attachment.mimeType)
        let bytes = Data("Offline review checklist\n\n1. Check drawer swipes.\n2. Check the entire Composer above the keyboard.\n3. Check light, dark and Reduce Motion.\n".utf8)
        add("demo-attachments", "Review notes and attachments", project: notes, selection: claude, preview: "Open the attached offline checklist", age: 3000, messages: [
            TranscriptMessage(id: "demo-attachment-prompt", role: "user", text: "Review this checklist.", attachments: [attachment], timestamp: now.addingTimeInterval(-3060)),
            TranscriptMessage(id: "demo-attachment-reply", role: "assistant", text: "The file is available locally in Try mode. Tap **review-notes.txt** to preview it. You can also attach your own files or photos to a follow-up; demo attachments remain in memory.", timestamp: now.addingTimeInterval(-3000), workedDuration: 60)
        ])
        add("demo-unread", "Accessibility review is ready", project: app, selection: claude, preview: "Completed while you were away", age: 3600, unread: true,
            messages: [TranscriptMessage(id: "demo-unread-reply", role: "assistant", text: "## Review complete\n\nTouch targets and labels look good in this sample. Open the diff to inspect the changes.", subagents: [
                SubagentStatus(id: "demo-finished-review", title: "Accessibility review", status: "done", detail: "All sample checks passed.")
            ], timestamp: now.addingTimeInterval(-3600), workedDuration: 144)])
        patches["demo-unread"] = DemoClient.sampleDiff
        add("demo-failed", "Retry a delivery", project: personal, preview: "A simulated send failed. Tap Retry to continue.", age: 4200, messages: [
            TranscriptMessage(id: "demo-failed-prompt", role: "user", text: "Review the navigation changes.", timestamp: now.addingTimeInterval(-4200))
        ])
        rows[6].failed = true
        rows[6].lastFinishedAt = nil
        rows[6].completedTurnID = nil
        states["demo-failed"]?.turnID = nil
        states["demo-failed"]?.deliveryFailed = true
        states["demo-failed"]?.delivery = "Sample delivery failed. Retry is safe in Try mode."

        for (id, title, project, selection, preview, age, pinned, pr) in [
            ("demo-merged", "Merged interface polish", app, fusion, "Merged PR sample with a retained diff", 4800.0, true, PullRequest(number: 39, title: "Interface polish", url: "", state: "merged", provider: "Test mode", baseRef: "main", headRef: "demo/polish")),
            ("demo-draft-pr", "Draft API cleanup", server, claude, "Draft pull request awaiting review", 5400.0, false, PullRequest(number: 51, title: "API cleanup", url: "", state: "open", provider: "Test mode", baseRef: "main", headRef: "demo/api", isDraft: true)),
            ("demo-closed-pr", "Alternative navigation", app, fusion, "Closed PR sample", 6000.0, false, PullRequest(number: 36, title: "Alternative navigation", url: "", state: "closed", provider: "Test mode", baseRef: "main", headRef: "demo/navigation"))
        ] {
            add(id, title, project: project, selection: selection, preview: preview, age: age, pinned: pinned, pr: pr)
            patches[id] = DemoClient.sampleDiff
        }
        add("demo-long-chat", "A longer planning conversation", project: notes, selection: claude, preview: "Scroll a multi-turn transcript with code and lists", age: 6600,
            messages: (0..<8).flatMap { index in
                let timestamp = now.addingTimeInterval(-7200 + Double(index) * 60)
                return [
                    TranscriptMessage(id: "demo-long-user-\(index)", role: "user", text: "Review pass \(index + 1): what should we check next?", timestamp: timestamp),
                    TranscriptMessage(id: "demo-long-reply-\(index)", role: "assistant", text: """
                        ### Review pass \(index + 1)

                        Check the phone drawer, tablet sidebar, search focus and long drafts.

                        1. Open Sessions and switch conversations.
                        2. Pull to refresh and keep your finger held briefly.
                        3. Try a multiline draft with the keyboard visible.

                        ```swift
                        let pass = \(index + 1)
                        let usesNativeControls = true
                        ```

                        All results here are simulated. No host tools or commands are executed.
                        """, timestamp: timestamp.addingTimeInterval(30), workedDuration: 30)
                ]
            })
        add("demo-offline", "Notes from an offline host", project: offline, preview: "Cached sample transcript from Demo Laptop", age: 9000)
        add("demo-api", "Pagination and empty states", project: server, selection: claude, preview: "API response examples and edge cases", age: 11000)
        add("demo-search", "Search and filter examples", project: personal, preview: "Try provider, project, unread and PR filters", age: 14000)
        add("demo-archive-ui", "Archived interface exploration", project: app, selection: fusion, preview: "An older UI conversation", age: 86400, archived: true)
        add("demo-archive-api", "Archived API migration", project: server, selection: claude, preview: "An older API conversation", age: 172800, archived: true)

        let checkouts = Dictionary(uniqueKeysWithValues: projects.filter(\.isRepository).map { project in
            (project.id, [
                ProjectCheckout(branch: "main", path: project.path, isCurrent: true),
                ProjectCheckout(branch: "demo/interface", path: project.path + "-interface"),
                ProjectCheckout(branch: "demo/accessibility", path: project.path + "-accessibility")
            ])
        })
        let workspace = WorkspaceState(connection: .online, hosts: [
            Host(id: "demo-mac", name: "Demo Mac", online: true),
            Host(id: "demo-linux", name: "Demo Linux", online: true),
            Host(id: "demo-offline", name: "Demo Laptop", online: false)
        ], projects: projects, sessions: rows, profile: UserProfile(id: "test-mode", displayName: "Test mode", email: "demo@example.com"), devices: [
            ConnectedDevice(id: "demo-mac", name: "Demo Mac", platform: "macos", online: true, isExecutionHost: true),
            ConnectedDevice(id: "demo-linux", name: "Demo Linux", platform: "linux", online: true, isExecutionHost: true),
            ConnectedDevice(id: "demo-offline", name: "Demo Laptop", platform: "macos", online: false, isExecutionHost: true),
            ConnectedDevice(id: "demo-phone", name: "This device", platform: "ios", online: true, isExecutionHost: false, isCurrent: true)
        ])
        return DemoFixtures(workspace: workspace, sessions: states, checkouts: checkouts,
                            attachments: [attachment.path: bytes, queuedAttachment.path: bytes],
                            queuedAttachments: ["demo-queue-notes": [queuedAttachment]], patches: patches)
    }
}
