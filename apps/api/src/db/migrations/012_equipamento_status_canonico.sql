UPDATE equipamentos SET status = 'LOCADO' WHERE status = 'ALUGADO';
UPDATE equipamentos SET status = 'INATIVO' WHERE status = 'BAIXADO';
ALTER TABLE equipamentos DROP CONSTRAINT IF EXISTS equipamentos_status_check;
ALTER TABLE equipamentos ADD CONSTRAINT equipamentos_status_check CHECK (status IN ('DISPONIVEL','LOCADO','ALUGADO','MANUTENCAO','INATIVO'));
