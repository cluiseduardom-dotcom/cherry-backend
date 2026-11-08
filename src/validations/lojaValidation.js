const { z } = require('zod');
const { LIMITE_PADRAO, LIMITE_MAXIMO } = require('../constants/loja');

const ORDENS = ['destaque', 'novidades', 'mais_vendidos', 'preco_asc', 'preco_desc', 'nome'];

const codigo = z.string().regex(/^[A-Za-z0-9]{1,3}$/, 'Código de categoria inválido').transform((v) => v.toUpperCase());
const dinheiro = z.coerce.number({ error: 'Preço inválido' }).finite('Preço inválido').min(0, 'Preço inválido').max(1000000, 'Preço inválido');
const booleano = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

// Query do catálogo público. Parâmetro desconhecido é ignorado; valor inválido é 400 (nunca vira SQL).
const catalogoQuerySchema = z.object({
    n1: codigo.optional(),
    n2: codigo.optional(),
    n3: codigo.optional(),
    q: z.string().trim().min(2, 'Busca deve ter ao menos 2 caracteres').max(60, 'Busca deve ter no máximo 60 caracteres').optional(),
    preco_min: dinheiro.optional(),
    preco_max: dinheiro.optional(),
    novidades: booleano.optional(),
    disponivel: booleano.optional(),
    ordem: z.enum(ORDENS, { error: 'Ordenação inválida' }).optional(),
    pagina: z.coerce.number().int().min(1, 'Página inválida').max(1000, 'Página inválida').default(1),
    limite: z.coerce.number().int().min(1, 'Limite inválido').max(LIMITE_MAXIMO, 'Limite inválido').default(LIMITE_PADRAO)
}).refine((v) => v.preco_min == null || v.preco_max == null || v.preco_min <= v.preco_max, { message: 'Faixa de preço inválida' });

const texto = (max) => z.string().max(max, `Texto deve ter no máximo ${max} caracteres`).transform((v) => v.trim() || null).nullable();

// Gestão da marcação do produto. Estrito: campo desconhecido é erro (ex.: preço e estoque NÃO se editam aqui).
const marcacaoSchema = z.object({
    visivel: z.boolean({ error: 'visivel deve ser verdadeiro ou falso' }).optional(),
    titulo: texto(160).optional(),
    descricao: texto(4000).optional(),
    materiais: texto(2000).optional(),
    cuidados: texto(2000).optional(),
    ordem: z.number().int('Ordem inválida').min(0, 'Ordem inválida').max(100000, 'Ordem inválida').optional()
}).strict();

module.exports = { catalogoQuerySchema, marcacaoSchema, ORDENS };
