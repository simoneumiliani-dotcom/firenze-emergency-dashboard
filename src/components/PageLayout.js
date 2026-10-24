import AppNav from "@/components/AppNav";

// Contenitore comune a tutte le pagine: navigazione, larghezza massima e
// spaziatura verticale restano identiche, cambia solo il contenuto.
export default function PageLayout({ children }) {
  return (
    <>
      <AppNav />
      <main className="min-h-screen px-3 py-4 sm:px-5 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">{children}</div>
      </main>
    </>
  );
}
