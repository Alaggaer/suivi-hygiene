import { describe, expect, it } from "vitest";
import { dimensions } from "./photos";

describe("réduction des photos", () => {
  it("ramène le plus grand côté à 1280 px en gardant les proportions", () => {
    expect(dimensions(4032, 3024)).toEqual({ l: 1280, h: 960 });
    expect(dimensions(3024, 4032)).toEqual({ l: 960, h: 1280 });
  });
  it("n'agrandit jamais une petite photo", () => {
    expect(dimensions(800, 600)).toEqual({ l: 800, h: 600 });
  });
});
