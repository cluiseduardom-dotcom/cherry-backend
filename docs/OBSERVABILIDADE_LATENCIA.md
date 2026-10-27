# Medição de latência (opt-in)

Objetivo: saber, com dados, se a espera do usuário vem do app, do banco ou da distância entre os dois
(backend no Render/Oregon, banco no Neon/São Paulo), antes de decidir mudar de região.

Desligada por padrão: sem as variáveis abaixo nada é instalado e o comportamento é idêntico ao anterior.

## Variáveis (Render)

| Variável | Efeito |
|---|---|
| `LATENCIA_LOG=1` | Liga o log de latência por requisição e a contagem de tempo no banco. |
| `LATENCIA_DB_PING_SEGUNDOS=<n>` | (Opcional, mínimo 30, exige `LATENCIA_LOG=1`.) Sonda periódica do banco. Mantém uma conexão sendo aberta a cada `n` s: pode impedir o Neon de suspender o compute no plano gratuito. Use só durante a medição. |

## O que é registrado (uma linha JSON por evento, em stdout)

```json
{"evento":"http_latencia","metodo":"GET","rota":"/produtos/:id","status":200,"ms":84.2,"db_ms":61.0,"db_consultas":3}
{"evento":"db_ping","conexao_ms":78.4,"consulta_ms":12.1}
{"evento":"db_ping_erro"}
```

- `ms`: duração total da requisição no app. `db_ms`/`db_consultas`: soma do tempo (incluindo rede) e número
  de consultas ao banco naquela requisição, inclusive dentro de transações. `db_ms` inclui abrir conexão
  quando o pool não tem uma livre.
- `db_ping.consulta_ms`: um `SELECT 1` numa conexão já aberta, ou seja, o tempo de ida e volta app↔banco.
  `conexao_ms`: abrir a conexão (inclui TLS). O `pg` fecha conexões ociosas após 10 s, então a sonda
  normalmente paga a abertura.
- Nunca registrados: IP, usuário, empresa, cabeçalhos, query string, corpo, SQL, caminho real (só o padrão da
  rota, como `/produtos/:id`) nem mensagem de erro do banco.

## Como ler

- `db_ping.consulta_ms` alto (dezenas de ms) em repouso → distância app↔banco é relevante.
- `db_ms` ≈ `ms` nas rotas lentas → o tempo está no banco/rede; `ms` ≫ `db_ms` → está no app.
- Muitas `db_consultas` por requisição multiplicam a latência de rede: otimizar consultas pode render mais
  que mudar de região.
- Compare p50/p95 por rota, não médias, e separe a primeira requisição depois de ociosidade (conexão fria).

## Desligar

Remova `LATENCIA_LOG` (e `LATENCIA_DB_PING_SEGUNDOS`) no Render.
