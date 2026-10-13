import { describe, expect, it } from "vitest";
import {
  autoMarkers,
  markedDays,
  markedMonths,
  markerDates,
  markersBetween,
  type Marker,
} from "@/domain/markers";

const m = (startDate: string, endDate: string | null = null, text = "Repère"): Marker => ({
  id: "x",
  kind: "other",
  text,
  startDate,
  endDate,
});

describe("markersBetween", () => {
  it("repères qui touchent la période [from, to), triés par date", () => {
    const list = [
      m("2026-10-03", null, "dans"),
      m("2026-09-25", "2026-10-02", "à cheval"),
      m("2026-11-01", null, "après"),
      m("2026-09-01", "2026-09-30", "avant"),
    ];
    expect(markersBetween(list, "2026-10-01", "2026-11-01").map((x) => x.text)).toEqual([
      "à cheval",
      "dans",
    ]);
  });
});

describe("markedMonths", () => {
  it("chaque mois couvert par un repère, durée comprise", () => {
    const months = markedMonths([m("2026-09-25", "2026-11-02", "long"), m("2026-10-15")]);
    expect([...months.keys()]).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(months.get("2026-10")?.map((x) => x.text)).toEqual(["long", "Repère"]);
  });
});

describe("markedDays", () => {
  it("chaque jour couvert de la période [from, to), durée comprise", () => {
    const days = markedDays(
      [m("2026-09-28", "2026-10-02", "long"), m("2026-10-02"), m("2026-11-01")],
      "2026-10-01",
      "2026-11-01",
    );
    expect([...days.keys()]).toEqual(["2026-10-01", "2026-10-02"]);
    expect(days.get("2026-10-02")?.map((x) => x.text)).toEqual(["long", "Repère"]);
  });
});

describe("markerDates", () => {
  it("jour, durée dans un mois, durée sur deux mois ou deux ans", () => {
    expect(markerDates(m("2026-10-03"))).toBe("3 octobre 2026");
    expect(markerDates(m("2026-10-03", "2026-10-10"))).toBe("du 3 au 10 octobre 2026");
    expect(markerDates(m("2026-09-28", "2026-10-04"))).toBe("du 28 septembre au 4 octobre 2026");
    expect(markerDates(m("2025-12-28", "2026-01-04"))).toBe(
      "du 28 décembre 2025 au 4 janvier 2026",
    );
    expect(markerDates(m("2026-10-03", "2026-10-03"))).toBe("3 octobre 2026");
  });
});

describe("autoMarkers", () => {
  it("début des contrats souscrits et mise en service des équipements", () => {
    expect(
      autoMarkers(
        [
          { name: "Octopus Go", status: "subscribed", startDate: "2026-02-01" },
          { name: "Offre Tempo", status: "simulated", startDate: null },
        ],
        [{ label: "Panneaux du toit", installedOn: "2024-10-03" }],
      ),
    ).toEqual([
      {
        id: null,
        kind: "contract",
        text: "Nouveau contrat : Octopus Go",
        startDate: "2026-02-01",
        endDate: null,
      },
      {
        id: null,
        kind: "install",
        text: "Mise en service : Panneaux du toit",
        startDate: "2024-10-03",
        endDate: null,
      },
    ]);
  });
});
