-- Extrato bancário importado (OFX/CSV) passa a ter origem própria nos movimentos, para distinguir o que veio do
-- banco do que foi lançado à mão. Só amplia a lista aceita; nenhum dado existente muda.
-- Reversão manual: recriar a constraint sem 'EXTRATO' (só depois de não haver movimentos com essa origem).
ALTER TABLE movimentos_bancarios DROP CONSTRAINT IF EXISTS ck_mov_banc_origem;
ALTER TABLE movimentos_bancarios ADD CONSTRAINT ck_mov_banc_origem CHECK (
    origem IN ('MANUAL','PAGAMENTO','RECEBIMENTO','TRANSFERENCIA','OPEN_FINANCE','API_BANCO','AJUSTE','EXTRATO')
);
