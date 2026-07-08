"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Camera, CloudSun, LayoutDashboard, Waves } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/previsioni", label: "Previsioni", icon: CloudSun },
  { href: "/idrometria", label: "Idrometria", icon: Waves },
  { href: "/webcam", label: "Webcam", icon: Camera }
];

export default function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-40 border-b border-emergency-line bg-emergency-ink/92 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-3 py-3 sm:px-5 md:flex-row md:items-center md:justify-between lg:px-8">
        <Link href="/" className="inline-flex items-center gap-2 text-slate-100">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-400/40 bg-sky-400/10">
            <BarChart3 className="h-5 w-5 text-sky-200" />
          </span>
          <span>
            <span className="block text-sm font-semibold leading-tight">Meteo Firenze</span>
            <span className="block text-xs text-slate-400">Monitoraggio e scenari</span>
          </span>
        </Link>

        <div className="grid grid-cols-2 gap-2 rounded-lg border border-emergency-line bg-emergency-panel p-1 text-sm sm:grid-cols-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            const className = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 font-medium transition " +
              (active
                ? "bg-sky-400/15 text-sky-100 ring-1 ring-sky-400/40"
                : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100");

            return (
              <Link key={item.href} href={item.href} className={className}>
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
