ALTER TABLE transacoes_financeiras ADD COLUMN IF NOT EXISTS producao_card_id uuid REFERENCES producao_cards(id);
CREATE UNIQUE INDEX IF NOT EXISTS transacoes_financeiras_producao_card_unique ON transacoes_financeiras(producao_card_id) WHERE producao_card_id IS NOT NULL;
