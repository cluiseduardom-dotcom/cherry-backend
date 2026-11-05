-- Nomes comerciais dos planos e limite de usuários do Básico (PO, 05/11/2026).
--
-- Duas linhas de nome para os mesmos planos (o `codigo` interno não muda, a regra da Cortesia depende dele):
--   linha geral   (planos_comerciais.nome):        Semente · Cultivo · Pomar
--   linha de joias (planos_comerciais.nome_joias): Pérola · Esmeralda · Safira
-- Cortesia e os planos legados (sem_mensalidade, com_mensalidade) são internos e não ganham nome comercial.
-- O Básico passa de 3 para 5 usuários (a Cortesia, que vira Básico no 3º mês, segue em 3).
-- Só atualiza o que ainda está no valor original (idempotente; não sobrescreve ajuste posterior). Aditiva.
-- Reversão manual no rodapé.

ALTER TABLE planos_comerciais ADD COLUMN IF NOT EXISTS nome_joias VARCHAR(100);

UPDATE planos_comerciais p
SET nome = v.nome, nome_joias = v.nome_joias
FROM (VALUES
    ('basico', 'Plano básico', 'Semente',  'Pérola'),
    ('padrao', 'Plano padrão', 'Cultivo',  'Esmeralda'),
    ('pro',    'Plano Pro',    'Pomar',    'Safira')
) AS v(codigo, nome_antigo, nome, nome_joias)
WHERE p.codigo = v.codigo AND p.nome = v.nome_antigo;

UPDATE planos_comerciais SET limite_usuarios = 5 WHERE codigo = 'basico' AND limite_usuarios = 3;

-- Reversão manual (não executada pelo runner):
--   UPDATE planos_comerciais SET nome = CASE codigo WHEN 'basico' THEN 'Plano básico' WHEN 'padrao' THEN 'Plano padrão' WHEN 'pro' THEN 'Plano Pro' END
--     WHERE codigo IN ('basico','padrao','pro');
--   UPDATE planos_comerciais SET limite_usuarios = 3 WHERE codigo = 'basico';
--   ALTER TABLE planos_comerciais DROP COLUMN IF EXISTS nome_joias;
