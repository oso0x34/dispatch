import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type HealthResponse = {
  status: "ok";
  appName: string;
  appVersion: string;
  bootedAtUnix: number;
  logDirectory: string | null;
  activeLogPath: string | null;
  sessionLogsDirectory: string | null;
  staleSessionsAbandonedAtBoot: number;
};

export type ProjectRecord = {
  id: string;
  name: string;
  rootRelativePath: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
};

export type TaskWorkflowState =
  | "draft"
  | "planning"
  | "in_progress"
  | "review"
  | "done"
  | "blocked";

export type TaskRunState =
  | "idle"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "abandoned";

export type TaskPriority =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "urgent";

export type TaskSubtaskRecord = {
  id: string;
  text: string;
  completed: boolean;
};

export type TaskRecord = {
  id: string;
  projectId: string;
  title: string;
  descriptionMarkdown: string;
  priority: TaskPriority;
  labels: string[];
  subtasks: TaskSubtaskRecord[];
  reviewNotesMarkdown: string;
  assignee: string | null;
  workflowState: TaskWorkflowState;
  lastRunState: TaskRunState;
  lastSessionId: string | null;
  assignedAgentMode: string | null;
  markdownExportPath: string | null;
  blockedReason: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type SettingRecord<TValue = unknown> = {
  key: string;
  value: TValue;
  updatedAt: number;
};

export type SecretStatus =
  | "keychain"
  | "env"
  | "missing";

export type SecretStatusRecord = {
  status: SecretStatus | string;
};

export type ProjectTreeEntryRecord = {
  path: string;
  name: string;
  kind: "directory" | "file" | string;
};

export type ProjectFilePreviewRecord = {
  path: string;
  absolutePath: string;
  name: string;
  format: "markdown" | "text" | string;
  content: string;
};

export type ProjectContentSearchHitRecord = {
  path: string;
  lineNumber: number;
  lineText: string;
};

export const PROJECT_FILE_REFRESH_EVENT = "dispatch://files/refresh";

export type ProjectFileWatchRecord = {
  projectId: string;
  debounceWindowMs: number;
};

export type ProjectFileRefreshEventRecord = {
  projectId: string;
  changedPaths: string[];
  changedAtUnixMs: number;
};

export type SavePointRecord = {
  projectId: string;
  runId: string | null;
  refName: string;
  commitOid: string;
  baseHeadOid: string | null;
  stage: "pre_agent" | "post_agent" | "manual" | string;
  createdAt: number;
};

export type SavePointCreateResultRecord = {
  status: "created" | "unsupported" | string;
  savePoint: SavePointRecord | null;
};

export type SavePointDiffSummaryRecord = {
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export type SavePointDiffFileRecord = {
  path: string;
  previousPath: string | null;
  status: string;
  isBinary: boolean;
  patch: string;
};

export type SavePointDiffRecord = {
  projectId: string;
  refName: string;
  commitOid: string;
  baseCommitOid: string | null;
  summary: SavePointDiffSummaryRecord;
  files: SavePointDiffFileRecord[];
};

export type SavePointDiffResultRecord = {
  status: "ready" | "unsupported" | string;
  diff: SavePointDiffRecord | null;
};

export type SavePointRestoreResultRecord = {
  status: "restored" | "unsupported" | string;
  refName: string | null;
  restoredPaths: string[];
};

export type ChatMessageRole =
  | "system"
  | "user"
  | "assistant"
  | "tool";

export type ChatMessageAuthorKind =
  | "user"
  | "dispatch"
  | "openclaw"
  | "agent";

export type ChatMessageRecord = {
  id: string;
  conversationId: string;
  projectId: string | null;
  agentSessionId: string | null;
  role: ChatMessageRole | string;
  authorKind: ChatMessageAuthorKind | string;
  bodyMarkdown: string;
  metadataJson: Record<string, unknown>;
  createdAt: number;
};

export type OpenClawChatSendResultRecord = {
  message: ChatMessageRecord;
  sessionKey: string;
  conversationId: string;
  runId: string | null;
  status: string;
};

export type OpenClawChatSnapshotRecord = {
  status: OpenClawConnectionStatusRecord;
  streamState: string;
  conversationId: string;
  sessionKey: string;
  messages: ChatMessageRecord[];
};

export type OpenClawConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export type OpenClawConnectionStatusRecord = {
  state: OpenClawConnectionState | string;
  gatewayUrl: string | null;
  connectedAt: number | null;
  lastError: string | null;
  protocolVersion: number | null;
  serverVersion: string | null;
  tickIntervalMs: number | null;
  availableMethods: string[];
  availableEvents: string[];
  helloSnapshot: Record<string, unknown> | null;
  statusDetails: Record<string, unknown> | null;
  healthDetails: Record<string, unknown> | null;
  presenceDetails: Record<string, unknown> | null;
  lastEventAt: number | null;
  lastEventSeq: number | null;
};

export type OpenClawSidebarSessionRecord = {
  id: string;
  sessionKey: string;
  title: string;
  subtitle: string;
  source: string;
  sessionKind: string;
  status: "pending" | "running" | "succeeded" | "failed" | "canceled" | "abandoned" | string;
  taskId: string | null;
  agentId: string | null;
  label: string | null;
  runId: string | null;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number | null;
};

export type OpenClawSidebarSnapshotRecord = {
  status: OpenClawConnectionStatusRecord;
  sessions: OpenClawSidebarSessionRecord[];
};

export type OpenClawDispatchSessionResultRecord = {
  sessionId: string;
  sessionKey: string;
  runId: string | null;
  status: string;
  taskId: string | null;
};

export type TerminalSessionRecord = {
  id: string;
  projectId: string;
  taskId: string | null;
  source: string;
  sessionKind: string;
  status: "pending" | "running" | "succeeded" | "failed" | "canceled" | "abandoned" | string;
  program: string;
  transport: string;
  cwdRelativePath: string;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type TerminalWorkspaceRecord = {
  websocketBaseUrl: string;
  sessions: TerminalSessionRecord[];
};

export type AgentRegistryEntryRecord = {
  id: string;
  name: string;
  selectionMode: "auto" | "profile" | string;
};

export type AgentArgRecord =
  | {
    kind: "literal";
    value: string;
  }
  | {
    kind: "prompt";
  }
  | {
    kind: "optional_prompt";
  }
  | {
    kind: "project_path";
  }
  | {
    kind: "task_title";
  }
  | {
    kind: "task_body";
  };

export type AgentEnvValueRecord =
  | {
    kind: "inherit";
    key: string;
  }
  | {
    kind: "literal";
    value: string;
  }
  | {
    kind: "secret";
    key: string;
  };

export type AgentCwdRecord = {
  kind: "project_root" | string;
};

export type AgentProfileRecord = {
  id: string;
  name: string;
  program: string;
  args: AgentArgRecord[];
  env: Record<string, AgentEnvValueRecord>;
  cwd: AgentCwdRecord;
  createdAt: number;
  updatedAt: number;
};

type CreateProjectInput = {
  name: string;
  rootPath: string;
};

type CreateTaskInput = {
  projectId: string;
  title: string;
  descriptionMarkdown?: string | null;
  priority?: TaskPriority | null;
  labels?: string[] | null;
  subtasks?: TaskSubtaskRecord[] | null;
  reviewNotesMarkdown?: string | null;
  assignee?: string | null;
  workflowState?: TaskWorkflowState | null;
  assignedAgentMode?: string | null;
  blockedReason?: string | null;
};

type UpdateTaskInput = {
  projectId: string;
  taskId: string;
  title?: string;
  descriptionMarkdown?: string;
  priority?: TaskPriority;
  labels?: string[];
  subtasks?: TaskSubtaskRecord[];
  reviewNotesMarkdown?: string;
  assignee?: string | null;
  workflowState?: TaskWorkflowState;
  lastRunState?: TaskRunState;
  lastSessionId?: string | null;
  assignedAgentMode?: string | null;
  markdownExportPath?: string | null;
  blockedReason?: string | null;
  completedAt?: number | null;
};

type DispatchAgentInput = {
  projectId: string;
  profileId: string;
  taskId?: string | null;
  prompt?: string | null;
};

type SecretKeyInput = {
  key: string;
};

type SecretSetInput = {
  key: string;
  value: string;
};

type AgentProfileIdInput = {
  profileId: string;
};

type SaveAgentProfileInput = {
  id: string;
  name: string;
  program: string;
  args: AgentArgRecord[];
  env: Record<string, AgentEnvValueRecord>;
  cwd: AgentCwdRecord;
};

type CreateTerminalSessionInput = {
  projectId: string;
  taskId?: string | null;
  shell?: string | null;
};

type TerminalWorkspaceInput = {
  projectId: string;
};

type ProjectIdInput = {
  projectId: string;
};

type ListProjectTreeInput = {
  projectId: string;
  rootRelativePath?: string | null;
};

type ReadProjectFileInput = {
  projectId: string;
  relativePath: string;
};

type SearchProjectInput = {
  projectId: string;
  query: string;
};

type CreateManualSavePointInput = {
  projectId: string;
  label?: string | null;
};

type ProjectSavePointInput = {
  projectId: string;
  refName: string;
};

type RestoreProjectSavePointFileInput = {
  projectId: string;
  refName: string;
  relativePath: string;
};

type SessionIdInput = {
  sessionId: string;
};

type SettingKeyInput = {
  key: string;
};

type OpenClawConnectInput = {
  gatewayUrl?: string | null;
  authToken?: string | null;
};

type OpenClawListSessionsInput = {
  limit?: number | null;
  search?: string | null;
};

type OpenClawSpawnSessionInput = {
  message: string;
  agentId?: string | null;
  sessionKey?: string | null;
  label?: string | null;
};

type OpenClawDispatchSessionInput = {
  projectId: string;
  taskId?: string | null;
  prompt: string;
};

type OpenClawChatSnapshotInput = {
  conversationId?: string | null;
  sessionKey?: string | null;
  limit?: number | null;
};

type OpenClawSendChatMessageInput = {
  projectId?: string | null;
  conversationId?: string | null;
  sessionKey?: string | null;
  bodyMarkdown: string;
};

type OpenClawSendMessageInput = {
  sessionKey: string;
  message: string;
};

type OpenClawKillSessionInput = {
  sessionKey: string;
  runId?: string | null;
};

type SetSettingInput<TValue> = {
  key: string;
  value: TValue;
};

type TauriInternalsWindow = Window & {
  __TAURI_INTERNALS__?: {
    invoke?: unknown;
  };
};

type PreviewProjectFileSource = {
  preview: ProjectFilePreviewRecord;
  lines: string[];
};

const PREVIEW_PROJECT_ID = "project-dispatch";
const PREVIEW_CONVERSATION_ID = "main";
const PREVIEW_SESSION_KEY = "agent:main:global";
const PREVIEW_AUTO_REVIEW_SETTING_KEY = "dispatch.review.auto_enabled";
const PREVIEW_ACTIVE_PROJECT_SETTING_KEY = "app.active_project_id";
const PREVIEW_BOOTED_AT_UNIX = 1_774_485_600;
const PREVIEW_UPDATED_AT_UNIX = PREVIEW_BOOTED_AT_UNIX + 480;

const previewProject: ProjectRecord = {
  id: PREVIEW_PROJECT_ID,
  name: "dispatch",
  rootRelativePath: ".",
  createdAt: PREVIEW_BOOTED_AT_UNIX - 86_400,
  updatedAt: PREVIEW_UPDATED_AT_UNIX,
  lastOpenedAt: PREVIEW_UPDATED_AT_UNIX,
};

const previewFiles: PreviewProjectFileSource[] = [
  {
    preview: {
      path: "README.md",
      absolutePath: "/workspace/dispatch/README.md",
      name: "README.md",
      format: "markdown",
      content: [
        "# Dispatch",
        "",
        "Dispatch is a compact agent workspace with tabs for Orchestrate, Tasks, Agents, Files, History, and Browser.",
        "",
        "The shell stays visually quiet so the project context and agent output can do the work.",
      ].join("\n"),
    },
    lines: [
      "# Dispatch",
      "",
      "Dispatch is a compact agent workspace with tabs for Orchestrate, Tasks, Agents, Files, History, and Browser.",
      "",
      "The shell stays visually quiet so the project context and agent output can do the work.",
    ],
  },
  {
    preview: {
      path: "src/app/App.tsx",
      absolutePath: "/workspace/dispatch/src/app/App.tsx",
      name: "App.tsx",
      format: "text",
      content: [
        "export function App() {",
        "  return <DispatchShell />;",
        "}",
      ].join("\n"),
    },
    lines: [
      "export function App() {",
      "  return <DispatchShell />;",
      "}",
    ],
  },
  {
    preview: {
      path: "src/features/agents/TerminalPanel.tsx",
      absolutePath: "/workspace/dispatch/src/features/agents/TerminalPanel.tsx",
      name: "TerminalPanel.tsx",
      format: "text",
      content: [
        "const previewShell = [",
        "  '$ codex plan --task \"Align shell to screenshots\"',",
        "  'Inspecting App, TopBar, TabHost, Agents, Files...',",
        "  'Applying compact titlebar shell changes...',",
        "];",
      ].join("\n"),
    },
    lines: [
      "const previewShell = [",
      "  '$ codex plan --task \"Align shell to screenshots\"',",
      "  'Inspecting App, TopBar, TabHost, Agents, Files...',",
      "  'Applying compact titlebar shell changes...',",
      "];",
    ],
  },
  {
    preview: {
      path: "src/features/files/FilesTab.tsx",
      absolutePath: "/workspace/dispatch/src/features/files/FilesTab.tsx",
      name: "FilesTab.tsx",
      format: "text",
      content: [
        "export function FilesTab() {",
        "  return <ProjectBrowser />;",
        "}",
      ].join("\n"),
    },
    lines: [
      "export function FilesTab() {",
      "  return <ProjectBrowser />;",
      "}",
    ],
  },
];

const previewFileByPath = new Map(
  previewFiles.map((source) => [
    source.preview.path,
    source,
  ]),
);

const previewTreeByDirectory = new Map<string, ProjectTreeEntryRecord[]>([
  [
    ".",
    [
      { path: "src", name: "src", kind: "directory" },
      { path: "docs", name: "docs", kind: "directory" },
      { path: "README.md", name: "README.md", kind: "file" },
      { path: "package.json", name: "package.json", kind: "file" },
    ],
  ],
  [
    "src",
    [
      { path: "src/app", name: "app", kind: "directory" },
      { path: "src/features", name: "features", kind: "directory" },
      { path: "src/styles", name: "styles", kind: "directory" },
    ],
  ],
  [
    "src/app",
    [
      { path: "src/app/App.tsx", name: "App.tsx", kind: "file" },
      { path: "src/app/TabHost.tsx", name: "TabHost.tsx", kind: "file" },
    ],
  ],
  [
    "src/features",
    [
      { path: "src/features/agents", name: "agents", kind: "directory" },
      { path: "src/features/files", name: "files", kind: "directory" },
      { path: "src/features/tasks", name: "tasks", kind: "directory" },
    ],
  ],
  [
    "src/features/agents",
    [
      { path: "src/features/agents/TerminalPanel.tsx", name: "TerminalPanel.tsx", kind: "file" },
    ],
  ],
  [
    "src/features/files",
    [
      { path: "src/features/files/FilesTab.tsx", name: "FilesTab.tsx", kind: "file" },
    ],
  ],
  [
    "docs",
    [
      { path: "docs/vision.md", name: "vision.md", kind: "file" },
    ],
  ],
]);

const previewOpenClawStatus: OpenClawConnectionStatusRecord = {
  state: "disconnected",
  gatewayUrl: null,
  connectedAt: null,
  lastError: null,
  protocolVersion: null,
  serverVersion: null,
  tickIntervalMs: null,
  availableMethods: [],
  availableEvents: [],
  helloSnapshot: null,
  statusDetails: null,
  healthDetails: null,
  presenceDetails: null,
  lastEventAt: null,
  lastEventSeq: null,
};

const previewAgentRegistryEntries: AgentRegistryEntryRecord[] = [
  {
    id: "auto",
    name: "Auto",
    selectionMode: "auto",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    selectionMode: "profile",
  },
  {
    id: "codex",
    name: "Codex",
    selectionMode: "profile",
  },
  {
    id: "gemini",
    name: "Gemini",
    selectionMode: "profile",
  },
];

const previewAgentProfiles: AgentProfileRecord[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    program: "claude",
    args: [{ kind: "optional_prompt" }],
    env: {},
    cwd: { kind: "project_root" },
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "codex",
    name: "Codex",
    program: "codex",
    args: [{ kind: "optional_prompt" }],
    env: {},
    cwd: { kind: "project_root" },
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "gemini",
    name: "Gemini",
    program: "gemini",
    args: [{ kind: "prompt" }],
    env: {},
    cwd: { kind: "project_root" },
    createdAt: 0,
    updatedAt: 0,
  },
];

let previewTaskCounter = 3;
let previewTerminalSessionCounter = 2;
let previewSettings = new Map<string, unknown>([
  [PREVIEW_ACTIVE_PROJECT_SETTING_KEY, PREVIEW_PROJECT_ID],
  [PREVIEW_AUTO_REVIEW_SETTING_KEY, true],
]);

let previewTasks: TaskRecord[] = [
  {
    id: "task-shell",
    projectId: PREVIEW_PROJECT_ID,
    title: "Refine shell chrome against latest reference",
    descriptionMarkdown: "Collapse the header into a single compact strip and keep tabs inline with the project selector.",
    priority: "high",
    labels: ["design", "shell"],
    subtasks: [
      {
        id: "task-shell-1",
        text: "Remove the second nav row",
        completed: true,
      },
      {
        id: "task-shell-2",
        text: "Tighten spacing in the header",
        completed: false,
      },
    ],
    reviewNotesMarkdown: "PASS\n\nHeader direction is closer. Agents and Files still need a flatter inner layout.",
    assignee: "Codex",
    workflowState: "in_progress",
    lastRunState: "running",
    lastSessionId: "session-shell",
    assignedAgentMode: "profile:codex",
    markdownExportPath: null,
    blockedReason: null,
    createdAt: PREVIEW_BOOTED_AT_UNIX - 3_600,
    updatedAt: PREVIEW_UPDATED_AT_UNIX,
    completedAt: null,
  },
  {
    id: "task-files",
    projectId: PREVIEW_PROJECT_ID,
    title: "Flatten the Files workspace",
    descriptionMarkdown: "Reduce panel chrome and make the browser feel closer to an editor split.",
    priority: "medium",
    labels: ["design", "files"],
    subtasks: [
      {
        id: "task-files-1",
        text: "Compress file search header",
        completed: true,
      },
      {
        id: "task-files-2",
        text: "Tone down preview framing",
        completed: false,
      },
    ],
    reviewNotesMarkdown: "",
    assignee: "Codex",
    workflowState: "review",
    lastRunState: "idle",
    lastSessionId: null,
    assignedAgentMode: "profile:codex",
    markdownExportPath: null,
    blockedReason: null,
    createdAt: PREVIEW_BOOTED_AT_UNIX - 7_200,
    updatedAt: PREVIEW_UPDATED_AT_UNIX - 240,
    completedAt: null,
  },
  {
    id: "task-history",
    projectId: PREVIEW_PROJECT_ID,
    title: "Keep save-point history readable",
    descriptionMarkdown: "History is structurally correct. Preserve the low-chrome list and readable diff area.",
    priority: "low",
    labels: ["history"],
    subtasks: [],
    reviewNotesMarkdown: "",
    assignee: null,
    workflowState: "done",
    lastRunState: "succeeded",
    lastSessionId: null,
    assignedAgentMode: null,
    markdownExportPath: null,
    blockedReason: null,
    createdAt: PREVIEW_BOOTED_AT_UNIX - 10_800,
    updatedAt: PREVIEW_UPDATED_AT_UNIX - 900,
    completedAt: PREVIEW_UPDATED_AT_UNIX - 900,
  },
];

let previewTerminalSessions: TerminalSessionRecord[] = [
  {
    id: "session-shell",
    projectId: PREVIEW_PROJECT_ID,
    taskId: "task-shell",
    source: "dispatch",
    sessionKind: "terminal",
    status: "running",
    program: "codex",
    transport: "pty",
    cwdRelativePath: ".",
    startedAt: PREVIEW_BOOTED_AT_UNIX - 1_800,
    endedAt: null,
    createdAt: PREVIEW_BOOTED_AT_UNIX - 1_800,
    updatedAt: PREVIEW_UPDATED_AT_UNIX,
  },
  {
    id: "session-notes",
    projectId: PREVIEW_PROJECT_ID,
    taskId: null,
    source: "local",
    sessionKind: "terminal",
    status: "running",
    program: "bash",
    transport: "pty",
    cwdRelativePath: ".",
    startedAt: PREVIEW_BOOTED_AT_UNIX - 2_700,
    endedAt: null,
    createdAt: PREVIEW_BOOTED_AT_UNIX - 2_700,
    updatedAt: PREVIEW_UPDATED_AT_UNIX - 60,
  },
];

let previewTerminalOutputBySessionId = new Map<string, string>([
  [
    "session-shell",
    [
      "dispatch /workspace/dispatch",
      "$ codex work --surface agents --goal \"match the new shell refs\"",
      "",
      "Inspecting current shell surfaces...",
      "  - Header collapsed into a single strip",
      "  - Tasks promoted into a primary tab",
      "  - Agents sidebar reduced to a thinner rail",
      "",
      "Next:",
      "  1. flatten terminal framing",
      "  2. reduce files chrome",
      "  3. tighten orchestrate density",
    ].join("\n"),
  ],
  [
    "session-notes",
    [
      "notes /workspace/dispatch",
      "$ git status --short",
      " M src/app/App.tsx",
      " M src/app/TabHost.tsx",
      " M src/shared/components/TopBar.tsx",
      " M src/styles/globals.css",
    ].join("\n"),
  ],
]);

let previewChatMessages: ChatMessageRecord[] = [
  {
    id: "chat-1",
    conversationId: PREVIEW_CONVERSATION_ID,
    projectId: PREVIEW_PROJECT_ID,
    agentSessionId: null,
    role: "assistant",
    authorKind: "dispatch",
    bodyMarkdown: "Shell refactor is moving in the right direction. The next visual gap is the Agents tab: thinner rail, flatter terminal frame, denser header.",
    metadataJson: {},
    createdAt: PREVIEW_BOOTED_AT_UNIX - 600,
  },
  {
    id: "chat-2",
    conversationId: PREVIEW_CONVERSATION_ID,
    projectId: PREVIEW_PROJECT_ID,
    agentSessionId: null,
    role: "assistant",
    authorKind: "dispatch",
    bodyMarkdown: "Files should feel like a simple explorer and preview split, not a dashboard surface.",
    metadataJson: {},
    createdAt: PREVIEW_BOOTED_AT_UNIX - 420,
  },
];

let previewSavePointCounter = 1;
let previewSavePoints: SavePointRecord[] = [
  {
    projectId: PREVIEW_PROJECT_ID,
    runId: "session-shell",
    refName: "refs/dispatch/save-points/project-dispatch/1774485200-post-shell-pass",
    commitOid: "abc123def456",
    baseHeadOid: "998877665544",
    stage: "post_agent",
    createdAt: PREVIEW_BOOTED_AT_UNIX - 300,
  },
  {
    projectId: PREVIEW_PROJECT_ID,
    runId: null,
    refName: "refs/dispatch/save-points/project-dispatch/1774484700-manual-before-agents",
    commitOid: "ddeeff001122",
    baseHeadOid: "998877665544",
    stage: "manual",
    createdAt: PREVIEW_BOOTED_AT_UNIX - 900,
  },
];

const previewDiffsByRefName = new Map<string, SavePointDiffResultRecord>([
  [
    "refs/dispatch/save-points/project-dispatch/1774485200-post-shell-pass",
    {
      status: "ready",
      diff: {
        projectId: PREVIEW_PROJECT_ID,
        refName: "refs/dispatch/save-points/project-dispatch/1774485200-post-shell-pass",
        commitOid: "abc123def456",
        baseCommitOid: "998877665544",
        summary: {
          filesChanged: 3,
          insertions: 42,
          deletions: 17,
        },
        files: [
          {
            path: "src/shared/components/TopBar.tsx",
            previousPath: null,
            status: "modified",
            isBinary: false,
            patch: "@@ -1,4 +1,4 @@\n- old two-row shell\n+ compact inline shell",
          },
        ],
      },
    },
  ],
  [
    "refs/dispatch/save-points/project-dispatch/1774484700-manual-before-agents",
    {
      status: "ready",
      diff: {
        projectId: PREVIEW_PROJECT_ID,
        refName: "refs/dispatch/save-points/project-dispatch/1774484700-manual-before-agents",
        commitOid: "ddeeff001122",
        baseCommitOid: "998877665544",
        summary: {
          filesChanged: 2,
          insertions: 18,
          deletions: 6,
        },
        files: [
          {
            path: "src/features/agents/TerminalPanel.tsx",
            previousPath: null,
            status: "modified",
            isBinary: false,
            patch: "@@ -1,4 +1,4 @@\n- padded cards\n+ flatter terminal shell",
          },
        ],
      },
    },
  ],
]);

function cloneProject(project: ProjectRecord) {
  return { ...project };
}

function cloneTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    labels: [...task.labels],
    subtasks: task.subtasks.map((subtask) => ({ ...subtask })),
  };
}

function cloneTerminalSession(session: TerminalSessionRecord) {
  return { ...session };
}

function cloneChatMessage(message: ChatMessageRecord) {
  return {
    ...message,
    metadataJson: { ...message.metadataJson },
  };
}

function cloneSavePoint(savePoint: SavePointRecord) {
  return { ...savePoint };
}

function cloneSavePointDiff(result: SavePointDiffResultRecord): SavePointDiffResultRecord {
  return {
    ...result,
    diff: result.diff
      ? {
          ...result.diff,
          summary: { ...result.diff.summary },
          files: result.diff.files.map((file) => ({ ...file })),
        }
      : null,
  };
}

function nextPreviewTaskId() {
  previewTaskCounter += 1;
  return `task-preview-${previewTaskCounter}`;
}

function nextPreviewTerminalSessionId() {
  previewTerminalSessionCounter += 1;
  return `session-preview-${previewTerminalSessionCounter}`;
}

function nextPreviewSavePointRefName() {
  previewSavePointCounter += 1;
  return `refs/dispatch/save-points/project-dispatch/1774486${String(previewSavePointCounter).padStart(3, "0")}-manual-preview`;
}

function getPreviewSettingRecord<TValue = unknown>(key: string): SettingRecord<TValue> | null {
  if (!previewSettings.has(key)) {
    return null;
  }

  return {
    key,
    value: previewSettings.get(key) as TValue,
    updatedAt: PREVIEW_UPDATED_AT_UNIX,
  };
}

function listPreviewTasks(projectId: string) {
  return previewTasks
    .filter((task) => task.projectId === projectId)
    .map(cloneTask);
}

function getPreviewTask(taskId: string) {
  return previewTasks.find((task) => task.id === taskId) ?? null;
}

function buildPreviewHealth(): HealthResponse {
  return {
    status: "ok",
    appName: "Dispatch",
    appVersion: "0.1.0-preview",
    bootedAtUnix: PREVIEW_BOOTED_AT_UNIX,
    logDirectory: null,
    activeLogPath: null,
    sessionLogsDirectory: null,
    staleSessionsAbandonedAtBoot: 0,
  };
}

function browserPreviewUnsupported(command: string): never {
  throw new Error(`Dispatch browser preview does not support "${command}". Run the desktop app for live runtime behavior.`);
}

function hasTauriRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  return typeof (window as TauriInternalsWindow).__TAURI_INTERNALS__?.invoke === "function";
}

function isJsdomRuntime() {
  return typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
}

export function isBrowserPreviewMode() {
  return typeof window !== "undefined" && !hasTauriRuntime() && !isJsdomRuntime();
}

function isTauriRuntimeUnavailableError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";

  return message.includes("__TAURI_INTERNALS__")
    || message.includes("reading 'invoke'")
    || message.includes("reading 'transformCallback'");
}

function previewSearchProjectPaths(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const allEntries = Array.from(previewTreeByDirectory.values()).flat();
  return allEntries
    .filter((entry) => entry.path.toLowerCase().includes(normalizedQuery) || entry.name.toLowerCase().includes(normalizedQuery))
    .map((entry) => ({ ...entry }));
}

function previewSearchProjectContent(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const hits: ProjectContentSearchHitRecord[] = [];

  for (const source of previewFiles) {
    source.lines.forEach((lineText, index) => {
      if (!lineText.toLowerCase().includes(normalizedQuery)) {
        return;
      }

      hits.push({
        path: source.preview.path,
        lineNumber: index + 1,
        lineText,
      });
    });
  }

  return hits;
}

export function getBrowserPreviewTerminalOutput(sessionId: string) {
  return previewTerminalOutputBySessionId.get(sessionId) ?? null;
}

function handlePreviewInvoke<TResult>(
  command: string,
  args?: Record<string, unknown>,
): TResult {
  switch (command) {
    case "health":
      return buildPreviewHealth() as TResult;
    case "show_main_window":
    case "hide_main_window":
    case "is_main_window_visible":
      return true as TResult;
    case "list_projects":
      return [cloneProject(previewProject)] as TResult;
    case "get_project": {
      const projectId = String(args?.projectId ?? "");
      return (projectId === PREVIEW_PROJECT_ID ? cloneProject(previewProject) : null) as TResult;
    }
    case "get_setting": {
      const key = String(args?.key ?? "");
      return getPreviewSettingRecord(key) as TResult;
    }
    case "set_setting": {
      const key = String(args?.key ?? "");
      previewSettings.set(key, args?.value ?? null);
      return {
        key,
        value: previewSettings.get(key) ?? null,
        updatedAt: PREVIEW_UPDATED_AT_UNIX,
      } as TResult;
    }
    case "list_tasks": {
      const projectId = String((args?.input as { projectId?: string } | undefined)?.projectId ?? "");
      return listPreviewTasks(projectId) as TResult;
    }
    case "create_task": {
      const input = (args?.input as CreateTaskInput | undefined) ?? { projectId: PREVIEW_PROJECT_ID, title: "Untitled" };
      const task: TaskRecord = {
        id: nextPreviewTaskId(),
        projectId: input.projectId,
        title: input.title.trim(),
        descriptionMarkdown: input.descriptionMarkdown ?? "",
        priority: input.priority ?? "none",
        labels: [...(input.labels ?? [])],
        subtasks: (input.subtasks ?? []).map((subtask) => ({ ...subtask })),
        reviewNotesMarkdown: input.reviewNotesMarkdown ?? "",
        assignee: input.assignee ?? null,
        workflowState: input.workflowState ?? "draft",
        lastRunState: "idle",
        lastSessionId: null,
        assignedAgentMode: input.assignedAgentMode ?? null,
        markdownExportPath: null,
        blockedReason: input.blockedReason ?? null,
        createdAt: PREVIEW_UPDATED_AT_UNIX,
        updatedAt: PREVIEW_UPDATED_AT_UNIX,
        completedAt: null,
      };
      previewTasks = [task, ...previewTasks];
      return cloneTask(task) as TResult;
    }
    case "update_task": {
      const input = (args?.input as UpdateTaskInput | undefined) ?? { projectId: PREVIEW_PROJECT_ID, taskId: "" };
      const task = getPreviewTask(input.taskId);
      if (!task) {
        throw new Error("Task was not found in browser preview mode.");
      }

      const updatedTask: TaskRecord = {
        ...task,
        title: input.title ?? task.title,
        descriptionMarkdown: input.descriptionMarkdown ?? task.descriptionMarkdown,
        priority: input.priority ?? task.priority,
        labels: input.labels ? [...input.labels] : [...task.labels],
        subtasks: input.subtasks ? input.subtasks.map((subtask) => ({ ...subtask })) : task.subtasks.map((subtask) => ({ ...subtask })),
        reviewNotesMarkdown: input.reviewNotesMarkdown ?? task.reviewNotesMarkdown,
        assignee: input.assignee === undefined ? task.assignee : input.assignee,
        workflowState: input.workflowState ?? task.workflowState,
        lastRunState: input.lastRunState ?? task.lastRunState,
        lastSessionId: input.lastSessionId === undefined ? task.lastSessionId : input.lastSessionId,
        assignedAgentMode: input.assignedAgentMode === undefined ? task.assignedAgentMode : input.assignedAgentMode,
        markdownExportPath: input.markdownExportPath === undefined ? task.markdownExportPath : input.markdownExportPath,
        blockedReason: input.blockedReason === undefined ? task.blockedReason : input.blockedReason,
        completedAt: input.completedAt === undefined ? task.completedAt : input.completedAt,
        updatedAt: PREVIEW_UPDATED_AT_UNIX,
      };
      previewTasks = previewTasks.map((candidate) => candidate.id === updatedTask.id ? updatedTask : candidate);
      return cloneTask(updatedTask) as TResult;
    }
    case "delete_task": {
      const taskId = String((args?.input as { taskId?: string } | undefined)?.taskId ?? "");
      const previousCount = previewTasks.length;
      previewTasks = previewTasks.filter((task) => task.id !== taskId);
      return (previewTasks.length !== previousCount) as TResult;
    }
    case "list_project_tree": {
      const rootRelativePath = String((args?.input as { rootRelativePath?: string | null } | undefined)?.rootRelativePath ?? ".");
      return (previewTreeByDirectory.get(rootRelativePath) ?? []).map((entry) => ({ ...entry })) as TResult;
    }
    case "read_project_file": {
      const relativePath = String((args?.input as { relativePath?: string } | undefined)?.relativePath ?? "");
      const source = previewFileByPath.get(relativePath);
      if (!source) {
        throw new Error("Project path was not found in browser preview mode.");
      }
      return {
        ...source.preview,
      } as TResult;
    }
    case "search_project_paths": {
      const query = String((args?.input as { query?: string } | undefined)?.query ?? "");
      return previewSearchProjectPaths(query) as TResult;
    }
    case "search_project_content": {
      const query = String((args?.input as { query?: string } | undefined)?.query ?? "");
      return previewSearchProjectContent(query) as TResult;
    }
    case "start_project_file_watch": {
      const projectId = String((args?.input as { projectId?: string } | undefined)?.projectId ?? PREVIEW_PROJECT_ID);
      return {
        projectId,
        debounceWindowMs: 150,
      } as TResult;
    }
    case "stop_project_file_watch":
      return true as TResult;
    case "list_project_save_points": {
      const projectId = String((args?.input as { projectId?: string } | undefined)?.projectId ?? "");
      return previewSavePoints
        .filter((savePoint) => savePoint.projectId === projectId)
        .map(cloneSavePoint) as TResult;
    }
    case "latest_project_save_point": {
      const projectId = String((args?.input as { projectId?: string } | undefined)?.projectId ?? "");
      const savePoint = previewSavePoints.find((candidate) => candidate.projectId === projectId) ?? null;
      return (savePoint ? cloneSavePoint(savePoint) : null) as TResult;
    }
    case "get_project_save_point_diff": {
      const refName = String((args?.input as { refName?: string } | undefined)?.refName ?? "");
      const diff = previewDiffsByRefName.get(refName);
      if (!diff) {
        throw new Error("Save-point diff was not found in browser preview mode.");
      }
      return cloneSavePointDiff(diff) as TResult;
    }
    case "create_manual_save_point": {
      const projectId = String((args?.input as { projectId?: string } | undefined)?.projectId ?? PREVIEW_PROJECT_ID);
      const refName = nextPreviewSavePointRefName();
      const savePoint: SavePointRecord = {
        projectId,
        runId: null,
        refName,
        commitOid: "preview001122",
        baseHeadOid: "preview-base",
        stage: "manual",
        createdAt: PREVIEW_UPDATED_AT_UNIX + previewSavePointCounter,
      };
      previewSavePoints = [savePoint, ...previewSavePoints];
      previewDiffsByRefName.set(refName, {
        status: "ready",
        diff: {
          projectId,
          refName,
          commitOid: savePoint.commitOid,
          baseCommitOid: savePoint.baseHeadOid,
          summary: {
            filesChanged: 1,
            insertions: 6,
            deletions: 1,
          },
          files: [
            {
              path: "src/styles/globals.css",
              previousPath: null,
              status: "modified",
              isBinary: false,
              patch: "@@ -1,3 +1,3 @@\n- louder chrome\n+ flatter shell",
            },
          ],
        },
      });
      return {
        status: "created",
        savePoint: cloneSavePoint(savePoint),
      } as TResult;
    }
    case "restore_project_save_point":
    case "restore_project_save_point_file": {
      const input = (args?.input as { refName?: string; relativePath?: string } | undefined) ?? {};
      return {
        status: "restored",
        refName: input.refName ?? null,
        restoredPaths: input.relativePath ? [input.relativePath] : ["src/shared/components/TopBar.tsx"],
      } as TResult;
    }
    case "connect_openclaw":
    case "disconnect_openclaw":
    case "get_openclaw_status":
      return {
        ...previewOpenClawStatus,
      } as TResult;
    case "get_openclaw_sidebar_snapshot":
      return {
        status: {
          ...previewOpenClawStatus,
        },
        sessions: [],
      } as TResult;
    case "get_openclaw_chat_snapshot": {
      const input = (args?.input as OpenClawChatSnapshotInput | undefined) ?? {};
      return {
        status: {
          ...previewOpenClawStatus,
          state: "connected",
          gatewayUrl: "ws://localhost:3444",
        },
        streamState: "live",
        conversationId: input.conversationId ?? PREVIEW_CONVERSATION_ID,
        sessionKey: input.sessionKey ?? PREVIEW_SESSION_KEY,
        messages: previewChatMessages.map(cloneChatMessage),
      } as TResult;
    }
    case "send_openclaw_chat_message": {
      const input = (args?.input as OpenClawSendChatMessageInput | undefined) ?? {
        bodyMarkdown: "",
      };
      const createdAt = PREVIEW_UPDATED_AT_UNIX + previewChatMessages.length + 1;
      const userMessage: ChatMessageRecord = {
        id: `chat-user-${createdAt}`,
        conversationId: input.conversationId ?? PREVIEW_CONVERSATION_ID,
        projectId: input.projectId ?? PREVIEW_PROJECT_ID,
        agentSessionId: null,
        role: "user",
        authorKind: "user",
        bodyMarkdown: input.bodyMarkdown,
        metadataJson: {},
        createdAt,
      };
      const assistantMessage: ChatMessageRecord = {
        id: `chat-assistant-${createdAt}`,
        conversationId: input.conversationId ?? PREVIEW_CONVERSATION_ID,
        projectId: input.projectId ?? PREVIEW_PROJECT_ID,
        agentSessionId: null,
        role: "assistant",
        authorKind: "dispatch",
        bodyMarkdown: "Browser preview mode can render the shell and sample state, but live orchestration still requires the desktop runtime.",
        metadataJson: {},
        createdAt: createdAt + 1,
      };
      previewChatMessages = [
        ...previewChatMessages,
        userMessage,
        assistantMessage,
      ];
      return {
        message: cloneChatMessage(userMessage),
        sessionKey: input.sessionKey ?? PREVIEW_SESSION_KEY,
        conversationId: input.conversationId ?? PREVIEW_CONVERSATION_ID,
        runId: null,
        status: "queued",
      } as TResult;
    }
    case "get_terminal_workspace": {
      const projectId = String((args?.projectId as string | undefined) ?? PREVIEW_PROJECT_ID);
      return {
        websocketBaseUrl: "ws://preview.dispatch.invalid",
        sessions: previewTerminalSessions
          .filter((session) => session.projectId === projectId)
          .map(cloneTerminalSession),
      } as TResult;
    }
    case "create_terminal_session": {
      const input = (args as CreateTerminalSessionInput | undefined) ?? { projectId: PREVIEW_PROJECT_ID };
      const session: TerminalSessionRecord = {
        id: nextPreviewTerminalSessionId(),
        projectId: input.projectId,
        taskId: input.taskId ?? null,
        source: "local",
        sessionKind: "terminal",
        status: "running",
        program: input.shell ?? "bash",
        transport: "pty",
        cwdRelativePath: ".",
        startedAt: PREVIEW_UPDATED_AT_UNIX,
        endedAt: null,
        createdAt: PREVIEW_UPDATED_AT_UNIX,
        updatedAt: PREVIEW_UPDATED_AT_UNIX,
      };
      previewTerminalSessions = [session, ...previewTerminalSessions];
      previewTerminalOutputBySessionId.set(
        session.id,
        [
          `${session.program} /workspace/dispatch`,
          "$ echo \"Browser preview session\"",
          "Browser preview session",
        ].join("\n"),
      );
      return cloneTerminalSession(session) as TResult;
    }
    case "dispatch_agent": {
      const input = (args as DispatchAgentInput | undefined) ?? {
        projectId: PREVIEW_PROJECT_ID,
        profileId: "codex",
      };
      const program = input.profileId === "claude-code"
        ? "claude"
        : input.profileId === "gemini"
          ? "gemini"
          : "codex";
      const session: TerminalSessionRecord = {
        id: nextPreviewTerminalSessionId(),
        projectId: input.projectId,
        taskId: input.taskId ?? null,
        source: "dispatch",
        sessionKind: "terminal",
        status: "running",
        program,
        transport: "pty",
        cwdRelativePath: ".",
        startedAt: PREVIEW_UPDATED_AT_UNIX,
        endedAt: null,
        createdAt: PREVIEW_UPDATED_AT_UNIX,
        updatedAt: PREVIEW_UPDATED_AT_UNIX,
      };
      previewTerminalSessions = [session, ...previewTerminalSessions];
      previewTerminalOutputBySessionId.set(
        session.id,
        [
          `${session.program} /workspace/dispatch`,
          input.prompt
            ? `$ ${session.program} "${input.prompt}"`
            : `$ ${session.program}`,
          "Planning changes...",
          "Applying screenshot-driven shell refinements...",
        ].join("\n"),
      );
      return cloneTerminalSession(session) as TResult;
    }
    case "terminate_terminal_session": {
      const sessionId = String((args?.sessionId as string | undefined) ?? "");
      previewTerminalSessions = previewTerminalSessions.filter((session) => session.id !== sessionId);
      previewTerminalOutputBySessionId.delete(sessionId);
      return true as TResult;
    }
    case "dispatch_openclaw_session":
    case "spawn_openclaw_session":
    case "send_openclaw_message":
    case "kill_openclaw_session":
      browserPreviewUnsupported(command);
    case "list_agent_registry_entries":
      return previewAgentRegistryEntries.map((entry) => ({ ...entry })) as TResult;
    case "list_agent_profiles":
      return previewAgentProfiles.map((profile) => ({
        ...profile,
        args: profile.args.map((argument) => ({ ...argument })),
        env: Object.fromEntries(
          Object.entries(profile.env).map(([key, value]) => [key, { ...value }]),
        ),
        cwd: { ...profile.cwd },
      })) as TResult;
    case "get_agent_profile":
      return (
        previewAgentProfiles.find(
          (profile) => profile.id === String((args?.profileId as string | undefined) ?? ""),
        )
          ?? null
      ) as TResult;
    case "save_agent_profile":
      browserPreviewUnsupported(command);
    case "delete_agent_profile":
      return true as TResult;
    case "create_project":
    case "delete_project":
    case "set_secret":
    case "get_secret_status":
    case "clear_secret":
      browserPreviewUnsupported(command);
    default:
      browserPreviewUnsupported(command);
  }
}

async function invokeTauri<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  try {
    return await invoke<TResult>(command, args);
  } catch (error: unknown) {
    if (isBrowserPreviewMode() && isTauriRuntimeUnavailableError(error)) {
      return handlePreviewInvoke<TResult>(command, args);
    }

    throw error;
  }
}

export async function listenToTauriEvent<TPayload>(
  eventName: string,
  handler: (event: { payload: TPayload }) => void,
) {
  if (isBrowserPreviewMode()) {
    return () => {
      return;
    };
  }

  return listen<TPayload>(eventName, handler);
}

export function fetchHealth() {
  return invokeTauri<HealthResponse>("health");
}

export function createProject(input: CreateProjectInput) {
  return invokeTauri<ProjectRecord>("create_project", input);
}

export function createTask(input: CreateTaskInput) {
  return invokeTauri<TaskRecord>("create_task", { input });
}

export function showMainWindow() {
  return invokeTauri<boolean>("show_main_window");
}

export function hideMainWindow() {
  return invokeTauri<boolean>("hide_main_window");
}

export function isMainWindowVisible() {
  return invokeTauri<boolean>("is_main_window_visible");
}

export function listProjects() {
  return invokeTauri<ProjectRecord[]>("list_projects");
}

export function listTasks(input: ProjectIdInput) {
  return invokeTauri<TaskRecord[]>("list_tasks", { input });
}

export function getProject(input: ProjectIdInput) {
  return invokeTauri<ProjectRecord | null>("get_project", input);
}

export function deleteProject(input: ProjectIdInput) {
  return invokeTauri<boolean>("delete_project", input);
}

export function listProjectTree(input: ListProjectTreeInput) {
  return invokeTauri<ProjectTreeEntryRecord[]>("list_project_tree", { input });
}

export function readProjectFile(input: ReadProjectFileInput) {
  return invokeTauri<ProjectFilePreviewRecord>("read_project_file", { input });
}

export function searchProjectPaths(input: SearchProjectInput) {
  return invokeTauri<ProjectTreeEntryRecord[]>("search_project_paths", { input });
}

export function searchProjectContent(input: SearchProjectInput) {
  return invokeTauri<ProjectContentSearchHitRecord[]>("search_project_content", { input });
}

export function startProjectFileWatch(input: ProjectIdInput) {
  return invokeTauri<ProjectFileWatchRecord>("start_project_file_watch", { input });
}

export function stopProjectFileWatch() {
  return invokeTauri<boolean>("stop_project_file_watch");
}

export function listProjectSavePoints(input: ProjectIdInput) {
  return invokeTauri<SavePointRecord[]>("list_project_save_points", { input });
}

export function latestProjectSavePoint(input: ProjectIdInput) {
  return invokeTauri<SavePointRecord | null>("latest_project_save_point", { input });
}

export function createManualSavePoint(input: CreateManualSavePointInput) {
  return invokeTauri<SavePointCreateResultRecord>("create_manual_save_point", { input });
}

export function getProjectSavePointDiff(input: ProjectSavePointInput) {
  return invokeTauri<SavePointDiffResultRecord>("get_project_save_point_diff", { input });
}

export function restoreProjectSavePoint(input: ProjectSavePointInput) {
  return invokeTauri<SavePointRestoreResultRecord>("restore_project_save_point", { input });
}

export function restoreProjectSavePointFile(input: RestoreProjectSavePointFileInput) {
  return invokeTauri<SavePointRestoreResultRecord>("restore_project_save_point_file", {
    input,
  });
}

export function connectOpenClaw(input: OpenClawConnectInput = {}) {
  return invokeTauri<OpenClawConnectionStatusRecord>("connect_openclaw", { input });
}

export function disconnectOpenClaw() {
  return invokeTauri<OpenClawConnectionStatusRecord>("disconnect_openclaw");
}

export function getOpenClawStatus() {
  return invokeTauri<OpenClawConnectionStatusRecord>("get_openclaw_status");
}

export function getOpenClawSidebarSnapshot() {
  return invokeTauri<OpenClawSidebarSnapshotRecord>("get_openclaw_sidebar_snapshot");
}

export function listOpenClawSessions(input: OpenClawListSessionsInput = {}) {
  return invokeTauri<Record<string, unknown>>("list_openclaw_sessions", { input });
}

export function spawnOpenClawSession(input: OpenClawSpawnSessionInput) {
  return invokeTauri<Record<string, unknown>>("spawn_openclaw_session", { input });
}

export function dispatchOpenClawSession(input: OpenClawDispatchSessionInput) {
  return invokeTauri<OpenClawDispatchSessionResultRecord>("dispatch_openclaw_session", { input });
}

export function getOpenClawChatSnapshot(input: OpenClawChatSnapshotInput = {}) {
  return invokeTauri<OpenClawChatSnapshotRecord>("get_openclaw_chat_snapshot", { input });
}

export function sendOpenClawChatMessage(input: OpenClawSendChatMessageInput) {
  return invokeTauri<OpenClawChatSendResultRecord>("send_openclaw_chat_message", { input });
}

export function sendOpenClawMessage(input: OpenClawSendMessageInput) {
  return invokeTauri<Record<string, unknown>>("send_openclaw_message", { input });
}

export function killOpenClawSession(input: OpenClawKillSessionInput) {
  return invokeTauri<Record<string, unknown>>("kill_openclaw_session", { input });
}

export function updateTask(input: UpdateTaskInput) {
  return invokeTauri<TaskRecord>("update_task", { input });
}

export function deleteTask(input: {
  projectId: string;
  taskId: string;
}) {
  return invokeTauri<boolean>("delete_task", { input });
}

export function getSetting<TValue = unknown>(input: SettingKeyInput) {
  return invokeTauri<SettingRecord<TValue> | null>("get_setting", input);
}

export function setSetting<TValue>(input: SetSettingInput<TValue>) {
  return invokeTauri<SettingRecord<TValue>>("set_setting", input);
}

export function setSecret(input: SecretSetInput) {
  return invokeTauri<SecretStatusRecord>("set_secret", input);
}

export function getSecretStatus(input: SecretKeyInput) {
  return invokeTauri<SecretStatusRecord>("get_secret_status", input);
}

export function clearSecret(input: SecretKeyInput) {
  return invokeTauri<SecretStatusRecord>("clear_secret", input);
}

export function getTerminalWorkspace(input: TerminalWorkspaceInput) {
  return invokeTauri<TerminalWorkspaceRecord>("get_terminal_workspace", input);
}

export function createTerminalSession(input: CreateTerminalSessionInput) {
  return invokeTauri<TerminalSessionRecord>("create_terminal_session", input);
}

export function terminateTerminalSession(input: SessionIdInput) {
  return invokeTauri<boolean>("terminate_terminal_session", input);
}

export function listAgentRegistryEntries() {
  return invokeTauri<AgentRegistryEntryRecord[]>("list_agent_registry_entries");
}

export function listAgentProfiles() {
  return invokeTauri<AgentProfileRecord[]>("list_agent_profiles");
}

export function getAgentProfile(input: AgentProfileIdInput) {
  return invokeTauri<AgentProfileRecord | null>("get_agent_profile", input);
}

export function saveAgentProfile(profile: SaveAgentProfileInput) {
  return invokeTauri<AgentProfileRecord>("save_agent_profile", { profile });
}

export function deleteAgentProfile(input: AgentProfileIdInput) {
  return invokeTauri<boolean>("delete_agent_profile", input);
}

export function dispatchAgent(input: DispatchAgentInput) {
  return invokeTauri<TerminalSessionRecord>("dispatch_agent", input);
}
