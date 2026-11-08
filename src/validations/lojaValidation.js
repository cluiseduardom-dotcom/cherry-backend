const { z } = require('zod');
const crypto = require('node:crypto');
const { LIMITE_PADRAO, LIMITE_MAXIMO, MAX_ITENS_POR_PEDIDO, MAX_QUANTIDADE_POR_ITEM } = require('../constants/loja');

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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Pedido do visitante. Estrito: nenhum campo extra (nem empresa_id, nem preço total, nem frete) é aceito.
// `preco_exibido` NÃO é o preço cobrado: serve só para o servidor detectar que o preço mudou desde que a cliente viu.
const pedidoSchema = z.object({
    cliente: z.object({
        nome: z.string({ error: 'Informe o nome' }).trim().min(2, 'Informe o nome').max(120, 'Nome deve ter no máximo 120 caracteres'),
        email: z.string({ error: 'Informe o e-mail' }).trim().toLowerCase().max(160, 'E-mail muito longo').regex(EMAIL, 'Informe um e-mail válido'),
        telefone: z.string().trim().transform((v) => v.replace(/\D/g, '')).refine((v) => v === '' || (v.length >= 10 && v.length <= 13), 'Telefone inválido')
            .transform((v) => v || undefined).optional()
    }).strict(),
    itens: z.array(z.object({
        slug: z.string({ error: 'Produto inválido' }).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Produto inválido').max(160, 'Produto inválido'),
        quantidade: z.number({ error: 'Quantidade inválida' }).int('Quantidade inválida').min(1, 'Quantidade inválida').max(MAX_QUANTIDADE_POR_ITEM, `Quantidade máxima por item: ${MAX_QUANTIDADE_POR_ITEM}`),
        preco_exibido: z.number({ error: 'Preço exibido inválido' }).finite('Preço exibido inválido').positive('Preço exibido inválido').max(1000000, 'Preço exibido inválido')
    }).strict(), { error: 'Informe os itens do pedido' })
        .min(1, 'O pedido precisa de ao menos um item')
        .max(MAX_ITENS_POR_PEDIDO, `O pedido aceita no máximo ${MAX_ITENS_POR_PEDIDO} itens`)
        .refine((itens) => new Set(itens.map((i) => i.slug)).size === itens.length, 'Item repetido: some as quantidades')
}).strict();

const CHAVE_IDEMPOTENCIA = /^[A-Za-z0-9_-]{8,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Impressão digital do conteúdo do pedido (cliente + itens em ordem fixa). Mesma chave com outro hash = recusada.
function hashDoPedido({ cliente, itens }) {
    const canonico = {
        c: { n: cliente.nome, e: cliente.email, t: cliente.telefone ?? '' },
        i: [...itens].sort((a, b) => a.slug.localeCompare(b.slug)).map((i) => [i.slug, i.quantidade, Number(i.preco_exibido).toFixed(2)])
    };

    return crypto.createHash('sha256').update(JSON.stringify(canonico)).digest('hex');
}

module.exports = { catalogoQuerySchema, marcacaoSchema, pedidoSchema, hashDoPedido, CHAVE_IDEMPOTENCIA, UUID, ORDENS };
