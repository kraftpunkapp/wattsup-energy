import { headers } from "next/headers";
import { pushState } from "@/domain/ingest/push-state";
import { parseSettingsTab, settingsTabsFor } from "@/lib/settings-tabs";
import { listAppliances } from "@/server/appliances";
import { listCategories, unknownCategorySlugs } from "@/server/categories";
import type { HouseholdContext } from "@/server/context";
import { getLastPushAt, listIngestLog } from "@/server/ingest/status";
import { getActiveIngestToken } from "@/server/ingest/token";
import { getLocationStatus } from "@/server/location";
import { dayValues, storedMetrics, suspectValues, type StoredValue } from "@/server/energy-data";
import { addDays, localParts } from "@/lib/time";
import { pageContext } from "@/server/page";
import { alertSettings } from "@/server/alerts";
import { overviewBlocksFor, overviewHidden } from "@/server/overview-prefs";
import { mailConfigured } from "@/server/mail";
import { AlertsSettingsCard } from "./alerts-card";
import { OverviewBlocksCard } from "./overview-blocks-card";
import { AppliancesCard } from "./appliances-card";
import { CategoriesCard } from "./categories-card";
import { CsvCard } from "./csv-card";
import { DayCard, RangeCard, SuspectCard } from "./data-cards";
import { FuelSettingsCard } from "./fuel-settings-card";
import { HaFuelCard } from "./ha-fuel-card";
import { HaHistoryCard } from "./ha-history-card";
import { IngestCard } from "./ingest-card";
import { IngestLogCard } from "./ingest-log-card";
import { LocationCard } from "./location-card";
import { ProfileForm } from "./profile-form";
import { SolarBatteryCard } from "./solar-battery-card";

export const metadata = { title: "Réglages · WattsUp Energy" };

/** Adresse publique de l'instance (endpoint, blueprints), d'après la requête. */
async function requestOrigin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
}

// Un ou deux encarts par section, en colonne de lecture confortable.
const panel = "flex max-w-2xl flex-col gap-4";

async function EquipmentTab({ ctx }: { ctx: HouseholdContext }) {
  return (
    <div className={panel}>
      {(ctx.profile.solar || ctx.profile.battery) && (
        <SolarBatteryCard
          solar={ctx.profile.solar}
          battery={ctx.profile.battery}
          initial={{
            exportEnabled: ctx.settings.exportEnabled,
            exportPriceEurKwh: ctx.settings.exportPriceEurKwh,
            batteryGridCharging: ctx.settings.batteryGridCharging,
          }}
        />
      )}
      {(ctx.profile.pellet || ctx.profile.wood) && (
        <FuelSettingsCard
          pellet={ctx.profile.pellet}
          wood={ctx.profile.wood}
          initial={{
            pelletBagKg: ctx.settings.pelletBagKg,
            pelletBagsPerPallet: ctx.settings.pelletBagsPerPallet,
            heatingSeason: ctx.settings.heatingSeason,
            kwhFactors: ctx.settings.kwhFactors,
          }}
        />
      )}
      {(ctx.profile.pellet || ctx.profile.wood) && <HaFuelCard origin={await requestOrigin()} />}
    </div>
  );
}

async function HomeAssistantTab({ ctx }: { ctx: HouseholdContext }) {
  const [active, lastPushAt, log, categories] = await Promise.all([
    getActiveIngestToken(ctx),
    getLastPushAt(ctx),
    listIngestLog(ctx),
    listCategories(ctx),
  ]);
  const origin = await requestOrigin();
  return (
    <div className={panel}>
      <IngestCard
        endpoint={`${origin}/api/v1/ingest`}
        granularity={ctx.granularity}
        lastPushAt={lastPushAt?.toISOString() ?? null}
        link={pushState(lastPushAt?.getTime() ?? null, Date.now(), ctx.granularity)}
        active={active && { prefix: active.prefix, createdAt: active.createdAt.toISOString() }}
      />
      <IngestLogCard
        timezone={ctx.timezone}
        categoryNames={Object.fromEntries(categories.map((c) => [c.slug, c.name]))}
        entries={log.map((l) => ({ ...l, receivedAt: l.receivedAt.toISOString() }))}
      />
    </div>
  );
}

async function CategoriesTab({ ctx }: { ctx: HouseholdContext }) {
  const [categories, unknown] = await Promise.all([listCategories(ctx), unknownCategorySlugs(ctx)]);
  return (
    <div className={panel}>
      <CategoriesCard
        timezone={ctx.timezone}
        unknown={unknown}
        categories={categories.map((c) => ({
          ...c,
          lastDataAt: c.lastDataAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}

async function AppliancesTab({ ctx }: { ctx: HouseholdContext }) {
  return (
    <div className={panel}>
      <AppliancesCard appliances={await listAppliances(ctx)} />
    </div>
  );
}

async function HistoryTab({ ctx }: { ctx: HouseholdContext }) {
  const categories = await listCategories(ctx);
  return (
    <div className={panel}>
      <HaHistoryCard origin={await requestOrigin()} />
      <CsvCard
        granularity={ctx.granularity}
        timezone={ctx.timezone}
        slugs={categories.map((c) => c.slug)}
      />
    </div>
  );
}

const toItem = (v: StoredValue) => ({ ...v, start: v.start.toISOString() });

async function DataTab({
  ctx,
  metric,
  day,
}: {
  ctx: HouseholdContext;
  metric: string | undefined;
  day: string | undefined;
}) {
  const [metrics, suspects, categories] = await Promise.all([
    storedMetrics(ctx),
    suspectValues(ctx),
    listCategories(ctx),
  ]);
  const names = Object.fromEntries(categories.map((c) => [c.slug, c.name]));
  const today = localParts(new Date(), ctx.timezone).date;
  // Par défaut : l'import réseau (ou le premier compteur), la veille.
  const m =
    metric && metrics.includes(metric)
      ? metric
      : (metrics.find((x) => x === "grid_import") ?? metrics[0] ?? "grid_import");
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : addDays(today, -1);
  const values = await dayValues(ctx, m, d);
  return (
    <div className={panel}>
      <SuspectCard items={suspects.map(toItem)} names={names} timezone={ctx.timezone} />
      <DayCard
        metrics={metrics}
        names={names}
        metric={m}
        day={d}
        items={values.map(toItem)}
        timezone={ctx.timezone}
      />
      <RangeCard metrics={metrics} names={names} today={today} />
    </div>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    onglet?: string | string[];
    compteur?: string | string[];
    jour?: string | string[];
  }>;
}) {
  const ctx = await pageContext("/reglages");
  const tabs = settingsTabsFor(ctx.profile);
  const params = await searchParams;
  const tab = parseSettingsTab(params.onglet, tabs);
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  return <SettingsSection ctx={ctx} tab={tab} params={params} one={one} />;
}

/** Contenu de la section choisie. */
async function SettingsSection({
  ctx,
  tab,
  params,
  one,
}: {
  ctx: HouseholdContext;
  tab: ReturnType<typeof parseSettingsTab>;
  params: { compteur?: string | string[]; jour?: string | string[] };
  one: (v: string | string[] | undefined) => string | undefined;
}) {
  const p = ctx.profile;
  return (
    <>
      {tab === "profil" && (
        <div className={panel}>
          <ProfileForm initial={ctx.profile} />
        </div>
      )}
      {tab === "localisation" && (
        <div className={panel}>
          <LocationCard status={await getLocationStatus(ctx)} />
        </div>
      )}
      {tab === "equipements" && <EquipmentTab ctx={ctx} />}
      {tab === "home-assistant" && <HomeAssistantTab ctx={ctx} />}
      {tab === "postes" && <CategoriesTab ctx={ctx} />}
      {tab === "appareils" && <AppliancesTab ctx={ctx} />}
      {tab === "vue-ensemble" && (
        <div className={panel}>
          <OverviewBlocksCard
            hidden={overviewHidden(ctx)}
            applicable={await overviewBlocksFor(ctx)}
          />
        </div>
      )}
      {tab === "alertes" && (
        <div className={panel}>
          <AlertsSettingsCard
            initial={alertSettings(ctx)}
            email={mailConfigured()}
            visible={[
              ...(p.pellet || p.wood ? (["fuelStock"] as const) : []),
              "haSilent",
              ...(p.solar ? (["solarYield"] as const) : []),
              "budget",
              "marketOffer",
            ]}
          />
        </div>
      )}
      {tab === "donnees" && (
        <DataTab ctx={ctx} metric={one(params.compteur)} day={one(params.jour)} />
      )}
      {tab === "historique" && <HistoryTab ctx={ctx} />}
    </>
  );
}
