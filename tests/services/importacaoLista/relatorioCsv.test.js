const { montarCsv, protegerFormula } = require('../../../src/services/importacaoLista/relatorioCsv');

describe('protegerFormula', () => {
  test.each(['=1+1', '+55', '-5', '@SOMA(A1)', '\tx', '\rx'])('prefixa apóstrofo em %j', (entrada) => {
    expect(protegerFormula(entrada)).toBe(`'${entrada}`);
  });

  test.each(['Anel', '12,50', 'a=b', ' =x', ''])('deixa %j como está', (entrada) => {
    expect(protegerFormula(entrada)).toBe(entrada);
  });
});

describe('montarCsv', () => {
  test('produtos: BOM, cabeçalho em português, ponto e vírgula e CRLF', () => {
    const csv = montarCsv('produtos', [{ linha: 2, resultado: 'criado', id: 8, nome: 'Anel', sku: 'AN-001', saldo: 5, detalhe: 'SKU gerado' }]);
    expect(csv).toBe('﻿linha;resultado;id;nome;sku;saldo;detalhe\r\n2;criado;8;Anel;AN-001;5;SKU gerado\r\n');
  });

  test('clientes: só linha, resultado, id e detalhe (sem nome nem telefone)', () => {
    const csv = montarCsv('clientes', [{ linha: 3, resultado: 'criado', id: 9, nome: 'Maria', telefone: '11912345678', detalhe: '' }]);
    expect(csv).toBe('﻿linha;resultado;id;detalhe\r\n3;criado;9;\r\n');
    expect(csv).not.toMatch(/Maria|11912345678/);
  });

  test('neutraliza fórmula em qualquer coluna de texto, inclusive o nome e o motivo', () => {
    const csv = montarCsv('produtos', [
      { linha: 2, resultado: 'criado', id: 1, nome: '=HYPERLINK("http://x")', sku: '@A', saldo: 0, detalhe: '-cmd' }
    ]);
    const [, linha] = csv.replace('﻿', '').split('\r\n');
    expect(linha).toBe('2;criado;1;"\'=HYPERLINK(""http://x"")";\'@A;0;\'-cmd');
  });

  test('aspas, ponto e vírgula e quebra de linha dentro da célula ficam entre aspas', () => {
    const csv = montarCsv('produtos', [{ linha: 4, resultado: 'ignorado', nome: 'Anel; "Ouro"\nNovo', detalhe: 'x' }]);
    expect(csv).toContain('"Anel; ""Ouro""\nNovo"');
  });

  test('sem linhas, só o cabeçalho', () => {
    expect(montarCsv('clientes', [])).toBe('﻿linha;resultado;id;detalhe\r\n');
  });
});
