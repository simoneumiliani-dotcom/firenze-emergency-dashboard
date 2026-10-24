import Link from "next/link";
import { ArrowRight } from "lucide-react";

// Collegamento contestuale alla sezione di /fonti che corrisponde alla scheda
// aperta: resta discreto nel piè di pagina ma porta sempre alla fonte giusta.
export default function SourcesLink({ section, label = "Fonti e riferimenti" }) {
  return (
    <Link
      href={"/fonti#" + section}
      className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-sky-300 transition hover:text-sky-100"
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}
