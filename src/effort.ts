// Structured reasoning-effort handling for Kiro runtime requests.

import { type Api, clampThinkingLevel, type Model, type ThinkingLevel } from "@earendil-works/pi-ai";

export type KiroEffortField = "reasoning" | "output_config";

export interface KiroEffortConfig {
  field: KiroEffortField;
  values: readonly string[];
}

export type KiroAdditionalModelRequestFields =
  | { reasoning: { effort: string } }
  | { output_config: { effort: string }; thinking: { type: "adaptive" } };

type ModelWithKiroEffortMetadata = Model<Api> & {
  additionalModelRequestFieldsSchema?: unknown;
};

const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Derive Kiro's structured effort field and allowed enum from an authenticated catalog schema. */
export function deriveKiroEffort(schema: unknown): KiroEffortConfig | undefined {
  if (!isRecord(schema) || !isRecord(schema.properties)) return undefined;

  for (const field of ["reasoning", "output_config"] as const) {
    const fieldSchema = schema.properties[field];
    if (!isRecord(fieldSchema) || !isRecord(fieldSchema.properties)) continue;

    const effortSchema = fieldSchema.properties.effort;
    if (!isRecord(effortSchema) || !Array.isArray(effortSchema.enum) || effortSchema.enum.length === 0) continue;
    if (!effortSchema.enum.every((value) => typeof value === "string" && value.length > 0)) continue;

    return { field, values: [...new Set(effortSchema.enum as string[])] };
  }

  return undefined;
}

/**
 * Known-family compatibility used only before catalog schema metadata is available.
 *
 * The effort *field* (GPT `reasoning.effort` vs Claude `output_config.effort`) is
 * inherent to the Kiro API and cannot be derived without the schema, so it is
 * keyed off the model family. The allowed effort *values* are taken from the
 * model's own `thinkingLevelMap` — the same source of truth the catalog uses —
 * rather than a duplicated hardcoded model list:
 *   - GPT always exposes `reasoning.effort`; when no map is present it keeps the
 *     historical low→xhigh ceiling.
 *   - Claude only exposes `output_config.effort` when the model advertises an
 *     extended thinking level (`xhigh`/`max`) via `thinkingLevelMap`; models
 *     without one (e.g. Sonnet 4.5) fall through to prompt-injected thinking.
 */
export function fallbackKiroEffort(
  model: ModelWithKiroEffortMetadata,
  kiroModelId: string,
): KiroEffortConfig | undefined {
  const normalizedId = kiroModelId.toLowerCase().replace(/(\d)-(\d)/g, "$1.$2");
  const map = model.thinkingLevelMap;
  const extras: string[] = [];
  if (map?.xhigh) extras.push("xhigh");
  if (map?.max) extras.push("max");

  if (normalizedId.startsWith("openai-gpt") || normalizedId.startsWith("gpt")) {
    return { field: "reasoning", values: ["low", "medium", "high", ...(extras.length > 0 ? extras : ["xhigh"])] };
  }
  if (normalizedId.startsWith("claude") && extras.length > 0) {
    return { field: "output_config", values: ["low", "medium", "high", ...extras] };
  }
  return undefined;
}

/** Prefer authoritative schema metadata; never replace a present schema with a known-model guess. */
export function getKiroEffortConfig(
  model: ModelWithKiroEffortMetadata,
  kiroModelId: string,
): KiroEffortConfig | undefined {
  if (model.additionalModelRequestFieldsSchema !== undefined) {
    return deriveKiroEffort(model.additionalModelRequestFieldsSchema);
  }
  return fallbackKiroEffort(model, kiroModelId);
}

/** Map a canonical Pi level to a value that is present in the selected model's Kiro enum. */
export function mapPiLevelToKiroEffort(
  model: Model<Api>,
  level: ThinkingLevel,
  config: KiroEffortConfig,
): string | undefined {
  if (config.values.length === 0) return undefined;

  const effectiveLevel = clampThinkingLevel(model, level);
  if (effectiveLevel === "off") return undefined;

  const explicitlyMapped = model.thinkingLevelMap?.[effectiveLevel];
  if (typeof explicitlyMapped === "string" && config.values.includes(explicitlyMapped)) {
    return explicitlyMapped;
  }

  const target = effectiveLevel === "minimal" ? "low" : effectiveLevel;
  if (config.values.includes(target)) return target;

  const targetIndex = EFFORT_ORDER.indexOf(target as (typeof EFFORT_ORDER)[number]);
  if (targetIndex >= 0) {
    for (let index = targetIndex; index < EFFORT_ORDER.length; index++) {
      const candidate = EFFORT_ORDER[index];
      if (config.values.includes(candidate)) return candidate;
    }
    for (let index = targetIndex - 1; index >= 0; index--) {
      const candidate = EFFORT_ORDER[index];
      if (config.values.includes(candidate)) return candidate;
    }
  }

  return config.values[0];
}

/** Build the top-level Kiro runtime field for one requested Pi reasoning level. */
export function buildKiroAdditionalModelRequestFields(
  model: ModelWithKiroEffortMetadata,
  kiroModelId: string,
  level: ThinkingLevel | undefined,
): KiroAdditionalModelRequestFields | undefined {
  if (!level || !model.reasoning) return undefined;

  const config = getKiroEffortConfig(model, kiroModelId);
  if (!config) return undefined;
  const effort = mapPiLevelToKiroEffort(model, level, config);
  if (!effort) return undefined;

  return config.field === "output_config"
    ? { output_config: { effort }, thinking: { type: "adaptive" } }
    : { reasoning: { effort } };
}
