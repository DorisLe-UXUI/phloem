// Image providers for /ai/image, cheapest first: Cloudflare Workers AI (FLUX.2 klein, free daily allowance) and then
// Google's Nano Banana 2 Lite (Gemini Flash-Lite Image, paid per image). Pure helpers live here so they can be tested.

/** Cloudflare account for Workers AI: CF_ACCOUNT_ID, else the account in the R2 backup endpoint (https://<id>.r2.cloudflarestorage.com). */
export function cfAccountId(env = process.env) {
  if (env.CF_ACCOUNT_ID) return String(env.CF_ACCOUNT_ID).trim();
  const m = /^https:\/\/([0-9a-f]{32})\.r2\.cloudflarestorage\.com/i.exec(String(env.BACKUP_S3_ENDPOINT || ''));
  return m ? m[1] : '';
}

/** Output size for FLUX per aspect: multiples of 64, about one megapixel (FLUX.2 klein accepts 256–1920 per side). */
export function fluxSize(aspect) {
  return { '1:1': [1024, 1024], '3:4': [960, 1280], '4:3': [1280, 960], '9:16': [768, 1344], '16:9': [1344, 768] }[aspect] || [1024, 1024];
}

/** Nano Banana 2 Lite from a ListModels result: a Gemini image model whose name says "lite"; newest version first. */
export function pickLiteImageModel(models) {
  const ver = (n) => Number((/(\d+(?:\.\d+)?)/.exec(n) || [0, 0])[1]);
  return (models || [])
    .filter((m) => /gemini.*(lite.*image|image.*lite)/i.test(m.name) && (m.supportedGenerationMethods || []).includes('generateContent'))
    .sort((a, b) => ver(b.name) - ver(a.name) || (/preview/.test(a.name) ? 1 : 0) - (/preview/.test(b.name) ? 1 : 0))[0] || null;
}

/** The best Gemini image model ("Nano Banana Pro", gemini-*-pro-image): sharper text and faces, several times the price of Lite.
 *  Used only when a request asks for quality 'pro'. Newest version first, stable before preview. */
export function pickProImageModel(models) {
  const ver = (n) => Number((/(\d+(?:\.\d+)?)/.exec(n) || [0, 0])[1]);
  return (models || [])
    .filter((m) => /gemini.*pro.*image/i.test(m.name) && (m.supportedGenerationMethods || []).includes('generateContent'))
    .sort((a, b) => ver(b.name) - ver(a.name) || (/preview/.test(a.name) ? 1 : 0) - (/preview/.test(b.name) ? 1 : 0))[0] || null;
}

/** MIME type of base64 image bytes from their first characters. */
export const sniffMime = (b64) => (String(b64).startsWith('/9j/') ? 'image/jpeg' : String(b64).startsWith('UklGR') ? 'image/webp' : 'image/png');

/** Next 00:00 UTC, when the Workers AI free allowance resets. */
export function nextUtcMidnight(now = Date.now()) { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); }
