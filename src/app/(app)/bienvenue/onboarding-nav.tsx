"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { button } from "@/components/ui";
import { finishOnboardingAction, saveOnboardingStepAction } from "@/server/actions/onboarding";
import { STEPS } from "./steps";

/** Étapes cliquables, Précédent / Suivant, « Passer » et « Terminer ». */
export function OnboardingNav({ step, position }: { step: number; position: "top" | "bottom" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = (target: number) =>
    startTransition(async () => {
      await saveOnboardingStepAction(target);
      router.push(`/bienvenue?etape=${target + 1}`);
    });
  const finish = () => startTransition(() => finishOnboardingAction());
  const last = step === STEPS.length - 1;

  if (position === "top") {
    return (
      <ol className="flex gap-1.5" aria-label="Étapes">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex-1">
            <button
              type="button"
              onClick={() => go(i)}
              aria-current={i === step ? "step" : undefined}
              className="flex w-full flex-col gap-1.5 text-left"
            >
              <span className={`h-1.5 rounded-full ${i <= step ? "bg-accent" : "bg-track"}`} />
              <span
                className={`hidden text-[11px] sm:block ${i === step ? "font-semibold text-ink" : "text-muted"}`}
              >
                {i + 1}. {s.title}
              </span>
            </button>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {step > 0 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => go(step - 1)}
          className={button.secondary}
        >
          Précédent
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={finish}
        className={`${button.link} mr-auto px-2`}
      >
        Passer l&apos;accueil
      </button>
      {last ? (
        <button type="button" disabled={pending} onClick={finish} className={button.primary}>
          Terminer
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => go(step + 1)}
          className={button.primary}
        >
          Suivant
        </button>
      )}
    </div>
  );
}
