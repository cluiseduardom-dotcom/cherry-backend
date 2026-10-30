-- Catálogo comercial da taxa da plataforma (VERTUMNO/GiroOne).
--
-- Decisão do Product Owner (30/10/2026): a taxa incide SÓ sobre a parte da venda
-- paga em Pix. Planos e percentuais sobre o Pix:
--   cortesia  (sem mensalidade, acesso concedido para conquistar/testar cliente) 0,50%
--   basico    (com mensalidade)                                                 0,50%
--   padrao    (com mensalidade)                                                 0,40%
--   pro       (com mensalidade)                                                 0,30%
--
-- Migration nova, sem editar as 046/048. Os planos legados sem_mensalidade e
-- com_mensalidade continuam existindo: sem_mensalidade segue como plano padrão de
-- empresa sem plano cadastrado (taxa de produção em 0,50%, ajustada por dados).
-- Atribuir um plano a uma empresa continua sendo ato da GiroOne (empresa_planos),
-- nunca de rota de tenant.
--
-- As políticas começam em 30/10/2026 (início da vigência da regra); só há uma
-- política ativa por plano e período (constraint de exclusão da 048).

INSERT INTO planos_comerciais (codigo, nome, tem_mensalidade) VALUES
    ('cortesia', 'Plano cortesia', false),
    ('basico',   'Plano básico',   true),
    ('padrao',   'Plano padrão',   true),
    ('pro',      'Plano Pro',      true)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO politicas_taxa_plataforma (tipo, percentual, vigencia_inicio, vigencia_fim, ativo, descricao, plano_id)
SELECT 'percentual', v.percentual, DATE '2026-10-30', NULL, true, v.descricao, p.id
FROM (VALUES
    ('cortesia', 0.5000::numeric, 'Plano cortesia: 0,50% sobre o Pix'),
    ('basico',   0.5000::numeric, 'Plano básico: 0,50% sobre o Pix'),
    ('padrao',   0.4000::numeric, 'Plano padrão: 0,40% sobre o Pix'),
    ('pro',      0.3000::numeric, 'Plano Pro: 0,30% sobre o Pix')
) AS v(codigo, percentual, descricao)
JOIN planos_comerciais p ON p.codigo = v.codigo
WHERE NOT EXISTS (
    SELECT 1 FROM politicas_taxa_plataforma t WHERE t.plano_id = p.id AND t.ativo
);
