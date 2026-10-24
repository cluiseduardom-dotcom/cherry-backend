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
  "pode_gerenciar": true, "motivo_bloqueio_gestao": null }
```

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

Corpo (campos extras são recusados com 400): `{ "nome", "email", "senha" (6–128), "papel" }`.
`papel` é um cargo ligado na empresa e de nível menor que o do ator (não pode ser `admin`).
Resposta 201: `{ "usuario": { id, nome, email, papel, empresa_id, ativo } }`.
Erros: 400 validação / cargo desligado, 403 hierarquia, 409 e-mail já cadastrado
(o e-mail é único em todo o sistema).

## PATCH /usuarios/:id/bloqueio

Corpo: `{ "bloqueado": true|false, "motivo": "3–300 caracteres" }` (motivo obrigatório).
Resposta 200: `{ id, nome, email, papel, ativo, alterado }`; `alterado: false` = já estava
nesse estado (nada gravado). Erros: 400, 403 hierarquia/si mesmo/Admin, 404 (inclui usuário de
outra empresa).

## GET /usuarios/eventos?page=1&pageSize=20

Trilha (mais recente primeiro; `pageSize` máx. 100):
`{ items: [{ id, acao: "criar"|"bloquear"|"desbloquear", alvo_usuario_id, alvo_nome, cargo_alvo,
executado_por, executado_por_nome, motivo, criado_em }], page, pageSize, total, totalPages }`.
