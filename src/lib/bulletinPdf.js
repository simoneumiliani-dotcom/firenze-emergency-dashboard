// I bollettini archiviati prima della validazione sugli URL hanno il PDF dentro
// il record come data URL base64 (centinaia di KB ciascuno): non vanno mai
// rimandati al browser dentro il JSON dell'archivio, ma serviti a parte.
export function isInlinePdfUrl(url) {
  return typeof url === "string" && url.startsWith("data:");
}

export const BULLETIN_PDF_ENDPOINT = "/api/bulletins/pdf";

export function buildBulletinPdfHref(id) {
  return id ? BULLETIN_PDF_ENDPOINT + "?id=" + encodeURIComponent(id) : null;
}

// Sorgente da usare per aprire o scaricare il PDF di un record: URL https
// originale quando c'è, altrimenti l'endpoint che estrae il PDF incorporato.
export function getBulletinPdfHref(item) {
  if (!item) return null;
  if (item.pdfUrl && !isInlinePdfUrl(item.pdfUrl)) return item.pdfUrl;
  if (item.hasEmbeddedPdf || isInlinePdfUrl(item.pdfUrl)) return buildBulletinPdfHref(item.id);
  return null;
}

// Copia del record adatta al browser e al localStorage: nessun base64 dentro.
export function toPublicBulletin(item) {
  if (!item) return item;
  const inline = isInlinePdfUrl(item.pdfUrl);
  return {
    ...item,
    pdfUrl: inline ? null : item.pdfUrl || null,
    hasEmbeddedPdf: inline || Boolean(item.hasEmbeddedPdf)
  };
}
