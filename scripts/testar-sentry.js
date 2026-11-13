'use strict';

// Envia UM evento de teste ao Sentry para confirmar que o DSN está certo e que o evento chega mascarado.
// Uso (na sua máquina ou no Shell do Render):  SENTRY_DSN='<dsn>' node scripts/testar-sentry.js
// O DSN vem só do ambiente e nunca é impresso. O evento é inofensivo: "Teste do Sentry (pode ignorar)".
const { iniciarMonitoramento, registrarErro, encerrarMonitoramento } = require('../src/config/monitoramento');

(async () => {
    if (!iniciarMonitoramento()) {
        console.error('SENTRY_DSN não definido: nada foi enviado.');
        process.exitCode = 1;
        return;
    }

    // Texto com dados fictícios para provar a máscara: no Sentry deve aparecer [email] e [cpf].
    registrarErro(new Error('Teste do Sentry (pode ignorar) — contato teste@exemplo.com CPF 123.456.789-09'), { rota: 'teste-sentry', metodo: 'SCRIPT' });
    await encerrarMonitoramento(5000);
    // O SDK não confirma a entrega: quem confirma é o painel do Sentry.
    console.log('Evento de teste entregue ao Sentry SDK (a entrega em si não é confirmada aqui).');
    console.log('Confira em Issues no projeto: deve aparecer em até 1-2 minutos, com "[email]" e "[cpf]" no lugar dos dados.');
    console.log('Se não aparecer, o DSN está errado ou a rede está bloqueando o envio.');
})();
