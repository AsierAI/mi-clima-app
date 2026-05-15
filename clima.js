/** Open-Meteo: https://open-meteo.com/ — sin API key */

const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

const DEFAULT_LAT = 40.4168;
const DEFAULT_LON = -3.7038;
const DEFAULT_NAME = "Madrid, España";

const HOURLY_VARS = [
  "temperature_2m",
  "relative_humidity_2m",
  "apparent_temperature",
  "dew_point_2m",
  "precipitation_probability",
  "precipitation",
  "rain",
  "showers",
  "snowfall",
  "weather_code",
  "cloud_cover",
  "pressure_msl",
  "surface_pressure",
  "visibility",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
];

/** @type {{ data: object, label: string } | null} */
let cache = null;
/** @type {"daily" | "hourly"} */
let viewMode = "daily";
/** Columna activa para colorear filas (clave de HOURLY_COLUMNS); null = sin resaltar. */
let hourlyHeatmapKey = null;

/** WMO Weather interpretation codes (Open-Meteo) */
function weatherFromCode(code) {
  if (code === 0) return { icon: "☀️", desc: "Despejado" };
  if (code === 1) return { icon: "🌤️", desc: "Mayormente despejado" };
  if (code === 2) return { icon: "⛅", desc: "Parcialmente nublado" };
  if (code === 3) return { icon: "☁️", desc: "Nublado" };
  if (code === 45 || code === 48) return { icon: "🌫️", desc: "Niebla" };
  if (code >= 51 && code <= 55) return { icon: "🌦️", desc: "Llovizna" };
  if (code >= 56 && code <= 57) return { icon: "🌨️", desc: "Llovizna helada" };
  if (code >= 61 && code <= 65) return { icon: "🌧️", desc: "Lluvia" };
  if (code >= 66 && code <= 67) return { icon: "🌧️", desc: "Lluvia helada" };
  if (code >= 71 && code <= 77) return { icon: "❄️", desc: "Nieve" };
  if (code >= 80 && code <= 82) return { icon: "🌧️", desc: "Chubascos" };
  if (code >= 85 && code <= 86) return { icon: "🌨️", desc: "Chubascos de nieve" };
  if (code === 95) return { icon: "⛈️", desc: "Tormenta" };
  if (code >= 96 && code <= 99) return { icon: "⛈️", desc: "Tormenta con granizo" };
  return { icon: "🌡️", desc: "Variado" };
}

function sameCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDayLabel(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameCalendarDay(d, today)) return "Hoy";
  if (sameCalendarDay(d, tomorrow)) return "Mañana";
  return d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "short" });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const WD_SHORT = ["dom.", "lun.", "mar.", "mié.", "jue.", "vie.", "sáb."];
const MO_SHORT = [
  "ene.",
  "feb.",
  "mar.",
  "abr.",
  "may.",
  "jun.",
  "jul.",
  "ago.",
  "sep.",
  "oct.",
  "nov.",
  "dic.",
];

/** Etiqueta de fecha/hora en calendario gregoriano (hora local del pronóstico, sin desfase del navegador). */
function wallClockLabel(iso) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const hh = Number(m[4]);
  const mi = Number(m[5]);
  const wd = new Date(Date.UTC(y, mo - 1, da, 12)).getUTCDay();
  return `${WD_SHORT[wd]} ${da} ${MO_SHORT[mo - 1]} ${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

function windDirLabel(deg) {
  if (deg == null || Number.isNaN(deg)) return "—";
  const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  const i = ((Math.round(deg / 45) % 8) + 8) % 8;
  return `${dirs[i]} ${Math.round(deg)}°`;
}

function fmtNum(v, decimals = 1) {
  if (v == null || Number.isNaN(v)) return "—";
  return Number(v).toFixed(decimals);
}

function fmtInt(v) {
  if (v == null || Number.isNaN(v)) return "—";
  return String(Math.round(v));
}

function visibilityKm(m) {
  if (m == null || Number.isNaN(m)) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

async function geocodeCity(query) {
  const params = new URLSearchParams({
    name: query.trim(),
    count: "5",
    language: "es",
    format: "json",
  });
  const res = await fetch(`${GEO_URL}?${params}`);
  if (!res.ok) throw new Error("No se pudo buscar la ciudad.");
  const data = await res.json();
  const r = data.results?.[0];
  if (!r) throw new Error("Ciudad no encontrada.");
  return {
    lat: r.latitude,
    lon: r.longitude,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
  };
}

async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "wind_speed_10m_max",
    ].join(","),
    hourly: HOURLY_VARS.join(","),
    timezone: "auto",
    forecast_days: "7",
  });
  const res = await fetch(`${FORECAST_URL}?${params}`);
  if (!res.ok) throw new Error("No se pudo obtener el pronóstico.");
  return res.json();
}

function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg;
  el.hidden = false;
}

function hideError() {
  const el = document.getElementById("error-msg");
  el.hidden = true;
}

function renderDaily(data, locationLabel) {
  const daily = data.daily;
  if (!daily?.time?.length) throw new Error("Sin datos de pronóstico diario.");

  document.getElementById("location-label").textContent = locationLabel;

  const times = daily.time.slice(0, 7);
  const codes = daily.weather_code;
  const tMax = daily.temperature_2m_max;
  const tMin = daily.temperature_2m_min;
  const precip = daily.precipitation_probability_max;
  const wind = daily.wind_speed_10m_max;

  const todayCard = document.getElementById("today-card");
  const w0 = weatherFromCode(codes[0]);
  document.getElementById("today-icon").textContent = w0.icon;
  document.getElementById("today-temp").textContent = `${Math.round(tMax[0])}° / ${Math.round(tMin[0])}°`;
  document.getElementById("today-desc").textContent = w0.desc;

  const meta = document.getElementById("today-meta");
  meta.innerHTML = "";
  const items = [
    ["Máx.", `${Math.round(tMax[0])}°C`],
    ["Mín.", `${Math.round(tMin[0])}°C`],
    ["Lluvia (máx.)", precip[0] != null ? `${precip[0]}%` : "—"],
    ["Viento (máx.)", wind[0] != null ? `${Math.round(wind[0])} km/h` : "—"],
  ];
  for (const [label, value] of items) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="meta-label">${label}</span><strong>${value}</strong>`;
    meta.appendChild(li);
  }
  todayCard.hidden = false;

  const list = document.getElementById("forecast-list");
  list.innerHTML = "";
  for (let i = 0; i < times.length; i++) {
    const w = weatherFromCode(codes[i]);
    const li = document.createElement("li");
    const dayName = capitalize(formatDayLabel(times[i]));
    li.innerHTML = `
      <span class="day-name">${dayName}</span>
      <span class="day-icon" aria-hidden="true">${w.icon}</span>
      <p class="day-desc">${w.desc}</p>
      <span class="temps">${Math.round(tMax[i])}° <span class="temp-min">/ ${Math.round(tMin[i])}°</span></span>
    `;
    list.appendChild(li);
  }
}

/**
 * heat: tipo de escala para colorear filas al pulsar la cabecera.
 * undefined = cabecera quita el resaltado (Hora, Estado, Dir.).
 */
const HOURLY_COLUMNS = [
  { key: "time", title: "Hora (local del lugar)", abbr: "Hora", fmt: (row) => row._timeStr },
  {
    key: "state",
    title: "Estado",
    abbr: "Estado",
    fmt: (r) => r._iconOnly,
    tdTitle: (r) => r._stateDesc,
  },
  { key: "temperature_2m", title: "Temperatura (°C)", abbr: "T", fmt: (r) => fmtInt(r.temperature_2m), heat: "temp" },
  { key: "apparent_temperature", title: "Sensación (°C)", abbr: "Sens.", fmt: (r) => fmtInt(r.apparent_temperature), heat: "temp" },
  { key: "dew_point_2m", title: "Punto rocío (°C)", abbr: "Rocío", fmt: (r) => fmtInt(r.dew_point_2m), heat: "temp" },
  { key: "relative_humidity_2m", title: "Humedad relativa (%)", abbr: "Hum.", fmt: (r) => fmtInt(r.relative_humidity_2m), heat: "numeric" },
  {
    key: "precipitation_probability",
    title: "Prob. precipitación (%)",
    abbr: "P.prec.",
    fmt: (r) => fmtInt(r.precipitation_probability),
    heat: "precip",
  },
  { key: "precipitation", title: "Precipitación total (mm)", abbr: "Precip.", fmt: (r) => fmtNum(r.precipitation, 2), heat: "numeric" },
  { key: "rain", title: "Lluvia (mm)", abbr: "Lluvia", fmt: (r) => fmtNum(r.rain, 2), heat: "numeric" },
  { key: "showers", title: "Chubascos (mm)", abbr: "Chub.", fmt: (r) => fmtNum(r.showers, 2), heat: "numeric" },
  { key: "snowfall", title: "Nieve (cm)", abbr: "Nieve", fmt: (r) => fmtNum(r.snowfall, 2), heat: "numeric" },
  { key: "weather_code", title: "Código WMO", abbr: "WMO", fmt: (r) => fmtInt(r.weather_code), heat: "numeric" },
  { key: "cloud_cover", title: "Nubosidad (%)", abbr: "Nubes", fmt: (r) => fmtInt(r.cloud_cover), heat: "numeric" },
  { key: "pressure_msl", title: "Presión a nivel del mar (hPa)", abbr: "P.mar", fmt: (r) => fmtNum(r.pressure_msl, 0), heat: "numeric" },
  { key: "surface_pressure", title: "Presión en superficie (hPa)", abbr: "P.sup.", fmt: (r) => fmtNum(r.surface_pressure, 0), heat: "numeric" },
  { key: "visibility", title: "Visibilidad (m)", abbr: "Vis.", fmt: (r) => visibilityKm(r.visibility), heat: "numeric" },
  { key: "wind_speed_10m", title: "Viento a 10 m (km/h)", abbr: "Viento", fmt: (r) => fmtInt(r.wind_speed_10m), heat: "numeric" },
  { key: "wind_direction_10m", title: "Dirección viento", abbr: "Dir.", fmt: (r) => windDirLabel(r.wind_direction_10m) },
  { key: "wind_gusts_10m", title: "Ráfagas (km/h)", abbr: "Ráf.", fmt: (r) => fmtInt(r.wind_gusts_10m), heat: "numeric" },
];

/** @param {number} t 0..1 */
function precipRowGradientCss(t) {
  const lo = `hsla(220, ${10 + t * 12}%, ${9 + t * 10}%, 0.98)`;
  const mid = `hsla(206, ${22 + t * 68}%, ${16 + t * 36}%, 0.94)`;
  const hi = `hsla(188, ${35 + t * 55}%, ${24 + t * 40}%, 0.9)`;
  return `linear-gradient(96deg, ${lo} 0%, ${mid} 42%, ${hi} 100%)`;
}

/** @param {number} t 0..1 frío → caliente */
function tempRowGradientCss(t) {
  const h0 = 232 - t * 168;
  const h1 = 218 - t * 158;
  const a = `hsla(${h0}, ${36 + t * 40}%, ${14 + t * 28}%, 0.97)`;
  const b = `hsla(${h1}, ${48 + t * 32}%, ${20 + t * 32}%, 0.92)`;
  return `linear-gradient(96deg, ${a} 0%, ${b} 100%)`;
}

/** @param {number} t 0..1 escala genérica */
function numericRowGradientCss(t) {
  const a = `hsla(158, ${12 + t * 48}%, ${12 + t * 30}%, 0.96)`;
  const b = `hsla(28, ${18 + t * 58}%, ${18 + t * 34}%, 0.9)`;
  return `linear-gradient(96deg, ${a} 0%, ${b} 100%)`;
}

function heatGradientForType(heatType, t) {
  if (heatType === "precip") return precipRowGradientCss(t);
  if (heatType === "temp") return tempRowGradientCss(t);
  return numericRowGradientCss(t);
}

function normalizeSeries(arr, heatType) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v != null && !Number.isNaN(Number(v))) {
      const n = Number(v);
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
  }
  if (min === Infinity) return { min: 0, max: 1 };
  if (heatType === "precip") {
    return { min: 0, max: Math.max(100, max, 1) };
  }
  if (max === min) {
    return { min: min - 1, max: max + 1 };
  }
  return { min, max };
}

function applyHourlyHeatmap() {
  const table = document.getElementById("hourly-table");
  const tbody = document.getElementById("hourly-tbody");
  const thead = document.getElementById("hourly-thead");
  if (!table || !tbody || !thead || !cache?.data?.hourly) return;

  const ths = thead.querySelectorAll("th");
  ths.forEach((th) => {
    th.classList.remove("th--heat-active");
    th.removeAttribute("aria-selected");
  });

  const rows = tbody.querySelectorAll("tr");
  const clearRowStyles = () => {
    rows.forEach((tr) => {
      tr.classList.remove("hourly-row--heat");
      tr.querySelectorAll("td").forEach((td) => {
        td.style.background = "";
      });
    });
    table.classList.remove("hourly-table--heat");
  };

  clearRowStyles();

  if (!hourlyHeatmapKey) return;

  const col = HOURLY_COLUMNS.find((c) => c.key === hourlyHeatmapKey);
  const heatType = col?.heat;
  if (!heatType) {
    hourlyHeatmapKey = null;
    return;
  }

  const h = cache.data.hourly;
  const arr = h[hourlyHeatmapKey];
  if (!arr || !Array.isArray(arr)) {
    hourlyHeatmapKey = null;
    return;
  }

  const { min, max } = normalizeSeries(arr, heatType);
  const span = max - min || 1;

  rows.forEach((tr, i) => {
    const v = arr[i];
    let t = 0.5;
    if (v != null && !Number.isNaN(Number(v))) {
      t = (Number(v) - min) / span;
      t = Math.max(0, Math.min(1, t));
    }
    const bg = heatGradientForType(heatType, t);
    tr.classList.add("hourly-row--heat");
    tr.querySelectorAll("td").forEach((td) => {
      td.style.background = bg;
    });
  });

  table.classList.add("hourly-table--heat");
  const idx = HOURLY_COLUMNS.findIndex((c) => c.key === hourlyHeatmapKey);
  if (idx >= 0 && ths[idx]) {
    ths[idx].classList.add("th--heat-active");
    ths[idx].setAttribute("aria-selected", "true");
  }
}

function onHourlyTableClick(e) {
  const th = e.target.closest("#hourly-thead th");
  if (!th || !cache?.data?.hourly) return;

  const key = th.dataset.colKey;
  if (key == null) return;

  const col = HOURLY_COLUMNS.find((c) => c.key === key);
  if (!col?.heat) {
    hourlyHeatmapKey = null;
    applyHourlyHeatmap();
    return;
  }

  if (hourlyHeatmapKey === key) {
    hourlyHeatmapKey = null;
  } else {
    hourlyHeatmapKey = key;
  }
  applyHourlyHeatmap();
}

function bindHourlyHeatmapOnce() {
  const table = document.getElementById("hourly-table");
  if (!table || table.dataset.heatBound === "1") return;
  table.dataset.heatBound = "1";
  table.addEventListener("click", onHourlyTableClick);
  table.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const th = e.target.closest("#hourly-thead th");
    if (!th || document.activeElement !== th) return;
    e.preventDefault();
    onHourlyTableClick({ target: th });
  });
}

function renderHourly(data, locationLabel) {
  const h = data.hourly;
  if (!h?.time?.length) throw new Error("Sin datos horarios.");

  document.getElementById("location-label").textContent = locationLabel;

  const n = h.time.length;
  const hint = document.getElementById("hourly-hint");
  hint.textContent = `${n} horas · desplaza horizontalmente · pulsa una cabecera numérica para colorear cada fila (otro clic en la misma quita)`;

  const thead = document.getElementById("hourly-thead");
  const tbody = document.getElementById("hourly-tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const trHead = document.createElement("tr");
  for (const col of HOURLY_COLUMNS) {
    const th = document.createElement("th");
    th.scope = "col";
    th.title = col.heat
      ? `${col.title} — clic para colorear filas por esta magnitud (otro clic quita)`
      : `${col.title} — clic para quitar el color de filas`;
    th.textContent = col.abbr || col.title;
    th.dataset.colKey = col.key;
    th.classList.add("hourly-th");
    th.tabIndex = 0;
    if (col.key === "time") th.classList.add("col-sticky", "col-time");
    if (col.key === "state") th.classList.add("col-sticky", "col-state");
    trHead.appendChild(th);
  }
  thead.appendChild(trHead);

  for (let i = 0; i < n; i++) {
    const iso = h.time[i];
    const row = {
      _timeStr: capitalize(wallClockLabel(iso)),
      _icon: "",
      temperature_2m: h.temperature_2m?.[i],
      apparent_temperature: h.apparent_temperature?.[i],
      dew_point_2m: h.dew_point_2m?.[i],
      relative_humidity_2m: h.relative_humidity_2m?.[i],
      precipitation_probability: h.precipitation_probability?.[i],
      precipitation: h.precipitation?.[i],
      rain: h.rain?.[i],
      showers: h.showers?.[i],
      snowfall: h.snowfall?.[i],
      weather_code: h.weather_code?.[i],
      cloud_cover: h.cloud_cover?.[i],
      pressure_msl: h.pressure_msl?.[i],
      surface_pressure: h.surface_pressure?.[i],
      visibility: h.visibility?.[i],
      wind_speed_10m: h.wind_speed_10m?.[i],
      wind_direction_10m: h.wind_direction_10m?.[i],
      wind_gusts_10m: h.wind_gusts_10m?.[i],
    };
    const w = weatherFromCode(row.weather_code);
    row._iconOnly = w.icon;
    row._stateDesc = w.desc;

    const tr = document.createElement("tr");
    for (const col of HOURLY_COLUMNS) {
      const td = document.createElement("td");
      td.title = col.tdTitle ? col.tdTitle(row) : col.title;
      if (col.key === "time") td.classList.add("col-sticky", "col-time");
      if (col.key === "state") td.classList.add("col-sticky", "col-state");
      td.textContent = col.fmt(row);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  bindHourlyHeatmapOnce();
  applyHourlyHeatmap();
}

function setView(mode) {
  viewMode = mode;
  const app = document.querySelector(".app");
  const btnD = document.getElementById("btn-view-daily");
  const btnH = document.getElementById("btn-view-hourly");
  const panelD = document.getElementById("panel-daily");
  const panelH = document.getElementById("panel-hourly");

  const isDaily = mode === "daily";
  btnD.classList.toggle("is-active", isDaily);
  btnH.classList.toggle("is-active", !isDaily);
  btnD.setAttribute("aria-pressed", String(isDaily));
  btnH.setAttribute("aria-pressed", String(!isDaily));
  panelD.hidden = !isDaily;
  panelH.hidden = isDaily;
  app.classList.toggle("app--wide", !isDaily);

  if (cache && !isDaily) {
    try {
      renderHourly(cache.data, cache.label);
    } catch (e) {
      showError(e.message || "Error al mostrar datos horarios.");
    }
  }
}

function applyCacheToView() {
  if (!cache) return;
  hideError();
  try {
    if (viewMode === "daily") {
      renderDaily(cache.data, cache.label);
    } else {
      renderHourly(cache.data, cache.label);
    }
  } catch (e) {
    showError(e.message || "Error al mostrar datos.");
  }
}

document.getElementById("btn-view-daily").addEventListener("click", () => {
  setView("daily");
});

document.getElementById("btn-view-hourly").addEventListener("click", () => {
  if (!cache) return;
  setView("hourly");
});

async function loadAt(lat, lon, label) {
  document.getElementById("location-label").textContent = label || "Obteniendo datos…";
  const data = await fetchForecast(lat, lon);
  cache = { data, label: label || `${lat.toFixed(2)}, ${lon.toFixed(2)}` };
  applyCacheToView();
}

document.getElementById("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = document.getElementById("city-input").value;
  if (!q.trim()) return;
  try {
    hideError();
    const { lat, lon, label } = await geocodeCity(q);
    await loadAt(lat, lon, label);
  } catch (err) {
    showError(err.message || "Error desconocido.");
  }
});

document.getElementById("btn-geo").addEventListener("click", () => {
  if (!navigator.geolocation) {
    showError("Tu navegador no permite geolocalización.");
    return;
  }
  document.getElementById("location-label").textContent = "Obteniendo ubicación…";
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        hideError();
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        await loadAt(lat, lon, `Tu zona (${lat.toFixed(2)}, ${lon.toFixed(2)})`);
      } catch (err) {
        showError(err.message || "Error al cargar el clima.");
      }
    },
    () => {
      showError("Permiso de ubicación denegado o no disponible.");
      loadAt(DEFAULT_LAT, DEFAULT_LON, DEFAULT_NAME).catch((e) => showError(e.message));
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 }
  );
});

(async function init() {
  bindHourlyHeatmapOnce();
  document.getElementById("location-label").textContent = "Cargando pronóstico…";
  try {
    await loadAt(DEFAULT_LAT, DEFAULT_LON, DEFAULT_NAME);
  } catch (err) {
    showError(err.message || "No se pudo conectar con la API.");
    document.getElementById("location-label").textContent = "";
  }
})();

/** RSS de Google News (titulares sobre Trump). Los posteos en redes no suelen ser accesibles por CORS sin backend. */
const TRUMP_GOOGLE_NEWS_RSS =
  "https://news.google.com/rss/search?q=Donald+Trump&hl=es&gl=ES&ceid=ES:es";

function stripTags(html) {
  if (!html) return "";
  const d = document.createElement("div");
  d.innerHTML = html;
  const t = d.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return t.length > 420 ? `${t.slice(0, 420)}…` : t;
}

function parseRssXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML inválido");
  const out = [];
  doc.querySelectorAll("item").forEach((item) => {
    const title = item.querySelector("title")?.textContent?.trim();
    let link = item.querySelector("link")?.textContent?.trim();
    if (!link) link = item.querySelector("link")?.innerHTML?.trim();
    const pub = item.querySelector("pubDate")?.textContent?.trim();
    if (title) out.push({ title, link: link || "#", pubDate: pub, description: "" });
  });
  return out;
}

async function fetchRssViaRss2Json(rssUrl) {
  const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("rss2json");
  const data = await res.json();
  if (data.status !== "ok" || !Array.isArray(data.items) || data.items.length === 0) {
    throw new Error("rss2json vacío");
  }
  return data.items.map((i) => ({
    title: i.title,
    link: i.link || "#",
    pubDate: i.pubDate,
    description: i.description || i.content || "",
  }));
}

async function fetchRssViaAllOrigins(rssUrl) {
  const url = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("allorigins");
  const data = await res.json();
  if (!data.contents) throw new Error("allorigins sin cuerpo");
  const items = parseRssXml(data.contents);
  if (!items.length) throw new Error("sin ítems RSS");
  return items;
}

function renderTrumpFeedError(bodyEl, metaEl, msg) {
  metaEl.textContent = "";
  bodyEl.replaceChildren();
  const p = document.createElement("p");
  p.className = "feed-aside__err";
  p.textContent = msg;
  bodyEl.appendChild(p);
}

async function loadTrumpAside() {
  const bodyEl = document.getElementById("trump-feed-body");
  const metaEl = document.getElementById("trump-feed-meta");
  if (!bodyEl || !metaEl) return;

  bodyEl.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "feed-aside__loading";
  loading.textContent = "Cargando…";
  bodyEl.appendChild(loading);

  let items;
  let sourceNote = "Google News (RSS, agregador)";

  try {
    items = await fetchRssViaRss2Json(TRUMP_GOOGLE_NEWS_RSS);
  } catch {
    try {
      items = await fetchRssViaAllOrigins(TRUMP_GOOGLE_NEWS_RSS);
      sourceNote += " · vía allorigins";
    } catch {
      renderTrumpFeedError(
        bodyEl,
        metaEl,
        "No se pudo cargar el resumen. Prueba «Actualizar» o abre Truth Social: los posteos oficiales no tienen API pública usable aquí sin servidor propio."
      );
      return;
    }
  }

  const first = items[0];
  bodyEl.replaceChildren();

  const h3 = document.createElement("h3");
  h3.className = "feed-aside__headline";
  const a = document.createElement("a");
  a.href = first.link || "#";
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = first.title || "Sin título";
  h3.appendChild(a);
  bodyEl.appendChild(h3);

  if (first.pubDate) {
    const d = new Date(first.pubDate);
    if (!Number.isNaN(d.getTime())) {
      const dateP = document.createElement("p");
      dateP.className = "feed-aside__date";
      dateP.textContent = capitalize(
        d.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })
      );
      bodyEl.appendChild(dateP);
    }
  }

  const snippet = stripTags(first.description);
  if (snippet) {
    const sn = document.createElement("p");
    sn.className = "feed-aside__snippet";
    sn.textContent = snippet;
    bodyEl.appendChild(sn);
  }

  metaEl.textContent = `${sourceNote}. Es el titular más reciente indexado, no el texto literal de Truth Social/X.`;
}

document.getElementById("trump-feed-refresh")?.addEventListener("click", () => {
  loadTrumpAside();
});

loadTrumpAside();

const TRUMP_ASIDE_STORAGE = "clima-trump-aside-collapsed";

function initTrumpAsideCollapse() {
  const aside = document.getElementById("trump-aside");
  const btn = document.getElementById("trump-aside-toggle");
  const icon = btn?.querySelector(".feed-aside__collapse-icon");
  const panel = document.getElementById("trump-aside-panel");
  if (!aside || !btn || !panel || !icon) return;

  const setCollapsed = (collapsed) => {
    aside.classList.toggle("feed-aside--collapsed", collapsed);
    btn.setAttribute("aria-expanded", String(!collapsed));
    btn.title = collapsed ? "Desplegar panel" : "Plegar panel";
    btn.setAttribute(
      "aria-label",
      collapsed ? "Desplegar panel lateral de noticias" : "Plegar panel lateral de noticias"
    );
    icon.textContent = collapsed ? "»" : "«";
    try {
      localStorage.setItem(TRUMP_ASIDE_STORAGE, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  try {
    if (localStorage.getItem(TRUMP_ASIDE_STORAGE) === "1") {
      setCollapsed(true);
    }
  } catch {
    /* ignore */
  }

  btn.addEventListener("click", () => {
    setCollapsed(!aside.classList.contains("feed-aside--collapsed"));
  });
}

initTrumpAsideCollapse();
