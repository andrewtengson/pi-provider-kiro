import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  buildKiroAdditionalModelRequestFields,
  deriveKiroEffort,
  fallbackKiroEffort,
  getKiroEffortConfig,
} from "../src/effort.js";

type EffortModel = Model<Api> & { additionalModelRequestFieldsSchema?: Record<string, unknown> };

function model(overrides: Partial<EffortModel>): EffortModel {
  return {
    id: "claude-opus-4-8",
    name: "M",
    api: "kiro-api",
    provider: "kiro",
    baseUrl: "https://runtime.us-east-1.kiro.dev/",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
    ...overrides,
  };
}

function schema(field: "reasoning" | "output_config", values: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: { [field]: { type: "object", properties: { effort: { enum: values } } } },
  };
}

describe("effort schema derivation", () => {
  it("reads the field and enum from a catalog schema", () => {
    expect(deriveKiroEffort(schema("reasoning", ["low", "high", "xhigh"]))).toEqual({
      field: "reasoning",
      values: ["low", "high", "xhigh"],
      summarizedThinking: false,
    });
    expect(deriveKiroEffort(schema("output_config", ["low", "max"]))).toEqual({
      field: "output_config",
      values: ["low", "max"],
      summarizedThinking: false,
    });
  });

  it("returns undefined for a schema without an effort enum", () => {
    expect(deriveKiroEffort({ type: "object", properties: {} })).toBeUndefined();
    expect(deriveKiroEffort(undefined)).toBeUndefined();
  });
});

describe("effort fallback derived from thinkingLevelMap", () => {
  it("derives Claude extended effort from an xhigh+max map", () => {
    expect(fallbackKiroEffort(model({ thinkingLevelMap: { xhigh: "xhigh", max: "max" } }), "claude-opus-4.8")).toEqual({
      field: "output_config",
      values: ["low", "medium", "high", "xhigh", "max"],
      summarizedThinking: true,
    });
  });

  it("derives the Claude max-without-xhigh hole from a max-only map", () => {
    expect(fallbackKiroEffort(model({ thinkingLevelMap: { max: "max" } }), "claude-sonnet-4.6")).toEqual({
      field: "output_config",
      values: ["low", "medium", "high", "max"],
      summarizedThinking: true,
    });
  });

  it("returns undefined for a Claude model without a thinking map", () => {
    expect(fallbackKiroEffort(model({ thinkingLevelMap: undefined }), "claude-sonnet-4.5")).toBeUndefined();
  });

  it("uses the reasoning field for GPT and keeps xhigh even without a map", () => {
    expect(fallbackKiroEffort(model({ thinkingLevelMap: undefined }), "openai-gpt-5.6")).toEqual({
      field: "reasoning",
      values: ["low", "medium", "high", "xhigh"],
      summarizedThinking: false,
    });
    expect(fallbackKiroEffort(model({ thinkingLevelMap: { xhigh: "xhigh" } }), "openai-gpt-5.6")).toEqual({
      field: "reasoning",
      values: ["low", "medium", "high", "xhigh"],
      summarizedThinking: false,
    });
  });

  it("returns undefined for unknown families", () => {
    expect(fallbackKiroEffort(model({ thinkingLevelMap: { max: "max" } }), "glm-5")).toBeUndefined();
  });
});

describe("getKiroEffortConfig", () => {
  it("prefers a present catalog schema over the thinking-map fallback", () => {
    const withSchema = model({
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
      additionalModelRequestFieldsSchema: schema("output_config", ["low", "high"]),
    });
    expect(getKiroEffortConfig(withSchema, "claude-opus-4.8")).toEqual({
      field: "output_config",
      values: ["low", "high"],
      summarizedThinking: false,
    });
  });

  it("does not synthesize a fallback when a present schema lacks an effort enum", () => {
    const emptySchema = model({
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
      additionalModelRequestFieldsSchema: { type: "object", properties: {} },
    });
    expect(getKiroEffortConfig(emptySchema, "claude-opus-4.8")).toBeUndefined();
  });

  it("builds Claude adaptive fields from the derived fallback", () => {
    const m = model({ id: "claude-opus-4-8", thinkingLevelMap: { xhigh: "xhigh", max: "max" } });
    expect(buildKiroAdditionalModelRequestFields(m, "claude-opus-4.8", "max")).toEqual({
      output_config: { effort: "max" },
      thinking: { type: "adaptive", display: "summarized" },
    });
  });

  it("requests summarized thinking display so Kiro streams reasoning frames", () => {
    // Kiro defaults thinking.display to "omitted", which suppresses every
    // reasoningContentEvent. Verified live against claude-opus-5 and
    // claude-opus-4.8: 0 reasoning frames without display, >0 with it.
    const schema = {
      type: "object",
      properties: {
        thinking: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["adaptive", "disabled"] },
            display: { type: "string", enum: ["summarized", "omitted"] },
          },
          required: ["type"],
        },
        output_config: { type: "object", properties: { effort: { type: "string", enum: ["low", "high", "max"] } } },
      },
      additionalProperties: false,
    };
    const m = model({ id: "claude-opus-5", additionalModelRequestFieldsSchema: schema });
    const fields = buildKiroAdditionalModelRequestFields(m, "claude-opus-5", "high");
    expect(fields).toEqual({
      output_config: { effort: "high" },
      thinking: { type: "adaptive", display: "summarized" },
    });
  });

  it("omits display when the schema's thinking block does not offer summarized", () => {
    // Do not send an unsupported enum value; models whose schema lacks
    // display (or offers only "omitted") must still get adaptive thinking.
    const schema = {
      type: "object",
      properties: {
        thinking: {
          type: "object",
          properties: { type: { type: "string", enum: ["adaptive", "disabled"] } },
          required: ["type"],
        },
        output_config: { type: "object", properties: { effort: { type: "string", enum: ["low", "high"] } } },
      },
      additionalProperties: false,
    };
    const m = model({ id: "claude-legacy", additionalModelRequestFieldsSchema: schema });
    expect(buildKiroAdditionalModelRequestFields(m, "claude-legacy", "high")).toEqual({
      output_config: { effort: "high" },
      thinking: { type: "adaptive" },
    });
  });

  it("omits the thinking field for GPT models, whose schema has no thinking support", () => {
    const gptSchema = {
      type: "object",
      properties: {
        reasoning: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["standard", "pro"], default: "standard" },
            effort: { type: "string", enum: ["none", "low", "medium", "high", "xhigh", "max"], default: "high" },
          },
        },
      },
      additionalProperties: false,
    };
    const m = model({ id: "gpt-5-6-sol", additionalModelRequestFieldsSchema: gptSchema });
    expect(buildKiroAdditionalModelRequestFields(m, "gpt-5.6-sol", "medium")).toEqual({
      reasoning: { effort: "medium" },
    });
  });
});
