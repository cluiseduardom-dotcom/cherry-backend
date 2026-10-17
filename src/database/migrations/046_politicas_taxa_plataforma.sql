-- Taxa interna da plataforma (VERTUMNO/GiroOne): POLÍTICA global.
--
-- EXCEÇÃO DELIBERADA à regra "toda tabela de negócio tem empresa_id": esta
-- tabela é da plataforma, não do tenant. Nenhuma rota de tenant escreve nela;
-- ela é administrada pela GiroOne (hoje por migration/SQL; a administração
-- pelo Super Admin é um PR futuro e usa esta mesma estrutura).
--
-- Versionamento lógico: uma política nova é uma LINHA nova (substitui_id aponta
-- para a anterior); a vigência da anterior é encerrada em vigencia_fim. A taxa
-- de cada venda congela o percentual usado em taxas_venda (migration 047),
-- então mudar a política nunca altera vendas já gravadas.
--
-- O EXCLUDE impede duas políticas ATIVAS com vigência sobreposta (não precisa
-- de extensão: && em daterange é nativo do gist).

CREATE TABLE IF NOT EXISTS politicas_taxa_plataforma (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(20) NOT NULL DEFAULT 'percentual'
        CHECK (tipo IN ('percentual')),
    -- 4 casas: 0,1500 = 0,15%
    percentual NUMERIC(7,4) NOT NULL
        CHECK (percentual >= 0 AND percentual <= 100),
    vigencia_inicio DATE NOT NULL,
    vigencia_fim DATE,
    ativo BOOLEAN NOT NULL DEFAULT true,
    substitui_id INTEGER REFERENCES politicas_taxa_plataforma(id),
    descricao TEXT,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_politica_taxa_vigencia
        CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),

    CONSTRAINT ex_politica_taxa_vigencia_ativa
        EXCLUDE USING gist (daterange(vigencia_inicio, vigencia_fim, '[]') WITH &&)
        WHERE (ativo)
);

-- Política inicial aprovada: 0,15% sobre o total da venda, sem mínimo nem
-- máximo, vigente a partir de 2026-10-09 (data de implantação; NÃO retroativa —
-- a taxa só é gerada no momento da venda, então vendas anteriores à ativação
-- nunca recebem taxa). Idempotente: só insere se a tabela estiver vazia.
INSERT INTO politicas_taxa_plataforma (tipo, percentual, vigencia_inicio, vigencia_fim, ativo, descricao)
SELECT 'percentual', 0.1500, DATE '2026-10-09', NULL, true,
       'Política inicial da plataforma: 0,15% sobre o total da venda'
WHERE NOT EXISTS (SELECT 1 FROM politicas_taxa_plataforma);
