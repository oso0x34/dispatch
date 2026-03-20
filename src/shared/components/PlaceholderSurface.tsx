type PlaceholderSurfaceProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function PlaceholderSurface({
  eyebrow,
  title,
  description,
}: PlaceholderSurfaceProps) {
  return (
    <section className="dispatch-surface rounded-[24px] p-6 sm:p-7">
      <p className="dispatch-eyebrow text-xs font-semibold uppercase tracking-[0.28em]">
        {eyebrow}
      </p>

      <h2 className="mt-4 max-w-3xl text-2xl font-semibold tracking-tight sm:text-[2rem]">
        {title}
      </h2>

      <p className="mt-4 max-w-2xl text-sm leading-7 sm:text-[0.95rem]">
        {description}
      </p>
    </section>
  );
}
