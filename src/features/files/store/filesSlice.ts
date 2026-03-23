import type { StateCreator } from "zustand";

import {
  isBrowserPreviewMode,
  listProjectTree as listProjectTreeCommand,
  readProjectFile as readProjectFileCommand,
  searchProjectContent as searchProjectContentCommand,
  searchProjectPaths as searchProjectPathsCommand,
  type ProjectContentSearchHitRecord,
  type ProjectFilePreviewRecord,
  type ProjectTreeEntryRecord,
} from "../../../shared/lib/tauri";
import type { DispatchStore } from "../../../store";

export type FilesStatus = "idle" | "loading" | "ready" | "error";
export type FilePreviewStatus = "idle" | "loading" | "ready" | "error";
export type FileSearchStatus = "idle" | "loading" | "ready" | "error";
export type FileSearchMode = "path" | "content";

type FilesLoadOptions = {
  force?: boolean;
};

type FilesSearchOptions = {
  query?: string;
  mode?: FileSearchMode;
};

export type FilesSlice = {
  filesProjectId: string | null;
  filesStatus: FilesStatus;
  filesError: string | null;
  currentDirectoryPath: string;
  treeEntries: ProjectTreeEntryRecord[];
  selectedPath: string | null;
  previewStatus: FilePreviewStatus;
  previewError: string | null;
  filePreview: ProjectFilePreviewRecord | null;
  fileSearchQuery: string;
  fileSearchMode: FileSearchMode;
  fileSearchStatus: FileSearchStatus;
  fileSearchError: string | null;
  pathSearchResults: ProjectTreeEntryRecord[];
  contentSearchResults: ProjectContentSearchHitRecord[];
  initializeFiles: (options?: FilesLoadOptions) => Promise<void>;
  refreshFiles: () => Promise<void>;
  openDirectory: (path?: string | null) => Promise<void>;
  previewFile: (path: string) => Promise<void>;
  setFileSearchQuery: (query: string) => void;
  setFileSearchMode: (mode: FileSearchMode) => void;
  runFileSearch: (options?: FilesSearchOptions) => Promise<void>;
  clearFileSearch: () => void;
  clearFilesError: () => void;
};

type DispatchState = DispatchStore & FilesSlice;

const ROOT_DIRECTORY_PATH = ".";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

function normalizeDirectoryPath(path?: string | null) {
  if (!path || path.trim().length === 0) {
    return ROOT_DIRECTORY_PATH;
  }

  return path;
}

function sortTreeEntries(entries: ProjectTreeEntryRecord[]) {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.path.localeCompare(right.path);
  });
}

function resolvePreviewPath(
  treeEntries: ProjectTreeEntryRecord[],
  currentPreviewPath: string | null,
) {
  if (currentPreviewPath) {
    return currentPreviewPath;
  }

  if (!isBrowserPreviewMode()) {
    return null;
  }

  const previewCandidate = treeEntries.find((entry) => entry.kind === "file" && entry.name === "README.md")
    ?? treeEntries.find((entry) => entry.kind === "file")
    ?? null;

  return previewCandidate?.path ?? null;
}

function resetFilesState() {
  return {
    filesProjectId: null,
    filesStatus: "idle" as const,
    filesError: null,
    currentDirectoryPath: ROOT_DIRECTORY_PATH,
    treeEntries: [],
    selectedPath: null,
    previewStatus: "idle" as const,
    previewError: null,
    filePreview: null,
    fileSearchQuery: "",
    fileSearchMode: "path" as const,
    fileSearchStatus: "idle" as const,
    fileSearchError: null,
    pathSearchResults: [],
    contentSearchResults: [],
  };
}

export const createFilesSlice: StateCreator<
  DispatchState,
  [],
  [],
  FilesSlice
> = (set, get) => ({
  ...resetFilesState(),
  initializeFiles: async (options) => {
    const projectId = get().activeProjectId;

    if (!projectId) {
      set(resetFilesState());
      return;
    }

    const currentProjectId = get().filesProjectId;
    const currentStatus = get().filesStatus;

    if (currentProjectId === projectId && currentStatus === "ready" && !options?.force) {
      return;
    }

    const currentDirectoryPath = currentProjectId === projectId
      ? get().currentDirectoryPath
      : ROOT_DIRECTORY_PATH;
    const currentPreviewPath = currentProjectId === projectId
      ? get().filePreview?.path ?? null
      : null;
    const currentSearchQuery = currentProjectId === projectId
      ? get().fileSearchQuery
      : "";
    const currentSearchMode = currentProjectId === projectId
      ? get().fileSearchMode
      : "path";

    set({
      filesProjectId: projectId,
      filesStatus: "loading",
      filesError: null,
    });

    try {
      const treeEntries = sortTreeEntries(await listProjectTreeCommand({
        projectId,
        rootRelativePath: currentDirectoryPath === ROOT_DIRECTORY_PATH
          ? null
          : currentDirectoryPath,
      }));

      if (get().activeProjectId !== projectId) {
        return;
      }

      const previewPath = resolvePreviewPath(treeEntries, currentPreviewPath);

      set({
        filesProjectId: projectId,
        filesStatus: "ready",
        filesError: null,
        currentDirectoryPath,
        treeEntries,
        selectedPath: previewPath,
      });

      if (previewPath) {
        try {
          const preview = await readProjectFileCommand({
            projectId,
            relativePath: previewPath,
          });

          if (get().activeProjectId !== projectId) {
            return;
          }

          set({
            previewStatus: "ready",
            previewError: null,
            filePreview: preview,
            selectedPath: preview.path,
          });
        } catch (error: unknown) {
          if (get().activeProjectId !== projectId) {
            return;
          }

          set({
            previewStatus: "error",
            previewError: getErrorMessage(error, "File preview failed to load."),
            filePreview: null,
            selectedPath: null,
          });
        }
      } else {
        set({
          previewStatus: "idle",
          previewError: null,
          filePreview: null,
          selectedPath: null,
        });
      }

      if (currentSearchQuery.trim().length > 0) {
        await get().runFileSearch({
          query: currentSearchQuery,
          mode: currentSearchMode,
        });
      } else {
        set({
          fileSearchStatus: "idle",
          fileSearchError: null,
          pathSearchResults: [],
          contentSearchResults: [],
        });
      }
    } catch (error: unknown) {
      if (get().activeProjectId !== projectId) {
        return;
      }

      set({
        filesProjectId: projectId,
        filesStatus: "error",
        filesError: getErrorMessage(error, "Project files failed to load."),
        treeEntries: [],
      });
    }
  },
  refreshFiles: async () => {
    await get().initializeFiles({ force: true });
  },
  openDirectory: async (path) => {
    const projectId = get().activeProjectId;

    if (!projectId) {
      const message = "Select a project before browsing files.";
      set({
        filesError: message,
      });
      throw new Error(message);
    }

    const directoryPath = normalizeDirectoryPath(path);

    set({
      filesProjectId: projectId,
      filesStatus: "loading",
      filesError: null,
      currentDirectoryPath: directoryPath,
      selectedPath: directoryPath === ROOT_DIRECTORY_PATH ? null : directoryPath,
    });

    try {
      const treeEntries = sortTreeEntries(await listProjectTreeCommand({
        projectId,
        rootRelativePath: directoryPath === ROOT_DIRECTORY_PATH ? null : directoryPath,
      }));

      if (get().activeProjectId !== projectId) {
        return;
      }

      set({
        filesProjectId: projectId,
        filesStatus: "ready",
        filesError: null,
        currentDirectoryPath: directoryPath,
        treeEntries,
        selectedPath: directoryPath === ROOT_DIRECTORY_PATH ? get().selectedPath : directoryPath,
      });
    } catch (error: unknown) {
      if (get().activeProjectId !== projectId) {
        return;
      }

      set({
        filesStatus: "error",
        filesError: getErrorMessage(error, "Project files failed to load."),
      });

      throw error;
    }
  },
  previewFile: async (path) => {
    const projectId = get().activeProjectId;

    if (!projectId) {
      const message = "Select a project before previewing files.";
      set({
        previewError: message,
      });
      throw new Error(message);
    }

    set({
      previewStatus: "loading",
      previewError: null,
      selectedPath: path,
    });

    try {
      const preview = await readProjectFileCommand({
        projectId,
        relativePath: path,
      });

      if (get().activeProjectId !== projectId) {
        return;
      }

      set({
        previewStatus: "ready",
        previewError: null,
        filePreview: preview,
        selectedPath: preview.path,
      });
    } catch (error: unknown) {
      if (get().activeProjectId !== projectId) {
        return;
      }

      const message = getErrorMessage(error, "File preview failed to load.");
      set({
        previewStatus: "error",
        previewError: message,
        filePreview: null,
      });

      throw new Error(message);
    }
  },
  setFileSearchQuery: (query) => {
    set({
      fileSearchQuery: query,
      fileSearchError: null,
    });
  },
  setFileSearchMode: (mode) => {
    set({
      fileSearchMode: mode,
      fileSearchError: null,
    });
  },
  runFileSearch: async (options) => {
    const projectId = get().activeProjectId;

    if (!projectId) {
      const message = "Select a project before searching files.";
      set({
        fileSearchError: message,
      });
      throw new Error(message);
    }

    const query = options?.query ?? get().fileSearchQuery;
    const mode = options?.mode ?? get().fileSearchMode;

    set({
      fileSearchQuery: query,
      fileSearchMode: mode,
      fileSearchStatus: "loading",
      fileSearchError: null,
    });

    if (query.trim().length === 0) {
      set({
        fileSearchStatus: "idle",
        fileSearchError: null,
        pathSearchResults: [],
        contentSearchResults: [],
      });
      return;
    }

    try {
      if (mode === "content") {
        const results = await searchProjectContentCommand({
          projectId,
          query,
        });

        if (get().activeProjectId !== projectId) {
          return;
        }

        set({
          fileSearchStatus: "ready",
          fileSearchError: null,
          pathSearchResults: [],
          contentSearchResults: results,
        });
        return;
      }

      const results = sortTreeEntries(await searchProjectPathsCommand({
        projectId,
        query,
      }));

      if (get().activeProjectId !== projectId) {
        return;
      }

      set({
        fileSearchStatus: "ready",
        fileSearchError: null,
        pathSearchResults: results,
        contentSearchResults: [],
      });
    } catch (error: unknown) {
      if (get().activeProjectId !== projectId) {
        return;
      }

      const message = getErrorMessage(error, "Project search failed.");
      set({
        fileSearchStatus: "error",
        fileSearchError: message,
        pathSearchResults: [],
        contentSearchResults: [],
      });

      throw new Error(message);
    }
  },
  clearFileSearch: () => {
    set({
      fileSearchQuery: "",
      fileSearchStatus: "idle",
      fileSearchError: null,
      pathSearchResults: [],
      contentSearchResults: [],
    });
  },
  clearFilesError: () => {
    set({
      filesError: null,
      previewError: null,
      fileSearchError: null,
    });
  },
});
