import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/bulletins/route";
import { DEFAULT_BULLETIN_PUBLISH_CODE } from "@/lib/bulletinPublishCode";
import {
  isBulletinCurrent,
  mergeBulletins,
  pruneBulletins
} from "@/lib/bulletinDeviceArchive";

const KV_URL = "http://kv.test";
const ARCHIVE_KEY = process.env.BULLETIN_ARCHIVE_KEY || "firenze:bulletins:v1";

// KV finto compatibile con l'API REST usata da src/lib/bulletinArchive.js.
function createKvStub({ failWrites = false } = {}) {
  const store = new Map();
  const fetchMock = vi.fn(async (url, options = {}) => {
    const target = String(url);

    if (target === KV_URL + "/pipeline") {
      if (failWrites) return new Response("errore", { status: 500 });
      for (const [command, key, value] of JSON.parse(options.body || "[]")) {
        if (command === "SET") store.set(key, value);
      }
      return new Response(JSON.stringify([{ result: "OK" }]), { status: 200 });
    }

    if (target.startsWith(KV_URL + "/get/")) {
      const key = decodeURIComponent(target.slice((KV_URL + "/get/").length));
      return new Response(JSON.stringify({ result: store.get(key) ?? null }), { status: 200 });
    }

    throw new Error("URL KV inatteso: " + target);
  });

  return { store, fetchMock };
}

function readArchive(store) {
  const raw = store.get(ARCHIVE_KEY);
  return raw ? JSON.parse(raw) : null;
}

const bulletin = {
  fileName: "bollettino-prova.pdf",
  level: "Giallo",
  matches: ["firenze", "mugello"],
  reason: "Rilevato codice ufficiale Giallo nel bollettino per le aree interessate.",
  validFrom: "2026-11-16T12:00:00.000Z",
  validTo: "2099-11-17T23:00:00.000Z",
  uploadedAt: "2026-11-16T11:00:00.000Z"
};

function postRequest(payload, { token = DEFAULT_BULLETIN_PUBLISH_CODE, origin } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token !== null) headers["x-bulletin-token"] = token;
  if (origin) headers.origin = origin;
  return new Request("http://localhost/api/bulletins", {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
}

function deleteRequest(id, { token = DEFAULT_BULLETIN_PUBLISH_CODE } = {}) {
  const headers = {};
  if (token !== null) headers["x-bulletin-token"] = token;
  const query = id === null ? "" : "?id=" + encodeURIComponent(id);
  return new Request("http://localhost/api/bulletins" + query, { method: "DELETE", headers });
}

let kv;

beforeEach(() => {
  kv = createKvStub();
  process.env.KV_REST_API_URL = KV_URL;
  process.env.KV_REST_API_TOKEN = "token-di-prova";
  vi.stubGlobal("fetch", kv.fetchMock);
});

afterEach(() => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  vi.unstubAllGlobals();
});

describe("pubblicazione nell'archivio condiviso (/api/bulletins)", () => {
  it("rifiuta la pubblicazione senza codice o con codice errato", async () => {
    expect((await POST(postRequest(bulletin, { token: null }))).status).toBe(401);
    expect((await POST(postRequest(bulletin, { token: "codice-sbagliato" }))).status).toBe(401);
    expect(kv.fetchMock).not.toHaveBeenCalled();
  });

  it("rifiuta le scritture da un'altra origine", async () => {
    const response = await POST(postRequest(bulletin, { origin: "https://esempio.test" }));
    expect(response.status).toBe(403);
  });

  it("valida il livello prima di salvare", async () => {
    const response = await POST(postRequest({ ...bulletin, level: "Viola" }));
    expect(response.status).toBe(400);
    expect(kv.fetchMock).not.toHaveBeenCalled();
  });

  it("salva il bollettino e lo restituisce come corrente", async () => {
    const response = await POST(postRequest(bulletin));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.saved).toBe(true);
    expect(body.persistent).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].fileName).toBe("bollettino-prova.pdf");
    expect(body.current?.level).toBe("Giallo");
    expect(readArchive(kv.store).items).toHaveLength(1);

    const stored = await (await GET()).json();
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0].id).toBe(body.items[0].id);
    expect(stored.persistent).toBe(true);
  });

  it("rimuove un bollettino pubblicato per errore", async () => {
    const archive = await (await POST(postRequest(bulletin))).json();
    const id = archive.items[0].id;

    expect((await DELETE(deleteRequest(null))).status).toBe(400);
    expect((await DELETE(deleteRequest(id, { token: "codice-sbagliato" }))).status).toBe(401);

    const response = await DELETE(deleteRequest(id));
    expect(response.status).toBe(200);
    expect((await response.json()).removed).toBe(id);
    expect((await (await GET()).json()).items).toHaveLength(0);
    expect(readArchive(kv.store).items).toHaveLength(0);
  });

  it("segnala saved:false se lo store condiviso non scrive, ma resta configurato", async () => {
    kv = createKvStub({ failWrites: true });
    vi.stubGlobal("fetch", kv.fetchMock);

    const body = await (await POST(postRequest(bulletin))).json();
    expect(body.saved).toBe(false);
    expect(body.persistent).toBe(true);
  });

  it("senza credenziali KV l'archivio non persiste e la risposta lo dice", async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    const body = await (await POST(postRequest(bulletin))).json();
    expect(body.saved).toBe(false);
    expect(body.persistent).toBe(false);
    expect(body.items).toHaveLength(1);
    expect(kv.fetchMock).not.toHaveBeenCalled();
  });
});

describe("fusione archivio condiviso e copia del dispositivo", () => {
  const shared = [
    { id: "a", uploadedAt: "2026-11-16T10:00:00.000Z", level: "Giallo" },
    { id: "b", uploadedAt: "2026-11-15T10:00:00.000Z", level: "Verde" }
  ];
  const device = [
    { id: "a", uploadedAt: "2026-11-16T10:00:00.000Z", level: "Giallo", hasLocalPdf: true },
    { id: "c", uploadedAt: "2026-11-16T09:00:00.000Z", level: "Arancione" }
  ];

  it("non duplica i bollettini già presenti nell'archivio condiviso", () => {
    const merged = mergeBulletins(shared, device);
    // Dal più recente: a (16/11 10:00), c (16/11 09:00), b (15/11).
    expect(merged.map((item) => item.id)).toEqual(["a", "c", "b"]);
    // La copia condivisa ha la precedenza: niente campi solo-dispositivo.
    expect(merged[0].hasLocalPdf).toBeUndefined();
  });

  it("aggiunge i bollettini solo-dispositivo, dal più recente", () => {
    const merged = mergeBulletins([], device);
    expect(merged.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("rispetta il limite dell'archivio", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      id: "id-" + index,
      uploadedAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString()
    }));
    expect(mergeBulletins(many, [], 5)).toHaveLength(5);
    expect(mergeBulletins(many, [], 5)[0].id).toBe("id-7");
  });
});

describe("bollettino in corso", () => {
  it("richiede una scadenza futura", () => {
    const now = new Date("2026-11-16T12:00:00.000Z");
    expect(isBulletinCurrent({ validTo: null }, now)).toBe(false);
    expect(isBulletinCurrent({ validTo: "2026-11-16T11:59:00.000Z" }, now)).toBe(false);
    expect(isBulletinCurrent({ validTo: "2026-11-16T12:01:00.000Z" }, now)).toBe(true);
  });
});

describe("pulizia dell'archivio", () => {
  it("scarta i record senza id, ordina dal più recente e taglia al limite", () => {
    const items = [
      { id: "", uploadedAt: "2026-11-16T10:00:00.000Z" },
      { id: "vecchio", uploadedAt: "2026-11-14T10:00:00.000Z" },
      { id: "nuovo", uploadedAt: "2026-11-16T09:00:00.000Z" }
    ];
    expect(pruneBulletins(items).map((item) => item.id)).toEqual(["nuovo", "vecchio"]);
    expect(pruneBulletins(items, 1)).toHaveLength(1);
  });
});
