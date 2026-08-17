// Cold-cache effort fallback: bootstrap GPT models carry no catalog schema, so
// the family fallback must still produce Kiro's `reasoning.effort` field.

import { describe, expect, it } from "vitest";
import { fallbackKiroEffort, getKiroEffortConfig } from "../src/effort.js";
import { kiroModels } from "../src/models.js";

describe("effort fallback without catalog schema", () => {
  it("derives reasoning.effort for Kiro's bare gpt ids", () => {
    const config = fallbackKiroEffort("gpt-5.6-sol");

    expect(config).toEqual({
      field: "reasoning",
      values: ["low", "medium", "high", "xhigh", "max"],
      summarizedThinking: false,
    });
  });

  it("still derives reasoning.effort for openai-prefixed ids", () => {
    expect(fallbackKiroEffort("openai-gpt-5.6-sol")?.field).toBe("reasoning");
  });

  it("keeps every bootstrap GPT model configurable on a cold cache", () => {
    const gptModels = kiroModels.filter((model) => model.id.startsWith("gpt-"));

    expect(gptModels.length).toBeGreaterThan(0);
    for (const model of gptModels) {
      const config = getKiroEffortConfig(undefined, model.kiroModelId);
      expect(config?.field, `${model.id} effort field`).toBe("reasoning");
      expect(config?.values, `${model.id} effort values`).toContain("max");
    }
  });

  it("prefers catalog schema over the family fallback", () => {
    const schema = {
      type: "object",
      properties: { reasoning: { type: "object", properties: { effort: { type: "string", enum: ["low", "high"] } } } },
    };

    expect(getKiroEffortConfig(schema, "gpt-5.6-sol")?.values).toEqual(["low", "high"]);
  });
});
