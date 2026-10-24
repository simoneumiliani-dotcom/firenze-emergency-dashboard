import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CloudSun,
  Database,
  ExternalLink,
  LayoutDashboard,
  Radio,
  Waves
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PageLayout from "@/components/PageLayout";
import RadarLiveFeed from "@/components/RadarLiveFeed";
import { buildHydrometrySourceMatrix } from "@/lib/hydrometrySources";

// Pagina di consultazione, non presente nella navigazione principale: raccoglie
// le fonti e i link di download che prima stavano dentro le singole schede.
export const metadata = {
  title: "Fonti e aggiornamenti",
  description: "Elenco delle fonti dati, dei download ufficiali e degli aggiornamenti live della dashboard.",
  robots: { index: false, follow: false }
};

const SECTIONS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "allerte", label: "Allerte" },
  { id: "previsioni", label: "Previsioni" },
  { id: "idrometria", label: "Idrometria" },
  { id: "webcam", label: "Webcam" }
];

const RADAR_LINKS = [
  { label: "Portale radar DPC", href: "https://radar.protezionecivile.gov.it/" },
  { label: "WMS capabilities", href: "https://radar-geowebcache.protezionecivile.it/service/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=getcapabilities&TILED=true" },
  { label: "REST ultimo dato (VMI)", href: "https://radar-api.protezionecivile.it/findLastProductByType?type=VMI" },
  { label: "Docs servizi WMS", href: "https://dpc-radar.readthedocs.io/it/latest/services.html" },
  { label: "Docs REST", href: "https://dpc-radar.readthedocs.io/it/latest/api.html" }
];

const DASHBOARD_SOURCES = [
  {
    source: "Open-Meteo",
    content: "Previsioni orarie e giornaliere, temperatura, vento, umidità e neve",
    format: "JSON forecast API",
    href: "https://open-meteo.com/en/docs"
  },
  {
    source: "CFR Toscana - Idrometria",
    content: "Livelli idrometrici, soglie e variazioni in tempo reale non validati",
    format: "HTML tabellare / export Excel",
    href: "https://www.cfr.toscana.it/monitoraggio/stazioni.php?type=idro"
  },
  {
    source: "SIR Toscana - Archivio",
    content: "Anagrafica stazioni e serie storiche validate, prevalidate e ricostruite",
    format: "JSON / GeoJSON",
    href: "https://www.sir.toscana.it/archivio/dati.php?D=json_stations"
  }
];

const ALERT_SOURCES = [
  {
    source: "CFR Toscana - Bollettini",
    content: "Bollettini di criticità idraulica e idrogeologica e relativi livelli di allerta",
    format: "PDF",
    href: "https://www.cfr.toscana.it/"
  },
  {
    source: "Protezione Civile - Mappe di criticità",
    content: "Scenari di criticità e avvisi meteo regionali",
    format: "Web / PDF",
    href: "https://mappe.protezionecivile.gov.it/it/"
  },
  {
    source: "Archivio della dashboard",
    content: "Bollettini caricati e validati dall'operatore, con livello e validità estratti dal PDF",
    format: "PDF",
    href: "/allerte"
  }
];

const WEBCAM_SOURCES = [
  {
    source: "SkylineWebcams",
    content: "Anteprime e live delle webcam cittadine, aggiornate dal provider",
    format: "iframe / immagine",
    href: "https://www.skylinewebcams.com/"
  },
  {
    source: "Autostrade per l'Italia",
    content: "Video MP4 diretti delle tratte autostradali",
    format: "MP4",
    href: "https://www.autostrade.it/"
  },
  {
    source: "Pagina Webcam",
    content: "Stato di disponibilità e link alla fonte pubblica di ogni sorgente",
    format: "Pagina interna",
    href: "/webcam"
  }
];

const LINK_BUTTON = "inline-flex min-h-10 items-center gap-2 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/20";
const LINK_BUTTON_MUTED = "inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-500/40 bg-slate-500/10 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-slate-500/20";

function SectionHeading({ icon: Icon, title, description, id }) {
  return (
    <div id={id} className="flex scroll-mt-24 items-center gap-3 border-b border-emergency-line px-4 py-3">
      <Icon className="h-5 w-5 text-sky-300" />
      <div>
        <h2 className="section-title">{title}</h2>
        <p className="muted">{description}</p>
      </div>
    </div>
  );
}

function SourceTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-emergency-line text-sm">
        <thead className="bg-emergency-panel2 text-left text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-3">Fonte</th>
            <th className="px-4 py-3">Contenuto</th>
            <th className="px-4 py-3">Formato</th>
            <th className="px-4 py-3">Riferimento</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-emergency-line">
          {rows.map((row) => (
            <tr key={row.source}>
              <td className="px-4 py-3 font-medium text-slate-100">{row.source}</td>
              <td className="px-4 py-3 text-slate-300">{row.content}</td>
              <td className="px-4 py-3 text-sky-100">{row.format}</td>
              <td className="px-4 py-3 text-slate-400">
                <a
                  href={row.href}
                  target={row.href.startsWith("/") ? undefined : "_blank"}
                  rel={row.href.startsWith("/") ? undefined : "noreferrer"}
                  className="inline-flex min-h-11 items-center gap-1 underline decoration-sky-400/50 underline-offset-2 hover:text-sky-100"
                >
                  Apri fonte
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HydrometrySourceTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-emergency-line text-sm">
        <thead className="bg-emergency-panel2 text-left text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-4 py-3">Fonte</th>
            <th className="px-4 py-3">Contenuto</th>
            <th className="px-4 py-3">Formato</th>
            <th className="px-4 py-3">Uso applicativo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-emergency-line">
          {rows.map((row) => (
            <tr key={row.source}>
              <td className="px-4 py-3 font-medium text-slate-100">{row.source}</td>
              <td className="px-4 py-3 text-slate-300">{row.content}</td>
              <td className="px-4 py-3 text-sky-100">{row.format}</td>
              <td className="px-4 py-3 text-slate-400">{row.applicationUse}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FontiPage() {
  const hydrometrySources = buildHydrometrySourceMatrix();

  return (
    <PageLayout>
      <PageHeader
        eyebrow="Documentazione"
        title="Fonti e aggiornamenti"
        description="Riferimenti ufficiali, download e canali di aggiornamento raccolti per scheda: dashboard, allerte, previsioni, idrometria e webcam."
      >
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-emergency-line bg-emergency-panel px-4 text-sm font-medium text-slate-200 transition hover:bg-white/[0.04]">
          <ArrowLeft className="h-4 w-4" />
          Torna alla dashboard
        </Link>
      </PageHeader>

      <nav aria-label="Sezioni della pagina" className="flex flex-wrap gap-2 text-sm">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={"#" + section.id}
            className="inline-flex min-h-11 items-center rounded-md border border-emergency-line bg-emergency-panel px-3 text-slate-300 hover:text-white"
          >
            {section.label}
          </a>
        ))}
      </nav>

      <section className="panel overflow-hidden">
        <SectionHeading
          id="dashboard"
          icon={LayoutDashboard}
          title="Dashboard"
          description="Fonti osservate per meteo e idrometria in tempo reale."
        />
        <SourceTable rows={DASHBOARD_SOURCES} />
        <div className="flex flex-wrap gap-2 border-t border-emergency-line px-4 py-3">
          <Link href="/" className={LINK_BUTTON_MUTED}>
            Apri Dashboard
          </Link>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <SectionHeading
          id="allerte"
          icon={AlertTriangle}
          title="Allerte"
          description="Bollettini di criticità, avvisi e archivio validato dalla dashboard."
        />
        <div className="border-b border-emergency-line bg-emergency-panel2 px-4 py-3 text-sm leading-6 text-slate-400">
          Il livello mostrato dipende dal bollettino più recente ancora valido: in assenza di bollettini validi la
          pagina non stima un livello. I PDF caricati restano consultabili nell&apos;archivio della scheda Allerte.
        </div>
        <SourceTable rows={ALERT_SOURCES} />
        <div className="flex flex-wrap gap-2 border-t border-emergency-line px-4 py-3">
          <a href="https://www.cfr.toscana.it/monitoraggio/stazioni.php?type=idro" target="_blank" rel="noreferrer" className={LINK_BUTTON}>
            Monitoraggio CFR Toscana
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <Link href="/allerte" className={LINK_BUTTON_MUTED}>
            Apri Allerte
          </Link>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <SectionHeading
          id="previsioni"
          icon={CloudSun}
          title="Previsioni"
          description="Meteo, radar DPC e aggiornamenti live del servizio radar."
        />
        <div className="flex flex-wrap gap-2 border-b border-emergency-line px-4 py-3">
          {RADAR_LINKS.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className={LINK_BUTTON}>
              {link.label}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ))}
        </div>
        <div className="space-y-3 px-4 py-4 text-sm leading-6 text-slate-400">
          <p>
            Le mappe radar usano le tile WebP ufficiali del tile cache DPC; l&apos;API REST fornisce l&apos;ultimo
            campione disponibile per ogni prodotto. Quando DPC pubblica un GeoTIFF grezzo, il link di download
            compare direttamente nella scheda radar della pagina Previsioni.
          </p>
          <p>
            <span className="font-semibold text-slate-200">Prodotti solo REST/download.</span> POH, VIL ed ETM non
            hanno tile raster nel cache WebP ufficiale: restano consultabili come dati grezzi e non vengono
            sovrapposti alla mappa.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer" className={LINK_BUTTON_MUTED}>
              Documentazione Open-Meteo
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Link href="/previsioni" className={LINK_BUTTON_MUTED}>
              Apri Previsioni
            </Link>
          </div>
        </div>
      </section>

      <RadarLiveFeed />

      <section className="panel overflow-hidden">
        <SectionHeading
          id="idrometria"
          icon={Waves}
          title="Idrometria"
          description="Fonti ufficiali per anagrafica, serie storiche e realtime CFR."
        />
        <HydrometrySourceTable rows={hydrometrySources} />
        <div className="flex flex-wrap gap-2 border-t border-emergency-line px-4 py-3">
          <a href="https://dati.toscana.it/dataset/idrometri" target="_blank" rel="noreferrer" className={LINK_BUTTON}>
            OpenData Idrometri
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a href="https://www.cfr.toscana.it/monitoraggio/stazioni.php?type=idro" target="_blank" rel="noreferrer" className={LINK_BUTTON}>
            CFR Toscana realtime
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <Link href="/idrometria" className={LINK_BUTTON_MUTED}>
            Apri Idrometria
          </Link>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <SectionHeading
          id="webcam"
          icon={Camera}
          title="Webcam"
          description="Provider delle immagini e dei video incorporati nella scheda Webcam."
        />
        <div className="border-b border-emergency-line bg-emergency-panel2 px-4 py-3 text-sm leading-6 text-slate-400">
          La pagina supporta immagini SkylineWebcams e video MP4 diretti Autostrade: quando una sorgente non espone
          stream incorporabili, resta disponibile il link alla fonte pubblica.
        </div>
        <SourceTable rows={WEBCAM_SOURCES} />
      </section>

      <section className="panel p-4 text-sm text-slate-400">
        <div className="flex items-start gap-3">
          <Database className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
          <p>
            Questa pagina è di sola consultazione e non è collegata alla navigazione principale. I dati mostrati
            nelle altre schede restano quelli delle fonti indicate, aggiornati con le rispettive cadenze.
          </p>
        </div>
      </section>

      <footer className="flex flex-wrap items-center gap-2 pb-6 text-xs text-slate-500">
        <Radio className="h-3.5 w-3.5" />
        <span>Ultimo controllo delle fonti effettuato sulla documentazione ufficiale dei servizi elencati.</span>
      </footer>
    </PageLayout>
  );
}
