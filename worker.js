// Worker "surat-nsd": halaman masuk, sesi, dan perantara aman ke AI memakai kunci milik pengelola.
// Secret   : GEMINI_API_KEY (atau ANTHROPIC_API_KEY bila PROVIDER=claude), USERS, SESSION_SECRET
// Variabel : PROVIDER (gemini|claude), MODEL (opsional), SESSION_HOURS (opsional, bawaan 12)
// USERS    : daftar akun, format  nama:kata_sandi;nama2:kata_sandi2  (kata sandi tidak boleh memuat ;)
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(data));
}
async function safeEq(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
async function makeToken(env, user, hours) {
  const p = b64u(enc.encode(JSON.stringify({ u: user, exp: Date.now() + hours * 3600000 })));
  return `${p}.${b64u(await hmac(env.SESSION_SECRET, p))}`;
}
async function readSession(env, request) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)sesi=([^;]+)/);
  if (!m || !env.SESSION_SECRET) return null;
  const [p, s] = m[1].split('.');
  if (!p || !s || !(await safeEq(s, b64u(await hmac(env.SESSION_SECRET, p))))) return null;
  try {
    const d = JSON.parse(new TextDecoder().decode(fromB64u(p)));
    return d.exp > Date.now() ? d : null;
  } catch { return null; }
}
function accounts(env) {
  const map = new Map();
  for (const pair of String(env.USERS || '').split(';')) {
    const i = pair.indexOf(':');
    if (i > 0) map.set(pair.slice(0, i).trim().toLowerCase(), pair.slice(i + 1));
  }
  return map;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const json = (obj, status = 200, extra = {}) =>
      new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
    const go = (to) => new Response(null, { status: 302, headers: { Location: to, 'cache-control': 'no-store' } });
    const hours = +env.SESSION_HOURS || 12;
    const cookie = (v, age) => `sesi=${v}; Max-Age=${age}; Path=/; HttpOnly; Secure; SameSite=Strict`;
    const showPage = async (file) => {
      if (!env.ASSETS) return new Response('ASSETS belum dikonfigurasi', { status: 500 });
      const r = await env.ASSETS.fetch(new Request(new URL('/' + file, request.url)));
      return new Response(r.body, {
        status: r.status,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' },
      });
    };

    if (request.method === 'GET' && (path === '/' || path === '/masuk')) {
      const ses = await readSession(env, request);
      if (path === '/') return ses ? showPage('app.html') : go('/masuk');
      return ses ? go('/') : showPage('login.html');
    }
    if (request.method === 'GET' && path === '/api/sesi') {
      const ses = await readSession(env, request);
      return ses ? json({ u: ses.u }) : json({ error: 'Belum masuk.' }, 401);
    }
    if (request.method !== 'POST' || !path.startsWith('/api/')) return new Response('Tidak ditemukan', { status: 404 });

    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'Asal permintaan tidak diizinkan.' }, 403);
    if (!env.SESSION_SECRET) return json({ error: 'SESSION_SECRET belum diatur di Worker.' }, 500);

    if (path === '/api/keluar') return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Permintaan tidak valid.' }, 400); }

    if (path === '/api/masuk') {
      const nama = String(body.nama || '').trim().toLowerCase();
      const known = accounts(env).get(nama);
      const ok = await safeEq(String(body.sandi || ''), known === undefined ? '\u0000tidak-ada' : known);
      if (known === undefined || !ok) {
        await new Promise((r) => setTimeout(r, 700));
        return json({ error: 'Nama pengguna atau kata sandi salah.' }, 401);
      }
      return json({ ok: true, u: nama }, 200, { 'Set-Cookie': cookie(await makeToken(env, nama, hours), hours * 3600) });
    }

    if (path === '/api/susun') {
      const ses = await readSession(env, request);
      if (!ses) return json({ error: 'Sesi berakhir. Silakan masuk lagi.' }, 401);
      if ((+request.headers.get('content-length') || 0) > 12000000) return json({ error: 'Berkas terlalu besar.' }, 413);
      if (!Array.isArray(body.messages) || !body.messages.length) return json({ error: 'Pesan kosong.' }, 400);
      console.log(JSON.stringify({ pengguna: ses.u, waktu: new Date().toISOString(), ukuran: +request.headers.get('content-length') || 0 }));
      return String(env.PROVIDER || 'gemini').toLowerCase() === 'claude' ? viaClaude(body, env, json) : viaGemini(body, env, json);
    }
    return json({ error: 'Tidak ditemukan.' }, 404);
  },
};

async function viaGemini(body, env, json) {
  if (!env.GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY belum diatur di Worker.' }, 500);
  const parts = body.messages.flatMap((m) =>
    (Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }]).map((c) =>
      c.type === 'image' ? { inline_data: { mime_type: c.source.media_type, data: c.source.data } } : { text: c.text }
    )
  );
  const model = env.MODEL || 'gemini-4-hydrogen';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 16384, responseMimeType: 'application/json' } }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: { message: (d.error && d.error.message) || `Layanan AI menolak permintaan (${r.status}).` } }, r.status);
  const cand = d.candidates && d.candidates[0];
  const text = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || '').join('');
  if (!text) {
    const why = (d.promptFeedback && d.promptFeedback.blockReason) || (cand && cand.finishReason) || '';
    return json({ error: { message: `AI tidak menghasilkan isi${why ? ' (' + why + ')' : ''}. Coba lagi.` } }, 502);
  }
  return json({ content: [{ type: 'text', text }] });
}

async function viaClaude(body, env, json) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY belum diatur di Worker.' }, 500);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.MODEL || 'claude-sonnet-5-5', max_tokens: Math.min(+body.max_tokens || 4000, 4000), messages: body.messages }),
  });
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
