require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// ROTAS
const produtosRoutes = require('./routes/produtos');
const vendasRoutes = require('./routes/vendas');
const clientesRoutes = require('./routes/clientes');
const authRoutes = require('./routes/authRoutes');
const authMiddleware = require('./middlewares/authMiddleware');
const errorHandler = require('./middlewares/errorHandler');

app.use('/auth', authRoutes);
app.use('/produtos', authMiddleware, produtosRoutes);
app.use('/vendas', authMiddleware, vendasRoutes);
app.use('/clientes', authMiddleware, clientesRoutes);
app.use(errorHandler);

// START SERVER (sempre por último)
app.listen(3000, () => {
  console.log('🚀 Servidor rodando na porta 3000');

});