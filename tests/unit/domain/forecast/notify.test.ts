import { describe, expect, it } from "vitest";
import { parseTomorrowNotice, tomorrowNotice } from "@/domain/forecast/notify";

// Notification du soir « Créneaux de demain » (T74, SPEC §7.14) : seulement un créneau de
// demain qui fait gagner au moins 0,30 € ou couvert à 80 % par le solaire. Novembre, UTC+1.

const TZ = "Europe/Paris";
const HOUR = 3_600_000;
const local = (date: string, h: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + (h - 1) * HOUR);
const w = (name: string, date: string, h: number, cost: number, now: number, solar: number) => ({
  appliance: { name },
  window: {
    start: local(date, h),
    end: local(date, h + 2),
    costEur: cost,
    nowCostEur: now,
    solarShare: solar,
  },
});

describe("tomorrowNotice", () => {
  it("un créneau : son nom et ses heures en titre, le détail ensuite", () => {
    const n = tomorrowNotice([w("Lave-linge", "2026-11-22", 13, 0.1, 1.08, 0.9)], "2026-11-22", TZ);
    expect(n).toEqual({
      title: "Demain, lave-linge de 13 h à 15 h",
      body: "Lave-linge 13 h – 15 h : 90 % solaire, 0,98 € de moins que tout de suite.",
    });
  });

  it("plusieurs créneaux ; les créneaux sans intérêt ou d'aujourd'hui sont écartés", () => {
    const n = tomorrowNotice(
      [
        w("Lave-linge", "2026-11-22", 13, 0.1, 1.08, 0.9),
        w("Véhicule", "2026-11-22", 1, 6.1, 7.9, 0),
        w("Ballon", "2026-11-22", 9, 1.0, 1.1, 0.2), // ni gain ni solaire
        w("Pompe", "2026-11-21", 22, 0, 2, 1), // aujourd'hui
        { appliance: { name: "Sèche-linge" }, window: null },
      ],
      "2026-11-22",
      TZ,
    );
    expect(n?.title).toBe("Demain, 2 créneaux avantageux");
    expect(n?.body).toBe(
      "Véhicule 1 h – 3 h : 1,80 € de moins que tout de suite. Lave-linge 13 h – 15 h : 90 % solaire, 0,98 € de moins que tout de suite.",
    );
  });

  it("rien d'avantageux : pas de notification", () => {
    expect(
      tomorrowNotice([w("Ballon", "2026-11-22", 9, 1.0, 1.1, 0.2)], "2026-11-22", TZ),
    ).toBeNull();
  });
});

describe("parseTomorrowNotice", () => {
  it("désactivée par défaut ; valeurs invalides ignorées", () => {
    expect(parseTomorrowNotice(undefined)).toEqual({ enabled: false, email: false });
    expect(parseTomorrowNotice({ enabled: true, email: "oui" })).toEqual({
      enabled: true,
      email: false,
    });
  });
});
