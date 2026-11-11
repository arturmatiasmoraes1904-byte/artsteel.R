import { z } from 'zod';
export const quoteSchema = z.object({
  descricao_projeto: z.string().min(3).max(300),
  liga: z.enum(['ACO', 'INOX', 'ALUMINIO']),
  comprimento_m: z.number().positive().max(1000),
  largura_mm: z.number().positive().max(10000),
  espessura_mm: z.number().positive().max(1000),
  quantidade: z.number().int().positive().max(10000),
  preco_por_kg: z.number().positive().max(100000),
  horas: z.number().nonnegative().max(100000),
  custo_hora: z.number().nonnegative().max(100000),
  custo_acabamento: z.number().nonnegative().max(10000000),
  margem_lucro_pct: z.number().min(0).max(90)
}).strict();
export function calculateQuote(input: z.infer<typeof quoteSchema>) {
  const density = { ACO: 7850, INOX: 8000, ALUMINIO: 2700 }[input.liga];
  // Rectangular solid / sheet geometry. Hollow profiles require net cross-section.
  const peso = input.comprimento_m * input.largura_mm / 1000 * input.espessura_mm / 1000 * density * input.quantidade;
  const material = peso * input.preco_por_kg;
  const labor = input.horas * input.custo_hora;
  const cost = material + labor + input.custo_acabamento;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { peso_total_calculado_kg: round(peso), custo_materia_prima: round(material), custo_mao_obra: round(labor), custo_acabamento: input.custo_acabamento, margem_lucro_pct: input.margem_lucro_pct, valor_final: round(cost / (1 - input.margem_lucro_pct / 100)) };
}
