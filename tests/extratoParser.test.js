const { lerExtrato, lerValor, detectarFormato } = require('../src/utils/extratoParser');

const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261102120000[-3:BRT]
<TRNAMT>1500.50
<FITID>2026110201
<MEMO>PIX RECEBIDO MARIA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261103
<TRNAMT>-89,90
<FITID>2026110302
<NAME>ENERGIA ELETRICA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261340
<TRNAMT>-10.00
<FITID>X
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('lerValor', () => {
  it('aceita BR, ponto, negativo e parênteses; recusa o resto', () => {
    expect(lerValor('1.234,56')).toBe(1234.56);
    expect(lerValor('R$ -10,5')).toBe(-10.5);
    expect(lerValor('(20,00)')).toBe(-20);
    expect(lerValor('1500.50')).toBe(1500.5);
    for (const ruim of ['', 'abc', '1,234', '10,123', null]) expect(lerValor(ruim)).toBeNaN();
  });
});

describe('OFX', () => {
  const r = lerExtrato(OFX);
  it('detecta o formato e lê entradas e saídas com data sem fuso', () => {
    expect(detectarFormato(OFX)).toBe('OFX');
    expect(r.formato).toBe('OFX');
    expect(r.linhas).toEqual([
      { indice: 1, data: '2026-11-02', tipo: 'ENTRADA', valor: 1500.5, descricao: 'PIX RECEBIDO MARIA', referencia_externa: 'ofx:2026110201' },
      { indice: 2, data: '2026-11-03', tipo: 'SAIDA', valor: 89.9, descricao: 'ENERGIA ELETRICA', referencia_externa: 'ofx:2026110302' },
    ]);
  });
  it('lançamento com data impossível vira erro, não é adivinhado', () => {
    expect(r.erros).toEqual([{ linha: 3, erro: 'Data inválida' }]);
  });
  it('FITID repetido no arquivo vira erro explícito', () => {
    const dup = OFX.replace('<FITID>2026110302', '<FITID>2026110201');
    const d = lerExtrato(dup);
    expect(d.linhas).toHaveLength(1);
    expect(d.erros.some((e) => e.erro === 'Identificador repetido no arquivo')).toBe(true);
  });
  it('arquivo sem lançamentos é erro', () => {
    expect(lerExtrato('<OFX></OFX>').erros[0].erro).toMatch(/Nenhum lançamento/);
  });
});

describe('CSV', () => {
  const CSV = [
    'Data;Histórico;Valor',
    '02/11/2026;PIX RECEBIDO;1.500,50',
    '03/11/2026;"TARIFA; MENSAL";-29,90',
    '03/11/2026;CAFE;-5,00',
    '03/11/2026;CAFE;-5,00',
    '31/02/2026;ERRO;-1,00',
    '04/11/2026;SEM VALOR;',
  ].join('\n');
  const r = lerExtrato(CSV);

  it('lê separador ;, aspas, sinal e datas BR', () => {
    expect(r.formato).toBe('CSV');
    expect(r.linhas.map((l) => [l.data, l.tipo, l.valor, l.descricao])).toEqual([
      ['2026-11-02', 'ENTRADA', 1500.5, 'PIX RECEBIDO'],
      ['2026-11-03', 'SAIDA', 29.9, 'TARIFA; MENSAL'],
      ['2026-11-03', 'SAIDA', 5, 'CAFE'],
      ['2026-11-03', 'SAIDA', 5, 'CAFE'],
    ]);
  });
  it('duas linhas idênticas no mesmo dia têm referências diferentes e estáveis', () => {
    const [, , a, b] = r.linhas;
    expect(a.referencia_externa).not.toBe(b.referencia_externa);
    expect(lerExtrato(CSV).linhas.map((l) => l.referencia_externa)).toEqual(r.linhas.map((l) => l.referencia_externa));
  });
  it('linhas inválidas viram erro com o número da linha do arquivo', () => {
    expect(r.erros).toEqual([{ linha: 6, erro: 'Data inválida' }, { linha: 7, erro: 'Valor inválido' }]);
  });
  it('aceita colunas Crédito/Débito e vírgula como separador', () => {
    const c = lerExtrato('Data,Descrição,Crédito,Débito\n2026-11-02,Venda,100.00,\n2026-11-02,Aluguel,,50.00');
    expect(c.linhas.map((l) => [l.tipo, l.valor])).toEqual([['ENTRADA', 100], ['SAIDA', 50]]);
  });
  it('cabeçalho desconhecido é erro claro', () => {
    expect(lerExtrato('a;b\n1;2').erros[0].erro).toMatch(/Cabeçalho não reconhecido/);
  });
});

describe('CSV com cabeçalho da conta antes da tabela (estilo Santander)', () => {
  // Nomes fictícios. Ordem do mais novo para o mais antigo; descrição com quebra de linha dentro de aspas.
  const SANTANDER = [
    'Extrato de conta corrente', 'Nome;Fulana de Tal', 'Agência;236', 'Conta;01.000000.0',
    'Período do extrato;21/10/2026 a 04/11/2026', '', 'Lançamentos:',
    'Data;Descrição;Valor;Saldo',
    '04/11/2026;"Pix recebido\nCliente A\nsilva";174,00;490,50',
    '04/11/2026;Pix enviado Fornecedor B;-70,00;316,50',
    '23/10/2026;Resg poup - central/internet/app;263,63;578,58',
    '23/10/2026;Pix enviado Fornecedor C;-578,58;0,00'
  ].join('\r\n');

  it('acha o cabeçalho depois das linhas de identificação e lê todos os lançamentos', () => {
    const r = lerExtrato(SANTANDER);
    expect(r.formato).toBe('CSV');
    expect(r.erros).toEqual([]);
    expect(r.linhas.map((l) => [l.data, l.tipo, l.valor])).toEqual([
      ['2026-11-04', 'ENTRADA', 174], ['2026-11-04', 'SAIDA', 70],
      ['2026-10-23', 'ENTRADA', 263.63], ['2026-10-23', 'SAIDA', 578.58]
    ]);
  });
  it('descrição com quebra de linha dentro das aspas vira uma linha só', () => {
    expect(lerExtrato(SANTANDER).linhas[0].descricao).toBe('Pix recebido Cliente A silva');
  });
  it('soma dos lançamentos fecha com a variação de saldo do extrato', () => {
    const total = lerExtrato(SANTANDER).linhas.reduce((s, l) => s + (l.tipo === 'ENTRADA' ? 1 : -1) * Math.round(l.valor * 100), 0);
    expect(total).toBe(17400 - 7000 + 26363 - 57858);
  });
  it('erro de linha usa a linha física do arquivo, mesmo com célula em várias linhas', () => {
    const r = lerExtrato(`${SANTANDER}\r\nTotal;;;`);
    expect(r.erros).toEqual([{ linha: 15, erro: 'Data inválida' }]);
  });
  it('reimportar o mesmo arquivo gera as mesmas referências', () => {
    expect(lerExtrato(SANTANDER).linhas.map((l) => l.referencia_externa)).toEqual(lerExtrato(SANTANDER).linhas.map((l) => l.referencia_externa));
  });
});
