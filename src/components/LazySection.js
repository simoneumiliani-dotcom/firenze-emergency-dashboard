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

    // Margine zero: il contenuto parte solo quando entra davvero in viewport.
    // Con un margine ampio la sezione si montava al primo layout, prima che i
    // dati caricati spostassero la mappa piu' in basso, annullando il risparmio.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "0px", threshold: 0.01 });

    observer.observe(element);

    // Alcuni browser (finestra non in primo piano, webview, risparmio energia)
    // non consegnano le callback dell'observer: senza questa rete di sicurezza
    // la sezione resterebbe sul segnaposto per sempre. Il controllo sul rettangolo
    // allo scroll costa poco e non fa partire nulla prima del necessario.
    const mountIfInView = () => {
      const rect = element.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        setVisible(true);
        observer.disconnect();
        window.removeEventListener("scroll", mountIfInView);
      }
    };

    window.addEventListener("scroll", mountIfInView, { passive: true });
    mountIfInView();

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", mountIfInView);
    };
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
