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
