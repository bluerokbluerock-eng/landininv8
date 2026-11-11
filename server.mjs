import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESIDENCE_COUNTRIES = new Map(Object.entries({
  Argentina: 'AR', Bolivia: 'BO', Canadá: 'CA', Chile: 'CL', Colombia: 'CO',
  'Costa Rica': 'CR', Cuba: 'CU', Ecuador: 'EC', 'El Salvador': 'SV',
  España: 'ES', 'Estados Unidos': 'US', Francia: 'FR', Guatemala: 'GT',
  'Guinea Ecuatorial': 'GQ', Honduras: 'HN', Italia: 'IT', México: 'MX',
  Nicaragua: 'NI', Panamá: 'PA', Paraguay: 'PY', Perú: 'PE',
  'Puerto Rico (territorio)': 'PR', 'República Dominicana': 'DO', Uruguay: 'UY', Venezuela: 'VE',
}));
const PHONE_COUNTRIES = new Map(Object.entries({
  '+54': 'AR', '+591': 'BO', '+56': 'CL', '+57': 'CO', '+506': 'CR',
  '+53': 'CU', '+593': 'EC', '+503': 'SV', '+34': 'ES', '+33': 'FR',
  '+502': 'GT', '+240': 'GQ', '+504': 'HN', '+39': 'IT', '+52': 'MX',
  '+505': 'NI', '+507': 'PA', '+595': 'PY', '+51': 'PE', '+598': 'UY',
  '+58': 'VE',
}));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const ROOT_FILES = new Set(['index.html', 'styles.css', 'script.js', 'leads-client.js', 'favicon.ico']);

function cleanLead(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !UUID.test(data.requestId)) throw new Error('invalid');
  if (data.consent !== true) throw new Error('invalid');
  const lead = { requestId: data.requestId.toLowerCase() };
  for (const [key, max] of Object.entries({ name: 160, email: 254, phone: 40, country: 100, dob: 10 })) {
    if (typeof data[key] !== 'string') throw new Error('invalid');
    const value = data[key].trim();
    if ((!value && key !== 'dob') || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('invalid');
    lead[key] = value;
  }
  const phone = /^\+\d{1,3} ([\d ()-]{7,18})$/.exec(lead.phone);
  if (lead.name.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) || !phone || phone[1].replace(/\D/g, '').length < 7) throw new Error('invalid');
  if (lead.dob) {
    const birth = new Date(`${lead.dob}T00:00:00Z`);
    const today = new Date().toISOString().slice(0, 10);
    const adultCutoff = `${Number(today.slice(0, 4)) - 18}${today.slice(4)}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lead.dob) || !Number.isFinite(+birth) || birth.toISOString().slice(0, 10) !== lead.dob || lead.dob < '1900-01-01' || lead.dob > adultCutoff) throw new Error('invalid');
  }
  const residenceCountryCode = RESIDENCE_COUNTRIES.get(lead.country);
  if (!residenceCountryCode) throw new Error('invalid');
  const [prefix] = lead.phone.split(' ');
  const phoneCountry = prefix === '+1' && ['CA', 'US', 'DO', 'PR'].includes(data.phoneCountry)
    ? data.phoneCountry
    : PHONE_COUNTRIES.get(prefix);
  return {
    requestId: lead.requestId,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    phoneCountry,
    residenceCountryCode,
    birthDate: lead.dob || undefined,
    consent: true,
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

export function createLandingServer({ root, env = process.env, fetchImpl = fetch }) {
  const endpoint = crmEndpoint(env.CRM_BACKEND_URL);
  const apiKey = env.CRM_LANDING_V8_API_KEY?.trim();
  return http.createServer(async (req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { return json(400, { ok: false }); }

    if (pathname === '/api/leads') {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(405, { ok: false }); }
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(415, { ok: false });
      if (req.headers.origin) {
        try { if (new URL(req.headers.origin).host !== req.headers.host) return json(403, { ok: false }); }
        catch { return json(403, { ok: false }); }
      }
      if (!endpoint || !apiKey || apiKey.length < 32) return json(503, { ok: false, error: 'El formulario está pendiente de configuración.' });
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
      try {
        const upstream = await fetchImpl(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
          body: JSON.stringify(lead),
          redirect: 'error', signal: AbortSignal.timeout(25000),
        });
        const saved = upstream.ok ? await upstream.json() : null;
        if (!saved || saved.ok !== true || saved.id !== lead.requestId) throw new Error('not saved');
        return json(200, { ok: true, id: saved.id });
      } catch { return json(502, { ok: false, error: 'No se pudo confirmar el registro. Inténtalo de nuevo.' }); }
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
