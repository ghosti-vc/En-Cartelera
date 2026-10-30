const IMG = "https://image.tmdb.org/t/p/";
const LANG = "es-MX";
const REGION = "MX";
const TTL_MS = 10 * 60 * 1000;
const FRESH_MS = 6 * 60 * 60 * 1000;
const DAYS_AHEAD = 120;
const ALL = "8|1899|384|119|9|337|350|531";

const PLATFORMS = {
  netflix: { name: "Netflix", id: "8", net: "213" },
  prime: { name: "Prime Video", id: "119|9", net: "1024" },
  disney: { name: "Disney+", id: "337", net: "2739" },
  hbo: { name: "HBO Max", id: "1899|384", net: "49|3186" },
  apple: { name: "Apple TV+", id: "350", net: "2552" },
  paramount: { name: "Paramount+", id: "531", net: "4330" },
};
const ALL_NET = Object.values(PLATFORMS).map((p) => p.net).join("|");

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const memo = new Map();

function en() {
  return kino.lang === "en-US";
}
function t(es, enText) {
  return en() ? enText : es;
}
function errText(e) {
  return e && (e.code || e.message) ? (e.code || "") + " " + (e.message || "") : String(e);
}

async function tmdb(path, params) {
  await null;
  if (typeof kino.tmdb !== "function") {
    throw kino.error("unavailable", "kino.tmdb no existe", {
      userMessage: "Actualiza la app para ver este contenido.",
    });
  }
  const p = Object.assign({ language: LANG }, params || {});
  const key = path + "?" + JSON.stringify(p);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = await Promise.race([
    kino.tmdb(path, p),
    new Promise((_, rej) => setTimeout(() => rej(new Error("tmdb lento")), 5000)),
  ]);
  memo.set(key, { at: Date.now(), data });
  return data;
}

function isoDay(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function dateOf(r) {
  const s = String((r && (r.release_date || r.first_air_date)) || "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? { iso: s, y: m[1], mo: Number(m[2]), d: Number(m[3]) } : null;
}

function toItem(r, kind, platformName) {
  const title = r && (r.title || r.name);
  if (!title || !r.id) return null;
  const dt = dateOf(r);
  const item = {
    id: (kind === "movie" ? "m" : "s") + r.id,
    ref: (kind === "movie" ? "movie:" : "tv:") + r.id,
    title: String(title).slice(0, 200),
    kind,
    ids: { tmdb: r.id },
  };
  if (dt) {
    item.year = dt.y;
    const day = dt.d + " " + SHORT[dt.mo - 1];
    item.badges = [platformName ? platformName + " · " + day : day];
  } else if (platformName) {
    item.badges = [platformName];
  }
  if (r.poster_path) item.poster = IMG + "w500" + r.poster_path;
  if (r.backdrop_path) item.backdrop = IMG + "w780" + r.backdrop_path;
  const head = [];
  if (dt) head.push(t("Estreno: ", "Release: ") + dt.d + " de " + MONTHS[dt.mo - 1] + " de " + dt.y);
  if (platformName) head.push(platformName);
  const overview = (head.length ? head.join(" · ") + "\n\n" : "") + (r.overview ? String(r.overview) : "");
  if (overview) item.overview = overview.slice(0, 2000);
  if (r.vote_average > 0) item.rating = Math.round(r.vote_average * 10) / 10;
  return item;
}

function items(list, kind, platformName, limit) {
  const out = [];
  const seen = new Set();
  const today = isoDay(0);
  const sorted = (list || [])
    .filter((r) => {
      const dt = dateOf(r);
      return dt && dt.iso >= today;
    })
    .sort((a, b) => dateOf(a).iso.localeCompare(dateOf(b).iso));
  for (const r of sorted) {
    const it = toItem(r, kind, platformName);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

async function results(path, params) {
  const d = await tmdb(path, params);
  return Array.isArray(d) ? d : d && Array.isArray(d.results) ? d.results : [];
}

// Cada consulta tiene tope de tiempo y, si falla, devuelve vacío.
function safe(p, ms) {
  return Promise.race([
    Promise.resolve(p).catch(() => []),
    new Promise((res) => setTimeout(() => res([]), ms || 4000)),
  ]);
}

// Pocas llamadas por fila (TMDB casi no tiene datos de plataforma
// para títulos futuros, por eso las series usan también el network).
async function discover(kind, providers, net) {
  const isMovie = kind === "movie";
  const f = isMovie ? "primary_release_date" : "first_air_date";
  const path = "/discover/" + (isMovie ? "movie" : "tv");
  const base = { sort_by: "popularity.desc" };
  base[f + ".gte"] = isoDay(0);
  base[f + ".lte"] = isoDay(DAYS_AHEAD);

  const jobs = [
    safe(results(path, Object.assign({}, base, {
      watch_region: REGION,
      with_watch_providers: providers || ALL,
      with_watch_monetization_types: "flatrate",
    }))),
  ];
  if (!isMovie) {
    jobs.push(safe(results(path, Object.assign({}, base, { with_networks: net || ALL_NET }))));
  } else if (!providers) {
    jobs.push(safe(results("/movie/upcoming", { region: REGION })));
  }
  const parts = await Promise.all(jobs);
  return [].concat.apply([], parts);
}

function rowDefs() {
  const platform = (key) => {
    const p = PLATFORMS[key];
    return [
      {
        id: key + "-pelis",
        title: t("Próximas películas en " + p.name, "Upcoming movies on " + p.name),
        genre: "peliculas",
        load: async () => items(await discover("movie", p.id, p.net), "movie", p.name, 20),
      },
      {
        id: key + "-series",
        title: t("Próximas series en " + p.name, "Upcoming series on " + p.name),
        genre: "series",
        load: async () => items(await discover("tv", p.id, p.net), "series", p.name, 20),
      },
    ];
  };
  return {
    proximos: [
      {
        id: "proximas-pelis",
        title: t("Próximas películas", "Upcoming movies"),
        genre: "peliculas",
        load: async () => items(await discover("movie", null, null), "movie", null, 20),
      },
      {
        id: "proximas-series",
        title: t("Próximas series en plataformas", "Upcoming series on streaming"),
        genre: "series",
        load: async () => items(await discover("tv", null, null), "series", null, 20),
      },
    ],
    netflix: platform("netflix"),
    prime: platform("prime"),
    disney: platform("disney"),
    hbo: platform("hbo"),
    apple: platform("apple"),
    paramount: platform("paramount"),
  };
}

// Guardado en el aparato: respuesta rápida y respaldo.
async function cacheGet(id) {
  try {
    const v = await kino.storage.get("row3:" + id);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}

async function cachePut(id, list) {
  try {
    const slim = list.slice(0, 15).map((it) => {
      const c = Object.assign({}, it);
      delete c.backdrop;
      if (c.overview) c.overview = c.overview.slice(0, 300);
      return c;
    });
    await kino.storage.set("row3:" + id, JSON.stringify({ at: Date.now(), list: slim }));
  } catch (e) {}
}

const DEADLINE_MS = 4500;

async function buildRows(defs) {
  const errs = [];
  const slots = new Array(defs.length).fill(null);

  const jobs = defs.map(async (d, i) => {
    const saved = await cacheGet(d.id);
    const hasSaved = saved && saved.list && saved.list.length;
    const asRow = (list) => ({ id: d.id, title: d.title, genre: d.genre, items: list });
    if (hasSaved) slots[i] = asRow(saved.list); // respuesta inmediata (aunque sea vieja)
    if (hasSaved && Date.now() - saved.at < FRESH_MS) return;
    try {
      const list = await d.load();
      if (list.length) {
        slots[i] = asRow(list);
        await cachePut(d.id, list);
      } else {
        errs.push(d.id + ": vacia");
      }
    } catch (e) {
      errs.push(d.id + ": " + errText(e));
    }
  });

  // Si algo tarda de más, se devuelve lo que ya haya y el resto sigue
  // cargándose en segundo plano para la próxima vez.
  await Promise.race([
    Promise.all(jobs),
    new Promise((res) => setTimeout(res, DEADLINE_MS)),
  ]);

  const ok = slots.filter(Boolean);
  if (ok.length) return ok;
  return [
    {
      id: "diagnostico",
      title: (errs.length
        ? "Sin datos. " + errs.slice(0, 3).join(" | ")
        : "Cargando… pulsa Reintentar en unos segundos").slice(0, 190),
      items: [{ id: "d1", ref: "movie:0", title: "Reintenta en unos minutos", kind: "movie" }],
    },
  ];
}

export async function home() {
  const all = rowDefs();
  return buildRows(all.proximos);
}

export async function section({ tab }) {
  const all = rowDefs();
  const tabs = [
    { id: "proximos", label: t("Próximos", "Upcoming") },
    { id: "netflix", label: "Netflix" },
    { id: "prime", label: "Prime Video" },
    { id: "disney", label: "Disney+" },
    { id: "hbo", label: "HBO Max" },
    { id: "apple", label: "Apple TV+" },
    { id: "paramount", label: "Paramount+" },
  ];
  const chosen = tabs.some((x) => x.id === tab) ? tab : "proximos";
  return { tabs, tab: chosen, rows: await buildRows(all[chosen]) };
}

export async function episodes(ref) {
  await null;
  return { episodes: [] };
}

export async function resolve(ref) {
  await null;
  throw kino.error("not_found", "solo catalogo", {
    userMessage: "Este catálogo no reproduce: busca el título en tus otras fuentes.",
  });
}
