// KV REST di sviluppo: implementa solo /get/:key e /pipeline (SET), le due
// chiamate usate da src/lib/bulletinArchive.js. Serve a provare in locale
// l'archivio condiviso dei bollettini senza credenziali Upstash/Vercel.
// I dati vivono in memoria: si perdono alla chiusura del processo.
//
//   node scripts/dev-kv-stub.mjs
//   KV_REST_API_URL=http://127.0.0.1:4010 KV_REST_API_TOKEN=dev npm run dev
//
// Non usare in produzione: nessuna autenticazione e nessuna persistenza.
import { createServer } from "node:http";

const port = Number(process.env.KV_STUB_PORT || 4010);
const store = new Map();

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");

  if (request.method === "GET" && url.pathname.startsWith("/get/")) {
    const key = decodeURIComponent(url.pathname.slice("/get/".length));
    send(response, 200, { result: store.get(key) ?? null });
    return;
  }

  if (request.method === "POST" && url.pathname === "/pipeline") {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    try {
      for (const [command, key, value] of JSON.parse(raw || "[]")) {
        if (command === "SET") store.set(key, value);
        if (command === "DEL") store.delete(key);
      }
      send(response, 200, [{ result: "OK" }]);
    } catch {
      send(response, 400, { error: "payload non valido" });
    }
    return;
  }

  send(response, 404, { error: "not found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log("KV di sviluppo in ascolto su http://127.0.0.1:" + port);
});
