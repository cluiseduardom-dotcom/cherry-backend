require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// ROTAS
const produtosRoutes = require('./routes/produtos');
const vendasRoutes = require('./routes/vendas');
const clientesRoutes = require('./routes/clientes');
const canaisVendaRoutes = require('./routes/canaisVenda');
const dashboardRoutes = require('./routes/dashboard');
const contasPagarRoutes = require('./routes/contasPagar');
const contasReceberRoutes = require('./routes/contasReceber');
const fornecedoresRoutes = require('./routes/fornecedores');
const despesasFixasRoutes = require('./routes/despesasFixas');
const configuracoesFinanceirasRoutes = require('./routes/configuracoesFinanceiras');
const financeiroRoutes = require('./routes/financeiro');
const authRoutes = require('./routes/authRoutes');
const authMiddleware = require('./middlewares/authMiddleware');
const requireAdmin = require('./middlewares/requireAdmin');
const requireEstoquista = require('./middlewares/requireEstoquista');
const errorHandler = require('./middlewares/errorHandler');

app.use('/auth', authRoutes);
app.use('/produtos', authMiddleware, produtosRoutes);
app.use('/vendas', authMiddleware, vendasRoutes);
app.use('/clientes', authMiddleware, clientesRoutes);
app.use('/canais-venda', authMiddleware, canaisVendaRoutes);
app.use('/dashboard', authMiddleware, requireAdmin, dashboardRoutes);
app.use('/contas-pagar', authMiddleware, requireAdmin, contasPagarRoutes);
app.use('/contas-receber', authMiddleware, requireAdmin, contasReceberRoutes);
app.use('/fornecedores', authMiddleware, requireEstoquista, fornecedoresRoutes);
app.use('/despesas-fixas', authMiddleware, requireAdmin, despesasFixasRoutes);
app.use('/configuracoes-financeiras', authMiddleware, requireAdmin, configuracoesFinanceirasRoutes);
app.use('/financeiro', authMiddleware, requireAdmin, financeiroRoutes);
app.use(errorHandler);

module.exports = app;