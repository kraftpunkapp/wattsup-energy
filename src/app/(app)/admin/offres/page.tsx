import { redirect } from "next/navigation";
import { MarketSourceNote } from "@/components/market-source-note";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, Notice, StatTile, tiles } from "@/components/ui";
import { isNewOffer, isOldGrid, REASON_LABELS } from "@/domain/market/offer";
import { formatAgo } from "@/lib/format";
import { MARKET_SOURCE_REPO_URL } from "@/lib/links";
import { localParts } from "@/lib/time";
import { getMarketCatalog } from "@/server/market/catalog";
import { marketSyncEnabled } from "@/server/market/sync";
import { pageContext } from "@/server/page";
import { KIND_LABELS } from "../../contrats/labels";
import { OffersTable, type OfferRow } from "./offers-table";
import { RefreshButton } from "./refresh-button";

export const metadata = { title: "Offres du marché · WattsUp Energy" };

const STALE_MS = 7 * 86_400_000;
const TZ = "Europe/Paris";
const shortDate = (d: Date) =>
  d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
const dateTime = (d: Date) =>
  d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: TZ });
const isoDate = (iso: string) => shortDate(new Date(`${iso}T12:00:00Z`));
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * Administration › Offres du marché (T54, SPEC §7.12) : état de la synchronisation du
 * catalogue, changements du dernier import et liste des offres avec leur fraîcheur.
 */
export default async function MarketOffersPage() {
  const ctx = await pageContext("/admin/offres");
  if (!ctx.isAdmin) redirect("/");
  const { state, offers, imports } = await getMarketCatalog(ctx);
  const now = new Date();
  const today = localParts(now, TZ).date;
  const enabled = marketSyncEnabled();
  const compared = offers.filter((o) => o.support.status === "compared").length;
  const catalogStart = offers.reduce<Date | null>(
    (min, o) => (!min || o.firstSeenAt < min ? o.firstSeenAt : min),
    null,
  );
  const stale = state?.checkedAt ? now.getTime() - state.checkedAt.getTime() > STALE_MS : false;
  const last = imports[0];

  const rows: OfferRow[] = offers.map((o) => ({
    name: o.name,
    provider: o.provider,
    offer: o.offer,
    regulated: o.regulated,
    isNew: catalogStart !== null && isNewOffer(o.firstSeenAt, catalogStart, now),
    type: o.support.status === "compared" ? KIND_LABELS[o.support.kind] : null,
    householdOffPeak: o.support.status === "compared" && o.support.householdOffPeak,
    powers:
      o.powers.length > 1
        ? `${o.powers[0]} à ${o.powers[o.powers.length - 1]} kVA`
        : `${o.powers[0]} kVA`,
    gridDate: isoDate(o.gridDate),
    oldGrid: isOldGrid(o.gridDate, today),
    status:
      o.support.status === "compared"
        ? { kind: "compared" }
        : { kind: o.support.status, reason: REASON_LABELS[o.support.reason] },
    priceUrl: o.priceUrl,
    subscriptionUrl: o.subscriptionUrl,
  }));

  return (
    <>
      <PageHeader
        title="Offres du marché"
        subtitle={
          offers.length > 0
            ? `Administration · ${plural(offers.length, "offre", "offres")}, dont ${compared} comparée${compared > 1 ? "s" : ""}`
            : "Administration · catalogue des offres comparées sur la page Contrats"
        }
      />

      {!enabled && (
        <Notice tone="info" title="Synchronisation désactivée :">
          MARKET_SYNC=off, aucun appel vers la source ; le catalogue déjà importé reste utilisé.
        </Notice>
      )}
      {enabled && offers.length === 0 && (
        <Notice tone="info" title="Catalogue pas encore importé :" action={<RefreshButton />}>
          il est vérifié chaque jour à 4 h et au démarrage du serveur.
        </Notice>
      )}
      {state?.status === "error" && (
        <Notice tone="warning" title="Dernière vérification en échec :">
          {state.error}. {offers.length > 0 && "Le catalogue précédent reste utilisé."}
        </Notice>
      )}
      {enabled && stale && state?.checkedAt && (
        <Notice tone="warning" title="Catalogue non vérifié depuis plus de 7 jours :">
          dernière vérification {formatAgo(now.getTime() - state.checkedAt.getTime())}. Le
          planificateur du serveur tourne-t-il ?
        </Notice>
      )}

      {state && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] items-start gap-4">
          <Card
            icon="refresh"
            title="Synchronisation"
            badges={
              state.status === "error" ? (
                <Badge tone="warning">Échec</Badge>
              ) : (
                <Badge tone="positive">À jour</Badge>
              )
            }
            description={
              <>
                Vérifiée chaque jour à 4 h ; le catalogue n&apos;est téléchargé que lorsque la
                source change.
                {state.sourceCommit && (
                  <>
                    {" "}
                    Source :{" "}
                    <a
                      href={`${MARKET_SOURCE_REPO_URL}/commit/${state.sourceCommit}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-ink"
                    >
                      commit {state.sourceCommit.slice(0, 7)}
                    </a>
                    {state.sourceCommittedAt && ` du ${shortDate(state.sourceCommittedAt)}`}.
                  </>
                )}
              </>
            }
          >
            <div className={tiles}>
              <StatTile
                label="Dernière vérification"
                value={state.checkedAt ? formatAgo(now.getTime() - state.checkedAt.getTime()) : "—"}
                sub={state.checkedAt ? dateTime(state.checkedAt) : undefined}
              />
              <StatTile
                label="Dernier import"
                value={state.importedAt ? shortDate(state.importedAt) : "—"}
                sub={state.importedAt ? dateTime(state.importedAt).split(" ")[1] : undefined}
              />
              <StatTile
                label="Offres"
                value={String(offers.length)}
                sub={`${compared} comparée${compared > 1 ? "s" : ""}`}
              />
            </div>
            {enabled && <RefreshButton />}
          </Card>

          {last && (
            <Card
              icon="tag"
              title="Dernier import"
              description={`${dateTime(last.at)} · commit ${last.sourceCommit.slice(0, 7)} · ${plural(last.offers, "offre", "offres")}`}
            >
              <ChangeList label="Nouvelles" names={last.added} />
              <ChangeList label="Retirées" names={last.removed} />
              <ChangeList label="Grilles modifiées" names={last.updated} />
              {last.unreadable.length > 0 && (
                <ChangeList label="Illisibles" names={last.unreadable} warning />
              )}
              {last.added.length + last.removed.length + last.updated.length === 0 && (
                <p className="text-xs text-muted">
                  {imports.length === 1
                    ? "Premier import : ce catalogue sert de référence pour repérer les nouvelles offres, les offres retirées et les changements de prix."
                    : "Aucun changement d'offre par rapport au catalogue précédent."}
                </p>
              )}
              {imports.length > 1 && (
                <details className="border-t border-track pt-3 text-xs">
                  <summary className="cursor-pointer text-muted hover:text-ink">
                    Historique des imports ({imports.length})
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1 tabular-nums">
                    {imports.map((i) => (
                      <li key={i.id} className="flex flex-wrap gap-x-2 text-muted">
                        <span className="text-ink">{dateTime(i.at)}</span>
                        <span>{i.sourceCommit.slice(0, 7)}</span>
                        <span>{plural(i.offers, "offre", "offres")}</span>
                        <span>
                          +{i.added.length} −{i.removed.length} ~{i.updated.length}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          )}
        </div>
      )}

      {rows.length > 0 && <OffersTable rows={rows} />}
      {rows.length > 0 && (
        <MarketSourceNote catalogDate={state?.sourceCommittedAt ?? state?.importedAt ?? null} />
      )}
    </>
  );
}

function ChangeList({
  label,
  names,
  warning = false,
}: {
  label: string;
  names: string[];
  warning?: boolean;
}) {
  if (names.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-[11px] font-medium ${warning ? "text-warning-ink" : "text-muted"}`}>
        {label} ({names.length})
      </span>
      <p className="text-[13px] text-pretty">{names.join(" · ")}</p>
    </div>
  );
}
