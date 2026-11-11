-- Older Supabase databases may have been bootstrapped before soft-delete columns
-- were introduced. Keep customer listing and deletion compatible with that schema.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS clientes_tenant_deleted_idx ON clientes(tenant_id, deleted_at);
