# PCP: necessidade de material (PR 1 do módulo)

Funcionalidade `pcp` (migration 121 a torna ligável; nenhum plano a inclui, a GiroNex liga avulso por empresa).
Somente leitura, sem tabela nova. Código: `producoesService.necessidade`, `producoesRepository.lerNecessidade`.

## `GET /producoes/necessidade?produto_id=&quantidade=`
Acesso: admin e estoquista (mesmo alcance de `/producoes`) **e** funcionalidade `pcp` ligada (senão 403 "Funcionalidade não incluída no seu plano").
`quantidade` inteiro de 1 a 1.000.000 (padrão 1).

Responde o que uma produção de `quantidade` unidades consumiria, **sem gravar nem travar nada**:

| Campo | Significado |
|---|---|
| `insumos[]` | por insumo da ficha vigente: `por_unidade`, `necessario` (= por_unidade × quantidade), `disponivel` (estoque atual do insumo), `faltante`, `suficiente`, `ativo`, `maximo_produzivel` (= floor(disponivel ÷ por_unidade)) |
| `pode_produzir_tudo` | todos os insumos suficientes **e** ativos |
| `maximo_produzivel` | o que o estoque atual permite (menor máximo entre os insumos; não é limitado pela quantidade pedida) |
| `gargalo` | insumo que limita a produção |
| `custo_estimado` (`unitario`, `total`) e, por insumo, `custo_unitario` e `custo_necessario` | **só** para quem vê custos (`ver_custos`); para os demais os campos não existem |

A conta é a mesma de `POST /producoes` (consumo por unidade, máximo = floor(saldo ÷ consumo)), então a prévia não promete o que a produção recusaria. Insumo **inativo** nunca é "suficiente" (a produção recusa).
Custo usa o custo **atual** do insumo (não há custo médio ponderado).

Erros: `400` parâmetro inválido, produto que não é `acabado` ou sem ficha técnica; `404` produto inexistente ou de outra empresa; `401`/`403`.

## Não faz parte desta entrega (próximas PRs)
- Ordem de produção com estados (planejada, em produção, concluída), apontamento de quantidade real e perda (PR 2).
- Tela de Produção no frontend (PR 3).
- Rendimento da receita e quantidades **decimais** (0,5 kg, 250 ml): dependem do módulo Fracionado, porque estoque e ficha técnica hoje só aceitam inteiros.
- `POST /producoes`, listagem, cancelamento e `/produtos/:id/ficha-tecnica` continuam abertos como sempre foram (sem exigir a funcionalidade), para não tirar nada de quem já usa.
