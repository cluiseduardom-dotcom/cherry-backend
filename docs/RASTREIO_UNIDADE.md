# Rastreio por unidade (IMEI / número de série) — ADR-008, primeira entrega

Migration `131_rastreio_unidade.sql`. Para celulares, iPhones, consoles e demais itens em que cada aparelho precisa ser identificado (garantia, auditoria, furto).

## Regras
- `produtos.rastreia_unidade` (padrão `false`; nenhum produto existente muda). Só em produto vendido por unidade (`UN`).
- Produto rastreado tem **uma linha por aparelho** em `unidades_rastreadas` (um identificador por unidade: IMEI 1 **ou** série). O saldo continua em `produtos.estoque_atual` e fecha com a contagem de unidades `em_estoque` (mesma transação, mesmo lock do produto).
- Identificador: maiúsculo, sem espaço/hífen/barra/ponto. Só dígitos ⇒ precisa ser IMEI de 15 dígitos com dígito verificador (Luhn); senão é série de 5 a 40 letras/números. Único por empresa (`UNIQUE (empresa_id, identificador)`).
- Status: `em_estoque` → `vendida` (venda) → `em_estoque` (cancelamento da venda); `baixada` (saída avulsa ou cancelamento da compra). Histórico em `unidades_rastreadas_eventos` (nada é apagado).
- Ligar o rastreio: só em produto **sem nenhuma movimentação** (senão o saldo antigo ficaria sem IMEI). Desligar: só sem unidade `em_estoque`. Ambos travam a linha do produto.

## Contrato (campo opcional `identificadores: string[]`, um por unidade, quantidade = tamanho da lista, máx. 500)
| Fluxo | Onde | Efeito |
|---|---|---|
| Compra | `POST /compras` item | cria as unidades `em_estoque` ligadas à compra |
| Estoque inicial / recebimento sem compra | `POST /produtos/:id/movimentacoes` (entrada) | cria as unidades |
| Saída avulsa (avaria etc.) | idem (saída) | unidades informadas viram `baixada` |
| Venda | `POST /vendas` item | unidades informadas (em estoque, do mesmo produto) viram `vendida`, ligadas ao item |
| Cancelar venda | `PATCH /vendas/:id/cancelar` | unidades do item voltam a `em_estoque` |
| Cancelar compra | `PATCH /compras/:id/cancelar` | unidades da compra viram `baixada`; 409 se alguma já saiu |
| Consulta | `GET /unidades?produto_id=&status=&busca=&page=&pageSize=` e `GET /unidades/buscar/:identificador` (com histórico) | qualquer usuário autenticado; **nunca devolve custo**; sempre filtrado pelo `empresa_id` do JWT |

Erros: 400 (formato, quantidade ≠ lista, repetido na lista, produto não rastreado com lista); 409 (IMEI já cadastrado, não está em estoque para o produto, ligar/desligar bloqueado).

## Limitações desta entrega
- Produto rastreado **recusa** ajuste de quantidade, transferência entre locais e movimentações sem identificadores (400/409) — fluxos que ainda não informam IMEI (recebimento aprovado, loja online, produção, consumos, conferência) falham fechado em vez de desalinhar o saldo.
- A unidade não guarda o local (o saldo por local segue o do produto).
- Série só com dígitos precisa ser um IMEI válido de 15 dígitos.
- Sem gate por `funcionalidades` ainda (a flag do produto é o gate).
