/**
 * Weather from Open-Meteo (free, no key; their free API is for
 * non-commercial use — fine for Jasper's personal briefing). UK units.
 */

const WMO: Record<number, string> = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorms", 96: "Thunderstorms with hail", 99: "Thunderstorms with hail",
};

export function describeWeatherCode(code: number | null | undefined): string {
  return code === null || code === undefined ? "Unknown" : WMO[code] ?? "Mixed";
}

export type WeatherDay = { date: string; summary: string; maxC: number; minC: number; rainChancePct: number | null; windMaxMph: number | null; sunrise: string | null; sunset: string | null };
export type Weather = { location: string; current: { tempC: number; summary: string; windMph: number } | null; days: WeatherDay[] };

const kmhToMph = (k: number) => Math.round(k * 0.621371);

export function forecastUrl(lat: number, lon: number, days = 3) {
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lon));
  u.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
  u.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset");
  u.searchParams.set("timezone", "Europe/London");
  u.searchParams.set("forecast_days", String(Math.min(Math.max(days, 1), 7)));
  return u.toString();
}

export function parseForecast(location: string, json: Record<string, unknown>): Weather {
  const cur = json.current as Record<string, number> | undefined;
  const d = (json.daily ?? {}) as Record<string, unknown[]>;
  const dates = (d.time ?? []) as string[];
  return {
    location,
    current: cur ? { tempC: Math.round(cur.temperature_2m), summary: describeWeatherCode(cur.weather_code), windMph: kmhToMph(cur.wind_speed_10m) } : null,
    days: dates.map((date, i) => ({
      date,
      summary: describeWeatherCode(Number(d.weather_code?.[i])),
      maxC: Math.round(Number(d.temperature_2m_max?.[i])),
      minC: Math.round(Number(d.temperature_2m_min?.[i])),
      rainChancePct: d.precipitation_probability_max?.[i] === null || d.precipitation_probability_max?.[i] === undefined ? null : Number(d.precipitation_probability_max[i]),
      windMaxMph: d.wind_speed_10m_max?.[i] === undefined ? null : kmhToMph(Number(d.wind_speed_10m_max[i])),
      sunrise: typeof d.sunrise?.[i] === "string" ? (d.sunrise[i] as string).slice(11, 16) : null,
      sunset: typeof d.sunset?.[i] === "string" ? (d.sunset[i] as string).slice(11, 16) : null,
    })),
  };
}

/** One spoken sentence for the briefing. */
export function weatherSentence(w: Weather): string {
  const t = w.days[0];
  if (!t) return `Weather for ${w.location} is unavailable.`;
  const rain = t.rainChancePct !== null && t.rainChancePct >= 50 ? ` ${t.rainChancePct}% chance of rain — take a coat.` : t.rainChancePct !== null && t.rainChancePct >= 20 ? ` ${t.rainChancePct}% chance of rain.` : "";
  const wind = t.windMaxMph !== null && t.windMaxMph >= 30 ? ` Windy, gusts around ${t.windMaxMph} mph.` : "";
  return `${w.location}: ${t.summary.toLowerCase()}, ${t.minC}–${t.maxC}°C.${rain}${wind}`;
}

export async function getForecast(lat: number, lon: number, location: string, days = 3): Promise<Weather> {
  const res = await fetch(forecastUrl(lat, lon, days), { next: { revalidate: 1800 } });
  if (!res.ok) throw new Error(`Weather service error ${res.status}`);
  return parseForecast(location, (await res.json()) as Record<string, unknown>);
}

export async function geocode(name: string): Promise<{ name: string; lat: number; lon: number } | null> {
  const u = new URL("https://geocoding-api.open-meteo.com/v1/search");
  u.searchParams.set("name", name);
  u.searchParams.set("count", "1");
  u.searchParams.set("language", "en");
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) return null;
  const j = (await res.json()) as { results?: { name: string; admin1?: string; country_code?: string; latitude: number; longitude: number }[] };
  const r = j.results?.[0];
  return r ? { name: [r.name, r.admin1].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude } : null;
}
