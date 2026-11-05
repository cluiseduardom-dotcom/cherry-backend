-- Cortesia acaba sozinha no 3º mês de uso (PO, 05/11/2026): ao atribuir a Cortesia, o Painel grava também um
-- registro sucessor (Básico) que começa no dia seguinte ao fim da Cortesia. Assim a empresa nunca cai em silêncio
-- no plano padrão sem mensalidade e sem limite. Este marcador identifica o registro criado automaticamente, para
-- que a GiroNex possa substituí-lo (plano negociado) sem ser barrada por "plano agendado".
-- Aditiva e idempotente. A trigger de histórico não protege esta coluna (só desativação/encerramento mudam).
-- Reversão manual: ALTER TABLE empresa_planos DROP COLUMN IF EXISTS sucessor_automatico;

ALTER TABLE empresa_planos ADD COLUMN IF NOT EXISTS sucessor_automatico BOOLEAN NOT NULL DEFAULT false;
