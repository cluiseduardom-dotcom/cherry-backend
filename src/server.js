const app = require('./app');
const { validarRuntime } = require('./config/runtimeConfig');

validarRuntime();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
