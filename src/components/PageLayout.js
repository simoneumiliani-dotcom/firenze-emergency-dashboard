import AppNav from "@/components/AppNav";

// Contenitore comune a tutte le pagine: navigazione, larghezza massima e
// spaziatura verticale restano identiche, cambia solo il contenuto.
export default function PageLayout({ children }) {
  return (
    <>
      <a
        href="#contenuto"
        className="absolute left-3 top-3 z-50 -translate-y-24 rounded-md bg-sky-400 px-4 py-3 text-sm font-semibold text-emergency-ink shadow-glow transition-transform focus:translate-y-0"
      >
        Salta al contenuto
      </a>
      <AppNav />
      <main id="contenuto" tabIndex={-1} className="min-h-screen px-3 py-4 sm:px-5 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">{children}</div>
      </main>
    </>
  );
}
