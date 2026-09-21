require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();

function obterOrigensPermitidas() {
    return (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((origem) => origem.trim())
        .filter(Boolean);
}

function configurarCors() {
    const origensPermitidas = obterOrigensPermitidas();

    return {
        origin(origin, callback) {
            // Requisições sem Origin (curl, health-check, server-to-server)
            // não são bloqueadas pelo CORS.
            if (!origin) return callback(null, true);

            // Desenvolvimento/testes continuam convenientes sem configuração.
            if (process.env.NODE_ENV !== 'production' && origensPermitidas.length === 0) {
                return callback(null, true);
            }

            if (origensPermitidas.includes(origin)) {
                return callback(null, true);
            }

            return callback(new Error('Origem não permitida pelo CORS'));
        }
    };
}

app.use(helmet());
app.use(cors(configurarCors()));
app.use(express.json());

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
const comprasRoutes = require('./routes/compras');
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
const errorHandler = require('./middlewares/errorHandler');

app.use('/auth', authRoutes);
app.use('/onboarding', onboardingRoutes);
app.use('/produtos', authMiddleware, produtosRoutes);
app.use('/vendas', authMiddleware, vendasRoutes);
app.use('/clientes', authMiddleware, clientesRoutes);
app.use('/canais-venda', authMiddleware, canaisVendaRoutes);
app.use('/dashboard', authMiddleware, requireAdmin, dashboardRoutes);
app.use('/contas-pagar', authMiddleware, requireAdmin, contasPagarRoutes);
app.use('/contas-receber', authMiddleware, requireAdmin, contasReceberRoutes);
app.use('/fornecedores', authMiddleware, requireEstoquista, fornecedoresRoutes);
app.use('/categorias', authMiddleware, requireEstoquista, categoriasRoutes);
app.use('/niveis-categoria', authMiddleware, requireEstoquista, niveisCategoriaRoutes);
app.use('/compras', authMiddleware, requireEstoquista, comprasRoutes);
app.use('/producoes', authMiddleware, requireEstoquista, producoesRoutes);
app.use('/despesas-fixas', authMiddleware, requireAdmin, despesasFixasRoutes);
app.use('/configuracoes-financeiras', authMiddleware, requireAdmin, configuracoesFinanceirasRoutes);
app.use('/financeiro', authMiddleware, requireAdmin, financeiroRoutes);
app.use('/pagamentos', authMiddleware, pagamentosRoutes);
app.use('/parcelas', authMiddleware, parcelasPagamentoRoutes);
app.use(errorHandler);

module.exports = app;