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

export function tariffSourceLabel(source: FreightTariffSource): string {
  if (source === "AGREGADOS_CD") return "Agregados CD";
  if (source === "JUST_IN_TIME") return "JUST IN TIME";
  return "Paulo Cruz";
}
