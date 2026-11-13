#!/usr/bin/env bash
# Cópia lógica do banco (pg_dump, formato custom) para guardar fora do provedor.
# Uso: BACKUP_DATABASE_URL='<url>' scripts/backup-logico.sh [pasta-de-destino]
# A URL vem SOMENTE do ambiente; o script nunca a imprime. O arquivo contém dados pessoais e financeiros:
# fica com permissão 600 e deve ser guardado criptografado e fora do repositório (ver docs/OPERACAO.md).
set -euo pipefail

if [ -z "${BACKUP_DATABASE_URL:-}" ]; then
  echo "Defina BACKUP_DATABASE_URL no ambiente (URL de leitura do banco)." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump não encontrado: instale o cliente do PostgreSQL." >&2
  exit 1
fi

destino="${1:-./backups}"
mkdir -p "$destino"
umask 077
arquivo="$destino/vertumno-$(date -u +%Y%m%dT%H%M%SZ).dump"

pg_dump --format=custom --no-owner --no-privileges --dbname="$BACKUP_DATABASE_URL" --file="$arquivo"
chmod 600 "$arquivo"

# Confere que o arquivo é legível pelo pg_restore (lista o conteúdo, sem restaurar nada).
pg_restore --list "$arquivo" >/dev/null
echo "Cópia criada: $arquivo ($(du -h "$arquivo" | cut -f1)). Guarde criptografada e fora do repositório."
