import { PageHeader } from "@/components/page-header";
import { visibleModules } from "@/domain/profile";
import type { EquipmentKind } from "@/server/equipment";
import { pageContext } from "@/server/page";
import { getRoi } from "@/server/queries/roi";
import { EquipmentCard } from "./equipment-sheet";
import { RoiDetails } from "./roi-details";
import { RoiSummary } from "./roi-summary";
import { SimulatorCard } from "./simulator-card";

export const metadata = { title: "Rentabilité · WattsUp Energy" };

export default async function RoiPage() {
  const ctx = await pageContext("/rentabilite");
  const modules = visibleModules(ctx.profile);
  const kinds: EquipmentKind[] = [
    ...(modules.solar ? (["solar"] as const) : []),
    ...(modules.battery ? (["battery"] as const) : []),
  ];
  const roi = await getRoi(ctx);
  return (
    <>
      <PageHeader
        title="Rentabilité"
        subtitle="Ce que vos équipements vous ont fait économiser, au prix de vos contrats successifs"
      />
      <RoiSummary view={roi} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-4">
        {kinds.map((kind) => (
          <EquipmentCard key={kind} kind={kind} item={roi.items[kind]?.equipment ?? null}>
            {roi.items[kind] && <RoiDetails roi={roi.items[kind]} view={roi} />}
          </EquipmentCard>
        ))}
      </div>
      <div>
        <SimulatorCard
          hasBattery={Boolean(roi.items.battery)}
          solarKwc={roi.items.solar?.equipment.capacity ?? null}
          exportEnabled={ctx.settings.exportEnabled}
        />
      </div>
    </>
  );
}
