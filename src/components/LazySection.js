"use client";

import { useEffect, useRef, useState } from "react";

// Monta i contenuti pesanti (mappa, radar) solo quando si avvicinano alla
// viewport: su telefono evita di scaricare tile e moduli prima del necessario.
export default function LazySection({ children, minHeight = "24rem", label = "Caricamento…", className = "" }) {
  const containerRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "300px 0px" });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className={className} style={visible ? undefined : { minHeight }}>
      {visible ? children : (
        <div
          className="flex h-full w-full items-center justify-center rounded-lg border border-emergency-line bg-emergency-panel text-sm text-slate-400"
          style={{ minHeight }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
