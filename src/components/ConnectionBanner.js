"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export default function ConnectionBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-2 border-t border-emergency-orange/50 bg-emergency-ink/95 px-4 py-2 text-center text-xs text-orange-100 backdrop-blur"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      Sei offline: stai vedendo gli ultimi dati ricevuti.
    </div>
  );
}
