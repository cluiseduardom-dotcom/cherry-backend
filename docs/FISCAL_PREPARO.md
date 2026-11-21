# Preparo fiscal (só cadastro; nenhuma nota é emitida)

Funcionalidade **`fiscal_cadastro`** (todas as rotas exigem; sem ela, 403), criada pela migration 126; nenhum plano a inclui e a GiroNex liga avulso. O módulo `fiscal` do catálogo (emissão de nota) é outro e continua "em breve": por isso o site público não anuncia uma emissão que ainda não existe.
Objetivo: deixar o cadastro pronto para quando a emissão for feita, e dizer **o que falta**.

## O que NÃO está aqui (de propósito)
Certificado digital e CSC (segredos), série da NFC-e, CST/CSOSN, CFOP, alíquotas e os campos de **IBS/CBS da reforma tributária**.
Essas regras dependem do contador e das notas técnicas vigentes, e **estão em mudança** (as fontes consultadas divergem em datas e
versões; ver "Fontes" abaixo). Modelar agora seria chutar. NCM e CEST são conferidos **só pelo formato**, não contra a tabela oficial.

## Dados guardados
- `empresa_fiscal` (uma linha por empresa): `regime_tributario` (`mei`, `simples_nacional`, `simples_nacional_excesso`, `lucro_presumido`,
  `lucro_real`), `inscricao_estadual` (2 a 14 dígitos ou `ISENTO`), `inscricao_municipal`, `cnae_principal` (7 dígitos),
  `codigo_municipio_ibge` (7 dígitos; precisa começar com o código da UF da empresa) e `ambiente` (`homologacao` padrão, `producao`).
  CNPJ, razão social e endereço **já existem** em `empresas` (tela Dados da empresa) e não são duplicados.
- `produtos`: `ncm` (8 dígitos, capítulo 01 a 97 exceto 77), `cest` (7), `origem_mercadoria` (0 a 8), `unidade_fiscal` (1 a 6 letras, ex.: UN, KG).
  Todos opcionais: produto sem dado fiscal segue como era. Só **produto vendido** (`acabado`) entra no fiscal; insumo não.
- Máscara não é erro: `7117.19.00`, `4781-4/00` e `123.456.789.110` são aceitos e gravados só com os dígitos.

## Rotas
| Rota | Quem | O que faz |
|---|---|---|
| `GET /fiscal/empresa` | admin | dados cadastrais da empresa + dados fiscais |
| `PUT /fiscal/empresa` | admin | grava só os campos enviados (`null` limpa); município de outra UF = 400 |
| `GET /fiscal/produtos?filtro=pendentes\|todos&q&page&pageSize` | admin, estoquista | produtos vendidos com os dados fiscais; `pendentes` = sem NCM ou sem origem |
| `PATCH /fiscal/produtos/:id` | admin, estoquista | NCM, CEST, origem e unidade fiscal de um produto (`null` limpa) |
| `POST /fiscal/produtos/lote` | admin, estoquista | aplica os mesmos dados a 1 a 200 produtos; id de outra empresa = 404 e **nada** é aplicado; `null` não é aceito em lote |
| `GET /fiscal/prontidao` | admin | checklist: dados da empresa e dos produtos, o que falta, até 10 produtos pendentes e os avisos |

## Prontidão
`pronto = true` quando todo item **obrigatório** está ok: CNPJ válido, razão social, endereço completo, regime tributário, inscrição
estadual, código IBGE do município (da UF da empresa), e NCM e origem em todos os produtos vendidos e ativos. São recomendados (não
travam): CNAE, inscrição municipal e unidade fiscal. "Pronto" significa **cadastro completo**, não que a nota será aceita pela SEFAZ.

## CNPJ alfanumérico
Desde julho de 2026 a Receita emite CNPJ com letras (IN RFB 2.229/2024): as 12 primeiras posições aceitam 0-9 e A-Z; as 2 últimas
são sempre números. O dígito verificador segue o módulo 11, com cada caractere valendo o código ASCII menos 48 (os CNPJ numéricos
antigos mantêm o mesmo dígito). `cnpjValido`/`normalizarCnpj` (`src/utils/documentos.js`) já tratam isso e o cadastro da empresa
(`PATCH /empresa/dados`) aceita CNPJ alfanumérico. **Ainda só numéricos:** cadastro de clientes e de fornecedores, a loja institucional
e as máscaras do frontend (CNPJ digitado com letra seria descartado).

## Fontes consultadas (21/11/2026)
Conteúdo de fornecedores e imprensa especializada; a fonte primária não foi lida diretamente. Confirmar no Portal Nacional da NF-e e na SEFAZ da UF.
- Regras de validação CFOP × CSOSN da NFC-e (NT 2015.002, ajustada pela NT 2023.003): https://blog.tecnospeed.com.br/nf-e-e-nfc-e-nota-tecnica-2023-003-alteracao-em-regras-de-validacao-cfop-para-nfc-e/
- Reforma tributária na NF-e/NFC-e (NT 2025.002, versões recentes; prazos divergem entre as fontes): https://www.contabeis.com.br/noticias/73958/reforma-tributaria-nota-tecnica-traz-prazos-e-novidades-na-nf-e-e-nfc-e/ e https://www.fiemg.com.br/wp-content/uploads/2026/05/IE-40-Nota-Tecnica-1.40-maio-de-2026.pdf
- CNPJ alfanumérico e cálculo do dígito: https://serpro.gov.br/menu/noticias/noticias-2024/cnpj-alfanumerico e https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/cnpj/cnpj-alfanumerico.pdf
