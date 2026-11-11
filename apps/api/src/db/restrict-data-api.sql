-- Fastify is the sole data entry point, including for the identity catalogue.
DO $$ DECLARE tab text; api_role text; BEGIN
  FOREACH tab IN ARRAY ARRAY['users','tenants','user_tenants','clientes','equipamentos','contratos_locacao','itens_contrato','ordens_manutencao','materias_primas','orcamentos_projetos','ordens_servico_serralheria','faturas','schema_migrations'] LOOP
    IF to_regclass('public.' || tab) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', tab);
      FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
        IF EXISTS (SELECT FROM pg_roles WHERE rolname=api_role) THEN
          EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', tab, api_role);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

