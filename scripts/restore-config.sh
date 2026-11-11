#!/bin/bash
# 从备份恢复 paseo-task-notify 的配置与开关状态。
# 用法：scripts/restore-config.sh ~/.paseo/plugin-backups/paseo-task-notify/<时间戳>
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "用法：$0 <备份目录>"
  exit 1
fi

SRC="$1"
HOME_DIR="${HOME:-$HOME}"

if [ -f "$SRC/notify.json" ]; then
  mkdir -p "$HOME_DIR/.paseo/plugin-settings/paseo-task-notify"
  cp "$SRC/notify.json" "$HOME_DIR/.paseo/plugin-settings/paseo-task-notify/notify.json"
  chmod 600 "$HOME_DIR/.paseo/plugin-settings/paseo-task-notify/notify.json"
  echo "已恢复 notify.json"
fi
if [ -f "$SRC/state.json" ]; then
  mkdir -p "$HOME_DIR/.paseo/plugin-data/paseo-task-notify"
  cp "$SRC/state.json" "$HOME_DIR/.paseo/plugin-data/paseo-task-notify/state.json"
  echo "已恢复 state.json"
fi
echo "恢复完成，无需重启 daemon（配置按需读取）。"
