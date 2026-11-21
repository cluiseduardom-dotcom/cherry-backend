-- 126: preparo fiscal. Só CADASTRO: nenhuma nota é emitida. Guarda o que uma NF-e/NFC-e vai pedir e que o sistema ainda não tinha.
--
--  empresa_fiscal : uma linha por empresa, com regime tributário, inscrição estadual e municipal, CNAE principal,
--                   código IBGE do município e ambiente (homologação/produção). O CNPJ, a razão social e o endereço
--                   já vivem em `empresas` (tela Dados da empresa) e não são duplicados aqui.
--  produtos       : ncm, cest, origem_mercadoria e unidade_fiscal, todos opcionais (produto sem esses dados segue como era).
-- NÃO guarda segredo (certificado digital, CSC) nem regra tributária (CST/CSOSN, alíquotas, IBS/CBS da reforma tributária):
-- isso depende do contador e das notas técnicas vigentes e fica para a etapa de emissão.
-- Funcionalidade NOVA `fiscal_cadastro` (vendavel = true; nenhum plano a inclui; a GiroNex liga avulso). O módulo `fiscal` do catálogo
-- (emissão de nota, migration 089) continua "em breve": assim o site público não anuncia uma emissão que ainda não existe.
-- Idempotente. Reversão manual no rodapé.

CREATE TABLE IF NOT EXISTS empresa_fiscal (
    empresa_id            INTEGER      PRIMARY KEY REFERENCES empresas (id),
    regime_tributario     VARCHAR(30),
    inscricao_estadual    VARCHAR(14),
    inscricao_municipal   VARCHAR(20),
    cnae_principal        VARCHAR(7),
    codigo_municipio_ibge VARCHAR(7),
    ambiente              VARCHAR(12)  NOT NULL DEFAULT 'homologacao',
    atualizado_por        INTEGER,
    atualizado_em         TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT empresa_fiscal_atualizado_por_fk FOREIGN KEY (atualizado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT empresa_fiscal_regime_chk CHECK (regime_tributario IS NULL OR regime_tributario IN ('mei', 'simples_nacional', 'simples_nacional_excesso', 'lucro_presumido', 'lucro_real')),
    CONSTRAINT empresa_fiscal_ie_chk CHECK (inscricao_estadual IS NULL OR inscricao_estadual = 'ISENTO' OR inscricao_estadual ~ '^[0-9]{2,14}$'),
    CONSTRAINT empresa_fiscal_cnae_chk CHECK (cnae_principal IS NULL OR cnae_principal ~ '^[0-9]{7}$'),
    CONSTRAINT empresa_fiscal_ibge_chk CHECK (codigo_municipio_ibge IS NULL OR codigo_municipio_ibge ~ '^[0-9]{7}$'),
    CONSTRAINT empresa_fiscal_ambiente_chk CHECK (ambiente IN ('homologacao', 'producao'))
);

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ncm VARCHAR(8)
    CONSTRAINT produtos_ncm_chk CHECK (ncm IS NULL OR ncm ~ '^[0-9]{8}$');
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cest VARCHAR(7)
    CONSTRAINT produtos_cest_chk CHECK (cest IS NULL OR cest ~ '^[0-9]{7}$');
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS origem_mercadoria SMALLINT
    CONSTRAINT produtos_origem_chk CHECK (origem_mercadoria IS NULL OR origem_mercadoria BETWEEN 0 AND 8);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS unidade_fiscal VARCHAR(6)
    CONSTRAINT produtos_unidade_fiscal_chk CHECK (unidade_fiscal IS NULL OR unidade_fiscal ~ '^[A-Z]{1,6}$');

INSERT INTO funcionalidades (codigo, nome, tipo, vendavel) VALUES
    ('fiscal_cadastro', 'Fiscal: cadastro para emissão de nota (NCM, origem e dados da empresa)', 'modulo', true)
ON CONFLICT (codigo) DO NOTHING;

-- Reversão manual (não executada pelo runner; só vale se os dados fiscais podem ser descartados):
--   DELETE FROM funcionalidades WHERE codigo = 'fiscal_cadastro';
--   ALTER TABLE produtos DROP COLUMN IF EXISTS unidade_fiscal, DROP COLUMN IF EXISTS origem_mercadoria,
--       DROP COLUMN IF EXISTS cest, DROP COLUMN IF EXISTS ncm;
--   DROP TABLE IF EXISTS empresa_fiscal;
