import { z } from "zod";
import { isAddress } from "viem";
import { HttpError } from "./http";

export const RuleSchema = z.object({
  troveOwner: z.string().refine((a) => isAddress(a, { strict: false }), "troveOwner must be an address"),
  kind: z.enum(["enters_warning", "enters_critical", "hf_drop", "price_drop", "debt_increase", "data_stale", "recovery_mode"]),
  threshold: z.number().positive().max(1_000_000).nullable().optional(),
  frequency: z.enum(["every_check", "once_per_hour", "once_per_day"]).default("once_per_day"),
  channel: z.enum(["in_app", "in_app_browser"]).default("in_app"),
  quietStart: z.number().int().min(0).max(23).nullable().optional(),
  quietEnd: z.number().int().min(0).max(23).nullable().optional(),
  tzOffsetMin: z.number().int().min(-840).max(840).default(0),
  enabled: z.boolean().default(true),
});

export function validateThreshold(kind: string, t: number | null | undefined) {
  if (t == null) return;
  if ((kind === "enters_warning" || kind === "enters_critical") && (t <= 1 || t > 20)) throw new HttpError(400, "Health factor thresholds must be between 1.00 and 20.00", "threshold");
  if (kind === "hf_drop" && t > 10) throw new HttpError(400, "Health-factor drop must be 10 or less", "threshold");
  if (kind === "price_drop" && t >= 100) throw new HttpError(400, "Price drop must be below 100%", "threshold");
}

/** PATCH body: every field optional and WITHOUT defaults, so omitted fields keep their stored values. */
export const RulePatchSchema = z.object({
  troveOwner: z.string().refine((a) => isAddress(a, { strict: false })).optional(),
  kind: z.enum(["enters_warning", "enters_critical", "hf_drop", "price_drop", "debt_increase", "data_stale", "recovery_mode"]).optional(),
  threshold: z.number().positive().max(1_000_000).nullable().optional(),
  frequency: z.enum(["every_check", "once_per_hour", "once_per_day"]).optional(),
  channel: z.enum(["in_app", "in_app_browser"]).optional(),
  quietStart: z.number().int().min(0).max(23).nullable().optional(),
  quietEnd: z.number().int().min(0).max(23).nullable().optional(),
  tzOffsetMin: z.number().int().min(-840).max(840).optional(),
  enabled: z.boolean().optional(),
});
