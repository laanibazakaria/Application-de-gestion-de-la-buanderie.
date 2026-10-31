import { describe, expect, it } from "vitest";

import { textDirection, TIME_ZONE } from "@/i18n/config";

describe("i18n", () => {
  it("le français s'affiche de gauche à droite, l'arabe de droite à gauche", () => {
    expect(textDirection("fr")).toBe("ltr");
    expect(textDirection("ar")).toBe("rtl");
  });

  it("le fuseau de référence est Africa/Casablanca", () => {
    expect(TIME_ZONE).toBe("Africa/Casablanca");
  });
});
