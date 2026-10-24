// Intestazione comune: occhiello, titolo, descrizione e uno slot a destra per
// il dato che conta in quella pagina (livello di allerta, coordinate, conteggi).
export default function PageHeader({ eyebrow, title, description, children }) {
  return (
    <header className="panel flex flex-col gap-4 p-4 shadow-glow sm:p-5 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex w-full flex-col gap-2 md:w-auto md:shrink-0">{children}</div> : null}
    </header>
  );
}
