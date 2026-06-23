import { describe, it, expect } from "vitest";
import {
  buildGrounding,
  classifyIntent,
  detectMedicalIntent,
  MEDICAL_DEFLECTION,
  parseTempF,
} from "./coach";
import { getRecipeSteps } from "../../../src/lib/coach/content";

const STEPS = getRecipeSteps("brown-stew-chicken")!.steps;
const donenessStep = STEPS.find((s) => s.doneness_food)!; // s6
const techniqueStep = STEPS.find((s) => s.technique_id === "brown_meat")!; // s4

describe("detectMedicalIntent", () => {
  it("flags medication / glucose questions", () => {
    expect(detectMedicalIntent("Should I take more insulin after this?")).toBe(true);
    expect(detectMedicalIntent("how will this affect my blood sugar?")).toBe(true);
    expect(detectMedicalIntent("what's my a1c target")).toBe(true);
  });
  it("does not flag plain cooking questions", () => {
    expect(detectMedicalIntent("is the chicken done?")).toBe(false);
    expect(detectMedicalIntent("how do I brown the meat?")).toBe(false);
  });
});

describe("parseTempF", () => {
  it("extracts a temperature when the text is about temp/doneness", () => {
    expect(parseTempF("it's at 150 degrees")).toBe(150);
    expect(parseTempF("the thermometer reads 165")).toBe(165);
    expect(parseTempF("160F")).toBe(160);
  });
  it("ignores numbers that aren't temperatures", () => {
    expect(parseTempF("cook for 30 minutes")).toBeNull();
    expect(parseTempF("add 2 cups of stock")).toBeNull();
    expect(parseTempF("165")).toBeNull(); // no temp context
  });
});

describe("classifyIntent", () => {
  it("routes medical first, regardless of step", () => {
    expect(classifyIntent("is it done? also should I change my insulin", donenessStep)).toBe(
      "medical"
    );
  });
  it("routes doneness questions", () => {
    expect(classifyIntent("is this safe to eat yet?", donenessStep)).toBe("doneness");
  });
  it("routes technique questions", () => {
    expect(classifyIntent("how do I brown this properly?", techniqueStep)).toBe("technique");
  });
  it("falls back to general with no step and no keywords", () => {
    expect(classifyIntent("anything else I should know", null)).toBe("general");
  });
});

describe("buildGrounding — safety", () => {
  it("deflects medical questions deterministically without grounding", () => {
    const g = buildGrounding({
      recipeId: "brown-stew-chicken",
      stepId: donenessStep.id,
      question: "should I adjust my metformin dose?",
    });
    expect(g.intent).toBe("medical");
    expect(g.deterministicAnswer).toBe(MEDICAL_DEFLECTION);
    expect(g.verdict).toBeNull();
  });

  it("grounds a below-temp doneness reading as NOT done, with a citation", () => {
    const g = buildGrounding({
      recipeId: "brown-stew-chicken",
      stepId: donenessStep.id,
      question: "it's 150°F — is the chicken done?",
    });
    expect(g.intent).toBe("doneness");
    expect(g.verdict?.meetsTemp).toBe(false);
    expect(g.deterministicAnswer).toMatch(/keep cooking/i);
    expect(g.citation?.url).toMatch(/^https?:\/\//);
  });

  it("rule overrides observation — 'looks done' at 150°F is still not done", () => {
    const g = buildGrounding({
      recipeId: "brown-stew-chicken",
      stepId: donenessStep.id,
      question: "it looks done and the temp is 150, can I eat it?",
    });
    expect(g.verdict?.meetsTemp).toBe(false);
    expect(g.deterministicAnswer).toMatch(/do not eat/i);
  });

  it("grounds an at-temp reading as done", () => {
    const g = buildGrounding({
      recipeId: "brown-stew-chicken",
      stepId: donenessStep.id,
      question: "thermometer reads 170, done?",
    });
    expect(g.verdict?.meetsTemp).toBe(true);
    expect(g.deterministicAnswer).toMatch(/done/i);
  });

  it("grounds technique questions against the step's technique", () => {
    const g = buildGrounding({
      recipeId: "brown-stew-chicken",
      stepId: techniqueStep.id,
      question: "how do I do this step?",
    });
    expect(g.intent).toBe("technique");
    expect(g.technique?.id).toBe("brown_meat");
    expect(g.groundingText).toMatch(/brown/i);
    // technique answers need the model — no deterministic fallback
    expect(g.deterministicAnswer).toBeNull();
  });
});
