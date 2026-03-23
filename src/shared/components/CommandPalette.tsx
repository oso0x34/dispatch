import {
  Command,
  History,
  LoaderCircle,
  Rocket,
  Search,
  Settings2,
  Terminal,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { useDispatchStore } from "../../app/providers";
import { appHotkeys } from "../hooks/useAppHotkeys";
import {
  createManualSavePoint,
  type TaskRecord,
} from "../lib/tauri";

type CommandDefinition = {
  id: string;
  group: string;
  title: string;
  description: string;
  keywords: string[];
  disabled?: boolean;
  disabledReason?: string;
  run: () => Promise<void>;
  icon: ComponentType<{ size?: number; className?: string }>;
};

type CommandStatusTone = "idle" | "error";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

function resolveDispatchProfileId(task: TaskRecord | null) {
  const assignedAgentMode = task?.assignedAgentMode?.trim() ?? "";

  if (assignedAgentMode === "auto") {
    return "auto";
  }

  if (assignedAgentMode.startsWith("profile:")) {
    const profileId = assignedAgentMode.slice("profile:".length).trim();
    return profileId || "auto";
  }

  return "auto";
}

function filterCommands(commands: CommandDefinition[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return commands;
  }

  const matches = commands.filter((command) => {
    const searchableText = [
      command.title,
      command.description,
      ...command.keywords,
    ].join(" ").toLowerCase();

    return searchableText.includes(normalizedQuery);
  });

  return matches.length > 0 ? matches : commands;
}

export function CommandPalette() {
  const projects = useDispatchStore((state) => state.projects);
  const activeProjectId = useDispatchStore((state) => state.activeProjectId);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const commandPaletteOpen = useDispatchStore((state) => state.commandPaletteOpen);
  const closeCommandPalette = useDispatchStore((state) => state.closeCommandPalette);
  const createTask = useDispatchStore((state) => state.createTask);
  const openTasksOverlay = useDispatchStore((state) => state.openTasksOverlay);
  const openOverlay = useDispatchStore((state) => state.openOverlay);
  const setActiveTab = useDispatchStore((state) => state.setActiveTab);
  const initializeTerminalWorkspace = useDispatchStore((state) => state.initializeTerminalWorkspace);
  const createTerminalSession = useDispatchStore((state) => state.createTerminalSession);
  const dispatchAgent = useDispatchStore((state) => state.dispatchAgent);
  const tasks = useDispatchStore((state) => state.tasks);
  const selectedTaskId = useDispatchStore((state) => state.selectedTaskId);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusTone, setStatusTone] = useState<CommandStatusTone>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const commandDefinitions = useMemo<CommandDefinition[]>(() => {
    const trimmedQuery = query.trim();
    const taskTitle = trimmedQuery || "New task";
    const savePointLabel = trimmedQuery || null;
    const dispatchPrompt = trimmedQuery || null;

    return [
      {
        id: "create-task",
        group: "Workspace",
        title: "Create task",
        description: trimmedQuery
          ? `Creates a new task titled "${taskTitle}".`
          : "Creates a new task and opens the Tasks overlay.",
        keywords: ["task", "todo", "backlog", "create"],
        disabled: !activeProjectId,
        disabledReason: "Select a project before creating tasks.",
        run: async () => {
          if (!activeProjectId) {
            throw new Error("Select a project before creating tasks.");
          }

          const task = await createTask({ title: taskTitle });
          openTasksOverlay(task.id);
        },
        icon: Command,
      },
      {
        id: "new-terminal",
        group: "Workspace",
        title: "New terminal",
        description: "Creates a fresh terminal session in the active project workspace.",
        keywords: ["terminal", "shell", "session", "agent"],
        disabled: !activeProjectId,
        disabledReason: "Select a project before creating a terminal session.",
        run: async () => {
          if (!activeProjectId) {
            throw new Error("Select a project before creating a terminal session.");
          }

          await initializeTerminalWorkspace(activeProjectId);
          setActiveTab("agents");
          await createTerminalSession();
        },
        icon: Terminal,
      },
      {
        id: "dispatch-selected-task",
        group: "Agents",
        title: "Dispatch selected task",
        description: selectedTask
          ? `Dispatches "${selectedTask.title}"${dispatchPrompt ? ` with "${dispatchPrompt}".` : "."}`
          : "Dispatches the currently selected task.",
        keywords: ["dispatch", "agent", "run", "task", "selected"],
        disabled: !activeProjectId || !selectedTask,
        disabledReason: !activeProjectId
          ? "Select a project before dispatching tasks."
          : "Select a task before dispatching it.",
        run: async () => {
          if (!activeProjectId) {
            throw new Error("Select a project before dispatching tasks.");
          }

          if (!selectedTask) {
            throw new Error("Select a task before dispatching it.");
          }

          await initializeTerminalWorkspace(activeProjectId);
          setActiveTab("agents");
          await dispatchAgent({
            profileId: resolveDispatchProfileId(selectedTask),
            taskId: selectedTask.id,
            prompt: dispatchPrompt,
          });
        },
        icon: Rocket,
      },
      {
        id: "create-manual-save-point",
        group: "Recovery",
        title: "Create manual save point",
        description: trimmedQuery
          ? `Creates a save point labeled "${trimmedQuery}" and opens History.`
          : "Creates a manual save point and opens History.",
        keywords: ["history", "save", "checkpoint", "snapshot", "git"],
        disabled: !activeProjectId,
        disabledReason: "Select a project before creating a save point.",
        run: async () => {
          if (!activeProjectId) {
            throw new Error("Select a project before creating a save point.");
          }

          const result = await createManualSavePoint({
            projectId: activeProjectId,
            label: savePointLabel,
          });

          if (result.status === "unsupported" || !result.savePoint) {
            throw new Error("History is unavailable until this project lives in an existing git repository.");
          }

          setActiveTab("history");
        },
        icon: History,
      },
      {
        id: "open-settings",
        group: "System",
        title: "Open settings",
        description: "Opens the settings overlay.",
        keywords: ["settings", "preferences", "config"],
        run: async () => {
          openOverlay("settings");
        },
        icon: Settings2,
      },
    ];
  }, [
    activeProjectId,
    createTask,
    createTerminalSession,
    dispatchAgent,
    initializeTerminalWorkspace,
    openOverlay,
    openTasksOverlay,
    query,
    selectedTask,
    setActiveTab,
  ]);

  const filteredCommands = useMemo(
    () => filterCommands(commandDefinitions, query),
    [commandDefinitions, query],
  );
  const groupedCommands = useMemo(() => {
    const groupOrder = ["Workspace", "Agents", "Recovery", "System"] as const;
    const commandsWithIndex = filteredCommands.map((command, index) => ({
      command,
      index,
    }));

    return groupOrder
      .map((group) => ({
        group,
        commands: commandsWithIndex.filter((entry) => entry.command.group === group),
      }))
      .filter((entry) => entry.commands.length > 0);
  }, [filteredCommands]);

  useEffect(() => {
    setSelectedIndex((currentIndex) => {
      if (filteredCommands.length === 0) {
        return 0;
      }

      return Math.min(currentIndex, filteredCommands.length - 1);
    });
  }, [filteredCommands]);

  useEffect(() => {
    if (!commandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      setStatusTone("idle");
      setStatusMessage(null);
      setIsRunning(false);

      if (wasOpenRef.current) {
        openerRef.current?.focus();
        openerRef.current = null;
        wasOpenRef.current = false;
      }

      return;
    }

    if (!wasOpenRef.current) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      wasOpenRef.current = true;
    }

    const dialog = dialogRef.current;
    const focusTarget = inputRef.current ?? closeButtonRef.current ?? dialog;
    focusTarget?.focus();

    const getFocusableElements = () => {
      if (!dialog) {
        return [];
      }

      return Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.closest('[aria-hidden="true"]'));
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCommandPalette();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements();

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const isFocusInsideDialog = activeElement ? dialog?.contains(activeElement) : false;

      if (event.shiftKey) {
        if (!isFocusInsideDialog || activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }

        return;
      }

      if (!isFocusInsideDialog || activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeCommandPalette, commandPaletteOpen]);

  if (!commandPaletteOpen) {
    return null;
  }

  const activeCommand = filteredCommands[selectedIndex] ?? null;

  const handleRunCommand = async (command: CommandDefinition | null) => {
    if (!command || command.disabled || isRunning) {
      return;
    }

    setIsRunning(true);
    setStatusTone("idle");
    setStatusMessage(null);

    try {
      await command.run();
      openerRef.current = null;
      closeCommandPalette();
    } catch (error: unknown) {
      setStatusTone("error");
      setStatusMessage(getErrorMessage(error, "Command failed."));
    } finally {
      setIsRunning(false);
    }
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();

      if (filteredCommands.length > 0) {
        setSelectedIndex((currentIndex) => (
          currentIndex >= filteredCommands.length - 1 ? 0 : currentIndex + 1
        ));
      }

      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();

      if (filteredCommands.length > 0) {
        setSelectedIndex((currentIndex) => (
          currentIndex <= 0 ? filteredCommands.length - 1 : currentIndex - 1
        ));
      }

      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void handleRunCommand(activeCommand);
    }
  };

  return (
    <div
      className="dispatch-overlay-backdrop fixed inset-0 z-[60] px-3 py-3 backdrop-blur-sm"
      onClick={closeCommandPalette}
    >
      <div className="mx-auto flex h-full w-full max-w-[1600px] items-start justify-center pt-8 sm:pt-12">
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          tabIndex={-1}
          className="dispatch-panel dispatch-palette-panel flex w-full max-w-[560px] flex-col overflow-hidden rounded-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="dispatch-divider border-b px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="dispatch-text-subtle text-[0.56rem] font-semibold uppercase tracking-[0.28em]">
                  Command palette
                </p>
                <p className="dispatch-text-secondary mt-1 text-[0.72rem] leading-5">
                  Search and run workspace actions.
                </p>
              </div>

              <div className="dispatch-palette-hints flex shrink-0 items-center gap-1.5">
                <span className="dispatch-palette-shortcut">↑↓</span>
                <span className="dispatch-palette-shortcut">Enter</span>
                <span className="dispatch-palette-shortcut">Esc</span>
              </div>
            </div>

            <label className="dispatch-palette-search mt-3 flex items-center gap-2 rounded-xl px-2.5 py-2">
              <Search size={14} className="dispatch-text-muted shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                className="dispatch-text-primary min-w-0 flex-1 bg-transparent text-[0.82rem] outline-none"
                placeholder={activeProject ? `Search commands in ${activeProject.name}...` : "Search commands..."}
                aria-label="Search commands"
              />
              <button
                ref={closeButtonRef}
                type="button"
                className="dispatch-text-muted flex h-5 shrink-0 items-center rounded-md border border-[var(--surface-border)] bg-[var(--surface-control)] px-1.5 text-[0.6rem] leading-none"
                aria-label="Close command palette"
                onClick={closeCommandPalette}
              >
                esc
              </button>
            </label>

            {statusMessage ? (
              <p
                className={`mt-2 px-1 text-[0.72rem] leading-5 ${statusTone === "error" ? "text-accent-error" : "dispatch-text-secondary"}`}
              >
                {statusMessage}
              </p>
            ) : null}
          </div>

          <div className="max-h-[min(420px,60vh)] overflow-auto px-2 py-2">
            <div className="space-y-3">
              {groupedCommands.map((group) => (
                <section key={group.group}>
                  <div className="flex items-center justify-between px-2 pb-1.5">
                    <span className="dispatch-text-subtle text-[0.56rem] font-semibold uppercase tracking-[0.24em]">
                      {group.group}
                    </span>
                    <span className="dispatch-text-muted text-[0.56rem]">
                      {group.commands.length}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {group.commands.map(({ command, index }) => {
                      const Icon = command.icon;
                      const isActive = selectedIndex === index;
                      const supportingText = command.disabled && command.disabledReason
                        ? command.disabledReason
                        : command.description;

                      return (
                        <button
                          key={command.id}
                          ref={(el) => {
                            if (isActive && el && typeof el.scrollIntoView === "function") {
                              el.scrollIntoView({ block: "nearest" });
                            }
                          }}
                          type="button"
                          className="dispatch-chip flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left"
                          data-active={isActive}
                          disabled={command.disabled || isRunning}
                          aria-current={isActive ? "true" : undefined}
                          onMouseEnter={() => setSelectedIndex(index)}
                          onClick={() => {
                            void handleRunCommand(command);
                          }}
                        >
                          <span className="dispatch-palette-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                            <Icon size={14} className="shrink-0" />
                          </span>

                          <div className="min-w-0 flex-1">
                            <span className="block text-[0.76rem] font-medium leading-5">
                              {command.title}
                            </span>
                            <span className="mt-0.5 block truncate text-[0.66rem] leading-4 dispatch-text-subtle">
                              {supportingText}
                            </span>
                          </div>

                          <span className="dispatch-palette-shortcut mt-0.5 shrink-0">
                            {isRunning && isActive ? (
                              <LoaderCircle size={11} className="animate-spin" />
                            ) : command.disabled ? (
                              "Locked"
                            ) : (
                              "Enter"
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            {activeCommand && !activeCommand.disabled ? (
              <div className="dispatch-palette-summary mt-3 rounded-xl px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="dispatch-text-secondary text-[0.62rem] font-semibold uppercase tracking-[0.22em]">
                    Selected action
                  </span>
                  <span className="dispatch-palette-shortcut">Enter</span>
                </div>
                <p className="dispatch-text-secondary mt-1.5 text-[0.72rem] leading-5">
                  {activeCommand.description}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
