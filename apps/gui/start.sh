#!/bin/sh
set -eu
cat >/usr/share/nginx/html/config.js <<CFG
window.GUI_CONFIG = {
  brand: "${GUI_BRAND:-APGMS Normalizer}",
  title: "${GUI_TITLE:-Customer Portal}",
  baseUrl: "${GUI_BASE_URL:-/api}",
  swaggerPath: "${GUI_SWAGGER_PATH:-/api/openapi.json}",
  role: "${GUI_ROLE:-user}"
};
CFG
exec nginx -g "daemon off;"
