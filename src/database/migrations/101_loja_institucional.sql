-- Loja online — dados institucionais editáveis pelo ERP (sem mexer em código): a história da marca e da fundadora, os
-- serviços, o atendimento, as redes sociais e os dados da empresa que o rodapé precisa mostrar.
--
-- * Uma linha por empresa (PK empresa_id). Tudo nasce VAZIO: o sistema nunca preenche texto, link ou dado por conta própria.
--   A loja pública só mostra o que estiver preenchido (nada de botão ou seção "de enfeite").
-- * Só acrescenta: nenhuma tabela, coluna ou contrato existente é alterado. Idempotente. Reversão manual no rodapé.

CREATE TABLE IF NOT EXISTS loja_institucional (
    empresa_id INTEGER PRIMARY KEY REFERENCES empresas(id),
    historia TEXT,
    fundadora_nome VARCHAR(120),
    servicos TEXT,
    atendimento TEXT,
    horario_atendimento VARCHAR(200),
    email_contato VARCHAR(160),
    whatsapp VARCHAR(13),
    instagram_url VARCHAR(300),
    facebook_url VARCHAR(300),
    tiktok_url VARCHAR(300),
    razao_social VARCHAR(160),
    cnpj VARCHAR(14),
    endereco VARCHAR(300),
    atualizado_por INTEGER,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT loja_institucional_whatsapp_chk CHECK (whatsapp IS NULL OR whatsapp ~ '^[0-9]{12,13}$'),
    CONSTRAINT loja_institucional_cnpj_chk CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$'),
    CONSTRAINT loja_institucional_atualizado_por_fk FOREIGN KEY (atualizado_por, empresa_id) REFERENCES usuarios (id, empresa_id)
);

-- Reversão manual (não executada pelo runner; antes, desligue o uso no código):
--   DROP TABLE IF EXISTS loja_institucional;
