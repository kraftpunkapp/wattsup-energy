import { localParts } from "@/lib/time";
import { emailAlertsForAll } from "./alerts";
import { pruneIngestLog } from "./ingest/persist";
import { mailConfigured } from "./mail";
import { GitHubOfferSource } from "./market/source";
import { marketSyncEnabled, syncMarket } from "./market/sync";
import { pushAlertsForAll, pushConfigured } from "./push";
import { CommunityTempoSource } from "./tempo/community";
import { loadTempoSeed, syncTempo, tempoSyncEnabled } from "./tempo/sync";
import { OpenMeteoSource } from "./weather/open-meteo";
import { syncRecentWeather, weatherSyncEnabled } from "./weather/sync";

// Tâches quotidiennes exécutées dans le processus serveur (instance unique en V1) : rien
// à configurer côté Coolify ni en auto-hébergement. Chaque tâche tourne au démarrage
// (rattrapage), puis une fois par créneau horaire (heure de Paris) : au premier passage
// du planificateur après l'heure prévue.

interface Job {
  name: string;
  /** Créneaux quotidiens "HH:MM", heure de Paris. */
  at: string[];
  enabled: () => boolean;
  run: () => Promise<string>;
}

const JOBS: Job[] = [
  {
    name: "journal",
    at: ["03:00"],
    enabled: () => true,
    run: async () => `${await pruneIngestLog()} envois de plus de 30 jours supprimés`,
  },
  {
    name: "météo",
    at: ["07:00"],
    enabled: weatherSyncEnabled,
    run: async () => {
      const { cells, failed } = await syncRecentWeather(new OpenMeteoSource());
      return `${cells - failed.length}/${cells} mailles`;
    },
  },
  {
    name: "tempo",
    at: ["11:30", "17:00"], // la couleur du lendemain est publiée vers 11 h
    enabled: tempoSyncEnabled,
    run: async () => {
      await loadTempoSeed();
      const { days, failed } = await syncTempo(new CommunityTempoSource());
      return `${days} jours${failed.length ? `, saisons en échec : ${failed.join(", ")}` : ""}`;
    },
  },
  {
    // Catalogue des offres du marché : une requête si la source n'a pas changé.
    name: "offres",
    at: ["04:00"],
    enabled: marketSyncEnabled,
    run: async () => {
      const r = await syncMarket(new GitHubOfferSource());
      if (r.status === "error") throw new Error(r.error);
      if (r.status === "unchanged") return `catalogue inchangé (${r.commit.slice(0, 7)})`;
      return `${r.offers} offres, ${r.compared} comparées (+${r.added.length} −${r.removed.length} ~${r.updated.length})`;
    },
  },
  {
    // Alertes par email et en push : toutes les heures (une alerte n'est envoyée qu'une fois
    // par niveau et par canal).
    name: "alertes",
    at: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:20`),
    enabled: () => (mailConfigured() && Boolean(process.env.BETTER_AUTH_URL)) || pushConfigured(),
    run: async () => {
      const origin = process.env.BETTER_AUTH_URL;
      const email = mailConfigured() && origin ? await emailAlertsForAll(origin) : null;
      const push = await pushAlertsForAll();
      return [
        email && `email : ${email.sent} alerte(s), ${email.households} foyer(s)`,
        `push : ${push.sent} alerte(s), ${push.households} foyer(s)`,
      ]
        .filter(Boolean)
        .join(" ; ");
    },
  },
];

const TICK_MS = 5 * 60_000;
const done = new Set<string>();
let started = false;

async function runJob(job: Job, reason: string) {
  try {
    console.log(`[wattsup] ${job.name} (${reason}) : ${await job.run()}`);
  } catch (err) {
    console.error(`[wattsup] ${job.name} : échec`, err);
  }
}

/** Créneaux échus aujourd'hui et pas encore exécutés (exporté pour les tests). */
export function dueSlots(jobs: readonly Job[], now: Date, alreadyDone: ReadonlySet<string>) {
  const local = localParts(now, "Europe/Paris");
  const hm = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
  return jobs.flatMap((job) =>
    job.at
      .filter((slot) => slot <= hm && !alreadyDone.has(`${job.name}@${local.date}@${slot}`))
      .map((slot) => ({ job, key: `${job.name}@${local.date}@${slot}` })),
  );
}

async function tick() {
  for (const { job, key } of dueSlots(JOBS, new Date(), done)) {
    done.add(key);
    if (job.enabled()) await runJob(job, "quotidienne");
  }
}

export function startScheduler(): void {
  if (started) return;
  started = true;
  // Au démarrage : rattrapage, et les créneaux déjà passés aujourd'hui sont considérés faits.
  for (const { key } of dueSlots(JOBS, new Date(), done)) done.add(key);
  for (const job of JOBS) if (job.enabled()) void runJob(job, "démarrage");
  setInterval(() => void tick(), TICK_MS).unref();
}
