import { describe, expect, it } from "vitest";
import { projectYear, type ProjectionMonth } from "@/domain/projection";

const key = (m: number) => `2026-${String(m).padStart(2, "0")}`;
/** N-1 : 100 € par mois ; cette année : `actual` € pour les mois jusqu'à `upTo`. */
const year = (
  actual: (m: number) => number | null,
  previous: (m: number) => number | null = () => 10_000,
) =>
  Array.from({ length: 12 }, (_, i): ProjectionMonth => ({
    key: key(i + 1),
    actualCents: actual(i + 1),
    previousCents: previous(i + 1),
  }));

describe("projectYear", () => {
  it("mois restants = N-1 × tendance des mois terminés ; mois en cours au prorata", () => {
    // Janvier à mai à 110 € (tendance +10 %) ; juin entamé (10 jours sur 30) à 40 €.
    const months = year((m) => (m <= 5 ? 11_000 : m === 6 ? 4_000 : null));
    const p = projectYear(months, { key: "2026-06", elapsedDays: 10, daysInMonth: 30 });
    // 5 × 110 + (40 + 110 × 20/30) + 6 × 110 = 550 + 113,33 + 660
    expect(p).toEqual({
      totalCents: 132_333,
      lowCents: null,
      highCents: null,
      previousTotalCents: 120_000,
      trend: 1.1,
      futureMonths: Array.from({ length: 6 }, (_, i) => ({ key: key(i + 7), cents: 11_000 })),
    });
  });

  it("moins de 3 mois comparables : fourchette de ±15 % sur la part estimée", () => {
    const months = year((m) => (m === 1 ? 10_000 : m === 2 ? 0 : null));
    const p = projectYear(months, { key: "2026-02", elapsedDays: 0, daysInMonth: 28 });
    expect(p?.totalCents).toBe(120_000);
    expect(p?.lowCents).toBe(120_000 - 0.15 * 110_000);
    expect(p?.highCents).toBe(120_000 + 0.15 * 110_000);
  });

  it("mois sans N-1 : moyenne des mois terminés ; N-1 total seulement si complet", () => {
    const months = year(
      (m) => (m <= 3 ? 9_000 : null),
      (m) => (m <= 6 ? 10_000 : null),
    );
    const p = projectYear(months, { key: "2026-04", elapsedDays: 0, daysInMonth: 30 });
    // Tendance 0,9 : avril à juin 90 € ; juillet à décembre sans N-1 : moyenne 90 €.
    expect(p?.totalCents).toBe(108_000);
    expect(p?.previousTotalCents).toBeNull();
  });

  it("aucun mois terminé ni N-1 : pas de projection", () => {
    const months = year(
      () => null,
      () => null,
    );
    expect(projectYear(months, { key: "2026-01", elapsedDays: 5, daysInMonth: 31 })).toBeNull();
  });
});
