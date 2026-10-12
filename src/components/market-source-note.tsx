import { MARKET_SOURCE_URL } from "@/lib/links";

// Mentions des offres du marché (SPEC §7.12), partout où elles s'affichent : avertissement
// et source des données, avec la date du catalogue.

const longDate = (d: Date) =>
  d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });

export function MarketSourceNote({ catalogDate }: { catalogDate: Date | null }) {
  return (
    <div className="flex flex-col gap-1 text-[11px] leading-relaxed text-subtle text-pretty">
      <p>
        Les offres peuvent ne pas être à jour : vérifiez-les sur le site du fournisseur avant toute
        décision.
      </p>
      <p>
        Source :{" "}
        <a
          href={MARKET_SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-ink"
        >
          comparateur-abonnements-electricite.fr
        </a>{" "}
        (données ouvertes, GPL-3.0){catalogDate ? `, catalogue du ${longDate(catalogDate)}` : ""}.
      </p>
    </div>
  );
}
