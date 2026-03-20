import type { StateCreator } from "zustand";

import {
  createProject as createProjectCommand,
  deleteProject as deleteProjectCommand,
  getProject as getProjectCommand,
  getSetting,
  listProjects,
  setSetting,
  type ProjectRecord,
} from "../shared/lib/tauri";
import type { UiSlice } from "./uiSlice";

const ACTIVE_PROJECT_SETTING_KEY = "app.active_project_id";

export type ProjectStatus = "idle" | "loading" | "ready" | "error";
export type ProjectAction = "idle" | "creating" | "switching" | "deleting";

export type ProjectSlice = {
  projects: ProjectRecord[];
  activeProjectId: string | null;
  projectStatus: ProjectStatus;
  projectAction: ProjectAction;
  pendingProjectId: string | null;
  projectError: string | null;
  initializeProjects: () => Promise<void>;
  createProject: (input: { name: string; rootPath: string }) => Promise<ProjectRecord>;
  selectProject: (projectId: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  clearProjectError: () => void;
};

type DispatchStoreState = UiSlice & ProjectSlice;

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function getPersistenceError(action: "create" | "switch" | "remove") {
  if (action === "create") {
    return "Project was added, but Dispatch could not save it as the active project.";
  }

  if (action === "switch") {
    return "Dispatch could not persist the active project selection.";
  }

  return "Project was removed, but Dispatch could not persist the active project fallback.";
}

function parseStoredProjectId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function upsertProject(projects: ProjectRecord[], project: ProjectRecord) {
  const remainingProjects = projects.filter((candidate) => candidate.id !== project.id);
  return [
    project,
    ...remainingProjects,
  ];
}

async function persistActiveProjectId(projectId: string | null) {
  await setSetting({
    key: ACTIVE_PROJECT_SETTING_KEY,
    value: projectId,
  });
}

export const createProjectSlice: StateCreator<
  DispatchStoreState,
  [],
  [],
  ProjectSlice
> = (set, get) => ({
  projects: [],
  activeProjectId: null,
  projectStatus: "idle",
  projectAction: "idle",
  pendingProjectId: null,
  projectError: null,
  initializeProjects: async () => {
    const currentStatus = get().projectStatus;
    if (currentStatus === "loading") {
      return;
    }

    set({
      projectStatus: "loading",
      projectError: null,
    });

    try {
      const [
        projects,
        storedSetting,
      ] = await Promise.all([
        listProjects(),
        getSetting<string | null>({ key: ACTIVE_PROJECT_SETTING_KEY }),
      ]);
      const storedProjectId = parseStoredProjectId(storedSetting?.value);
      const hasStoredProject = storedProjectId
        ? projects.some((project) => project.id === storedProjectId)
        : false;
      const activeProjectId = hasStoredProject
        ? storedProjectId
        : projects[0]?.id ?? null;

      set({
        projects,
        activeProjectId,
        projectStatus: "ready",
        projectError: null,
      });

      if (storedProjectId !== activeProjectId) {
        await persistActiveProjectId(activeProjectId);
      }
    } catch (error: unknown) {
      set({
        projectStatus: "error",
        projectError: getErrorMessage(error, "Projects failed to load."),
      });
    }
  },
  createProject: async ({ name, rootPath }) => {
    const previousActiveProjectId = get().activeProjectId;

    set({
      projectAction: "creating",
      pendingProjectId: null,
      projectError: null,
    });

    try {
      const project = await createProjectCommand({
        name,
        rootPath,
      });
      const projects = upsertProject(get().projects, project);

      try {
        await persistActiveProjectId(project.id);

        set({
          projects,
          activeProjectId: project.id,
          projectStatus: "ready",
        });
      } catch (error: unknown) {
        const message = getErrorMessage(error, getPersistenceError("create"));

        set({
          projects,
          activeProjectId: previousActiveProjectId,
          projectStatus: "ready",
          projectError: message,
        });

        throw new Error(message);
      }

      return project;
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Project creation failed.");

      set({
        projectError: message,
      });

      throw new Error(message);
    } finally {
      set({
        projectAction: "idle",
        pendingProjectId: null,
      });
    }
  },
  selectProject: async (projectId) => {
    if (get().activeProjectId === projectId) {
      return;
    }

    set({
      projectAction: "switching",
      pendingProjectId: projectId,
      projectError: null,
    });

    try {
      const project = await getProjectCommand({ projectId });

      if (!project) {
        throw new Error("The selected project is no longer available.");
      }

      await persistActiveProjectId(project.id);

      set((state) => ({
        activeProjectId: project.id,
        projects: upsertProject(state.projects, project),
        projectStatus: "ready",
      }));
    } catch (error: unknown) {
      set({
        projectError: getErrorMessage(error, getPersistenceError("switch")),
      });
    } finally {
      set({
        projectAction: "idle",
        pendingProjectId: null,
      });
    }
  },
  removeProject: async (projectId) => {
    set({
      projectAction: "deleting",
      pendingProjectId: projectId,
      projectError: null,
    });

    try {
      const deleted = await deleteProjectCommand({ projectId });

      if (!deleted) {
        throw new Error("The selected project could not be removed.");
      }

      const currentState = get();
      const projects = currentState.projects.filter((project) => project.id !== projectId);
      const activeProjectId = currentState.activeProjectId === projectId
        ? projects[0]?.id ?? null
        : currentState.activeProjectId;
      const shouldPersistActiveProject = currentState.activeProjectId === projectId;

      if (shouldPersistActiveProject) {
        try {
          await persistActiveProjectId(activeProjectId);
        } catch (error: unknown) {
          set({
            projectError: getErrorMessage(error, getPersistenceError("remove")),
          });
        }
      }

      set({
        projects,
        activeProjectId,
        projectStatus: "ready",
      });
    } catch (error: unknown) {
      set({
        projectError: getErrorMessage(error, "Project removal failed."),
      });
    } finally {
      set({
        projectAction: "idle",
        pendingProjectId: null,
      });
    }
  },
  clearProjectError: () => {
    set({
      projectError: null,
    });
  },
});
