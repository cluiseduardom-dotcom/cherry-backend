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
    carrossel_novidades: z.boolean({ error: 'carrossel_novidades deve ser verdadeiro ou falso' }).optional(),
    destaque_home: z.boolean({ error: 'destaque_home deve ser verdadeiro ou falso' }).optional(),
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
        .refine((itens) => new Set(itens.map((i) => i.slug)).size === itens.length, 'Item repetido: some as quantidades'),
    // Token do Turnstile. Não entra na impressão digital do pedido: um retry traz outro token e é o mesmo pedido.
    captcha_token: z.string().trim().min(1).max(2048, 'Verificação de segurança inválida').optional()
}).strict();

// Pagamento do pedido: só o método. Valor, pedido e loja vêm do servidor.
const pagamentoSchema = z.object({
    metodo: z.enum(['pix', 'cartao'], { error: 'Escolha Pix ou cartão' })
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

module.exports = { catalogoQuerySchema, marcacaoSchema, pedidoSchema, pagamentoSchema, hashDoPedido, CHAVE_IDEMPOTENCIA, UUID, ORDENS };

// ---- Gestão dos pedidos pela equipe ----
const gestaoQuerySchema = z.object({
    situacao: z.enum(['a_combinar', 'combinadas', 'todos'], { error: 'Situação inválida' }).default('a_combinar'),
    limite: z.coerce.number().int().min(1, 'Limite inválido').max(50, 'Limite inválido').default(20),
    pagina: z.coerce.number().int().min(1, 'Página inválida').max(1000, 'Página inválida').default(1)
});

const entregaCombinadaSchema = z.object({
    observacao: z.string().trim().max(500, 'Observação deve ter no máximo 500 caracteres').transform((v) => v || null).nullable().optional()
}).strict();

const produtosGestaoQuerySchema = z.object({
    situacao: z.enum(['todos', 'publicados', 'nao_publicados', 'no_carrossel'], { error: 'Situação inválida' }).default('todos'),
    busca: z.string().trim().max(80, 'Busca deve ter no máximo 80 caracteres').transform((v) => v || undefined).optional(),
    limite: z.coerce.number().int().min(1, 'Limite inválido').max(50, 'Limite inválido').default(20),
    pagina: z.coerce.number().int().min(1, 'Página inválida').max(1000, 'Página inválida').default(1)
});

module.exports.produtosGestaoQuerySchema = produtosGestaoQuerySchema;
module.exports.gestaoQuerySchema = gestaoQuerySchema;
module.exports.entregaCombinadaSchema = entregaCombinadaSchema;

// ---- Retratos da Home (gestão) ----
// Criar: só texto alternativo e nome (a foto vem no campo "arquivo"). Vazio vira null.
const textoOpcional = (max) => z.string().trim().max(max, `Texto deve ter no máximo ${max} caracteres`).transform((v) => v || null).optional().transform((v) => v ?? null);

const retratoCriarSchema = z.object({
    alt: textoOpcional(300),
    nome: textoOpcional(120)
}).strict();

// Atualizar: estrito. A autorização só se confirma com `autorizacao_assinada: true` (quem e quando ficam registrados).
const retratoAtualizarSchema = z.object({
    alt: z.string().max(300, 'A descrição deve ter no máximo 300 caracteres').transform((v) => v.trim() || null).nullable().optional(),
    nome: z.string().max(120, 'O nome deve ter no máximo 120 caracteres').transform((v) => v.trim() || null).nullable().optional(),
    ordem: z.number().int('Ordem inválida').min(0, 'Ordem inválida').max(100000, 'Ordem inválida').optional(),
    ativo: z.boolean({ error: 'ativo deve ser verdadeiro ou falso' }).optional(),
    autorizacao_assinada: z.boolean({ error: 'autorizacao_assinada deve ser verdadeiro ou falso' }).optional()
}).strict();

module.exports.retratoCriarSchema = retratoCriarSchema;
module.exports.retratoAtualizarSchema = retratoAtualizarSchema;

// ---- Dados institucionais da loja (gestão) ----
const REDES = { instagram_url: ['instagram.com'], facebook_url: ['facebook.com', 'fb.com'], tiktok_url: ['tiktok.com'] };

function urlDaRede(rede) {
    const dominios = REDES[rede];

    return z.string().trim().max(300, 'O link deve ter no máximo 300 caracteres').nullable().optional().transform((v, ctx) => {
        if (v === null || v === undefined || v === '') return null;

        let u;
        try { u = new URL(v); } catch { ctx.addIssue({ code: 'custom', message: 'Link inválido: copie o endereço completo do perfil (começa com https://)' }); return z.NEVER; }

        const host = u.hostname.toLowerCase();
        const ok = u.protocol === 'https:' && !u.username && !u.password && dominios.some((d) => host === d || host.endsWith(`.${d}`));

        if (!ok) { ctx.addIssue({ code: 'custom', message: `O link precisa ser de ${dominios[0]} e começar com https://` }); return z.NEVER; }

        return u.toString();
    });
}

const textoLivre = (max, rotulo) => z.string().max(max, `${rotulo} deve ter no máximo ${max} caracteres`).transform((v) => v.trim() || null).nullable().optional();

// CNPJ: 14 dígitos com os dois dígitos verificadores corretos.
function cnpjValido(d) {
    if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;

    const dv = (base) => {
        let soma = 0;
        let peso = base.length - 7;
        for (const n of base) { soma += Number(n) * peso; peso = peso === 2 ? 9 : peso - 1; }
        const r = soma % 11;
        return r < 2 ? 0 : 11 - r;
    };

    return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}

const institucionalSchema = z.object({
    historia: textoLivre(6000, 'A história'),
    fundadora_nome: textoLivre(120, 'O nome'),
    servicos: textoLivre(1500, 'Os serviços'),
    atendimento: textoLivre(1000, 'O texto de atendimento'),
    horario_atendimento: textoLivre(200, 'O horário'),
    email_contato: z.string().trim().max(160, 'O e-mail deve ter no máximo 160 caracteres').nullable().optional().transform((v, ctx) => {
        if (!v) return null;
        if (!EMAIL.test(v)) { ctx.addIssue({ code: 'custom', message: 'E-mail inválido' }); return z.NEVER; }
        return v.toLowerCase();
    }),
    // Aceita "(11) 99999-9999" e "5511999999999"; guarda só dígitos com o 55 do Brasil.
    whatsapp: z.string().max(30).nullable().optional().transform((v, ctx) => {
        const digitos = String(v ?? '').replace(/\D/g, '');
        if (!digitos) return null;
        const completo = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
        if (!/^\d{12,13}$/.test(completo)) { ctx.addIssue({ code: 'custom', message: 'WhatsApp inválido: informe o DDD e o número (ex.: 11 99999-9999)' }); return z.NEVER; }
        return completo;
    }),
    instagram_url: urlDaRede('instagram_url'),
    facebook_url: urlDaRede('facebook_url'),
    tiktok_url: urlDaRede('tiktok_url'),
    razao_social: textoLivre(160, 'A razão social'),
    cnpj: z.string().max(30).nullable().optional().transform((v, ctx) => {
        const digitos = String(v ?? '').replace(/\D/g, '');
        if (!digitos) return null;
        if (!cnpjValido(digitos)) { ctx.addIssue({ code: 'custom', message: 'CNPJ inválido' }); return z.NEVER; }
        return digitos;
    }),
    endereco: textoLivre(300, 'O endereço')
}).strict();

module.exports.institucionalSchema = institucionalSchema;
module.exports.cnpjValido = cnpjValido;
