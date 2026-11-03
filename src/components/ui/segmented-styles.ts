/** Classes partagées : un groupe segmenté, et un segment actif ou non (liens ou boutons). */
export const segmented = {
  group: "inline-flex gap-0.5 rounded-control bg-chip p-[3px]",
  base: "inline-flex min-h-10 min-w-11 items-center justify-center rounded-[9px] px-3.5 text-[13px] font-semibold",
  on: "bg-surface text-ink shadow-sm",
  off: "text-ink-soft hover:text-ink",
  item: (active: boolean) =>
    `inline-flex min-h-10 min-w-11 items-center justify-center rounded-[9px] px-3.5 text-[13px] font-semibold ${
      active ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"
    }`,
};
