// Cobrança do fiado por WhatsApp: o sistema só MONTA a mensagem e o link `wa.me`; o comerciante revisa e envia. Nada é enviado
// automaticamente. Funções puras (sem banco, sem rede).

// Número do cliente em formato internacional para o wa.me (só dígitos, com 55). Devolve null se não for um telefone brasileiro válido.
function telefoneParaWhatsApp(telefone) {
    let digitos = String(telefone ?? '').replace(/\D/g, '').replace(/^0+/, '');

    if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;

    if (!/^55\d{10,11}$/.test(digitos)) return null;

    // Celular (11 dígitos nacionais) começa com 9 depois do DDD; fixo (10) começa com 2 a 5.
    const nacional = digitos.slice(2);

    if (nacional.length === 11 && nacional[2] !== '9') return null;

    if (nacional.length === 10 && !/[2-5]/.test(nacional[2])) return null;

    return digitos;
}

// "R$ 1.234,50", sem depender de Intl/locale do servidor.
function formatarMoeda(valor) {
    const centavos = Math.round(Number(valor) * 100);
    const reais = Math.floor(centavos / 100);
    const resto = String(centavos % 100).padStart(2, '0');

    return `R$ ${String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${resto}`;
}

function primeiroNome(nome) {
    const parte = String(nome ?? '').trim().split(/\s+/)[0] ?? '';

    return parte ? parte.charAt(0).toLocaleUpperCase('pt-BR') + parte.slice(1).toLocaleLowerCase('pt-BR') : '';
}

function montarMensagemDeCobranca({ nome, saldo }) {
    const saudacao = primeiroNome(nome) ? `Olá, ${primeiroNome(nome)}!` : 'Olá!';

    return `${saudacao} Consta em nosso controle um saldo pendente de ${formatarMoeda(saldo)}. Caso já tenha realizado o pagamento, por favor, desconsidere esta mensagem. Obrigado!`;
}

function linkWhatsApp(telefone, mensagem) {
    const numero = telefoneParaWhatsApp(telefone);

    return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}` : null;
}

module.exports = { telefoneParaWhatsApp, formatarMoeda, montarMensagemDeCobranca, linkWhatsApp };
