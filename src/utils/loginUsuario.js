// Código de login (usuário) por empresa, no estilo "iniciais + sobrenome":
//   Luís Eduardo Martins Cardoso → LEMCAR; Emilly Graziela Alves da Silva → EGASIL.
// Regra: inicial de cada nome menos o último (sem as partículas da/de/do/das/dos/e) + as 3 primeiras
// letras do último sobrenome. Maiúsculo, sem acento, só A–Z e 0–9, de 2 a 20 caracteres.
// O código é único POR EMPRESA (login pela página da loja); repetido ganha número no fim (EGASIL2).
// A mesma regra está no SQL da migration 083 (preenchimento dos usuários que já existiam).

const PARTICULAS = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'D']);
const LOGIN_RE = /^[A-Z0-9]{2,20}$/;
const TAMANHO_MAXIMO = 20;

function semAcento(texto) {
    return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Normaliza o que o usuário digitou (ou o admin escolheu): maiúsculo, sem acento, sem espaço/símbolo.
function normalizarLogin(texto) {
    return semAcento(texto).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function loginValido(login) {
    return typeof login === 'string' && LOGIN_RE.test(login);
}

// Sugestão a partir do nome completo. Nome de uma palavra só: as 6 primeiras letras.
function gerarLoginBase(nome) {
    const palavras = semAcento(nome).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    const uteis = palavras.filter((p, i) => i === palavras.length - 1 || !PARTICULAS.has(p));

    if (uteis.length === 0) return 'USUARIO';
    if (uteis.length === 1) return uteis[0].slice(0, 6).padEnd(2, 'X');

    const iniciais = uteis.slice(0, -1).map((p) => p[0]).join('');
    const sobrenome = uteis[uteis.length - 1].slice(0, 3);

    return `${iniciais}${sobrenome}`.slice(0, TAMANHO_MAXIMO);
}

// Primeiro livre entre base, base2, base3… (`ocupados`: Set de logins já usados na empresa).
function proximoLoginLivre(base, ocupados) {
    if (!ocupados.has(base)) return base;

    for (let n = 2; n < 10000; n += 1) {
        const sufixo = String(n);
        const candidato = `${base.slice(0, TAMANHO_MAXIMO - sufixo.length)}${sufixo}`;
        if (!ocupados.has(candidato)) return candidato;
    }

    throw new Error('Não foi possível gerar um login livre');
}

module.exports = { gerarLoginBase, normalizarLogin, loginValido, proximoLoginLivre, LOGIN_RE, PARTICULAS };
