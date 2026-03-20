import { invoke } from "@tauri-apps/api/core";

export type HealthResponse = {
  status: "ok";
  appName: string;
  appVersion: string;
  bootedAtUnix: number;
};

export type ProjectRecord = {
  id: string;
  name: string;
  rootRelativePath: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
};

export type SettingRecord<TValue = unknown> = {
  key: string;
  value: TValue;
  updatedAt: number;
};

type CreateProjectInput = {
  name: string;
  rootPath: string;
};

type ProjectIdInput = {
  projectId: string;
};

type SettingKeyInput = {
  key: string;
};

type SetSettingInput<TValue> = {
  key: string;
  value: TValue;
};

async function invokeTauri<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  return invoke<TResult>(command, args);
}

export function fetchHealth() {
  return invokeTauri<HealthResponse>("health");
}

export function createProject(input: CreateProjectInput) {
  return invokeTauri<ProjectRecord>("create_project", input);
}

export function listProjects() {
  return invokeTauri<ProjectRecord[]>("list_projects");
}

export function getProject(input: ProjectIdInput) {
  return invokeTauri<ProjectRecord | null>("get_project", input);
}

export function deleteProject(input: ProjectIdInput) {
  return invokeTauri<boolean>("delete_project", input);
}

export function getSetting<TValue = unknown>(input: SettingKeyInput) {
  return invokeTauri<SettingRecord<TValue> | null>("get_setting", input);
}

export function setSetting<TValue>(input: SetSettingInput<TValue>) {
  return invokeTauri<SettingRecord<TValue>>("set_setting", input);
}
