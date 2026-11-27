import { createHash } from 'node:crypto';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const META_COOKIE = /^fb\.\d+\.\d{10,16}\.[A-Za-z0-9_-]+$/;
const META_ENDPOINT = 'https://graph.facebook.com/v25.0/1101059396141011/events';
const META_DEDUP_WINDOW = 48 * 60 * 60 * 1000;
const MAX_RECENT_META_EVENTS = 10000;
const LOSS_BANDS = new Set(['under-13k', '13k-28k', '28k-50k', 'over-50k']);
const BCRA_ENDPOINT = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones';
const HOUR = 60 * 60 * 1000;
const PHONE_COUNTRIES = new Map(Object.entries({
  '+52': 'MX',
  '+54': 'AR',
  '+595': 'PY',
}));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const ROOT_FILES = new Set(['index.html', 'styles.css', 'script.js', 'leads-client.js', 'favicon.ico']);

function cleanLead(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !UUID.test(data.requestId)) throw new Error('invalid');
  if (data.consent !== true) throw new Error('invalid');
  if (!LOSS_BANDS.has(data.lossBand) || ![1, 3, 6].includes(data.incidentMonths)) throw new Error('invalid');
  const lead = { requestId: data.requestId.toLowerCase() };
  for (const [key, max] of Object.entries({ name: 160, phone: 40 })) {
    if (typeof data[key] !== 'string') throw new Error('invalid');
    const value = data[key].trim();
    if (!value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('invalid');
    lead[key] = value;
  }
  const phone = /^(\+\d{1,3}) ([\d ()-]{7,18})$/.exec(lead.phone);
  const phoneCountry = PHONE_COUNTRIES.get(phone?.[1]);
  if (lead.name.length < 3 || !phoneCountry || phone[2].replace(/\D/g, '').length < 7) throw new Error('invalid');
  return {
    requestId: lead.requestId,
    name: lead.name,
    phone: lead.phone,
    phoneCountry,
    residenceCountryCode: phoneCountry,
    consent: true,
    lossBand: data.lossBand,
    incidentMonths: data.incidentMonths,
  };
}

function crmEndpoint(baseUrl) {
  try {
    const base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) return null;
    if (!['/', '/api', '/api/', '/api/v1', '/api/v1/'].includes(base.pathname)) return null;
    return new URL('/api/v1/leads/landingv8', base);
  } catch {
    return null;
  }
}

function railwayClientIp(req, isRailway) {
  const clientIp = req.headers['x-real-ip'];
  if (isRailway && req.headers['x-railway-edge'] && typeof clientIp === 'string' && isIP(clientIp)) {
    return clientIp;
  }
}

async function detectVisitorCountry(req, isRailway, fetchImpl) {
  const clientIp = (railwayClientIp(req, isRailway) || req.socket.remoteAddress || '').replace(/^::ffff:(?=\d)/i, '');
  if (!isIP(clientIp) || clientIp === '::1' || clientIp.startsWith('127.')) return null;
  try {
    const response = await fetchImpl(`https://api.country.is/${encodeURIComponent(clientIp)}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const { country } = await response.json();
    return /^[A-Z]{2}$/.test(country) ? country : null;
  } catch {
    return null;
  }
}

function isValidExchangeRate(rate) {
  return Number.isFinite(rate) && rate >= 1 && Number.isSafeInteger(Math.ceil(rate * 50000));
}

function createExchangeRateLookup(env, fetchImpl) {
  const fixedRates = { ARS: Number(env.ARS_PER_USD), PYG: Number(env.PYG_PER_USD) };
  let cachedRates = {};
  let lastSuccess = 0;
  let refreshAt = 0;
  let pending;

  async function refresh() {
    try {
      const response = await fetchImpl(BCRA_ENDPOINT, {
        redirect: 'error',
        signal: AbortSignal.timeout(2500),
      });
      if (response.ok) {
        const { results } = await response.json();
        const arsPerUsd = results?.detalle?.find(entry => entry.codigoMoneda === 'USD')?.tipoCotizacion;
        const arsPerPyg = results?.detalle?.find(entry => entry.codigoMoneda === 'PYG')?.tipoCotizacion;
        if (isValidExchangeRate(arsPerUsd)) {
          // El BCRA publica cada divisa en ARS. El cociente da guaraníes por USD.
          const pygPerUsd = arsPerUsd / arsPerPyg;
          cachedRates = { ARS: arsPerUsd };
          if (isValidExchangeRate(pygPerUsd)) cachedRates.PYG = pygPerUsd;
          lastSuccess = Date.now();
          refreshAt = lastSuccess + HOUR;
          return;
        }
      }
    } catch {
      // Keep the last successful response briefly if the source is unavailable.
    }
    refreshAt = Date.now() + 60 * 1000;
  }

  return async currency => {
    if (isValidExchangeRate(fixedRates[currency])) return fixedRates[currency];
    if (Date.now() >= refreshAt) {
      pending ??= refresh().finally(() => { pending = undefined; });
      await pending;
    }
    return Date.now() - lastSuccess < 24 * HOUR ? cachedRates[currency] : undefined;
  };
}

function metaAttribution(req, origin, isRailway) {
  const userAgent = req.headers['user-agent']?.trim();
  if (origin?.protocol !== 'https:' || !userAgent || userAgent.length > 1024) return;

  const sourceUrl = `${origin.origin}/`;
  if (sourceUrl.length > 2048) return;
  const userData = { client_user_agent: userAgent };
  for (const cookie of (req.headers.cookie || '').split(';')) {
    const match = /^_(fbp|fbc)=(.+)$/.exec(cookie.trim());
    if (match && match[2].length <= 512 && META_COOKIE.test(match[2])) {
      userData[match[1]] = match[2];
    }
  }
  const clientIp = railwayClientIp(req, isRailway);
  if (clientIp) userData.client_ip_address = clientIp;
  return { sourceUrl, userData };
}

const hashMetaValue = value => createHash('sha256').update(value).digest('hex');

async function sendMetaEvent(fetchImpl, token, event) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await wait(1000);
    try {
      const response = await fetchImpl(META_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ data: [event] }),
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) return (await response.json()).events_received === 1;
      await response.body?.cancel();
      if (response.status !== 429 && response.status < 500) return false;
    } catch {
      // Retry an ambiguous transport failure with the same event ID and time.
    }
  }
  return false;
}

export function createLandingServer({ root, env = process.env, fetchImpl = fetch }) {
  const endpoint = crmEndpoint(env.CRM_BACKEND_URL);
  const apiKey = env.CRM_LANDING_API_KEY?.trim();
  const metaToken = env.META_CAPI_ACCESS_TOKEN?.trim();
  const isRailway = Boolean(env.RAILWAY_ENVIRONMENT_ID);
  const lookupExchangeRate = createExchangeRateLookup(env, fetchImpl);
  const recentMetaEvents = new Map();

  async function trackCompletedRegistration(req, origin, { requestId, phone }) {
    if (!metaToken) return;
    const attribution = metaAttribution(req, origin, isRailway);
    if (!attribution) return;

    const now = Date.now();
    if (recentMetaEvents.get(requestId) > now) return;
    for (const [id, expires] of recentMetaEvents) {
      if (expires > now && recentMetaEvents.size < MAX_RECENT_META_EVENTS) break;
      recentMetaEvents.delete(id);
    }
    const expires = now + META_DEDUP_WINDOW;
    recentMetaEvents.set(requestId, expires);
    const sent = await sendMetaEvent(fetchImpl, metaToken, {
      event_name: 'CompleteRegistration',
      event_id: `landingv8-lead-${requestId}`,
      event_time: Math.floor(now / 1000),
      action_source: 'website',
      event_source_url: attribution.sourceUrl,
      user_data: {
        ...attribution.userData,
        ph: [hashMetaValue(phone.replace(/\D/g, '').replace(/^0+/, ''))],
      },
    });
    if (!sent) {
      if (recentMetaEvents.get(requestId) === expires) recentMetaEvents.delete(requestId);
      console.warn('Meta CAPI: no se confirmó el evento CompleteRegistration de RecoveryAdvisory.');
    }
  }

  return http.createServer(async (req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { return json(400, { ok: false }); }

    const rateCurrency = /^\/api\/loss-rate\/(ARS|PYG)$/.exec(pathname)?.[1];
    if (pathname === '/api/form-context' || rateCurrency) {
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(405, { ok: false }); }
      if (pathname === '/api/form-context') {
        return json(200, { countryCode: await detectVisitorCountry(req, isRailway, fetchImpl) });
      }
      const rate = await lookupExchangeRate(rateCurrency);
      return rate ? json(200, { rate }) : json(503, { ok: false });
    }

    if (pathname === '/api/leads') {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(405, { ok: false }); }
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(415, { ok: false });
      let origin;
      if (req.headers.origin) {
        try {
          origin = new URL(req.headers.origin);
          if (origin.host !== req.headers.host) return json(403, { ok: false });
        }
        catch { return json(403, { ok: false }); }
      }
      let raw = '', bytes = 0;
      const chunks = [];
      try {
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 8192) { json(413, { ok: false }); req.resume(); return; }
          chunks.push(chunk);
        }
        raw = Buffer.concat(chunks).toString('utf8');
      } catch { if (!res.headersSent) json(400, { ok: false }); return; }
      let lead;
      try { lead = cleanLead(JSON.parse(raw)); }
      catch { return json(400, { ok: false, error: 'Revisa los campos del formulario.' }); }
      if (lead.lossBand === 'under-13k') {
        return json(200, { ok: true, id: lead.requestId, trackRegistration: false });
      }
      if (!endpoint || !apiKey || apiKey.length < 32) {
        return json(503, { ok: false, error: 'No pudimos enviar tu solicitud. Inténtalo más tarde.' });
      }
      try {
        const upstream = await fetchImpl(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
          body: JSON.stringify(lead),
          redirect: 'error', signal: AbortSignal.timeout(25000),
        });
        const saved = upstream.ok ? await upstream.json() : null;
        if (!saved || saved.ok !== true || saved.id !== lead.requestId) throw new Error('not saved');
      } catch { return json(502, { ok: false, error: 'No se pudo confirmar el registro. Inténtalo de nuevo.' }); }
      json(200, { ok: true, id: lead.requestId, trackRegistration: true });
      void trackCompletedRegistration(req, origin, lead);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { ok: false });
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    // Solo se publican los archivos de la página, nunca .env ni código del servidor.
    const segments = relative.split('/');
    if (relative.includes('\\') || segments.some(s => !s || s.startsWith('.')) || !(ROOT_FILES.has(relative) || relative.startsWith('assets/'))) return json(404, { ok: false });
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(path.resolve(root) + path.sep)) return json(404, { ok: false });
    try {
      if (!(await stat(filename)).isFile()) return json(404, { ok: false });
      const data = await readFile(filename);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(filename)] || 'application/octet-stream', 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { json(404, { ok: false }); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const landing = JSON.parse(await readFile(path.join(root, 'landing.config.json'), 'utf8'));
  const server = createLandingServer({ root });
  server.requestTimeout = 30000;
  server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log(`Landing ${landing.id} lista.`));
  process.on('SIGTERM', () => server.close());
}
