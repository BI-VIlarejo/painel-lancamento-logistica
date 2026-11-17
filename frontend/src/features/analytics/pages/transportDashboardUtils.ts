import { numericValue, tariffSourceLabel } from "../../freights/format";
import type { FreightResponse } from "../../freights/types";
import type { DeliveryItemResponse, DeliveryParticipantResponse } from "../../deliveries/types";

export type CarrierDescriptor = {
  key: string;
  label: string;
  kind: "aggregate" | "carrier" | "own-fleet" | "unidentified";
  driver: string | null;
};

export type TransportDeliveryRecord = {
  launchCode: string;
  item: DeliveryItemResponse;
  carrier: CarrierDescriptor;
  driver: string | null;
};

function identityPart(value: string): string {
  return value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function importSource(item: FreightResponse): Record<string, unknown> | null {
  const value = item.detalhe_calculo.importacao_planilha;
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function carrierFromCode(code: "PAULO_CRUZ" | "JUST_IN_TIME"): string {
  return tariffSourceLabel(code);
}

export function freightCarrier(item: FreightResponse): CarrierDescriptor {
  if (item.tipo_transporte === "PROPRIO") {
    return { key: "PROPRIO::FROTA", label: "Frota própria", kind: "own-fleet", driver: null };
  }

  if (item.tipo_transporte === "TRANSPORTADORA") {
    const code = item.codigo_fonte_tarifa === "PAULO_CRUZ" || item.codigo_fonte_tarifa === "JUST_IN_TIME"
      ? item.codigo_fonte_tarifa
      : null;
    const carrierName = code ? carrierFromCode(code) : item.nome_transportador?.trim();
    if (code || carrierName) {
      const key = code ? `TRANSPORTADORA::${code}` : `TRANSPORTADORA::NOME::${identityPart(carrierName!)}`;
      return {
        key,
        label: carrierName || "Transportadora não identificada",
        kind: "carrier",
        driver: item.nome_motorista_transportadora?.trim() || null,
      };
    }
    return { key: "NAO_IDENTIFICADO::TRANSPORTADORA", label: "Transportadora não identificada", kind: "unidentified", driver: null };
  }

  const source = importSource(item);
  const name = item.nome_transportador?.trim();
  if (source?.tipo_transporte_identificado === false && !name) {
    return { key: "NAO_IDENTIFICADO::AGREGADO", label: "Agregado não identificado", kind: "unidentified", driver: null };
  }
  if (name) {
    return { key: `AGREGADO::${identityPart(name)}`, label: name, kind: "aggregate", driver: name };
  }
  return { key: "NAO_IDENTIFICADO::AGREGADO", label: "Agregado não identificado", kind: "unidentified", driver: null };
}

/** Repete a regra do relatório financeiro: usa o líquido salvo ou bruto menos avaria e exclui pendências. */
export function transportPaymentAmount(item: FreightResponse): number | null {
  const savedAmount = numericValue(item.valor_frete_pago);
  const gross = numericValue(item.valor_frete_bruto);
  const amount = savedAmount ?? (gross === null ? null : gross - (numericValue(item.valor_avaria) ?? 0));
  if (amount === null) return null;
  if (item.status_calculo === "CALCULADO") return amount;

  const source = importSource(item);
  const importedResponsibleIsClear = source !== null
    && Boolean(item.nome_transportador?.trim())
    && source.tipo_transporte_identificado !== false
    && !(item.tipo_transporte === "AGREGADO" && source.vinculo_responsavel_status === "AMBIGUO");
  return importedResponsibleIsClear ? amount : null;
}

export function transportKilometers(item: FreightResponse): number | null {
  const saved = numericValue(item.km_rodado);
  if (saved !== null) return saved;
  const importedValue = importSource(item)?.km_rodado_planilha;
  return typeof importedValue === "string" || typeof importedValue === "number"
    ? numericValue(importedValue)
    : null;
}

export function deliveryCarrier(participant: DeliveryParticipantResponse | undefined): CarrierDescriptor {
  if (!participant) {
    return { key: "NAO_IDENTIFICADO::MOTORISTA", label: "Motorista não identificado", kind: "unidentified", driver: null };
  }
  const name = participant.nome_exibicao?.trim() || "Motorista não identificado";
  if (participant.tipo_transporte_entrega === "PROPRIA") {
    return { key: "PROPRIO::FROTA", label: "Frota própria", kind: "own-fleet", driver: name };
  }
  if (participant.modalidade_terceirizada === "AGREGADO") {
    return { key: `AGREGADO::${identityPart(name)}`, label: name, kind: "aggregate", driver: name };
  }
  if (participant.modalidade_terceirizada === "TRANSPORTADORA_INDEPENDENTE"
    && (participant.codigo_transportadora_independente === "PAULO_CRUZ" || participant.codigo_transportadora_independente === "JUST_IN_TIME")) {
    return {
      key: `TRANSPORTADORA::${participant.codigo_transportadora_independente}`,
      label: carrierFromCode(participant.codigo_transportadora_independente),
      kind: "carrier",
      driver: name,
    };
  }
  return {
    key: `NAO_IDENTIFICADO::${identityPart(name) || participant.id_pessoa}`,
    label: `Transportador não identificado · ${name}`,
    kind: "unidentified",
    driver: name,
  };
}

export function cityRegionLabel(item: FreightResponse): string {
  return item.rota_cidade?.trim() || "Cidade / rota não informada";
}

export function deliveryCityRegionLabel(item: DeliveryItemResponse): string {
  const city = item.cidade?.trim();
  const uf = item.uf?.trim();
  if (city && uf) return `${city} / ${uf}`;
  if (city) return city;
  return item.nome_localidade?.trim() || "Cidade não informada";
}

export function deliveryOccurrenceCount(record: TransportDeliveryRecord): number {
  return record.item.motivos
    .filter((reason) => reason.tipo_operacao === "ENTREGA")
    .reduce((sum, reason) => sum + reason.quantidade, 0);
}
