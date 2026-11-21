const { z } = require('zod');
const {
    REGIMES_TRIBUTARIOS, AMBIENTES_FISCAIS, ncmValido, cestValido, origemValida, unidadeFiscalValida, inscricaoEstadualValida, cnaeValido, codigoMunicipioValido
} = require('../utils/fiscal');

// Máscara não é erro: "7117.19.00", "4781-4/00" e "123.456.789.110" são aceitos e gravados só com os dígitos.
// Campo desconhecido (empresa_id, cnpj, preço...) é recusado, nunca ignorado.
const tiraMascara = (v) => (typeof v === 'string' ? v.replace(/[.\-/\s]/g, '') : v);
const opcionalNulo = (schema) => schema.nullable().optional();

const ncmSchema = z.preprocess(tiraMascara, z.string({ error: 'NCM inválido' }).refine(ncmValido, 'NCM inválido (8 dígitos, capítulo de 01 a 97)'));
const cestSchema = z.preprocess(tiraMascara, z.string({ error: 'CEST inválido' }).refine(cestValido, 'CEST inválido (7 dígitos)'));
const origemSchema = z.number({ error: 'Origem da mercadoria inválida (0 a 8)' }).refine(origemValida, 'Origem da mercadoria inválida (0 a 8)');
const unidadeSchema = z.string({ error: 'Unidade fiscal inválida' }).trim().toUpperCase().refine(unidadeFiscalValida, 'Unidade fiscal inválida (1 a 6 letras, ex.: UN, KG)');

const inscricaoEstadualSchema = z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim().toUpperCase() === 'ISENTO' ? 'ISENTO' : tiraMascara(v.trim())) : v),
    z.string({ error: 'Inscrição estadual inválida' }).refine(inscricaoEstadualValida, 'Inscrição estadual inválida (só números, 2 a 14 dígitos, ou ISENTO)')
);

const empresaFiscalSchema = z.strictObject({
    regime_tributario: opcionalNulo(z.enum(REGIMES_TRIBUTARIOS, { error: 'Regime tributário inválido' })),
    inscricao_estadual: opcionalNulo(inscricaoEstadualSchema),
    inscricao_municipal: opcionalNulo(z.string({ error: 'Inscrição municipal inválida' }).trim().min(1, 'Inscrição municipal inválida').max(20, 'Inscrição municipal muito longa')),
    cnae_principal: opcionalNulo(z.preprocess(tiraMascara, z.string({ error: 'CNAE inválido' }).refine(cnaeValido, 'CNAE inválido (7 dígitos)'))),
    codigo_municipio_ibge: opcionalNulo(z.preprocess(tiraMascara, z.string({ error: 'Código do município inválido' }).refine(codigoMunicipioValido, 'Código do município inválido (7 dígitos, tabela IBGE)'))),
    ambiente: z.enum(AMBIENTES_FISCAIS, { error: 'Ambiente inválido (homologacao ou producao)' }).optional()
}).refine((d) => Object.keys(d).length > 0, { message: 'Informe ao menos um campo para atualizar' });

const camposProduto = {
    ncm: opcionalNulo(ncmSchema),
    cest: opcionalNulo(cestSchema),
    origem_mercadoria: opcionalNulo(origemSchema),
    unidade_fiscal: opcionalNulo(unidadeSchema)
};

const produtoFiscalSchema = z.strictObject(camposProduto)
    .refine((d) => Object.keys(d).length > 0, { message: 'Informe ao menos um campo para atualizar' });

// Em lote não se limpa campo (null recusado): apagar NCM de 200 produtos de uma vez seria um erro caro.
const loteSchema = z.strictObject({
    produto_ids: z.array(z.coerce.number({ error: 'Produto inválido' }).int('Produto inválido').positive('Produto inválido'), { error: 'Informe os produtos' })
        .min(1, 'Informe ao menos um produto')
        .max(200, 'No máximo 200 produtos por vez')
        .refine((ids) => new Set(ids).size === ids.length, { message: 'Produto repetido na lista' }),
    ncm: ncmSchema.optional(),
    cest: cestSchema.optional(),
    origem_mercadoria: origemSchema.optional(),
    unidade_fiscal: unidadeSchema.optional()
}).refine((d) => ['ncm', 'cest', 'origem_mercadoria', 'unidade_fiscal'].some((c) => d[c] !== undefined), { message: 'Informe ao menos um dado fiscal para aplicar' });

const listarProdutosFiscaisSchema = z.object({
    filtro: z.enum(['pendentes', 'todos'], { error: 'Filtro inválido (pendentes ou todos)' }).default('pendentes'),
    q: z.string().trim().max(100).optional()
});

module.exports = { empresaFiscalSchema, produtoFiscalSchema, loteSchema, listarProdutosFiscaisSchema };
