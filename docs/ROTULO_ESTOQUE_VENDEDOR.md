# Rótulo do estoque do vendedor ("Maleta" × "Estoque do vendedor")

Base: migration `111_rotulo_estoque_vendedor.sql`. **Só muda o vocabulário.** O tipo técnico do local continua `maleta` (estoque, transferência com aceite, acerto, comissão e venda pelo PDV são os mesmos). Não confundir com `consignado`: este é estoque deixado com um terceiro (cliente) e **não vende pelo PDV**.

## Regra
- Cada empresa escolhe `empresas.rotulo_estoque_vendedor`, lista fechada (CHECK): `maleta` (semijoias e acessórios) ou `estoque_vendedor` (demais ramos).
- **Empresas que já existiam ficam com `maleta`** (nada muda para elas). **Empresas novas nascem com `estoque_vendedor`.**
- O texto exibido vem do código (`src/constants/vocabularioEstoque.js`), com gênero e preposição já concordados (`da maleta` / `do estoque do vendedor`; `Minha maleta` / `Meu estoque`). Não há texto livre.
- Chave desconhecida ou ausente cai em `maleta`.

## API
- `GET /auth/me` devolve `rotulo_estoque_vendedor` (o frontend escolhe as palavras).
- `GET/PATCH /empresa/dados` (só admin): campo `rotulo_estoque_vendedor` (`'maleta'` | `'estoque_vendedor'`; outro valor = 400).

## Mensagens do servidor que usam o vocabulário
- Nome padrão ao criar o local: `Maleta de Ana` / `Estoque de Ana`.
- "Este usuário já tem maleta" / "...já tem estoque do vendedor"; "Usuário bloqueado não pode ter ...".
- "Você só pode devolver mercadoria da sua própria maleta / do seu próprio estoque para o Central".
- Avisos do sino: "Maleta sem conferência", "Maleta sem vender" (e as ações) e equivalentes.

## Limites
- Trocar o rótulo **não renomeia** locais já criados (o nome é dado da empresa; renomeie se quiser).
- O nome da funcionalidade no catálogo (`maletas`: "Maletas e múltiplos locais") e o código de erros internos continuam como estão.
