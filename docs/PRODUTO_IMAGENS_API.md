# Fotos de produto — API

Galeria de até **5 fotos por produto**. O arquivo fica no armazenamento de objetos (Cloudflare R2, API S3);
o banco guarda só a chave e os metadados (tabela `produto_imagens`, migration `066`).

## Configuração (variáveis de ambiente)

Nenhuma é obrigatória para o backend subir. Sem elas, o envio responde `412` e as telas seguem com o placeholder.

| Variável | Uso |
|---|---|
| `R2_ACCOUNT_ID` | ID da conta Cloudflare (monta o endpoint `https://<id>.r2.cloudflarestorage.com`) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Credencial S3 do token do R2, restrita ao bucket (Object Read & Write) |
| `R2_BUCKET` | Nome do bucket (`vertumno-fotos-staging`, `vertumno-fotos`) |
| `R2_PUBLIC_BASE_URL` | Base pública das fotos, sem barra final. Vazia = `url` e `imagem_url` voltam `null` |

O segredo nunca é logado nem devolvido pela API.

## Endpoints (`/produtos/:id/imagens`)

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| GET | `/produtos/:id/imagens` | qualquer usuário autenticado | Lista a galeria, na ordem |
| POST | `/produtos/:id/imagens` | admin, estoquista | Envia uma foto (`multipart/form-data`, campo `arquivo`) |
| PUT | `/produtos/:id/imagens/ordem` | admin, estoquista | Define a ordem: `{ "ids": [3, 1, 2] }`; o primeiro é a principal |
| DELETE | `/produtos/:id/imagens/:imagemId` | admin, estoquista | Apaga a foto (banco e bucket) |

Foto: `{ id, url, ordem, principal, content_type, tamanho_bytes }`. `ordem` 0 = principal.

## Regras

- Aceita **JPEG, PNG e WebP**, até **2 MB**. O tipo vem do **conteúdo** do arquivo (assinatura), não do nome nem do content-type enviado.
- Máximo de **5 fotos por produto** (409 acima). O limite é conferido sob trava da linha do produto, então uploads simultâneos não passam dele.
- A chave no bucket é `<empresa_id>/produtos/<produto_id>/<uuid>.<ext>`, sempre montada no backend com o `empresa_id` do JWT. O nome do arquivo enviado é ignorado.
- `empresa_id` vem do JWT. Produto ou foto de outra empresa responde 404; o banco também recusa (FK composta).
- Apagar fecha a ordem (0..n-1); a principal é sempre a de ordem 0.
- A foto é enviada ao bucket antes de gravar a linha; se a linha não entrar (galeria cheia, produto removido), o objeto é apagado. Se o bucket falhar ao apagar, a foto some do sistema e fica no máximo um objeto órfão sem link.
- O bucket é público de leitura; a segurança está no nome aleatório (não adivinhável). Foto de produto não é dado sensível.
- O frontend deve reduzir a foto (por exemplo, lado maior ~1000 px) antes de enviar; o backend não redimensiona.

## Alterações em endpoints existentes

- `GET /produtos` (itens): novo campo `imagem_url` (foto principal ou `null`).
- `GET /produtos/:id`: novos `imagens` (galeria) e `imagem_url`.

## Erros

`400` arquivo ausente, inválido ou campo errado · `404` produto/foto inexistente ou de outra empresa · `409` galeria cheia · `412` armazenamento não configurado · `413` acima de 2 MB.
(Erros 5xx saem como `500` genérico pelo `errorHandler`; por isso a falta de configuração usa `412`, com mensagem clara.)
