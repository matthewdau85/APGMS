#!/usr/bin/env sh
set -e

command_exists () {
  command -v "$1" >/dev/null 2>&1
}

if command_exists npm; then
  :
fi
