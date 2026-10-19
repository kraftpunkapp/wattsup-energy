import { headers } from "next/headers";
import { PageHeader } from "@/components/page-header";
import { localParts } from "@/lib/time";
import { listCategories } from "@/server/categories";
import { listContracts } from "@/server/contracts";
import { getLastPushAt } from "@/server/ingest/status";
import { getActiveIngestToken } from "@/server/ingest/token";
import { getLocationStatus } from "@/server/location";
import { pageContext } from "@/server/page";
import { pushState } from "@/domain/ingest/push-state";
import { getPaymentAnalysis } from "@/server/queries/contracts";
import { ContractsManager } from "../contrats/contracts-manager";
import { toContractItems } from "../contrats/items";
import { CsvCard } from "../reglages/csv-card";
import { IngestCard } from "../reglages/ingest-card";
import { LocationCard } from "../reglages/location-card";
import { ProfileForm } from "../reglages/profile-form";
import { HomeAssistantStep } from "./home-assistant-step";
import { OnboardingNav } from "./onboarding-nav";
import { STEPS } from "./steps";

export const metadata = { title: "Bienvenue · WattsUp Energy" };

/** Parcours de bienvenue (T31) : une étape à la fois, reprise là où on l'a laissé. */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ etape?: string | string[] }>;
}) {
  const ctx = await pageContext("/bienvenue");
  const { etape } = await searchParams;
  const requested = Number(etape) - 1;
  const step =
    Number.isInteger(requested) && requested >= 0 && requested < STEPS.length
      ? requested
      : Math.min(ctx.onboarding.step, STEPS.length - 1);
  const current = STEPS[step] ?? STEPS[0];

  let content: React.ReactNode = null;
  if (step === 0) content = <ProfileForm initial={ctx.profile} />;
  if (step === 1) content = <LocationCard status={await getLocationStatus(ctx)} />;
  if (step === 2) {
    const today = localParts(new Date(), ctx.timezone).date;
    const [contracts, payment] = await Promise.all([listContracts(ctx), getPaymentAnalysis(ctx)]);
    content = (
      <ContractsManager
        contracts={toContractItems(contracts, today)}
        today={today}
        paymentAnalysis={payment?.analysis ?? null}
      />
    );
  }
  if (step === 3) {
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
    const [active, lastPushAt] = await Promise.all([getActiveIngestToken(ctx), getLastPushAt(ctx)]);
    content = (
      <>
        <IngestCard
          endpoint={`${origin}/api/v1/ingest`}
          granularity={ctx.granularity}
          lastPushAt={lastPushAt?.toISOString() ?? null}
          link={pushState(lastPushAt?.getTime() ?? null, Date.now(), ctx.granularity)}
          active={active && { prefix: active.prefix, createdAt: active.createdAt.toISOString() }}
        />
        <HomeAssistantStep
          blueprintUrl={`${origin}/api/blueprint/wattsup_push.yaml`}
          initialLastPush={lastPushAt?.toISOString() ?? null}
        />
      </>
    );
  }
  if (step === 4) {
    const categories = await listCategories(ctx);
    content = (
      <CsvCard
        granularity={ctx.granularity}
        timezone={ctx.timezone}
        slugs={categories.map((c) => c.slug)}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Bienvenue dans WattsUp"
        subtitle={`Étape ${step + 1} sur ${STEPS.length} · ${current.title}`}
      />
      <OnboardingNav step={step} position="top" />
      <p className="text-[13px] text-muted text-pretty">{current.description}</p>
      <div className="flex max-w-2xl flex-col gap-4">{content}</div>
      <div className="max-w-2xl">
        <OnboardingNav step={step} position="bottom" />
      </div>
    </>
  );
}
