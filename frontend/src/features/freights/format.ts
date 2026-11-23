import type { DecimalValue, FreightTariffSource } from "./types";

const currencyFormat = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const numberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

export function numericValue(value: DecimalValue | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const raw = String(value).trim().replace(/\s/g, "");
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatMoney(value: DecimalValue | null | undefined): string {
  const parsed = numericValue(value);
  return parsed === null ? "—" : currencyFormat.format(parsed);
}

export function formatNumber(value: DecimalValue | null | undefined): string {
  const parsed = numericValue(value);
  return parsed === null ? "—" : numberFormat.format(parsed);
}

export function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function localDateValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function firstDayOfCurrentMonth(date = new Date()): string {
  return `${localDateValue(date).slice(0, 7)}-01`;
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parts = value.slice(0, 10).split("-");
  if (parts.length !== 3) return value;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateValue(date);
}

/** Semana operacional de segunda a domingo contendo a data informada. */
export function weekRangeForDate(baseDate = new Date()): { from: string; to: string } {
  const iso = localDateValue(baseDate);
  const date = new Date(`${iso}T12:00:00`);
  const day = date.getDay(); // 0=domingo, 1=segunda
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = addDaysIso(iso, diffToMonday);
  return { from: monday, to: addDaysIso(monday, 6) };
}

export function previousWeekRange(baseDate = new Date()): { from: string; to: string } {
  const current = weekRangeForDate(baseDate);
  return { from: addDaysIso(current.from, -7), to: addDaysIso(current.to, -7) };
}

export function currentFortnightRange(baseDate = new Date()): { from: string; to: string } {
  const iso = localDateValue(baseDate);
  const day = Number(iso.slice(8, 10));
  const yearMonth = iso.slice(0, 7);
  if (day <= 15) {
    return { from: `${yearMonth}-01`, to: `${yearMonth}-15` };
  }
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  const lastDay = new Date(year, month, 0).getDate();
  return { from: `${yearMonth}-16`, to: `${yearMonth}-${String(lastDay).padStart(2, "0")}` };
}

export function currentMonthRange(baseDate = new Date()): { from: string; to: string } {
  const iso = localDateValue(baseDate);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const lastDay = new Date(year, month, 0).getDate();
  return {
    from: `${iso.slice(0, 7)}-01`,
    to: `${iso.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function tariffSourceLabel(source: FreightTariffSource): string {
  if (source === "AGREGADOS_CD") return "Agregados CD";
  if (source === "JUST_IN_TIME") return "JUST IN TIME";
  return "Paulo Cruz";
}
