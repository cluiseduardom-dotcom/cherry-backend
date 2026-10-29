# Foto de perfil do usuário

Uma foto por usuário, no mesmo armazenamento das fotos de produto (Cloudflare R2; variáveis `R2_*` em `docs/PRODUTO_IMAGENS_API.md`).
Sem `R2_*` configuradas o envio responde **412** e as telas seguem com as iniciais.

## Endpoints

| Rota | Quem | Efeito |
|---|---|---|
| `PUT /auth/foto` | qualquer usuário autenticado | troca a **própria** foto |
| `DELETE /auth/foto` | idem | remove a própria foto |
| `PUT /usuarios/:id/foto` | `gerir_usuarios` | foto de outro usuário (mesma hierarquia da edição de dados) |
| `DELETE /usuarios/:id/foto` | idem | remove a foto de outro usuário |

- Envio: `multipart/form-data`, um arquivo no campo `arquivo`. JPEG, PNG ou WebP, **máximo 2 MB** (413 acima). O tipo é conferido pelos bytes, não pelo nome/content-type (400 se inválido).
- Resposta (envio e remoção): `{ "success": true, "data": { "foto_url": "https://…" | null } }`.
- Hierarquia em `/usuarios/:id/foto`: nunca Admin (nem por outro Admin; Admin troca a própria foto), só cargo de nível abaixo do ator, nunca de outra empresa (404). `empresa_id` e o ator vêm do JWT.
- Trocar a foto cria uma chave nova (`<empresa_id>/usuarios/<usuario_id>/<uuid>.<ext>`) e apaga o objeto anterior.

## Onde `foto_url` aparece (null sem foto ou sem `R2_PUBLIC_BASE_URL`)

`POST /auth/login` (`usuario.foto_url`), `GET /auth/me`, `GET /usuarios` (cada item), `GET /usuarios/:id`,
`GET /usuarios/eventos` (`alvo_foto_url` e `executado_por_foto_url`).

## Auditoria

Cada troca/remoção grava um evento `editar` em `usuarios_eventos` com `campos = ['foto']` (só o nome do campo; sem conteúdo).

## Migration

`075_usuarios_fotos.sql` (aditiva). Reversão manual: `DROP TABLE usuarios_fotos;` (os objetos no bucket não são apagados por isso).
