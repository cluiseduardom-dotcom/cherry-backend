require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const AppError = require('./errors/AppError');
const rejeitarNumerosNaoFinitos = require('./middlewares/rejeitarNumerosNaoFinitos');

const app = express();

// Atrás do proxy do Render, req.ip precisa vir do X-Forwarded-For; sem isso
// todos os clientes parecem ter o IP do proxy e dividem o mesmo rate limit.
// Número de proxies confiáveis configurável (TRUST_PROXY_HOPS); padrão 1 em
// production/staging. Nunca `true`: aceitaria IP forjado pelo cliente.
function obterSaltosProxyConfiaveis() {
    const configurado = Number.parseInt(process.env.TRUST_PROXY_HOPS, 10);

    if (Number.isInteger(configurado) && configurado >= 0) return configurado;

    return ['production', 'staging'].includes(process.env.NODE_ENV) ? 1 : 0;
}

app.set('trust proxy', obterSaltosProxyConfiaveis());

function obterOrigensPermitidas() {
    return (process.env.CORS_ORIGINS || '')
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
app.use(express.json());
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
const pagamentosRoutes = require('./routes/pagamentos');
const parcelasPagamentoRoutes = require('./routes/parcelasPagamento');
const authRoutes = require('./routes/authRoutes');
const onboardingRoutes = require('./routes/onboarding');
const authMiddleware = require('./middlewares/authMiddleware');
const requireAdmin = require('./middlewares/requireAdmin');
const requireEstoquista = require('./middlewares/requireEstoquista');
const requireVendedor = require('./middlewares/requireVendedor');
const errorHandler = require('./middlewares/errorHandler');

app.use('/auth', authRoutes);
app.use('/onboarding', onboardingRoutes);
app.use('/produtos', authMiddleware, produtosRoutes);
app.use('/vendas', authMiddleware, vendasRoutes);
app.use('/clientes', authMiddleware, requireVendedor, clientesRoutes);
app.use('/canais-venda', authMiddleware, canaisVendaRoutes);
app.use('/dashboard', authMiddleware, requireAdmin, dashboardRoutes);
app.use('/contas-pagar', authMiddleware, requireAdmin, contasPagarRoutes);
app.use('/contas-receber', authMiddleware, requireAdmin, contasReceberRoutes);
app.use('/fornecedores', authMiddleware, requireEstoquista, fornecedoresRoutes);
app.use('/categorias', authMiddleware, requireEstoquista, categoriasRoutes);
app.use('/niveis-categoria', authMiddleware, requireEstoquista, niveisCategoriaRoutes);
app.use('/configuracoes-sku', authMiddleware, requireAdmin, configuracoesSkuRoutes);
app.use('/compras', authMiddleware, requireEstoquista, comprasRoutes);
app.use('/recebimentos', authMiddleware, requireEstoquista, recebimentosRoutes);
app.use('/producoes', authMiddleware, requireEstoquista, producoesRoutes);
app.use('/despesas-fixas', authMiddleware, requireAdmin, despesasFixasRoutes);
app.use('/configuracoes-financeiras', authMiddleware, requireAdmin, configuracoesFinanceirasRoutes);
app.use('/financeiro', authMiddleware, requireAdmin, financeiroRoutes);
app.use('/pagamentos', authMiddleware, pagamentosRoutes);
app.use('/parcelas', authMiddleware, parcelasPagamentoRoutes);
app.use(errorHandler);

module.exports = app;