export const STATUS_EQUIPAMENTO = {
  DISPONIVEL: 'DISPONIVEL',
  LOCADO: 'LOCADO',
  MANUTENCAO: 'MANUTENCAO',
  INATIVO: 'INATIVO',
} as const;

export type StatusEquipamento = (typeof STATUS_EQUIPAMENTO)[keyof typeof STATUS_EQUIPAMENTO];
