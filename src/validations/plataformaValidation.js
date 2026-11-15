const { z } = require('zod');
const { TEMAS_VISUAIS, SLUG_REGEX, SLUGS_RESERVADOS } = require('../constants/temasVisuais');

// mes = YYYY-MM (mês civil no fuso de Brasília). Sem mes: mês corrente.
const taxasPorEmpresaQuerySchema = z.strictObject({
    mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mes deve estar no formato AAAA-MM').optional()
});

// Data civil AAAA-MM-DD existente (rejeita 2026-02-30).
const dataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD').refine((valor) => {
    const [ano, mes, dia] = valor.split('-').map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}, 'Data inválida');

const justificativa = z.string({ error: 'Justificativa é obrigatória' }).trim().min(3, 'Justificativa é obrigatória').max(500, 'Justificativa muito longa');

const empresaIdParamSchema = z.strictObject({
    id: z.coerce.number().int().positive('Empresa inválida')
});

const trocarPlanoSchema = z.strictObject({
    plano: z.string({ error: 'Plano é obrigatório' }).trim().min(1, 'Plano é obrigatório').max(40),
    vigencia_inicio: dataCivil.optional(),
    justificativa
});

// Percentual em pontos percentuais (0,5 = 0,50%), até 4 casas, como NUMERIC(7,4).
const percentual = z.number({ error: 'Percentual é obrigatório' })
    .min(0, 'Percentual deve estar entre 0 e 100')
    .max(100, 'Percentual deve estar entre 0 e 100')
    .refine((valor) => Math.abs(valor * 10000 - Math.round(valor * 10000)) < 1e-6, 'Percentual aceita no máximo 4 casas decimais');

const definirCondicaoSchema = z.strictObject({
    percentual,
    vigencia_inicio: dataCivil.optional(),
    vigencia_fim: dataCivil.optional(),
    justificativa
});

const encerrarCondicaoSchema = z.strictObject({
    a_partir_de: dataCivil.optional(),
    justificativa
});

// Identidade visual: tema (conjunto fechado) e/ou slug de login (null remove). Slug em minúsculas.
const slug = z.string().trim().toLowerCase()
    .regex(SLUG_REGEX, 'Identificador deve ter 1 a 40 caracteres: letras minúsculas, números e hífen (sem hífen no início ou no fim)')
    .refine((valor) => !SLUGS_RESERVADOS.includes(valor), 'Este identificador é reservado');

const identidadeSchema = z.strictObject({
    tema_visual: z.enum(TEMAS_VISUAIS, { error: 'Tema inválido' }).optional(),
    slug: slug.nullable().optional()
}).refine((dados) => dados.tema_visual !== undefined || dados.slug !== undefined, { message: 'Informe o tema e/ou o identificador' });

// Funcionalidades por empresa: liga (ligada=true) avulso ou desliga (false) mesmo que o plano inclua.
const empresaFuncionalidadeParamSchema = z.strictObject({
    id: z.coerce.number().int().positive('Empresa inválida'),
    codigo: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Funcionalidade inválida').max(40)
});

const definirFuncionalidadeSchema = z.strictObject({
    ligada: z.boolean({ error: 'Informe se a funcionalidade fica ligada ou desligada' }),
    vigencia_inicio: dataCivil.optional(),
    vigencia_fim: dataCivil.optional(),
    justificativa
}).refine((d) => !d.vigencia_inicio || !d.vigencia_fim || d.vigencia_fim >= d.vigencia_inicio,
    { message: 'O fim da vigência não pode ser anterior ao início' });

const removerFuncionalidadeSchema = z.strictObject({ justificativa });

// Limite de usuários por empresa: extras sobre o plano ou exceção sem limite.
const definirLimiteUsuariosSchema = z.strictObject({
    usuarios_extras: z.number({ error: 'Informe quantos usuários extras' }).int('Usuários extras deve ser inteiro')
        .min(0, 'Usuários extras não pode ser negativo').max(1000, 'Usuários extras acima do permitido'),
    ilimitado: z.boolean({ error: 'Informe se a empresa fica sem limite de usuários' }),
    justificativa
});

const removerLimiteUsuariosSchema = z.strictObject({ justificativa });

// ---- Cobrança da taxa da plataforma (Taxas a receber) ----

const { CHAVE_RE: CHAVE_COMPROVANTE_RE } = require('../utils/comprovanteTaxa');

const competencia = z.string({ error: 'Competência é obrigatória' })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'competencia deve estar no formato AAAA-MM');

const STATUS_PERIODO_TAXA = ['aberto', 'fechado', 'parcialmente_pago', 'pago'];
const FORMAS_PAGAMENTO_TAXA = ['pix', 'transferencia', 'boleto'];

// Valor em reais, positivo, até 2 casas (NUMERIC(15,2)).
const centavosExatos = (valor) => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6;
const valorPositivo = z.number({ error: 'Valor é obrigatório' })
    .finite('Valor inválido')
    .positive('Valor deve ser maior que zero')
    .max(1e9, 'Valor muito alto')
    .refine(centavosExatos, 'Valor aceita no máximo 2 casas decimais');

const justificativaLancamento = z.string({ error: 'Justificativa é obrigatória' }).trim()
    .min(5, 'Justificativa deve ter ao menos 5 caracteres').max(500, 'Justificativa muito longa');

// Retry seguro (duplo clique, reenvio): o painel manda a mesma chave para o mesmo lançamento.
const chaveIdempotencia = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, 'Chave de idempotência inválida').optional();

const cobrancaTaxaQuerySchema = z.strictObject({
    competencia,
    empresa_id: z.coerce.number().int().positive('Empresa inválida').optional(),
    status: z.enum(STATUS_PERIODO_TAXA, { error: 'Status inválido' }).optional()
});

// Detalhe por venda (T6): uma empresa por vez, paginado.
const vendasTaxaQuerySchema = z.strictObject({
    competencia,
    empresa_id: z.coerce.number({ error: 'Empresa é obrigatória' }).int().positive('Empresa inválida'),
    somente_divergentes: z.enum(['true', 'false'], { error: 'somente_divergentes deve ser true ou false' }).optional()
        .transform((v) => v === 'true'),
    limit: z.coerce.number().int().min(1, 'limit deve estar entre 1 e 500').max(500, 'limit deve estar entre 1 e 500').optional(),
    offset: z.coerce.number().int().min(0, 'offset inválido').optional()
});

const periodoIdParamSchema = z.strictObject({
    id: z.coerce.number().int().positive('Período inválido')
});

const fecharPeriodoSchema = z.strictObject({
    competencia,
    empresa_id: z.number().int().positive('Empresa inválida').optional()
});

const pagamentoTaxaSchema = z.strictObject({
    valor: valorPositivo,
    data_pagamento: dataCivil,
    forma_pagamento: z.enum(FORMAS_PAGAMENTO_TAXA, { error: 'Forma de pagamento deve ser pix, transferencia ou boleto' }),
    // Chave devolvida por POST /painel/taxas/periodos/:id/comprovantes (o backend confere período e existência).
    comprovante_chave: z.string().max(300).regex(CHAVE_COMPROVANTE_RE, 'Comprovante inválido').optional(),
    chave_idempotencia: chaveIdempotencia
});

const lancamentoIdParamSchema = z.strictObject({
    id: z.coerce.number().int().positive('Lançamento inválido')
});

const perdaoTaxaSchema = z.strictObject({
    valor: valorPositivo,
    justificativa: justificativaLancamento,
    chave_idempotencia: chaveIdempotencia
});

// Ajuste com sinal: positivo aumenta o devido, negativo reduz. Nunca zero.
const ajusteTaxaSchema = z.strictObject({
    valor: z.number({ error: 'Valor é obrigatório' })
        .finite('Valor inválido')
        .refine((v) => v !== 0, 'Ajuste não pode ser zero')
        .refine((v) => Math.abs(v) <= 1e9, 'Valor muito alto')
        .refine(centavosExatos, 'Valor aceita no máximo 2 casas decimais'),
    justificativa: justificativaLancamento,
    venda_id: z.number().int().positive('Venda inválida').optional(),
    chave_idempotencia: chaveIdempotencia
});

module.exports = {
    vendasTaxaQuerySchema,
    lancamentoIdParamSchema,
    cobrancaTaxaQuerySchema,
    periodoIdParamSchema,
    fecharPeriodoSchema,
    pagamentoTaxaSchema,
    perdaoTaxaSchema,
    ajusteTaxaSchema,
    empresaFuncionalidadeParamSchema,
    definirFuncionalidadeSchema,
    removerFuncionalidadeSchema,
    definirLimiteUsuariosSchema,
    removerLimiteUsuariosSchema,
    identidadeSchema,
    taxasPorEmpresaQuerySchema,
    empresaIdParamSchema,
    trocarPlanoSchema,
    definirCondicaoSchema,
    encerrarCondicaoSchema
};
