import { Fragment } from "react";
import { Badge, button, Icon } from "@/components/ui";

// Liste des offres du catalogue (administrateur), regroupées par fournisseur : type,
// puissances publiées, date de la grille et statut de la comparaison.

export interface OfferRow {
  name: string;
  provider: string;
  offer: string;
  regulated: boolean;
  isNew: boolean;
  /** Type de contrat du moteur ; null si l'offre n'est pas comparée. */
  type: string | null;
  householdOffPeak: boolean;
  powers: string;
  gridDate: string;
  oldGrid: boolean;
  status: { kind: "compared" } | { kind: "pending" | "never"; reason: string };
  priceUrl: string | null;
  subscriptionUrl: string | null;
}

function ExternalLink({ href, label, title }: { href: string; label: string; title: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={`${button.link} inline-flex items-center gap-1 whitespace-nowrap`}
    >
      {label}
      <Icon name="external" size={12} />
    </a>
  );
}

export function OffersTable({ rows }: { rows: OfferRow[] }) {
  const providers = [...new Set(rows.map((r) => r.provider))].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
  const th = "px-4 py-2.5 text-left text-[11px] font-medium whitespace-nowrap text-muted";
  const td = "px-4 py-3 align-top";
  return (
    <div className="relative overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[860px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-track">
            <th className={th}>Offre</th>
            <th className={th}>Type</th>
            <th className={th}>Puissances</th>
            <th className={th}>Grille de prix</th>
            <th className={th}>Comparaison</th>
            <th className={`${th} text-right`}>Liens</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((provider) => (
            <Fragment key={provider}>
              <tr className="border-b border-track bg-bg/60">
                <th
                  colSpan={6}
                  scope="colgroup"
                  className="px-4 py-2 text-left text-xs font-semibold text-ink-soft"
                >
                  {provider}
                </th>
              </tr>
              {rows
                .filter((r) => r.provider === provider)
                .sort((a, b) => a.offer.localeCompare(b.offer, "fr"))
                .map((r) => (
                  <tr key={r.name} className="border-b border-track last:border-b-0">
                    <td className={td}>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{r.offer}</span>
                        {r.regulated && <Badge tone="soft">Tarif réglementé</Badge>}
                        {r.isNew && <Badge tone="positive">Nouvelle</Badge>}
                      </span>
                    </td>
                    <td className={td}>
                      {r.type ? (
                        <span className="flex flex-col gap-0.5">
                          <span>{r.type}</span>
                          {r.householdOffPeak && (
                            <span className="text-[11px] text-subtle">heures creuses du foyer</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>{r.powers}</td>
                    <td className={td}>
                      <span className="flex flex-wrap items-center gap-1.5 whitespace-nowrap tabular-nums">
                        {r.gridDate}
                        {r.oldGrid && <Badge tone="warning">Ancienne</Badge>}
                      </span>
                    </td>
                    <td className={td}>
                      {r.status.kind === "compared" ? (
                        <Badge tone="positive">Comparée</Badge>
                      ) : (
                        <span className="flex flex-col items-start gap-0.5">
                          <Badge>{r.status.kind === "pending" ? "Pas encore" : "Exclue"}</Badge>
                          <span className="text-[11px] text-subtle">{r.status.reason}</span>
                        </span>
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      <span className="flex flex-col items-end gap-1">
                        {r.priceUrl && (
                          <ExternalLink
                            href={r.priceUrl}
                            label="Grille officielle"
                            title={`Grille de prix publiée par ${r.provider}`}
                          />
                        )}
                        {r.subscriptionUrl && (
                          <ExternalLink
                            href={r.subscriptionUrl}
                            label="Page de l'offre"
                            title={`Page de l'offre chez ${r.provider}`}
                          />
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
