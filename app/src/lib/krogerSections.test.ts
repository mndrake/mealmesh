import { describe, it, expect } from "vitest";
import { krogerDepartmentToSection, sectionMismatch } from "./krogerSections";

describe("krogerDepartmentToSection", () => {
  it("maps the confident departments", () => {
    expect(krogerDepartmentToSection("Produce")).toBe("Produce");
    expect(krogerDepartmentToSection("Meat & Seafood")).toBe("Meat & Poultry");
    expect(krogerDepartmentToSection("Poultry")).toBe("Meat & Poultry");
    expect(krogerDepartmentToSection("Dairy")).toBe("Dairy & Eggs");
    expect(krogerDepartmentToSection("Eggs")).toBe("Dairy & Eggs");
    expect(krogerDepartmentToSection("Frozen Foods")).toBe("Frozen");
    expect(krogerDepartmentToSection("Bakery")).toBe("Bakery");
  });

  it("returns null for ambiguous, unknown, or empty departments", () => {
    expect(krogerDepartmentToSection("Pantry")).toBeNull();
    expect(krogerDepartmentToSection("Beverages")).toBeNull();
    expect(krogerDepartmentToSection("Baking Goods")).toBeNull();
    expect(krogerDepartmentToSection("")).toBeNull();
    expect(krogerDepartmentToSection(null)).toBeNull();
    expect(krogerDepartmentToSection(undefined)).toBeNull();
  });
});

describe("sectionMismatch", () => {
  it("flags a confident, different Kroger section", () => {
    expect(sectionMismatch("Produce", "Bakery")).toBe("Bakery");
    expect(sectionMismatch("Pantry & Dry Goods", "Frozen")).toBe("Frozen");
  });

  it("returns null when sections agree or the mapping is unknown/missing", () => {
    expect(sectionMismatch("Produce", "Produce")).toBeNull();
    expect(sectionMismatch("Produce", "Beverages")).toBeNull(); // ambiguous → no flag
    expect(sectionMismatch(null, "Bakery")).toBeNull();
    expect(sectionMismatch("Produce", null)).toBeNull();
  });
});
