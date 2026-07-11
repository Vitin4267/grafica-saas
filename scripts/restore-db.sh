#!/usr/bin/env bash
# Restaura um backup gerado por backup-db.sh. DESTRUTIVO: apaga todo o
# conteúdo atual do banco antes de restaurar (mesmo dono/esquema, dados de
# antes do backup somem). Sempre pede confirmação explícita.
#
# Uso:
#   npm run db:restore -- backups/grafica_saas_20260101_120000.sql.gz
set -euo pipefail

cd "$(dirname "$0")/.."

ARQUIVO="${1:-}"
if [ -z "$ARQUIVO" ] || [ ! -f "$ARQUIVO" ]; then
  echo "Uso: npm run db:restore -- <caminho-do-backup.sql.gz>"
  echo "Backups disponíveis:"
  ls -1t backups/*.sql.gz 2>/dev/null || echo "  (nenhum em backups/)"
  exit 1
fi

USUARIO=$(docker compose exec -T db printenv POSTGRES_USER)
BANCO=$(docker compose exec -T db printenv POSTGRES_DB)

echo "Isso vai APAGAR todo o conteúdo atual de '$BANCO' e substituir pelo backup:"
echo "  $ARQUIVO"
read -r -p "Digite 'restaurar' pra confirmar: " CONFIRMACAO
if [ "$CONFIRMACAO" != "restaurar" ]; then
  echo "Cancelado."
  exit 1
fi

echo "Restaurando..."
docker compose exec -T db psql -U "$USUARIO" -d "$BANCO" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c "$ARQUIVO" | docker compose exec -T db psql -U "$USUARIO" -d "$BANCO" -v ON_ERROR_STOP=1

echo "Restauração concluída."
