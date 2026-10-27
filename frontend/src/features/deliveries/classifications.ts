export type DeliveryTransportType = "PROPRIA" | "TERCEIRIZADA";
export type NonDeliveryReasonGroup =
  | "TRANSPORTE_PROPRIO"
  | "TRANSPORTE_TERCEIRIZADO"
  | "LOJA"
  | "LOGISTICA";

export const deliveryTransportTypes: Array<{ value: DeliveryTransportType; label: string }> = [
  { value: "PROPRIA", label: "Entregas próprias" },
  { value: "TERCEIRIZADA", label: "Entregas terceirizadas" },
];

export const nonDeliveryReasonGroups: Array<{ value: NonDeliveryReasonGroup; label: string }> = [
  { value: "TRANSPORTE_PROPRIO", label: "Transporte próprio" },
  { value: "TRANSPORTE_TERCEIRIZADO", label: "Transporte terceirizado" },
  { value: "LOJA", label: "Loja" },
  { value: "LOGISTICA", label: "Logística" },
];

export function deliveryTransportLabel(value: DeliveryTransportType | null | undefined): string {
  return deliveryTransportTypes.find((item) => item.value === value)?.label ?? "Sem classificação";
}

export function nonDeliveryReasonGroupLabel(value: NonDeliveryReasonGroup | null | undefined): string {
  return nonDeliveryReasonGroups.find((item) => item.value === value)?.label ?? "Grupo pendente";
}
