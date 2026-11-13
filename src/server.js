const { iniciarMonitoramento, registrarErro, encerrarMonitoramento } = require('./config/monitoramento');

// Antes de tudo: erros ao subir também são coletados (só se SENTRY_DSN estiver definido).
iniciarMonitoramento();

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

iniciarServidor().catch(async (error) => {
  console.error('Falha ao iniciar o servidor:', error.message);
  registrarErro(error, { rota: 'inicializacao' });
  await encerrarMonitoramento();
  process.exit(1);
});
