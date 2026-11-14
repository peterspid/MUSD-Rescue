"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { GuardDTO, GuardRegistryDTO, KeeperRunDTO } from "../guard/dto";

export type GuardWithHints = GuardDTO & { hints: { upper: string; lower: string } | null };

export function useGuard(owner: string | null | undefined) {
  return useQuery({
    queryKey: ["guard", owner?.toLowerCase()],
    queryFn: () => api<GuardWithHints>(`/api/guard/${owner}`),
    enabled: !!owner,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

export function useGuardRegistry() {
  return useQuery({ queryKey: ["guard-registry"], queryFn: () => api<GuardRegistryDTO>("/api/guard"), refetchInterval: 30_000, staleTime: 10_000 });
}

export function fetchExecuteHints(owner: string) {
  return api<GuardWithHints>(`/api/guard/${owner}?hints=1`);
}

export function askKeeper() {
  return api<KeeperRunDTO>("/api/guard/keeper", { method: "POST", json: {} });
}
