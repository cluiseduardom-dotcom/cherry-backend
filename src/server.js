const app = require('./app');
const { validarRuntime } = require('./config/runtimeConfig');
const { main: executarMigrations, verificarMigrationsAplicadas } = require('./database/migrate');

validarRuntime();

const PORT = process.env.PORT || 3000;

async function iniciarServidor() {
  // Padrão (sem a variável): aplica as migrations pendentes ao subir, como sempre. Com MIGRATIONS_NO_BOOT=true elas
  // rodam em etapa própria do deploy (npm run db:migrate) e aqui só se confere que não falta nenhuma.
  if (process.env.MIGRATIONS_NO_BOOT === 'true') {
    await verificarMigrationsAplicadas();
  } else {
    await executarMigrations();
  }

  app.listen(PORT, () => {
    console.log('Servidor rodando na porta ' + PORT);
  });
}

iniciarServidor().catch((error) => {
  console.error('Falha ao iniciar o servidor:', error.message);
  process.exit(1);
});
