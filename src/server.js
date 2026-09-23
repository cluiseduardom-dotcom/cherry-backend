const app = require('./app');
const { validarRuntime } = require('./config/runtimeConfig');
const { main: executarMigrations } = require('./database/migrate');

validarRuntime();

const PORT = process.env.PORT || 3000;

async function iniciarServidor() {
  await executarMigrations();

  app.listen(PORT, () => {
    console.log('Servidor rodando na porta ' + PORT);
  });
}

iniciarServidor().catch((error) => {
  console.error('Falha ao iniciar o servidor:', error.message);
  process.exit(1);
});
