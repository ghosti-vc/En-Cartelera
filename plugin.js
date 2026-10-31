const BASE = "https://enmcine.uk";
const DL = "https://dl.enmcine.uk";
const TOKEN = "enmcine-mobile-2026";
const IMG = "https://image.tmdb.org/t/p/";
const UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

function errText(e) {
  return e && (e.code || e.message) ? (e.code || "") + " " + (e.message || "") : String(e);
}

function slugify(t) {
  var s = String(t || "").toLowerCase();
  if (typeof s.normalize === "function") s = s.normalize("NFD");
  return s
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeId(s) {
  return String(s || "x")
    .replace(/[^A-Za-z0-9._~-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

function poster(p, size) {
  if (!p) return undefined;
  p = String(p);
  if (p.indexOf("http") === 0) return p;
  return IMG + size + p;
}

function absUrl(u, from) {
  u = String(u || "");
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("http") === 0) return u;
  if (u.charAt(0) === "/") return BASE + u;
  return from ? from.replace(/[^/]*$/, "") + u : BASE + "/" + u;
}

async function getJson(path) {
  await null;
  var r = await kino.fetch(BASE + path, {
    headers: { Accept: "application/json", "x-app-token": TOKEN, "User-Agent": UA },
    timeoutMs: 12000,
  });
  if (!r.ok) {
    throw kino.error("unavailable", "http " + r.status, {
      userMessage: "El sitio no respondió. Intenta de nuevo en un momento.",
    });
  }
  return JSON.parse(await r.text());
}

async function getText(url, referer) {
  try {
    var r = await kino.fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        Referer: referer || BASE + "/",
        "User-Agent": UA,
      },
      timeoutMs: 15000,
    });
    if (!r.ok) return "";
    return await r.text();
  } catch (e) {
    return "";
  }
}

function toItem(r, forceSeries) {
  if (!r || !r.title) return null;
  var isSeries = !!(forceSeries || r.esSerie);
  if (isSeries && !r.id) return null;
  var title = String(r.title).slice(0, 200);
  var it = {
    id: (isSeries ? "s" : "m") + safeId(r.id || slugify(title)),
    ref: isSeries ? "s:" + r.id + ":" + encodeURIComponent(title) : "m:" + encodeURIComponent(title),
    title: title,
    kind: isSeries ? "series" : "movie",
    genres: [isSeries ? "series" : "peliculas"],
  };
  if (r.id) it.ids = { tmdb: r.id };
  var date = String(r.release_date || "");
  if (/^\d{4}/.test(date)) it.year = date.slice(0, 4);
  var p = poster(r.poster_path, "w342");
  if (p) it.poster = p;
  if (r.overview) it.overview = String(r.overview).slice(0, 2000);
  if (r.vote_average > 0) it.rating = Math.round(r.vote_average * 10) / 10;
  return it;
}

function toItems(list, forceSeries, max) {
  var out = [];
  var seen = {};
  for (var i = 0; i < (list || []).length; i++) {
    var it = toItem(list[i], forceSeries);
    if (!it || seen[it.id]) continue;
    seen[it.id] = true;
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

async function lista(params) {
  var q = new URLSearchParams(params).toString();
  var d = await getJson("/api/catalogo/lista?" + q);
  return d && Array.isArray(d.resultados) ? d.resultados : [];
}

export async function home() {
  await null;
  var defs = [
    { id: "peliculas", title: "Películas", genre: "peliculas", series: false, params: { limite: "30", tipo: "pelicula" } },
    { id: "series", title: "Series", genre: "series", series: true, params: { limite: "30", tipo: "serie" } },
    { id: "accion", title: "Acción", genre: "accion", series: false, params: { limite: "20", genero: "Acción" } },
    { id: "comedia", title: "Comedia", genre: "comedia", series: false, params: { limite: "20", genero: "Comedia" } },
    { id: "drama", title: "Drama", genre: "drama", series: false, params: { limite: "20", genero: "Drama" } },
    { id: "animacion", title: "Animación", series: false, params: { limite: "20", genero: "Animación" } },
  ];
  var errs = [];
  var rows = await Promise.all(
    defs.map(async function (d) {
      try {
        var list = await lista(d.params);
        var items = toItems(list, d.series, 30);
        if (!items.length) return null;
        var row = { id: d.id, title: d.title, items: items };
        if (d.genre) row.genre = d.genre;
        return row;
      } catch (e) {
        errs.push(d.id + ": " + errText(e));
        return null;
      }
    })
  );
  var ok = rows.filter(Boolean);
  if (ok.length) return ok;
  throw kino.error("unavailable", errs.join(" | "), {
    userMessage: "No se pudo cargar el catálogo. Intenta de nuevo en un momento.",
  });
}

export async function search(query) {
  await null;
  var q = String((query && query.q) || "").trim();
  if (!q) return [];
  var d = await getJson("/api/catalogo/buscar?q=" + encodeURIComponent(q));
  var list = d && Array.isArray(d.resultados) ? d.resultados : [];
  return toItems(list, false, 100);
}

export async function episodes(ref) {
  await null;
  var r = String(ref);
  if (r.indexOf("m:") === 0) {
    var mt = decodeURIComponent(r.slice(2));
    return {
      series: { title: mt },
      episodes: [{ season: 1, number: 1, ref: r, title: mt }],
    };
  }
  var p = r.split(":");
  var id = p[1];
  var title = decodeURIComponent(p[2] || "");
  var detail = await getJson("/api/series/" + id);
  var seasons = (detail.seasons || [])
    .filter(function (s) {
      return s.season_number > 0 && s.episode_count > 0;
    })
    .slice(0, 30);
  var parts = await Promise.all(
    seasons.map(async function (s) {
      try {
        var d = await getJson("/api/series/" + id + "/temporada/" + s.season_number);
        return { season: s.season_number, list: d.episodes || [] };
      } catch (e) {
        return { season: s.season_number, list: [] };
      }
    })
  );
  var eps = [];
  for (var i = 0; i < parts.length; i++) {
    for (var j = 0; j < parts[i].list.length; j++) {
      var e = parts[i].list[j];
      var n = e.episode_number;
      if (!n) continue;
      eps.push({
        season: parts[i].season,
        number: n,
        ref: "e:" + id + ":" + parts[i].season + ":" + n + ":" + encodeURIComponent(title),
        title: e.name ? String(e.name).slice(0, 200) : "Episodio " + n,
      });
    }
  }
  eps.sort(function (a, b) {
    return a.season !== b.season ? a.season - b.season : a.number - b.number;
  });
  var meta = { title: detail.name || title };
  var pp = poster(detail.poster_path, "w342");
  if (pp) meta.poster = pp;
  if (detail.overview) meta.overview = String(detail.overview).slice(0, 600);
  return { series: meta, episodes: eps };
}

function findStream(text) {
  if (!text) return null;
  var m3u = text.match(/https?:\/\/[^"'\s\\<>]+\.m3u8[^"'\s\\<>]*/i);
  if (m3u) {
    return { url: m3u[0].replace(/\\u0026/g, "&").replace(/\\/g, ""), mime: "application/x-mpegURL" };
  }
  var mp4 = text.match(/https?:\/\/[^"'\s\\<>]+\.mp4[^"'\s\\<>]*/i);
  if (mp4) {
    return { url: mp4[0].replace(/\\u0026/g, "&").replace(/\\/g, ""), mime: "video/mp4" };
  }
  var file = text.match(/["']file["']\s*:\s*["'](https?:\/\/[^"']+)["']/i);
  if (file) {
    var fu = file[1].replace(/\\u0026/g, "&");
    return { url: fu, mime: /\.m3u8/i.test(fu) ? "application/x-mpegURL" : "video/mp4" };
  }
  return null;
}

async function tryDirect(title) {
  var slug = slugify(title);
  if (!slug) return null;
  var url = DL + "/" + slug + ".mp4";
  try {
    var r = await kino.fetch(url, {
      headers: { Range: "bytes=0-0", "User-Agent": UA },
      timeoutMs: 10000,
    });
    if (r.ok) return { url: url, mime: "video/mp4", headers: { "User-Agent": UA } };
  } catch (e) {}
  return null;
}

export async function resolve(ref) {
  await null;
  var r = String(ref);
  var title = "";
  var extra = "";
  if (r.indexOf("m:") === 0) {
    title = decodeURIComponent(r.slice(2));
  } else if (r.indexOf("e:") === 0) {
    var p = r.split(":");
    title = decodeURIComponent(p[4] || "");
    extra = "&temporada=" + p[2] + "&episodio=" + p[3] + "&esSerie=1&tmdbId=" + p[1];
  } else {
    throw kino.error("not_found", "ref", { userMessage: "No se encontró este título." });
  }

  if (!extra) {
    var direct = await tryDirect(title);
    if (direct) return direct;
  }

  var verUrl = BASE + "/api/ver?titulo=" + encodeURIComponent(title) + extra + "&token=" + TOKEN;
  var html = await getText(verUrl, BASE + "/");
  var found = findStream(html);
  if (!found) {
    var m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (m) {
      var next = absUrl(m[1], verUrl);
      found = findStream(await getText(next, verUrl));
    }
  }
  if (found) {
    return { url: found.url, mime: found.mime, headers: { Referer: verUrl, "User-Agent": UA } };
  }
  throw kino.error("unavailable", "sin stream, html " + html.length, {
    userMessage: "No se encontró el video de este título. Prueba con otro.",
  });
}