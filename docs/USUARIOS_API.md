# API de gestão de usuários (contrato para o frontend)

Todas as rotas exigem `Authorization: Bearer <token>` e a capacidade `gerir_usuarios`
(Admin sempre tem; por padrão também diretor, gerente, coordenador e supervisor, desde que o
cargo esteja ligado na empresa). `empresa_id` vem sempre do token: nunca é enviado.
Respostas no formato `{ success, data }`; erros `{ success: false, message }`.

## Regras de hierarquia (decididas no backend; a tela só reflete)

- Só se gerencia cargo de **nível estritamente menor** que o do ator (Admin: qualquer não-Admin).
- Nunca se gerencia a si mesmo nem usuários Admin (cargo admin ou admin concedido).
- Cargos fora da escada (estoquista, faturista) contam como nível 0.
- Não existe exclusão: bloqueia-se. Bloqueio derruba as sessões do usuário na hora.
- Redefinir senha continua só com o Admin (fora desta API).

## GET /usuarios

Lista os usuários da empresa. Cada item:

```json
{ "id": 20, "nome": "Ana", "email": "ana@x.com", "cargo": "vendedor", "ativo": true,
  "criado_em": "2026-10-23T12:00:00.000Z",
  "telefone": "11912345678", "pode_gerenciar": true, "motivo_bloqueio_gestao": null }
```

`telefone` só dígitos (ou `null` para usuários anteriores ao cadastro completo). **CPF nunca vem na lista.**

Use `pode_gerenciar` para habilitar/ocultar o botão de bloquear; `motivo_bloqueio_gestao`
traz a explicação quando for `false`.

## GET /usuarios/cargos — cargos que o ator pode atribuir

Use para montar o seletor de cargo do formulário de criação. Devolve só o que `POST /usuarios`
aceitaria: cargos **ativos** na empresa, nunca Admin e, para quem não é Admin, só de nível
estritamente menor que o do ator. Não use um catálogo fixo no cliente.

```json
[{ "cargo": "vendedor", "rotulo": "Vendedor", "nivel": 30, "em_escada": true },
 { "cargo": "estoquista", "rotulo": "Estoquista", "nivel": null, "em_escada": false }]
```

Lista vazia = nenhum cargo habilitado abaixo do ator (o Admin liga cargos em `PUT /cargos/:cargo`).

## POST /usuarios — criar

Corpo (campos extras são recusados com 400): `{ "nome", "email", "senha" (6–128), "papel", "telefone" }`
mais os dados opcionais abaixo.

Dados cadastrais (`telefone` **obrigatório**, 10–11 dígitos; máscara aceita, é normalizada para dígitos). Opcionais
(`""` ou `null` = não informado): `cpf` (dígitos verificadores válidos, único por empresa),
`data_nascimento` e `data_admissao` (`YYYY-MM-DD`; nascimento entre 1900 e hoje, admissão ≥ 1950),
`cep` (8 dígitos), `logradouro` (255), `numero` (20), `complemento` (100), `bairro` (100),
`cidade` (100), `uf` (sigla válida, maiúscula) e `observacoes` (1000).
`papel` é um cargo ligado na empresa e de nível menor que o do ator (não pode ser `admin`).
Resposta 201: `{ "usuario": { id, nome, email, papel, empresa_id, ativo } }`.
Erros: 400 validação / cargo desligado, 403 hierarquia, 409 e-mail já cadastrado
(o e-mail é único em todo o sistema), 409 CPF já cadastrado nesta empresa.

## GET /usuarios/:id — detalhe com dados cadastrais

Capacidade `gerir_usuarios`; vale a mesma hierarquia do bloqueio (nível estritamente menor), **exceto o
próprio usuário**, que pode ver e editar os seus dados. 404 para inexistente/outra empresa, 403 hierarquia.
É o único endpoint que devolve o CPF.

```json
{ "id": 20, "nome": "Ana", "email": "ana@x.com", "cargo": "vendedor", "ativo": true, "criado_em": "...",
  "dados": { "telefone": "11912345678", "cpf": "52998224725", "data_nascimento": "1990-05-10",
             "cep": "01001000", "logradouro": null, "numero": null, "complemento": null, "bairro": null,
             "cidade": "São Paulo", "uf": "SP", "data_admissao": null, "observacoes": null } }
```

## PATCH /usuarios/:id/dados — editar dados cadastrais

Corpo parcial, estrito, com pelo menos um campo de `dados` (mesmas regras do POST; `telefone` não aceita
`null`; `null` ou `""` limpa os demais). Mande **só o que mudou**.
Resposta 200: `{ "alterado": true|false, "campos": ["cpf", ...] }`; `alterado: false` = nada mudou (nada gravado,
sem evento). Erros: 400, 403 hierarquia, 404, 409 CPF já cadastrado. Nome, e-mail e cargo não se editam por aqui.
Grava um evento `editar` na trilha **com apenas os nomes dos campos alterados, nunca os valores** (CPF não vai para a trilha).

## PATCH /usuarios/:id/bloqueio

Corpo: `{ "bloqueado": true|false, "motivo": "3–300 caracteres" }` (motivo obrigatório).
Resposta 200: `{ id, nome, email, papel, ativo, alterado }`; `alterado: false` = já estava
nesse estado (nada gravado). Erros: 400, 403 hierarquia/si mesmo/Admin, 404 (inclui usuário de
outra empresa).

## GET /usuarios/eventos?page=1&pageSize=20

Trilha (mais recente primeiro; `pageSize` máx. 100):
`{ items: [{ id, acao: "criar"|"bloquear"|"desbloquear"|"editar", alvo_usuario_id, alvo_nome, cargo_alvo,
executado_por, executado_por_nome, motivo, campos, criado_em }], page, pageSize, total, totalPages }`.

`campos`: lista de nomes dos campos alterados (só em `editar`; `null` nas demais ações). `motivo` é `null` em `criar` e `editar`.
