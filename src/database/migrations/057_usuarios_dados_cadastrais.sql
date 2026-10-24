-- Dados cadastrais do usuário (contato, identificação, endereço, trabalho) e edição auditada.
--
-- Ficam em tabela própria (1:1 com usuarios) para que as consultas de login/sessão, que só
-- precisam de credencial e cargo, nunca carreguem dado pessoal. CPF é dado pessoal (LGPD): só é
-- devolvido pelo detalhe do usuário (GET /usuarios/:id) a quem pode gerenciar aquele usuário, e
-- nunca entra em lista, log ou na trilha de auditoria (a trilha guarda só o NOME dos campos).
--
-- Aditiva e idempotente. Usuários antigos ficam sem linha aqui até alguém preencher.

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_id_empresa ON usuarios (id, empresa_id);

CREATE TABLE IF NOT EXISTS usuarios_dados (
    usuario_id       INTEGER      PRIMARY KEY,
    empresa_id       INTEGER      NOT NULL REFERENCES empresas(id),
    telefone         VARCHAR(11),
    cpf              CHAR(11),
    data_nascimento  DATE,
    cep              CHAR(8),
    logradouro       VARCHAR(255),
    numero           VARCHAR(20),
    complemento      VARCHAR(100),
    bairro           VARCHAR(100),
    cidade           VARCHAR(100),
    uf               CHAR(2),
    data_admissao    DATE,
    observacoes      TEXT,
    atualizado_em    TIMESTAMP    NOT NULL DEFAULT NOW(),
    atualizado_por   INTEGER,
    CONSTRAINT usuarios_dados_usuario_fk FOREIGN KEY (usuario_id, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT usuarios_dados_atualizado_por_fk FOREIGN KEY (atualizado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT usuarios_dados_telefone_chk CHECK (telefone IS NULL OR telefone ~ '^[0-9]{10,11}$'),
    CONSTRAINT usuarios_dados_cpf_chk CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$'),
    CONSTRAINT usuarios_dados_cep_chk CHECK (cep IS NULL OR cep ~ '^[0-9]{8}$'),
    CONSTRAINT usuarios_dados_uf_chk CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$'),
    CONSTRAINT usuarios_dados_observacoes_chk CHECK (observacoes IS NULL OR length(observacoes) <= 1000)
);

-- Um CPF por empresa (a mesma pessoa pode existir em empresas diferentes).
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_dados_cpf
    ON usuarios_dados (empresa_id, cpf) WHERE cpf IS NOT NULL;

-- Trilha: nova ação 'editar'. `campos` guarda só os NOMES dos campos alterados (nunca os valores,
-- para o CPF não vazar na auditoria). O motivo é opcional em criar e editar.
ALTER TABLE usuarios_eventos ADD COLUMN IF NOT EXISTS campos TEXT[];

ALTER TABLE usuarios_eventos DROP CONSTRAINT IF EXISTS usuarios_eventos_acao_chk;
ALTER TABLE usuarios_eventos ADD CONSTRAINT usuarios_eventos_acao_chk
    CHECK (acao IN ('criar', 'bloquear', 'desbloquear', 'editar'));

ALTER TABLE usuarios_eventos DROP CONSTRAINT IF EXISTS usuarios_eventos_motivo_chk;
ALTER TABLE usuarios_eventos ADD CONSTRAINT usuarios_eventos_motivo_chk
    CHECK (acao IN ('criar', 'editar') OR (motivo IS NOT NULL AND length(btrim(motivo)) >= 3));

ALTER TABLE usuarios_eventos DROP CONSTRAINT IF EXISTS usuarios_eventos_campos_chk;
ALTER TABLE usuarios_eventos ADD CONSTRAINT usuarios_eventos_campos_chk
    CHECK ((acao = 'editar' AND campos IS NOT NULL AND cardinality(campos) > 0) OR (acao <> 'editar' AND campos IS NULL));

-- Reversão manual (não executada pelo runner):
--   ALTER TABLE usuarios_eventos DROP CONSTRAINT usuarios_eventos_campos_chk, DROP COLUMN campos;
--   (recriar usuarios_eventos_acao_chk/motivo_chk como na 055, depois de remover eventos 'editar')
--   DROP TABLE usuarios_dados;
