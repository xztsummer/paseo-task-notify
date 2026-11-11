#!/bin/bash
# 备份 paseo-task-notify 的配置与开关状态。
# 用法：scripts/backup-config.sh
# 备份位置：~/.paseo/plugin-backups/paseo-task-notify/<时间戳>/
set -euo pipefail

HOME_DIR="${HOME:-$HOME}"
BACKUP_ROOT="$HOME_DIR/.paseo/plugin-backups/paseo-task-notify"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"

copied=0
for src in "$HOME_DIR/.paseo/plugin-settings/paseo-task-notify/notify.json" \
           "$HOME_DIR/.paseo/plugin-data/paseo-task-notify/state.json"; do
  if [ -f "$src" ]; then
    cp "$src" "$DEST/"
    copied=$((copied + 1))
  else
    echo "跳过（不存在）：$src"
  fi
done

echo "已备份 $copied 个文件到 $DEST"
ls -la "$DEST"
