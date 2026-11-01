# Identidade por cliente (tema e tela de login)

Cada empresa tem um **tema visual** (conjunto fechado, resolvido no frontend) e um **identificador** (`slug`) que dá a ela a própria tela de login. Quem não tem identificador abre o login do **Vertumno** (padrão da plataforma).

## Modelo

| Coluna | Regra |
|---|---|
| `empresas.tema_visual` | `vertumno` (padrão), `cherry` ou `valvazori`. O backend só guarda o identificador; logotipo, cor e CSS ficam no frontend. |
| `empresas.slug` | Opcional, único, 1 a 40 caracteres: minúsculas, números e hífen, sem hífen no início/fim. Reservados: `app`, `www`, `api`, `admin`, `plataforma`, `login`, `staging`, `vertumno`, `gironex`. |
| `empresas_identidade_eventos` | Trilha: tema e slug anterior/novo, responsável e data. |

A migration `081` dá o slug `cherry` à Cherry Semijoias (mesma regra de nome da 049), sem sobrescrever slug existente.

## API

**Pública, sem login** (`GET /publico/marca/:slug`, limite de 60 requisições/min por IP):

```json
{ "success": true, "data": { "slug": "valvazori", "tema": "valvazori" } }
```

Devolve **só** slug e tema de empresa **ativa**. Nenhum id, nome ou dado de negócio. Slug inexistente, malformado ou de empresa inativa respondem o mesmo `404`, então a rota não serve para descobrir empresas. O identificador `cherry` é fácil de adivinhar; o efeito é só mostrar a marca dela.

**Operador da plataforma** (`plataforma_admin`, lido do banco; a empresa-alvo vem da rota):

* `GET /plataforma/empresas/identidade` → `{ temas, empresas: [{ empresa_id, empresa_nome, status, tema_visual, slug }] }`
* `PATCH /plataforma/empresas/:id/identidade` `{ tema_visual?, slug? }` (`slug: null` remove). `409` se o slug já é de outra empresa; sem mudança real não grava evento. O responsável vem do usuário autenticado.
* `GET /plataforma/empresas/:id/identidade/historico`

O login continua devolvendo `usuario.empresa.tema` (lido do banco): depois de entrar, vale o tema da empresa do usuário.

## Fora do escopo

* Personalização editável (logo/cores enviados pelo cliente): hoje cada identidade é um tema pronto no frontend.
* Subdomínio por cliente (`cherry.vertumno.com.br`): o identificador é o mesmo, só mudaria como o frontend o lê.
