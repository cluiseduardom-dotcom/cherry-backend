-- Login por código ("usuário"), único POR EMPRESA, no estilo iniciais + sobrenome (LEMCAR, EGASIL).
--
-- * usuarios.login: maiúsculo, sem acento, A–Z/0–9, 2 a 20 caracteres. Anulável: quem não tiver código
--   continua entrando pelo e-mail (o e-mail segue valendo para todos).
-- * Único por empresa: (empresa_id, login). Duas lojas podem ter um EGASIL cada; o login por código é
--   feito na página da loja (/c/<slug>), que identifica a empresa.
-- * Preenche os usuários que já existem com a mesma regra de src/utils/loginUsuario.js: inicial de cada
--   nome menos o último (sem da/de/do/das/dos/e/d) + 3 primeiras letras do último; repetido na mesma
--   empresa ganha número (EGASIL2). Ordem: id crescente (quem é mais antigo fica sem número).
--
-- Aditiva e idempotente (só preenche quem está sem login). Reversão manual:
--   DROP INDEX IF EXISTS uq_usuarios_login_empresa;
--   ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_login_formato_chk, DROP COLUMN IF EXISTS login;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS login VARCHAR(20);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_login_formato_chk') THEN
        ALTER TABLE usuarios ADD CONSTRAINT usuarios_login_formato_chk CHECK (login IS NULL OR login ~ '^[A-Z0-9]{2,20}$');
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_login_empresa ON usuarios (empresa_id, login) WHERE login IS NOT NULL;

DO $$
DECLARE
    u          record;
    palavras   text[];
    uteis      text[];
    p          text;
    i          int;
    base       text;
    candidato  text;
    n          int;
BEGIN
    FOR u IN SELECT id, empresa_id, nome FROM usuarios WHERE login IS NULL ORDER BY id LOOP
        palavras := array_remove(regexp_split_to_array(
            upper(translate(coalesce(u.nome, ''),
                'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN')),
            '[^A-Z0-9]+'), '');

        uteis := ARRAY[]::text[];
        FOR i IN 1..coalesce(array_length(palavras, 1), 0) LOOP
            p := palavras[i];
            IF i = array_length(palavras, 1) OR p NOT IN ('DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'D') THEN
                uteis := uteis || p;
            END IF;
        END LOOP;

        IF coalesce(array_length(uteis, 1), 0) = 0 THEN
            base := 'USUARIO';
        ELSIF array_length(uteis, 1) = 1 THEN
            base := rpad(left(uteis[1], 6), 2, 'X');
        ELSE
            base := '';
            FOR i IN 1..array_length(uteis, 1) - 1 LOOP
                base := base || left(uteis[i], 1);
            END LOOP;
            base := left(base || left(uteis[array_length(uteis, 1)], 3), 20);
        END IF;

        candidato := base;
        n := 2;
        WHILE EXISTS (SELECT 1 FROM usuarios WHERE empresa_id = u.empresa_id AND login = candidato) LOOP
            candidato := left(base, 20 - length(n::text)) || n::text;
            n := n + 1;
        END LOOP;

        UPDATE usuarios SET login = candidato WHERE id = u.id;
    END LOOP;
END $$;
