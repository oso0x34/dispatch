import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  AgentRegistryEntryRecord,
  ChatMessageRecord,
  OpenClawChatSnapshotRecord,
} from "../../../shared/lib/tauri";

export type ChatLoadStatus = "idle" | "loading" | "ready" | "error";
export type ChatSendStatus = "idle" | "sending";

export type ChatModelOption = {
  value: string;
  label: string;
};

export type ChatSlice = {
  snapshotStatus: ChatLoadStatus;
  modelStatus: ChatLoadStatus;
  sendStatus: ChatSendStatus;
  connectionState: string;
  streamState: string;
  conversationId: string;
  sessionKey: string;
  messages: ChatMessageRecord[];
  draft: string;
  selectedModelId: string;
  modelOptions: ChatModelOption[];
  error: string | null;
  modelError: string | null;
  setDraft: (value: string) => void;
  setSelectedModelId: (value: string) => void;
  setSnapshotStatus: (value: ChatLoadStatus) => void;
  setModelStatus: (value: ChatLoadStatus) => void;
  setSendStatus: (value: ChatSendStatus) => void;
  setError: (value: string | null) => void;
  setModelError: (value: string | null) => void;
  setModelOptions: (entries: AgentRegistryEntryRecord[]) => void;
  applySnapshot: (snapshot: OpenClawChatSnapshotRecord) => void;
  appendMessage: (message: ChatMessageRecord) => void;
  resetDraft: () => void;
};

function sortMessages(messages: ChatMessageRecord[]) {
  return [...messages].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }

    return left.id.localeCompare(right.id);
  });
}

function upsertMessage(messages: ChatMessageRecord[], message: ChatMessageRecord) {
  return sortMessages([
    message,
    ...messages.filter((candidate) => candidate.id !== message.id),
  ]);
}

export function buildChatModelOptions(entries: AgentRegistryEntryRecord[]) {
  const options: ChatModelOption[] = [
    { value: "auto", label: "Auto" },
  ];

  for (const entry of entries) {
    if (entry.selectionMode === "auto") {
      continue;
    }

    if (options.some((option) => option.value === entry.id)) {
      continue;
    }

    options.push({
      value: entry.id,
      label: entry.name,
    });
  }

  return options;
}

export function createChatStore(): StoreApi<ChatSlice> {
  return createStore<ChatSlice>()((set) => ({
    snapshotStatus: "idle",
    modelStatus: "idle",
    sendStatus: "idle",
    connectionState: "disconnected",
    streamState: "cache_only",
    conversationId: "main",
    sessionKey: "agent:main:global",
    messages: [],
    draft: "",
    selectedModelId: "auto",
    modelOptions: [{ value: "auto", label: "Auto" }],
    error: null,
    modelError: null,
    setDraft: (value) => {
      set({ draft: value });
    },
    setSelectedModelId: (value) => {
      set({ selectedModelId: value });
    },
    setSnapshotStatus: (value) => {
      set({ snapshotStatus: value });
    },
    setModelStatus: (value) => {
      set({ modelStatus: value });
    },
    setSendStatus: (value) => {
      set({ sendStatus: value });
    },
    setError: (value) => {
      set({ error: value });
    },
    setModelError: (value) => {
      set({ modelError: value });
    },
    setModelOptions: (entries) => {
      set({
        modelOptions: buildChatModelOptions(entries),
      });
    },
    applySnapshot: (snapshot) => {
      set((state) => ({
        snapshotStatus: "ready",
        connectionState: snapshot.status.state,
        streamState: snapshot.streamState,
        conversationId: snapshot.conversationId,
        sessionKey: snapshot.sessionKey,
        messages: sortMessages([
          ...snapshot.messages,
          ...state.messages.filter(
            (candidate) => !snapshot.messages.some((message) => message.id === candidate.id),
          ),
        ]),
        error: null,
      }));
    },
    appendMessage: (message) => {
      set((state) => ({
        messages: upsertMessage(state.messages, message),
      }));
    },
    resetDraft: () => {
      set({
        draft: "",
      });
    },
  }));
}
