'use strict';

const { parseNome, parseTelefone, parseNascimento, parseObservacoes } = require('./campos');
const { limparTexto } = require('./texto');

const ERRO = 'erro';
const AVISO = 'aviso';

// contexto: { telefonesExistentes: Set de telefones normalizados (só dígitos, sem DDI) da empresa, hoje: 'YYYY-MM-DD' }
function validarClientes(linhas, contexto) {
    const telefonesVistos = new Map();

    return linhas.map(({ linha, valores, colunasAMais }) => {
        const problemas = [];
        const erro = (coluna, motivo) => problemas.push({ coluna, nivel: ERRO, motivo });
        const aviso = (coluna, motivo) => problemas.push({ coluna, nivel: AVISO, motivo });

        if (colunasAMais) {
            erro(null, 'a linha tem mais colunas que o cabeçalho; se o nome tem ";" ou ",", coloque o texto entre aspas');
        }

        const nome = parseNome(valores.nome);
        if (nome.erro) erro('nome', nome.erro);

        const telefone = limparTexto(valores.telefone) === '' ? { erro: 'o telefone é obrigatório' } : parseTelefone(valores.telefone);
        if (telefone.erro) erro('telefone', telefone.erro);
        else for (const texto of telefone.avisos) aviso('telefone', texto);

        const nascimentoTexto = limparTexto(valores.nascimento);
        const nascimento = nascimentoTexto === '' ? null : parseNascimento(nascimentoTexto, contexto.hoje);
        if (nascimento?.erro) erro('nascimento', nascimento.erro);

        const observacoes = parseObservacoes(valores.observacoes);
        if (observacoes.erro) erro('observacoes', observacoes.erro);

        if (problemas.some((p) => p.nivel === ERRO)) {
            return { linha, acao: 'erro', problemas };
        }

        if (contexto.telefonesExistentes.has(telefone.valor)) {
            aviso('telefone', 'já existe cliente com este telefone; a linha foi ignorada');
            return { linha, acao: 'ignorar', problemas };
        }

        if (telefonesVistos.has(telefone.valor)) {
            aviso('telefone', `telefone repetido no arquivo (linha ${telefonesVistos.get(telefone.valor)}); a linha foi ignorada`);
            return { linha, acao: 'ignorar', problemas };
        }

        telefonesVistos.set(telefone.valor, linha);

        return {
            linha,
            acao: 'criar',
            problemas,
            dados: {
                nome: nome.valor,
                telefone: telefone.valor,
                data_nascimento: nascimento ? nascimento.valor : null,
                observacoes: observacoes.valor === '' ? null : observacoes.valor
            }
        };
    });
}

module.exports = { validarClientes };
