-- Trilha de encerramento de planos e condições comerciais por empresa.
--
-- A 048 registra quem CRIOU cada linha (responsavel) mas não quem a ENCERROU nem
-- por quê. Com a tela de administração (operador da plataforma) isso passa a
-- importar. As colunas novas não estão na lista protegida pelos gatilhos da 048,
-- então podem ser preenchidas no encerramento; o resto do histórico segue imutável.

ALTER TABLE empresa_planos
    ADD COLUMN IF NOT EXISTS encerrado_por VARCHAR(255),
    ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMP,
    ADD COLUMN IF NOT EXISTS motivo_encerramento TEXT;

ALTER TABLE condicoes_comerciais_empresa
    ADD COLUMN IF NOT EXISTS encerrado_por VARCHAR(255),
    ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMP,
    ADD COLUMN IF NOT EXISTS motivo_encerramento TEXT;
