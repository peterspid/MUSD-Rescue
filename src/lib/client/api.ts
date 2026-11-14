"use client";
import { useQuery } from "@tanstack/react-query";
import type { PositionDTO, RadarDTO, SystemDTO, HistoryPointDTO, TroveEventDTO } from "../dto";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok || res.status === 202) {
    const b = (body ?? {}) as { error?: string; code?: string; details?: unknown };
    throw new ApiError(res.status, b.error ?? `Request failed (${res.status})`, b.code, b.details);
  }
  return body as T;
}

export function useSystem() {
  return useQuery({ queryKey: ["system"], queryFn: () => api<SystemDTO>("/api/system"), refetchInterval: 15_000, staleTime: 5_000 });
}

export function usePosition(owner: string | null | undefined) {
  return useQuery({
    queryKey: ["position", owner?.toLowerCase()],
    queryFn: () => api<PositionDTO>(`/api/positions/${owner}`),
    enabled: !!owner,
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });
}

export function useRadar() {
  return useQuery({ queryKey: ["radar"], queryFn: () => api<RadarDTO>("/api/radar"), refetchInterval: 60_000, staleTime: 30_000 });
}

export interface HistoryResponse {
  range: string;
  archive: HistoryPointDTO[];
  recorded: { block_number: string; t: number; price: string; icr?: string | null; tcr?: string; source: string }[];
  method: string;
}

export function useHistory(owner: string | null, range: "24h" | "7d" | "30d") {
  return useQuery({
    queryKey: ["history", owner?.toLowerCase() ?? "system", range],
    queryFn: () => api<HistoryResponse>(`/api/positions/${owner ?? "system"}/history?range=${range}`),
    staleTime: 120_000,
    retry: 1,
  });
}

export function useReference(days: "1" | "7" | "30", enabled: boolean) {
  return useQuery({
    queryKey: ["reference", days],
    queryFn: () => api<{ source: string; note: string; prices: { t: number; p: number }[] }>(`/api/prices/reference?days=${days}`),
    enabled,
    staleTime: 600_000,
    retry: 0,
  });
}

export function useEvents(owner: string | null) {
  return useQuery({
    queryKey: ["events", owner?.toLowerCase()],
    queryFn: () => api<{ events: TroveEventDTO[]; source: string }>(`/api/positions/${owner}/events`),
    enabled: !!owner,
    staleTime: 20_000,
  });
}
