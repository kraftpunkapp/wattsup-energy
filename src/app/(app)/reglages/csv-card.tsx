"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Badge, button, Card, CardFooter, Icon, Notice, StatTile } from "@/components/ui";
import {
  CSV_LIMITS,
  csvWindow,
  isCsvHeader,
  parseCsvLine,
  type CsvLineResult,
} from "@/domain/ingest/csv";
import { localParts } from "@/lib/time";
import { formatNumber } from "@/lib/format";
import type { CsvReport } from "@/server/csv/import";

type Granularity = "hourly" | "daily";

interface PreviewLine {
  line: number;
  content: string;
  result: CsvLineResult;
}

type Phase =
  | { step: "idle" }
  | { step: "ready"; file: File; preview: PreviewLine[] }
  | { step: "sending"; file: File; sent: number; lines: number }
  | { step: "done"; file: File; report: CsvReport }
  | { step: "failed"; message: string };

const mb = (bytes: number) =>
  `${(bytes / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

/** Aperçu : les 10 premières lignes de données, analysées comme à l'import. */
async function previewOf(file: File, ctx: Parameters<typeof parseCsvLine>[1]) {
  const head = await file.slice(0, 64 * 1024).text();
  const out: PreviewLine[] = [];
  head.split("\n").some((raw, i) => {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "" || (i === 0 && isCsvHeader(line))) return false;
    out.push({ line: i + 1, content: line, result: parseCsvLine(line, ctx) });
    return out.length >= 10;
  });
  return out;
}

/** Rapport téléchargeable : une ligne par rejet (numéro, contenu, motif). */
function downloadReport(report: CsvReport, fileName: string) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const body = [
    "ligne,contenu,motif",
    ...report.errors.map((e) => `${e.line},${escape(e.content)},${escape(e.message)}`),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `rapport-${fileName.replace(/\.csv$/i, "")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Envoi en flux et lecture de la réponse NDJSON (progression puis rapport). */
function upload(file: File, onProgress: (sent: number, lines: number) => void) {
  return new Promise<CsvReport>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let read = 0;
    let lines = 0;
    let sent = 0;
    let report: CsvReport | null = null;
    let error: string | null = null;
    const consume = () => {
      const text = xhr.responseText;
      const end = text.lastIndexOf("\n");
      if (end < read) return;
      for (const raw of text.slice(read, end).split("\n")) {
        if (!raw) continue;
        const event = JSON.parse(raw) as
          | { type: "progress"; lines: number }
          | { type: "report"; report: CsvReport }
          | { type: "error"; error: string };
        if (event.type === "progress") lines = event.lines;
        else if (event.type === "report") report = event.report;
        else error = event.error;
      }
      read = end + 1;
      onProgress(sent, lines);
    };
    xhr.open("POST", "/api/csv-import");
    xhr.setRequestHeader("content-type", "text/csv");
    xhr.upload.onprogress = (e) => {
      sent = e.loaded;
      onProgress(sent, lines);
    };
    xhr.onprogress = consume;
    xhr.onload = () => {
      if (xhr.status !== 200) {
        const body = JSON.parse(xhr.responseText || "{}") as { error?: string };
        return reject(new Error(body.error ?? "import refusé"));
      }
      consume();
      if (report) resolve(report);
      else reject(new Error(error ?? "import interrompu : réessayez"));
    };
    xhr.onerror = () => reject(new Error("connexion perdue pendant l'envoi"));
    xhr.send(file);
  });
}

export function CsvCard({
  granularity,
  slugs,
  timezone,
}: {
  granularity: Granularity;
  slugs: string[];
  /** Fuseau du foyer : celui de l'import (heures sans décalage, jours). */
  timezone: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [dragging, setDragging] = useState(false);
  const ctx = {
    timezone,
    granularity,
    slugs,
    window: csvWindow(localParts(new Date(), timezone).date, timezone),
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > CSV_LIMITS.bytes) {
      setPhase({ step: "failed", message: `${file.name} pèse ${mb(file.size)} : 20 Mo au plus.` });
      return;
    }
    setPhase({ step: "ready", file, preview: await previewOf(file, ctx) });
  };

  const start = (file: File) => {
    setPhase({ step: "sending", file, sent: 0, lines: 0 });
    upload(file, (sent, lines) => setPhase({ step: "sending", file, sent, lines }))
      .then((report) => {
        setPhase({ step: "done", file, report });
        router.refresh();
      })
      .catch((err: Error) => setPhase({ step: "failed", message: err.message }));
  };

  const reset = () => {
    setPhase({ step: "idle" });
    if (input.current) input.current.value = "";
  };

  const example =
    granularity === "hourly"
      ? "timestamp,metric,kwh\n2024-01-01T00:00:00+01:00,grid_import,0.412\n2024-01-01T00:00:00+01:00,solar_production,0"
      : "timestamp,metric,kwh,tariff_slot\n2024-01-01,grid_import,6.82,hp\n2024-01-01,grid_import,3.10,hc";

  return (
    <Card
      icon="upload"
      title="Import de l'historique (CSV)"
      badges={<Badge>{granularity === "hourly" ? "lignes horaires" : "lignes quotidiennes"}</Badge>}
      description="Pour remplir le passé avant la connexion de Home Assistant. Une donnée déjà reçue de Home Assistant n'est jamais remplacée."
    >
      <details className="rounded-control bg-bg px-3 py-2.5 text-xs text-muted">
        <summary className="cursor-pointer font-medium text-ink">Format attendu</summary>
        <div className="flex flex-col gap-2 pt-2 text-pretty">
          <p>
            Une ligne par {granularity === "hourly" ? "heure" : "jour"} et par métrique, valeurs en
            kWh consommés ou produits sur cette période (pas des index de compteur), point décimal.
            En-tête facultatif.
          </p>
          <pre className="overflow-x-auto rounded-[8px] bg-surface px-3 py-2 font-mono text-[11px] text-ink">
            {example}
          </pre>
          <p>
            Métriques : <span className="font-mono">grid_import</span>,{" "}
            <span className="font-mono">grid_export</span>,{" "}
            <span className="font-mono">solar_production</span>,{" "}
            <span className="font-mono">battery_charge</span>,{" "}
            <span className="font-mono">battery_charge_grid</span>,{" "}
            <span className="font-mono">battery_discharge</span>
            {slugs.length > 0 && (
              <>
                , et vos postes :{" "}
                {slugs.map((s, i) => (
                  <span key={s}>
                    {i > 0 && ", "}
                    <span className="font-mono">category:{s}</span>
                  </span>
                ))}
              </>
            )}
            .{" "}
            {granularity === "daily" &&
              "La colonne tariff_slot (hp ou hc) sert à l'import réseau en heures pleines et creuses."}
          </p>
          <p>
            Limites : 20 Mo et 500 000 lignes par fichier, données des 10 dernières années, 10
            imports par heure.
          </p>
        </div>
      </details>

      {phase.step === "idle" || phase.step === "failed" ? (
        <>
          {phase.step === "failed" && <Notice title="Import impossible :">{phase.message}</Notice>}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void choose(e.dataTransfer.files[0]);
            }}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-control border border-dashed px-4 py-6 text-center text-[13px] ${
              dragging ? "border-accent bg-track" : "border-dash hover:bg-bg"
            }`}
          >
            <Icon name="upload" size={20} />
            <span>
              <span className="font-medium">Choisir un fichier CSV</span> ou le déposer ici
            </span>
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => void choose(e.target.files?.[0])}
            />
          </label>
        </>
      ) : null}

      {phase.step === "ready" && (
        <>
          <p className="text-[13px]">
            <span className="font-medium">{phase.file.name}</span>{" "}
            <span className="text-subtle">· {mb(phase.file.size)}</span>
          </p>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-muted">Aperçu des 10 premières lignes</span>
            <ol className="flex flex-col rounded-control border border-border">
              {phase.preview.map((p) => (
                <li
                  key={p.line}
                  className="flex flex-col gap-0.5 border-t border-track px-3 py-2 first:border-t-0"
                >
                  <span className="flex min-w-0 gap-2 text-xs">
                    <span className="flex-none text-subtle tabular-nums">{p.line}</span>
                    <span className="truncate font-mono text-[11px]">{p.content}</span>
                  </span>
                  <span
                    className={`pl-5 text-[11px] ${p.result.ok ? "text-positive" : "text-negative"}`}
                  >
                    {p.result.ok ? "valide" : p.result.error}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          {phase.preview.length === 0 && (
            <Notice title="Aucune ligne de données">trouvée au début du fichier.</Notice>
          )}
          <CardFooter>
            <button type="button" onClick={reset} className={`${button.link} mr-auto`}>
              Choisir un autre fichier
            </button>
            <button
              type="button"
              disabled={phase.preview.length === 0}
              onClick={() => start(phase.file)}
              className={button.primary}
            >
              <Icon name="upload" size={14} />
              Importer
            </button>
          </CardFooter>
        </>
      )}

      {phase.step === "sending" && (
        <div className="flex flex-col gap-2" role="status">
          <div className="h-2 overflow-hidden rounded-full bg-track">
            <div
              className="h-2 rounded-full bg-accent transition-[width]"
              style={{ width: `${Math.min(100, (phase.sent / phase.file.size) * 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted tabular-nums">
            {phase.sent < phase.file.size
              ? `Envoi de ${phase.file.name} : ${mb(phase.sent)} sur ${mb(phase.file.size)}`
              : "Fichier envoyé, enregistrement en cours"}
            {phase.lines > 0 && ` · ${formatNumber(phase.lines)} lignes traitées`}
          </span>
        </div>
      )}

      {phase.step === "done" && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-2">
            <StatTile
              label="Importées"
              value={formatNumber(phase.report.imported)}
              unit="intervalles"
              dot="bg-battery"
            />
            <StatTile
              label="Gardées de HA"
              value={formatNumber(phase.report.keptHa)}
              unit="lignes"
              dot="bg-grid"
            />
            <StatTile
              label="Rejetées"
              value={formatNumber(phase.report.rejected)}
              unit="lignes"
              dot={phase.report.rejected > 0 ? "bg-eheat" : undefined}
            />
          </div>
          {phase.report.duplicates > 0 && (
            <p className="text-xs text-muted">
              {formatNumber(phase.report.duplicates)} ligne
              {phase.report.duplicates > 1 ? "s" : ""} en double : la dernière valeur a été gardée.
            </p>
          )}
          {phase.report.stopped && <Notice title="Import arrêté :">{phase.report.stopped}.</Notice>}
          {phase.report.rejected > 0 && (
            <Notice
              title={`${formatNumber(phase.report.rejected)} ligne${phase.report.rejected > 1 ? "s" : ""} rejetée${phase.report.rejected > 1 ? "s" : ""}.`}
              action={
                <button
                  type="button"
                  className={button.secondary}
                  onClick={() => downloadReport(phase.report, phase.file.name)}
                >
                  <Icon name="download" size={14} />
                  Télécharger le rapport
                </button>
              }
            >
              Premier motif : ligne {phase.report.errors[0]?.line},{" "}
              {phase.report.errors[0]?.message}.
            </Notice>
          )}
          <CardFooter>
            <button type="button" onClick={reset} className={`${button.secondary} ml-auto`}>
              Importer un autre fichier
            </button>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
