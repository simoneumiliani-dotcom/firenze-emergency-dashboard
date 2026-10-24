"use client";

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";

function formatDateTime(value) {
  if (!value) return "orario non disponibile";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) + " ora " +
    date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function parseDpcWsMessage(data) {
  const text = String(data || "").replace(/\u0000/g, "").trim();
  const jsonStart = text.indexOf("{");
  if (jsonStart === -1) return null;
  try {
    return JSON.parse(text.slice(jsonStart));
  } catch {
    return null;
  }
}

const STATUS_STYLE = {
  connesso: "text-emerald-300",
  errore: "text-emergency-red",
  chiuso: "text-emergency-yellow",
  "non connesso": "text-slate-300"
};

export default function RadarLiveFeed() {
  const [status, setStatus] = useState("non connesso");
  const [events, setEvents] = useState({});

  useEffect(() => {
    let socket = null;
    try {
      socket = new WebSocket("wss://radar-wss.protezionecivile.it");
      socket.onopen = () => {
        setStatus("connesso");
        socket.send("CONNECT\naccept-version:1.2\nheart-beat:10000,10000\n\n\u0000");
        window.setTimeout(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send("SUBSCRIBE\nid:radar-products\ndestination:/topic/product\n\n\u0000");
          }
        }, 300);
      };
      socket.onmessage = (event) => {
        const payload = parseDpcWsMessage(event.data);
        if (!payload?.productType) return;
        setEvents((current) => ({
          ...current,
          [payload.productType]: {
            ...payload,
            receivedAt: new Date().toISOString()
          }
        }));
      };
      socket.onerror = () => setStatus("errore");
      socket.onclose = () => setStatus((current) => (current === "errore" ? current : "chiuso"));
    } catch {
      setStatus("non connesso");
    }
    return () => {
      if (socket) socket.close();
    };
  }, []);

  const keys = Object.keys(events).slice(-8).reverse();

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center gap-3 border-b border-emergency-line px-4 py-3">
        <Radio className="h-5 w-5 text-sky-300" />
        <div>
          <h2 className="section-title">Aggiornamenti live radar</h2>
          <p className="muted">Notifiche WebSocket DPC sui nuovi prodotti radar pubblicati.</p>
        </div>
        <span className={"ml-auto text-xs font-semibold " + (STATUS_STYLE[status] || "text-slate-300")}>
          {status}
        </span>
      </div>
      <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {keys.length ? keys.map((key) => (
          <div key={key} className="rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2 text-xs">
            <p className="font-semibold text-slate-100">{key}</p>
            <p className="mt-1 text-slate-400">{formatDateTime(events[key].time)}</p>
          </div>
        )) : (
          <p className="text-sm leading-6 text-slate-400 sm:col-span-2 xl:col-span-4">
            In attesa di notifiche WebSocket. Le mappe e i prodotti restano comunque disponibili nella pagina
            Previsioni con l&apos;ultimo campione pubblicato dal servizio REST.
          </p>
        )}
      </div>
      <p className="border-t border-emergency-line px-4 py-3 text-xs leading-5 text-slate-500">
        Il canale <span className="font-mono">wss://radar-wss.protezionecivile.it</span> viene aperto solo mentre
        questa pagina è visualizzata. Se il canale non risponde, il radar continua a funzionare tramite tile cache
        WebP e REST.
      </p>
    </section>
  );
}
