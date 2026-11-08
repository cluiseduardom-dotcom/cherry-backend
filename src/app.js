require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const AppError = require('./errors/AppError');
const rejeitarNumerosNaoFinitos = require('./middlewares/rejeitarNumerosNaoFinitos');

const app = express();

// Atrás do proxy do Render, req.ip precisa vir do X-Forwarded-For; sem isso
// todos os clientes parecem ter o IP do proxy e dividem o mesmo rate limit.
// TRUST_PROXY_HOPS é o número de proxies confiáveis à frente do app e é
// OBRIGATÓRIO em production/staging: não existe padrão seguro, porque um valor
// menor que o real faz o app ler o IP de um nó de borda que muda a cada
// requisição (rate limit ineficaz) e um maior aceita IP forjado pelo cliente.
// Nunca `true`. Em development/test, ausente vale 0.
function obterSaltosProxyConfiaveis(env = process.env) {
    const exigido = ['production', 'staging'].includes(env.NODE_ENV);
    const valor = env.TRUST_PROXY_HOPS === undefined ? '' : String(env.TRUST_PROXY_HOPS).trim();

    if (valor === '') {
        if (exigido) {
            throw new Error(
                `TRUST_PROXY_HOPS deve ser configurado em ${env.NODE_ENV} ` +
                '(número de proxies confiáveis à frente do app; atrás do Cloudflare e do proxy do Render o valor validado foi 2)'
            );
        }

        return 0;
    }

    if (!/^\d+$/.test(valor)) {
        throw new Error('TRUST_PROXY_HOPS inválido: informe um número inteiro maior ou igual a 0');
    }

    return Number(valor);
}

app.set('trust proxy', obterSaltosProxyConfiaveis());

// PAINEL_CORS_ORIGINS: origem do Painel GiroNex, separada da allowlist do ERP para poder ser
// trocada (ex.: domínio próprio) sem mexer nas origens das lojas.
// LOJA_CORS_ORIGINS: origens da loja online (e-commerce), separadas pelo mesmo motivo.
// SITE_CORS_ORIGINS: origens do site público (marketing), pelo mesmo motivo: acrescentar ou trocar o
// endereço do site não exige editar CORS_ORIGINS, que protege o login das lojas.
function obterOrigensPermitidas() {
    return [process.env.CORS_ORIGINS, process.env.PAINEL_CORS_ORIGINS, process.env.SITE_CORS_ORIGINS, process.env.LOJA_CORS_ORIGINS].filter(Boolean).join(',')
        .split(',')
        .map((origem) => origem.trim())
        .filter(Boolean);
}

// Só development/test têm o bypass permissivo de conveniência — staging
// roda num serviço Render público com banco/JWT reais e recebe o mesmo
// hardening de produção (ver src/config/runtimeConfig.js). Allow-list
// positiva, não "tudo exceto production": um NODE_ENV inesperado/vazio
// também fica sem bypass.
const AMBIENTES_SEM_HARDENING_CORS = new Set(['development', 'test']);

function configurarCors() {
    const origensPermitidas = obterOrigensPermitidas();

    return {
        origin(origin, callback) {
            // Requisições sem Origin (curl, health-check, server-to-server)
            // não são bloqueadas pelo CORS.
            if (!origin) return callback(null, true);

            const nodeEnv = process.env.NODE_ENV || 'development';

            // Desenvolvimento/testes continuam convenientes sem configuração.
            if (AMBIENTES_SEM_HARDENING_CORS.has(nodeEnv) && origensPermitidas.length === 0) {
                return callback(null, true);
            }

            if (origensPermitidas.includes(origin)) {
                return callback(null, true);
            }

            return callback(new AppError('Origem não permitida pelo CORS', 403));
        }
    };
}

app.use(helmet());
app.use(cors(configurarCors()));
// A importação de extrato (/bancos/importacoes) recebe arquivo no corpo e tem parser próprio, aplicado só depois
// da autenticação (routes/bancos.js); todo o resto usa o limite padrão.
const jsonPadrao = express.json();
app.use((req, res, next) => (req.path.startsWith('/bancos/importacoes') ? next() : jsonPadrao(req, res, next)));
app.use(rejeitarNumerosNaoFinitos);

// Health-check público pra monitoramento de uptime: sem auth, sem tocar no
// banco — só confirma que o processo Node está de pé.
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// ROTAS
const produtosRoutes = require('./routes/produtos');
const vendasRoutes = require('./routes/vendas');
const clientesRoutes = require('./routes/clientes');
const canaisVendaRoutes = require('./routes/canaisVenda');
const dashboardRoutes = require('./routes/dashboard');
const notificacoesRoutes = require('./routes/notificacoes');
const consumosRoutes = require('./routes/consumos');
const contasPagarRoutes = require('./routes/contasPagar');
const contasReceberRoutes = require('./routes/contasReceber');
const fornecedoresRoutes = require('./routes/fornecedores');
const categoriasRoutes = require('./routes/categorias');
const niveisCategoriaRoutes = require('./routes/niveisCategoria');
const configuracoesSkuRoutes = require('./routes/configuracoesSku');
const comprasRoutes = require('./routes/compras');
const recebimentosRoutes = require('./routes/recebimentos');
const producoesRoutes = require('./routes/producoes');
const despesasFixasRoutes = require('./routes/despesasFixas');
const configuracoesFinanceirasRoutes = require('./routes/configuracoesFinanceiras');
const financeiroRoutes = require('./routes/financeiro');
const bancosRoutes = require('./routes/bancos');
const pagamentosRoutes = require('./routes/pagamentos');
const parcelasPagamentoRoutes = require('./routes/parcelasPagamento');
const authRoutes = require('./routes/authRoutes');
const onboardingRoutes = require('./routes/onboarding');
const authMiddleware = require('./middlewares/authMiddleware');
const requireAdmin = require('./middlewares/requireAdmin');
const exigirFuncionalidade = require('./middlewares/exigirFuncionalidade');
const empresaRoutes = require('./routes/empresa');
const painelRoutes = require('./routes/painel');
const publicoRoutes = require('./routes/publico');
const lojaRoutes = require('./routes/loja');
const lojaPedidosRoutes = require('./routes/lojaPedidos');
const integracoesMercadoPagoRoutes = require('./routes/integracoesMercadoPago');
const pagamentosGatewayRoutes = require('./routes/pagamentosGateway');
const webhooksMercadoPagoRoutes = require('./routes/webhooksMercadoPago');
const requireEstoquista = require('./middlewares/requireEstoquista');
const requireVendedor = require('./middlewares/requireVendedor');
const requireCapacidade = require('./middlewares/requireCapacidade');
const { CAPACIDADES } = require('./constants/cargos');
const cargosRoutes = require('./routes/cargos');
const privilegiosRoutes = require('./routes/privilegios');
const cancelamentosRoutes = require('./routes/cancelamentos');
const usuariosRoutes = require('./routes/usuarios');
const comissoesRoutes = require('./routes/comissoes');
const estoqueRoutes = require('./routes/estoque');
const errorHandler = require('./middlewares/errorHandler');

app.use('/auth', authRoutes);
app.use('/publico', publicoRoutes);
app.use('/loja', lojaRoutes);
// Pedidos da loja online para a equipe (admin e vendedor, só com a funcionalidade ligada): traz o contato da cliente.
app.use('/loja-pedidos', authMiddleware, requireVendedor, exigirFuncionalidade('loja_online'), lojaPedidosRoutes);
app.use('/onboarding', onboardingRoutes);
app.use('/produtos', authMiddleware, produtosRoutes);
app.use('/vendas', authMiddleware, vendasRoutes);
app.use('/clientes', authMiddleware, requireVendedor, clientesRoutes);
app.use('/cargos', authMiddleware, requireCapacidade(CAPACIDADES.GERIR_CARGOS), cargosRoutes);
app.use('/privilegios', authMiddleware, requireCapacidade(CAPACIDADES.CONCEDER_ADMIN), privilegiosRoutes);
app.use('/usuarios', authMiddleware, requireCapacidade(CAPACIDADES.GERIR_USUARIOS), usuariosRoutes);
app.use('/cancelamentos', authMiddleware, requireCapacidade(CAPACIDADES.VER_CANCELAMENTOS), cancelamentosRoutes);
// Só o uso do módulo é bloqueado; a venda continua acumulando comissão em silêncio (vendasRepository).
app.use('/comissoes', authMiddleware, exigirFuncionalidade('comissoes'), comissoesRoutes);
app.use('/estoque', authMiddleware, estoqueRoutes);
app.use('/canais-venda', authMiddleware, canaisVendaRoutes);
app.use('/dashboard', authMiddleware, requireCapacidade(CAPACIDADES.VER_DASHBOARD, CAPACIDADES.VER_CUSTOS), dashboardRoutes);
app.use('/notificacoes', authMiddleware, notificacoesRoutes);
app.use('/empresa', authMiddleware, requireAdmin, empresaRoutes);
// Painel GiroNex: operadores separados dos usuários das lojas, com sessão própria (PAINEL_JWT_SECRET) e 2FA.
app.use('/painel', painelRoutes);
// Mercado Pago: conexão da loja (admin; o retorno do OAuth é público, por `state`), cobrança Pix
// (admin/vendedor) e webhook público protegido por assinatura. Sem as variáveis MP_* respondem 503.
app.use('/integracoes/mercadopago', integracoesMercadoPagoRoutes);
app.use('/pagamentos-gateway', authMiddleware, requireVendedor, pagamentosGatewayRoutes);
app.use('/webhooks/mercadopago', webhooksMercadoPagoRoutes);
// Admin e estoquista; só GET /consumos/indicadores abre também por capacidade (ver routes/consumos.js).
app.use('/consumos', authMiddleware, consumosRoutes);
app.use('/contas-pagar', authMiddleware, requireAdmin, contasPagarRoutes);
app.use('/contas-receber', authMiddleware, requireAdmin, contasReceberRoutes);
app.use('/fornecedores', authMiddleware, requireEstoquista, fornecedoresRoutes);
app.use('/categorias', authMiddleware, requireEstoquista, categoriasRoutes);
app.use('/niveis-categoria', authMiddleware, requireEstoquista, niveisCategoriaRoutes);
app.use('/configuracoes-sku', authMiddleware, requireAdmin, configuracoesSkuRoutes);
app.use('/compras', authMiddleware, requireEstoquista, comprasRoutes);
app.use('/recebimentos', authMiddleware, requireEstoquista, recebimentosRoutes);
app.use('/producoes', authMiddleware, requireEstoquista, producoesRoutes);
app.use('/despesas-fixas', authMiddleware, requireAdmin, exigirFuncionalidade('analise_financeira'), despesasFixasRoutes);
app.use('/configuracoes-financeiras', authMiddleware, requireAdmin, configuracoesFinanceirasRoutes);
app.use('/financeiro', authMiddleware, requireAdmin, financeiroRoutes);
app.use('/bancos', authMiddleware, requireCapacidade(CAPACIDADES.GERIR_FINANCEIRO), exigirFuncionalidade('bancos'), bancosRoutes);
app.use('/pagamentos', authMiddleware, pagamentosRoutes);
app.use('/parcelas', authMiddleware, parcelasPagamentoRoutes);
app.use(errorHandler);

module.exports = app;