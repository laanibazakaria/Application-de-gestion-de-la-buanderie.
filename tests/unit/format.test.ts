import { describe, expect, it } from "vitest";

import { formatCountdown, formatTime, spokenCountdown } from "@/lib/format";

describe("formats d'affichage", () => {
  it("heure de Casablanca au format 24 h", () => {
    expect(formatTime("2026-01-14T13:05:00Z")).toBe("14:05"); // UTC+1 en janvier
    expect(formatTime("2026-03-04T21:30:00Z")).toBe("21:30"); // UTC+0 pendant le Ramadan
    expect(formatTime(null)).toBe("—");
  });

  it("compte à rebours", () => {
    expect(formatCountdown(247_000)).toBe("4:07");
    expect(formatCountdown(3_750_000)).toBe("1:02:30");
    expect(formatCountdown(-5_000)).toBe("0:00");
    expect(formatCountdown(200)).toBe("0:01");
  });

  it("compte à rebours lu par un lecteur d'écran", () => {
    expect(spokenCountdown(247_000)).toBe("4 minutes 7 secondes");
    expect(spokenCountdown(60_000)).toBe("1 minute");
    expect(spokenCountdown(0)).toBe("0 seconde");
  });
});
