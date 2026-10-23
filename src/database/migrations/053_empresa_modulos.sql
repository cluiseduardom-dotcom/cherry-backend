-- Módulos habilitáveis por empresa (ADR-007). Aditiva e idempotente. A ativação é decidida
-- só pela GiroOne (nenhuma rota de tenant escreve aqui) e validada no backend a cada
-- requisição pelo middleware exigirModulo. Sem linha = módulo desligado.
-- Desligar não apaga dados do módulo: apenas bloqueia novas operações.
-- Reversão manual no rodapé.
CREATE TABLE IF NOT EXISTS empresa_modulos (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    modulo VARCHAR(30) NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT true,
    justificativa TEXT NOT NULL,
    responsavel VARCHAR(120) NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT empresa_modulos_modulo_chk
        CHECK (modulo IN ('grade', 'fracionario', 'rastreio_unidade', 'fiscal', 'multi_pdv', 'servicos_agenda')),
    CONSTRAINT empresa_modulos_justificativa_chk CHECK (btrim(justificativa) <> ''),
    CONSTRAINT empresa_modulos_responsavel_chk CHECK (btrim(responsavel) <> ''),
    CONSTRAINT empresa_modulos_empresa_modulo_uk UNIQUE (empresa_id, modulo)
);

-- Reversão manual (não executada pelo runner):
--   DROP TABLE IF EXISTS empresa_modulos;
