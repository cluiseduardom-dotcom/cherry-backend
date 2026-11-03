-- Correção da 083: para nome de UMA palavra só (ex.: "Eduardo"), a 083 usou rpad(..., 2), que em
-- PostgreSQL também CORTA para 2 caracteres: gerou "ED" em vez de "EDUARD" (6 primeiras letras, como a regra
-- de src/utils/loginUsuario.js). Aqui recalcula só esses casos, e só se o login ainda for o valor errado
-- (quem já trocou à mão não é tocado). Repetido na empresa ganha número, como na 083.
-- Idempotente: depois de corrigido, o login deixa de bater com o valor errado e nada mais muda.

DO $$
DECLARE
    u          record;
    palavras   text[];
    uteis      text[];
    p          text;
    i          int;
    errado     text;
    base       text;
    candidato  text;
    n          int;
BEGIN
    FOR u IN SELECT id, empresa_id, nome, login FROM usuarios WHERE login IS NOT NULL ORDER BY id LOOP
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

        CONTINUE WHEN coalesce(array_length(uteis, 1), 0) <> 1 OR length(uteis[1]) <= 2;

        errado := left(uteis[1], 2);
        CONTINUE WHEN u.login !~ ('^' || errado || '[0-9]*$');

        base := left(uteis[1], 6);
        candidato := base;
        n := 2;
        WHILE EXISTS (SELECT 1 FROM usuarios WHERE empresa_id = u.empresa_id AND login = candidato AND id <> u.id) LOOP
            candidato := left(base, 20 - length(n::text)) || n::text;
            n := n + 1;
        END LOOP;

        UPDATE usuarios SET login = candidato WHERE id = u.id;
    END LOOP;
END $$;
