jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const vendasRepository = require('../../src/repositories/vendasRepository');
const comprasRepository = require('../../src/repositories/comprasRepository');

const itens = [{ produto_id: 1, quantidade: 1 }];
const base = { cliente_id: 1, canal_id: 1, usuario_id: 1, empresa_id: 1, itens };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('vendasRepository.criar — teto de parcelas/prazo (defesa além do Zod)', () => {
  test.each([
    ['numero_parcelas 1e9', [{ forma_pagamento: 'crediario', valor: 10, numero_parcelas: 1000000000, meses_prazo: 1 }], undefined],
    ['numero_parcelas 25', [{ forma_pagamento: 'credito', valor: 10, numero_parcelas: 25 }], undefined],
    ['numero_parcelas 0', [{ forma_pagamento: 'credito', valor: 10, numero_parcelas: 0 }], undefined],
    ['numero_parcelas fracionário', [{ forma_pagamento: 'credito', valor: 10, numero_parcelas: 1.5 }], undefined],
    ['numero_parcelas Infinity', [{ forma_pagamento: 'credito', valor: 10, numero_parcelas: Infinity }], undefined],
    ['meses_prazo do pagamento 7', [{ forma_pagamento: 'crediario', valor: 10, numero_parcelas: 1, meses_prazo: 7 }], undefined],
    ['crediário 12x de 1 mês (horizonte de 12 meses)', [{ forma_pagamento: 'crediario', valor: 10, numero_parcelas: 12, meses_prazo: 1 }], undefined],
    ['crediário 4x de 2 meses (horizonte de 8 meses)', [{ forma_pagamento: 'crediario', valor: 10, numero_parcelas: 4, meses_prazo: 2 }], undefined],
    ['crediário 7x sem prazo (padrão 1 mês)', [{ forma_pagamento: 'crediario', valor: 10, numero_parcelas: 7 }], undefined],
    ['venda a prazo legada em 7 meses', undefined, 7],
    ['meses_prazo legado 1e9', undefined, 1000000000]
  ])('rejeita %s com 400 antes de abrir conexão ou transação', async (_, pagamentos, meses_prazo) => {
    await expect(
      vendasRepository.criar({ ...base, pagamentos, forma_pagamento: pagamentos ? undefined : 'prazo', meses_prazo })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(db.connect).not.toHaveBeenCalled();
  });
});

describe('comprasRepository.criar — teto de dias_prazo', () => {
  test.each([366, 1000000000, 0, Infinity, 2.5])('rejeita dias_prazo %p com 400 antes de abrir conexão', async (dias_prazo) => {
    await expect(
      comprasRepository.criar({ fornecedor_id: 1, data_compra: '2026-10-01', forma_pagamento: 'prazo', dias_prazo, usuario_id: 1, empresa_id: 1, itens })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(db.connect).not.toHaveBeenCalled();
  });
});
