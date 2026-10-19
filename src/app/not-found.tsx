import Link from "next/link";
import { button } from "@/components/ui";

// Adresse inconnue (T60) : en français, avec un chemin de retour.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-full max-w-[520px] items-center px-4 py-12">
      <section className="flex w-full flex-col gap-4 rounded-card border border-border bg-surface p-6 text-[13px]">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold">Page introuvable</h1>
          <p className="text-pretty text-ink-soft">
            Cette adresse ne correspond à aucune page de WattsUp Energy : le lien est peut-être
            ancien ou incomplet.
          </p>
        </div>
        <Link href="/" className={`${button.primary} self-start no-underline`}>
          Retour à la vue d&apos;ensemble
        </Link>
      </section>
    </main>
  );
}
