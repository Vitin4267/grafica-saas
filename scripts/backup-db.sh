#!/usr/bin/env bash
# Faz um dump completo do Postgres (roda dentro do container via docker
# compose, já que pg_dump não precisa estar instalado na máquina host) e
# salva comprimido em backups/. Lê usuário/banco direto do container em vez
# de duplicar os valores de docker-compose.yml aqui.
#
# Uso:
#   npm run db:backup
#
# Agendamento: isso NÃO roda sozinho — é um script manual (ou pra chamar via
# cron/Task Scheduler quando o site estiver hospedado de verdade). Se no fim
# você escolher um Postgres gerenciado (Neon/Supabase/RDS) pra produção, esse
# script vira opcional pro banco local de dev: esses provedores já fazem
# backup automático sozinhos.
set -euo pipefail

cd "$(dirname "$0")/.."

PASTA_BACKUP="backups"
RETENCAO=14 # mantém só os N backups mais recentes, apaga o resto

mkdir -p "$PASTA_BACKUP"

USUARIO=$(docker compose exec -T db printenv POSTGRES_USER)
BANCO=$(docker compose exec -T db printenv POSTGRES_DB)
CARIMBO=$(date +%Y%m%d_%H%M%S)
ARQUIVO="$PASTA_BACKUP/${BANCO}_${CARIMBO}.sql.gz"

echo "Gerando backup de '$BANCO' em $ARQUIVO..."
docker compose exec -T db pg_dump -U "$USUARIO" "$BANCO" | gzip > "$ARQUIVO"

TAMANHO=$(du -h "$ARQUIVO" | cut -f1)
echo "Backup salvo: $ARQUIVO ($TAMANHO)"

# Limpeza: mantém só os $RETENCAO mais recentes.
ls -1t "$PASTA_BACKUP"/*.sql.gz 2>/dev/null | tail -n +$((RETENCAO + 1)) | while read -r antigo; do
  echo "Removendo backup antigo: $antigo"
  rm -f "$antigo"
done
