-- Issue #87: revogação de acesso. `ativo` desliga o usuário; `token_version`
-- invalida em bloco todos os JWTs já emitidos (o token carrega a versão e o
-- authMiddleware compara com o valor atual). Aditiva: usuários existentes
-- continuam ativos e na versão 0, e tokens antigos (sem a claim) valem como 0.
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
