import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "zustand";
import {
  AlertTriangle,
  Sparkles,
  X,
} from "lucide-react";

import { useDispatchStore } from "../../app/providers";
import {
  connectOpenClaw,
  disconnectOpenClaw,
  getOpenClawChatSnapshot,
  getOpenClawStatus,
  listAgentRegistryEntries,
  sendOpenClawChatMessage,
  type AgentRegistryEntryRecord,
} from "../../shared/lib/tauri";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import {
  createChatStore,
  type ChatSlice,
} from "./store/chatSlice";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

type ChatTabProps = {
  active?: boolean;
};

export function ChatTab({ active = true }: ChatTabProps) {
  const projects = useDispatchStore((state) => state.projects);
  const activeProjectId = useDispatchStore((state) => state.activeProjectId);
  const openTasksOverlay = useDispatchStore((state) => state.openTasksOverlay);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const projectLabel = activeProject?.name ?? "No project selected";
  const chatStoreRef = useRef<ReturnType<typeof createChatStore> | null>(null);

  if (!chatStoreRef.current) {
    chatStoreRef.current = createChatStore();
  }

  const chatStore = chatStoreRef.current;

  const snapshotStatus = useStore(chatStore, (state: ChatSlice) => state.snapshotStatus);
  const modelStatus = useStore(chatStore, (state: ChatSlice) => state.modelStatus);
  const sendStatus = useStore(chatStore, (state: ChatSlice) => state.sendStatus);
  const connectionState = useStore(chatStore, (state: ChatSlice) => state.connectionState);
  const streamState = useStore(chatStore, (state: ChatSlice) => state.streamState);
  const messages = useStore(chatStore, (state: ChatSlice) => state.messages);
  const draft = useStore(chatStore, (state: ChatSlice) => state.draft);
  const selectedModelId = useStore(chatStore, (state: ChatSlice) => state.selectedModelId);
  const modelOptions = useStore(chatStore, (state: ChatSlice) => state.modelOptions);
  const error = useStore(chatStore, (state: ChatSlice) => state.error);
  const modelError = useStore(chatStore, (state: ChatSlice) => state.modelError);
  const conversationId = useStore(chatStore, (state: ChatSlice) => state.conversationId);
  const sessionKey = useStore(chatStore, (state: ChatSlice) => state.sessionKey);
  const setDraft = useStore(chatStore, (state: ChatSlice) => state.setDraft);
  const setSelectedModelId = useStore(chatStore, (state: ChatSlice) => state.setSelectedModelId);
  const setModelOptions = useStore(chatStore, (state: ChatSlice) => state.setModelOptions);
  const setModelStatus = useStore(chatStore, (state: ChatSlice) => state.setModelStatus);
  const setSnapshotStatus = useStore(chatStore, (state: ChatSlice) => state.setSnapshotStatus);
  const setSendStatus = useStore(chatStore, (state: ChatSlice) => state.setSendStatus);
  const setError = useStore(chatStore, (state: ChatSlice) => state.setError);
  const setModelError = useStore(chatStore, (state: ChatSlice) => state.setModelError);
  const applySnapshot = useStore(chatStore, (state: ChatSlice) => state.applySnapshot);
  const appendMessage = useStore(chatStore, (state: ChatSlice) => state.appendMessage);
  const resetDraft = useStore(chatStore, (state: ChatSlice) => state.resetDraft);

  const refreshSnapshotRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let mounted = true;

    setModelStatus("loading");
    setModelError(null);

    void listAgentRegistryEntries()
      .then((entries) => {
        if (!mounted) {
          return;
        }

        setModelOptions(entries);
        setModelStatus("ready");
      })
      .catch((error: unknown) => {
        if (!mounted) {
          return;
        }

        setModelOptions([
          { id: "auto", name: "Auto", selectionMode: "auto" } as AgentRegistryEntryRecord,
        ]);
        setModelStatus("error");
        setModelError(getErrorMessage(error, "Model options failed to load."));
      });

    return () => {
      mounted = false;
    };
  }, [setModelError, setModelOptions, setModelStatus]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let mounted = true;
    let inFlight = false;

    const refreshSnapshot = async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;
      if (chatStore.getState().messages.length === 0) {
        setSnapshotStatus("loading");
      }

      try {
        const snapshot = await getOpenClawChatSnapshot({
          conversationId,
          sessionKey,
          limit: 200,
        });

        if (!mounted) {
          return;
        }

        applySnapshot(snapshot);
        setError(null);
      } catch (error: unknown) {
        if (!mounted) {
          return;
        }

        setSnapshotStatus("error");
        setError(getErrorMessage(error, "Chat history failed to load."));
      } finally {
        inFlight = false;
      }
    };

    refreshSnapshotRef.current = refreshSnapshot;

    void refreshSnapshot();

    const intervalId = window.setInterval(() => {
      void refreshSnapshot();
    }, 1_000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [
    active,
    applySnapshot,
    chatStore,
    conversationId,
    setError,
    setSnapshotStatus,
    sessionKey,
  ]);

  const handleSendMessage = async () => {
    const currentState = chatStore.getState();
    const nextDraft = currentState.draft.trim();

    if (!nextDraft || currentState.sendStatus === "sending") {
      return;
    }

    setSendStatus("sending");
    setError(null);

    try {
      const result = await sendOpenClawChatMessage({
        bodyMarkdown: nextDraft,
        projectId: activeProjectId,
        conversationId: currentState.conversationId,
        sessionKey: currentState.sessionKey,
        modelId: currentState.selectedModelId === "auto"
          ? null
          : currentState.selectedModelId,
      } as never);

      appendMessage(result.message);
      resetDraft();
      await refreshSnapshotRef.current?.();
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Chat send failed."));
    } finally {
      setSendStatus("idle");
    }
  };

  const handleCreateTask = () => {
    openTasksOverlay(null);
  };

  const [openClawConnected, setOpenClawConnected] = useState(false);
  const [isTogglingConnection, setIsTogglingConnection] = useState(false);

  useEffect(() => {
    if (!active) return;

    let mounted = true;

    const checkStatus = () => {
      void getOpenClawStatus()
        .then((status) => {
          if (mounted) {
            setOpenClawConnected(status.state === "connected");
          }
        })
        .catch(() => {
          if (mounted) {
            setOpenClawConnected(false);
          }
        });
    };

    checkStatus();
    const intervalId = window.setInterval(checkStatus, 3_000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [active]);

  const handleToggleOpenClaw = async () => {
    setIsTogglingConnection(true);
    try {
      if (openClawConnected) {
        await disconnectOpenClaw();
        setOpenClawConnected(false);
      } else {
        const result = await connectOpenClaw();
        setOpenClawConnected(result.state === "connected");
      }
    } catch {
      // Status will be refreshed by the polling interval
    } finally {
      setIsTogglingConnection(false);
    }
  };

  const displayError = error ?? modelError;
  const headerStats = useMemo(() => [
    {
      label: "Conversation",
      value: snapshotStatus === "ready" ? "Synced" : snapshotStatus === "loading" ? "Loading" : snapshotStatus === "error" ? "Needs attention" : "Idle",
      tone: snapshotStatus === "error" ? "error" : snapshotStatus === "loading" ? "loading" : "ready",
    },
    {
      label: "Connection",
      value: connectionState === "connected" ? "Live" : connectionState === "connecting" ? "Connecting" : connectionState === "reconnecting" ? "Reconnecting" : "Offline",
      tone: connectionState === "connected" ? "ready" : "loading",
    },
    {
      label: "Stream",
      value: streamState === "live" ? "Live transcript" : streamState === "degraded" ? "Cached" : "Cache only",
      tone: streamState === "live" ? "ready" : "loading",
    },
    {
      label: "Messages",
      value: String(messages.length).padStart(2, "0"),
      tone: "ready",
    },
  ], [connectionState, messages.length, snapshotStatus, streamState]);

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(255,255,255,0.04),transparent_24%),linear-gradient(180deg,rgba(7,9,14,0.78),rgba(9,11,16,0.96))]">
      {/* Compact inline error banner */}
      {displayError ? (
        <div className="flex items-center gap-2 border-b border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-1.5">
          <AlertTriangle size={12} style={{ color: "var(--danger-text)", flexShrink: 0 }} />
          <span className="min-w-0 flex-1 truncate text-[0.72rem]" style={{ color: "var(--danger-text)" }}>
            {displayError}
          </span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setModelError(null);
            }}
            className="flex-shrink-0 rounded p-0.5 transition-colors hover:bg-[var(--danger-surface-hover)]"
            style={{ color: "var(--danger-text)" }}
            aria-label="Dismiss error"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 pt-3">
        <section className="flex items-start justify-between gap-4 rounded-[1.35rem] border border-[var(--surface-border-soft)] bg-[rgba(9,11,17,0.84)] px-4 py-3 shadow-[0_22px_55px_rgba(0,0,0,0.28)] backdrop-blur-sm">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-[var(--text-subtle)]">
              <Sparkles size={11} className="text-accent-blue" />
              <span>Orchestrate</span>
            </div>
            <h1 className="truncate text-[1.05rem] font-semibold tracking-tight text-[var(--text-primary)]">
              {projectLabel}
            </h1>
            <p className="mt-1 max-w-2xl text-[0.78rem] leading-5 text-[var(--text-muted)]">
              A live command surface for OpenClaw chat, task handoff, and direct prompts. Keep the thread in view, then send from the dock below.
            </p>
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
            {headerStats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-[1rem] border border-[var(--surface-border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-2"
              >
                <p className="text-[0.58rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-subtle)]">
                  {stat.label}
                </p>
                <p
                  className={`mt-1 text-[0.74rem] font-medium ${
                    stat.tone === "error"
                      ? "text-accent-error"
                      : stat.tone === "loading"
                        ? "text-[var(--text-secondary)]"
                        : "text-[var(--text-primary)]"
                  }`}
                >
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
        </section>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.4rem] border border-[var(--surface-border-soft)] bg-[rgba(7,9,14,0.7)] shadow-[0_24px_70px_rgba(0,0,0,0.33)]">
          <div className="min-h-0 flex-1 overflow-hidden">
            <MessageList
              messages={messages}
              streamState={streamState}
              connectionState={connectionState}
              projectLabel={projectLabel}
            />
          </div>

          <ChatInput
            draft={draft}
            selectedModelId={selectedModelId}
            modelOptions={modelOptions}
            projectLabel={projectLabel}
            modelStatus={modelStatus}
            isSending={sendStatus === "sending"}
            openClawConnected={openClawConnected}
            isTogglingConnection={isTogglingConnection}
            onDraftChange={setDraft}
            onModelChange={setSelectedModelId}
            onSubmit={() => {
              void handleSendMessage();
            }}
            onCreateTask={handleCreateTask}
            onToggleOpenClaw={() => {
              void handleToggleOpenClaw();
            }}
          />
        </div>
      </div>
    </div>
  );
}
