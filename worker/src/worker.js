// Calculus for Engineers: family progress sync.
// A tiny Cloudflare Worker that stores each student's progress in KV under a family code.
// No accounts. Anyone with a family code can read and write that family's progress.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 characters, no I or O
const CODE_LENGTH = 12;
const TRACKS = ['general', 'mechanical', 'civil'];
const TTL_SECONDS = 60 * 60 * 24 * 400; // unused families expire after about 13 months
const MAX_STUDENTS = 12;
const MAX_BODY_BYTES = 40000;
const MAX_PROGRESS_BYTES = 30000;
const CREATES_PER_HOUR = 10;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 32];
  return out;
}

function normalizeCode(input) {
  let text = String(input || '');
  try { text = decodeURIComponent(text); } catch (e) { /* keep the raw text */ }
  const raw = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-HJ-NP-Z2-9]{12}$/.test(raw) ? raw : null;
}

function formatCode(raw) {
  return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12);
}

function corsFor(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const ok = origin && (allowed.includes(origin) || isLocal);
  return {
    origin,
    ok,
    headers: ok
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        }
      : { Vary: 'Origin' },
  };
}

function reply(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      cors.headers
    ),
  });
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { error: 'That request is too large.' };
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return { value };
  } catch (e) {
    /* fall through */
  }
  return { error: 'The request body must be a JSON object.' };
}

function cleanName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24);
}

async function familyExists(env, code) {
  return (await env.PROGRESS.get('fam:' + code)) !== null;
}

async function touchFamily(env, code) {
  // Refresh the family's expiry at most once a day, so one busy family doesn't hammer one KV key.
  const raw = await env.PROGRESS.get('fam:' + code);
  if (raw === null) return;
  let meta = {};
  try { meta = JSON.parse(raw) || {}; } catch (e) { meta = {}; }
  if (Date.now() - (meta.refreshed || meta.created || 0) > 86400000) {
    meta.refreshed = Date.now();
    await env.PROGRESS.put('fam:' + code, JSON.stringify(meta), { expirationTtl: TTL_SECONDS });
  }
}

async function listStudents(env, code) {
  const list = await env.PROGRESS.list({ prefix: 'stu:' + code + ':' });
  const rows = await Promise.all(
    list.keys.map(async (k) => {
      const rec = await env.PROGRESS.get(k.name, { type: 'json' });
      if (!rec) return null;
      return {
        id: k.name.slice(('stu:' + code + ':').length),
        name: rec.name,
        track: rec.track,
        progress: rec.progress,
        updatedAt: rec.updatedAt,
      };
    })
  );
  return rows.filter(Boolean);
}

async function createFamily(request, env, cors) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = 'rl:' + ip + ':' + Math.floor(Date.now() / 3600000);
  const used = parseInt((await env.PROGRESS.get(key)) || '0', 10);
  if (used >= CREATES_PER_HOUR) {
    return reply({ error: 'Too many new family codes from this network. Try again in an hour.' }, 429, cors);
  }
  await env.PROGRESS.put(key, String(used + 1), { expirationTtl: 3700 });
  const code = newCode();
  await env.PROGRESS.put('fam:' + code, JSON.stringify({ created: Date.now() }), { expirationTtl: TTL_SECONDS });
  return reply({ code: formatCode(code) }, 201, cors);
}

async function putStudent(request, env, cors, code, sid) {
  if (!(await familyExists(env, code))) return reply({ error: 'Family code not found.' }, 404, cors);
  if (!/^[a-z0-9]{8,32}$/.test(sid)) return reply({ error: 'Invalid student id.' }, 400, cors);
  const parsed = await readJson(request);
  if (parsed.error) return reply({ error: parsed.error }, 400, cors);
  const body = parsed.value;
  const name = cleanName(body.name);
  if (!name) return reply({ error: 'A student name is required.' }, 400, cors);
  const progress = body.progress;
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
    return reply({ error: 'Progress must be an object.' }, 400, cors);
  }
  if (JSON.stringify(progress).length > MAX_PROGRESS_BYTES) {
    return reply({ error: 'Progress is too large.' }, 400, cors);
  }
  const key = 'stu:' + code + ':' + sid;
  if ((await env.PROGRESS.get(key)) === null) {
    const list = await env.PROGRESS.list({ prefix: 'stu:' + code + ':' });
    if (list.keys.length >= MAX_STUDENTS) {
      return reply({ error: 'This family already has the maximum number of students.' }, 409, cors);
    }
  }
  const record = {
    name,
    track: TRACKS.includes(body.track) ? body.track : 'general',
    progress,
    updatedAt: Date.now(),
  };
  await env.PROGRESS.put(key, JSON.stringify(record), { expirationTtl: TTL_SECONDS });
  await touchFamily(env, code);
  return reply({ ok: true, updatedAt: record.updatedAt }, 200, cors);
}

export default {
  async fetch(request, env) {
    const cors = corsFor(request, env);
    if (cors.origin && !cors.ok) return reply({ error: 'This site is not allowed to use the sync service.' }, 403, cors);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors.headers });

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // e.g. ['api','family',CODE,'student',SID]
    try {
      if (parts[0] !== 'api') return reply({ error: 'Not found.' }, 404, cors);
      if (parts[1] === 'health' && request.method === 'GET') return reply({ ok: true }, 200, cors);
      if (parts[1] !== 'family') return reply({ error: 'Not found.' }, 404, cors);

      if (parts.length === 2 && request.method === 'POST') return await createFamily(request, env, cors);

      const code = normalizeCode(parts[2]);
      if (!code) return reply({ error: 'That family code isn’t valid.' }, 400, cors);

      if (parts.length === 3 && request.method === 'GET') {
        if (!(await familyExists(env, code))) return reply({ error: 'Family code not found.' }, 404, cors);
        return reply({ code: formatCode(code), students: await listStudents(env, code) }, 200, cors);
      }
      if (parts.length === 5 && parts[3] === 'student') {
        const sid = String(parts[4] || '').toLowerCase();
        if (request.method === 'PUT') return await putStudent(request, env, cors, code, sid);
        if (request.method === 'DELETE') {
          if (!(await familyExists(env, code))) return reply({ error: 'Family code not found.' }, 404, cors);
          await env.PROGRESS.delete('stu:' + code + ':' + sid);
          return reply({ ok: true }, 200, cors);
        }
      }
      return reply({ error: 'Not found.' }, 404, cors);
    } catch (err) {
      return reply({ error: 'Something went wrong on the sync service.' }, 500, cors);
    }
  },
};
