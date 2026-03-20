import { invoke } from "@tauri-apps/api/core";

export type HealthResponse = {
  status: "ok";
  appName: string;
  appVersion: string;
  bootedAtUnix: number;
};

export async function fetchHealth(): Promise<HealthResponse> {
  return invoke<HealthResponse>("health");
}
