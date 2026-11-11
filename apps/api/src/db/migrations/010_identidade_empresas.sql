-- Substitui os nomes fictícios usados nas primeiras demonstrações.
-- A cláusula WHERE limita a alteração aos registros conhecidos do seed anterior.
UPDATE tenants
SET razao_social = 'Art Steel Locações',
    nome_fantasia = 'Art Steel Locações'
WHERE nome_fantasia = 'Atlas Locadora'
   OR razao_social = 'Atlas Locadora Demonstração'
   OR nome_fantasia ILIKE '%Art steel locações%'
   OR segmento = 'LOCADORA';

UPDATE tenants
SET razao_social = 'Art Steel',
    nome_fantasia = 'Art Steel'
WHERE nome_fantasia = 'Ferro & Forma'
   OR razao_social = 'Ferro & Forma Demonstração'
   OR nome_fantasia = 'Arts Steel'
   OR segmento = 'SERRALHERIA';
