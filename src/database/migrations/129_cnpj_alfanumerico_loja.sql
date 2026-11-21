-- 129: CNPJ alfanumérico (IN RFB 2.229/2024, emitido desde julho de 2026) na loja institucional.
--
-- A constraint original exigia 14 dígitos. O CNPJ passa a ter 12 posições 0-9/A-Z (maiúsculas) e os 2 dígitos verificadores
-- numéricos. A API normaliza (sem pontuação, maiúsculas) e confere os dígitos verificadores; o banco só garante o formato.
-- Todo valor numérico existente continua válido. Sem alteração de dado. Idempotente.

ALTER TABLE loja_institucional DROP CONSTRAINT IF EXISTS loja_institucional_cnpj_chk;
ALTER TABLE loja_institucional ADD CONSTRAINT loja_institucional_cnpj_chk CHECK (cnpj IS NULL OR cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$');

-- Reversão manual (não executada pelo runner; só se nenhum CNPJ tiver letra):
--   ALTER TABLE loja_institucional DROP CONSTRAINT loja_institucional_cnpj_chk;
--   ALTER TABLE loja_institucional ADD CONSTRAINT loja_institucional_cnpj_chk CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$');
