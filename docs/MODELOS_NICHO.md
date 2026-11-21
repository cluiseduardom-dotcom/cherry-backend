# Modelos prontos por nicho

Empresa nova nasce **sem nenhuma categoria de produto** e com um padrão de SKU sem segmentos: quem não organiza isso antes de
cadastrar produtos não consegue gerar SKU. Os modelos dão o ponto de partida: níveis, categorias e o padrão de SKU de **produtos**
(insumos têm o próprio carregamento no onboarding e não são tocados). A empresa edita tudo depois (nomes, categorias, padrão).
Sem migration. Catálogo em `src/constants/modelosNicho.js`.

## Modelos
`confeitaria`, `lanchonete`, `adega`, `semijoias`, `moda`. Cada um tem 2 níveis (ex.: Tipo e Tamanho) com 7 categorias no primeiro e
4 a 6 no segundo, códigos de até 3 letras, e o padrão `Padrão` (numérico, separador `-`, 3 dígitos, nível 1 obrigatório e nível 2
opcional). Exemplo de SKU da confeitaria: `BOL-P-001` (Bolos, Pequeno, 1º da combinação); outra combinação tem sequência própria
(`TOR-G-001`).

## Rotas (só admin)
| Rota | O que faz |
|---|---|
| `GET /modelos-nicho` | catálogo com níveis, categorias e `exemplo_sku` |
| `POST /modelos-nicho/:id/aplicar` | aplica o modelo na empresa do JWT: cria os níveis e as categorias de produto e os segmentos do padrão de SKU, numa transação |

Regras: só aplica em empresa **sem categoria de produto ativa** e cujo padrão de SKU **ainda não tem segmentos** (senão `409`, nada muda);
modelo inexistente = `404`. Duas aplicações simultâneas na mesma empresa são serializadas (trava da linha da empresa).
O padrão de SKU de produto da empresa passa a ser o principal (`padrao = true`).

## Na criação da empresa
`POST /onboarding` e a criação pelo Painel GiroNex (`POST /painel/empresas`) aceitam `modelo_nicho` (opcional, um dos ids acima).
O modelo é aplicado **na mesma transação** da criação: id desconhecido derruba tudo (nenhuma empresa fica pela metade). Sem o campo,
nada muda.

## Fora desta entrega
Tela para o admin escolher o modelo, modelos por vocabulário (rótulos de "maleta", "Estoque do vendedor"), grade de tamanhos/cores como
variações do mesmo produto, e preparo fiscal por nicho.
