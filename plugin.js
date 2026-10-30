const IMG = "https://image.tmdb.org/t/p/";
const LANG = "es-MX";
const REGION = "MX";
const TTL_MS = 10 * 60 * 1000;
const DAYS_AHEAD = 120;

const PLATFORMS = {
  netflix: { name: "Netflix", id: "8" },
  prime: { name: "Prime Video", id: "119|9" },
  disney: { name: "Disney+", id: "337" },
  hbo: { name: "HBO Max", id: "1899|384" },
  apple: { name: "Apple TV+", id: "350" },
  paramount: { name: "Paramount+", id: "531" },
};

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
  const data = await kino.tmdb(path, p);
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

function upcomingMovies() {
  return results("/movie/upcoming", { region: REGION, page: "1" });
}

function discover(kind, providers) {
  const isMovie = kind === "movie";
  const f = isMovie ? "primary_release_date" : "first_air_date";
  const params = {
    sort_by: f + ".asc",
    include_adult: "false",
    page: "1",
  };
  params[f + ".gte"] = isoDay(0);
  params[f + ".lte"] = isoDay(DAYS_AHEAD);
  if (providers) {
    params.watch_region = REGION;
    params.with_watch_providers = providers;
    params.with_watch_monetization_types = "flatrate";
  }
  return results("/discover/" + (isMovie ? "movie" : "tv"), params);
}

function rowDefs() {
  const platform = (key) => {
    const p = PLATFORMS[key];
    return [
      {
        id: key + "-pelis",
        title: t("Próximas películas en " + p.name, "Upcoming movies on " + p.name),
        genre: "peliculas",
        load: async () => items(await discover("movie", p.id), "movie", p.name, 20),
      },
      {
        id: key + "-series",
        title: t("Próximas series en " + p.name, "Upcoming series on " + p.name),
        genre: "series",
        load: async () => items(await discover("tv", p.id), "series", p.name, 20),
      },
    ];
  };
  return {
    proximos: [
      {
        id: "cines",
        title: t("Próximos estrenos en cines", "Upcoming in theaters"),
        genre: "peliculas",
        load: async () => items(await upcomingMovies(), "movie", null, 20),
      },
      {
        id: "series-proximas",
        title: t("Próximas series", "Upcoming series"),
        genre: "series",
        load: async () => items(await discover("tv", null), "series", null, 20),
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

async function buildRows(defs) {
  const errs = [];
  const rows = await Promise.all(
    defs.map(async (d) => {
      try {
        const list = await d.load();
        if (!list.length) {
          errs.push(d.id + ": vacia");
          return null;
        }
        const row = { id: d.id, title: d.title, items: list };
        if (d.genre) row.genre = d.genre;
        return row;
      } catch (e) {
        errs.push(d.id + ": " + errText(e));
        return null;
      }
    })
  );
  const ok = rows.filter(Boolean);
  if (ok.length) return ok;
  return [
    {
      id: "diagnostico",
      title: ("Sin datos. " + (errs[0] || "")).slice(0, 190),
      items: [{ id: "d1", ref: "movie:0", title: "Reintenta en unos minutos", kind: "movie" }],
    },
  ];
}

export async function home() {
  const all = rowDefs();
  return buildRows([].concat(all.proximos, all.netflix, all.prime));
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