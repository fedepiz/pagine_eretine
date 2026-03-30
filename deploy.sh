#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./deploy.sh [name] [--bootstrap] [options]

Behavior:
  - With --bootstrap: prepare server dependencies, create systemd + nginx config,
    and run a full deployment.
  - Without --bootstrap: run deployment only (pull/build/restart).
  - This script assumes the repository already exists at /var/www/<name>.

Arguments:
  name                    App directory name under /var/www (default: script folder name)

Options:
  --bootstrap             Run one-time server/bootstrap steps
  --branch <name>         Git branch/ref to deploy (default: main)
  --base-dir <path>       Base directory for app checkouts (default: /var/www)
  --backend-port <port>   Backend port override (default: deterministic from app name)
  --public-port <port>    Nginx listen port (default: 80)
  --domain <server_name>  Nginx server_name (default: _)
  --api-base-url <url>    VITE_API_BASE_URL for frontend build (default: /api)
  --npm-fallback          If npm ci fails, retry with npm install
  --skip-pull             Skip git fetch/pull during deployment
  -h, --help              Show this help

Examples:
  ./deploy.sh pagine_eretine --bootstrap --domain example.com
  ./deploy.sh monterotondo --bootstrap --public-port 8080 --domain _
  ./deploy.sh pagine_eretine
  ./deploy.sh
EOF
}

log() {
  printf '[deploy] %s\n' "$*"
}

die() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_sudo() {
  sudo -n true >/dev/null 2>&1 || die "This script needs passwordless sudo or an active sudo session. Run: sudo -v"
}

derive_backend_port() {
  local name="$1"
  local checksum
  checksum="$(printf '%s' "$name" | cksum | awk '{print $1}')"
  printf '%d\n' "$((20000 + checksum % 10000))"
}

APP_NAME=""
BOOTSTRAP=0
BRANCH="main"
BASE_DIR="/var/www"
BACKEND_PORT=""
PUBLIC_PORT="80"
DOMAIN="_"
API_BASE_URL="/api"
NPM_FALLBACK=0
SKIP_PULL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bootstrap)
      BOOTSTRAP=1
      ;;
    --branch)
      [[ $# -ge 2 ]] || die "Missing value for --branch"
      BRANCH="$2"
      shift
      ;;
    --base-dir)
      [[ $# -ge 2 ]] || die "Missing value for --base-dir"
      BASE_DIR="$2"
      shift
      ;;
    --backend-port)
      [[ $# -ge 2 ]] || die "Missing value for --backend-port"
      BACKEND_PORT="$2"
      shift
      ;;
    --public-port)
      [[ $# -ge 2 ]] || die "Missing value for --public-port"
      PUBLIC_PORT="$2"
      shift
      ;;
    --domain)
      [[ $# -ge 2 ]] || die "Missing value for --domain"
      DOMAIN="$2"
      shift
      ;;
    --api-base-url)
      [[ $# -ge 2 ]] || die "Missing value for --api-base-url"
      API_BASE_URL="$2"
      shift
      ;;
    --npm-fallback)
      NPM_FALLBACK=1
      ;;
    --skip-pull)
      SKIP_PULL=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      die "Unknown option: $1"
      ;;
    *)
      if [[ -z "$APP_NAME" ]]; then
        APP_NAME="$1"
      else
        die "Unexpected argument: $1"
      fi
      ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$APP_NAME" ]]; then
  APP_NAME="$(basename "$SCRIPT_DIR")"
fi

if [[ -z "$BACKEND_PORT" ]]; then
  BACKEND_PORT="$(derive_backend_port "$APP_NAME")"
fi

[[ "$BACKEND_PORT" =~ ^[0-9]+$ ]] || die "--backend-port must be numeric"
[[ "$PUBLIC_PORT" =~ ^[0-9]+$ ]] || die "--public-port must be numeric"

APP_DIR="${BASE_DIR%/}/$APP_NAME"
FRONTEND_DIR="$APP_DIR/frontend"
BACKEND_DIR="$APP_DIR/backend"
SERVICE_NAME="${APP_NAME}-backend"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
NGINX_SITE="/etc/nginx/sites-available/${APP_NAME}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${APP_NAME}"

require_sudo

ensure_bootstrap_dependencies() {
  log "Installing base packages"
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg nginx git build-essential pkg-config libssl-dev

  local install_node=1
  if command -v node >/dev/null 2>&1; then
    local node_major
    node_major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "$node_major" -ge 20 ]]; then
      install_node=0
    fi
  fi

  if [[ "$install_node" -eq 1 ]]; then
    log "Installing Node.js 20"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi

  if ! command -v cargo >/dev/null 2>&1; then
    log "Installing Rust toolchain"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | bash -s -- -y
  fi

  export PATH="$HOME/.cargo/bin:$PATH"
}

ensure_app_checkout_exists() {
  [[ -d "$APP_DIR" ]] || die "App directory missing: $APP_DIR. Copy or clone your repo there first."
  [[ -d "$APP_DIR/.git" ]] || die "Expected git checkout at $APP_DIR/.git"
  [[ -d "$FRONTEND_DIR" ]] || die "Frontend directory missing: $FRONTEND_DIR"
  [[ -d "$BACKEND_DIR" ]] || die "Backend directory missing: $BACKEND_DIR"
}

write_systemd_service() {
  log "Writing systemd service: ${SERVICE_NAME}.service"
  sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=${APP_NAME} Rust backend
After=network.target

[Service]
Type=simple
User=${USER}
Group=${USER}
WorkingDirectory=${BACKEND_DIR}
Environment=PORT=${BACKEND_PORT}
ExecStart=${BACKEND_DIR}/target/release/backend
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
}

write_nginx_site() {
  local listen_directive="$PUBLIC_PORT"
  if [[ "$DOMAIN" == "_" ]]; then
    listen_directive="$PUBLIC_PORT default_server"
  fi

  log "Writing nginx site: $NGINX_SITE"
  sudo tee "$NGINX_SITE" >/dev/null <<EOF
server {
    listen ${listen_directive};
    server_name ${DOMAIN};

    root ${FRONTEND_DIR}/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

  sudo ln -sfn "$NGINX_SITE" "$NGINX_ENABLED"

  if [[ "$DOMAIN" == "_" ]] && [[ -L /etc/nginx/sites-enabled/default ]]; then
    log "Disabling default nginx site (server_name _ takes over)"
    sudo rm -f /etc/nginx/sites-enabled/default
  fi

  sudo nginx -t
  sudo systemctl enable nginx
}

pull_latest() {
  if [[ "$SKIP_PULL" -eq 1 ]]; then
    log "Skipping git pull (--skip-pull)"
    return
  fi

  if [[ ! -d "$APP_DIR/.git" ]]; then
    log "Skipping git pull (not a git checkout): $APP_DIR"
    return
  fi

  log "Pulling latest code from origin/$BRANCH"
  git -C "$APP_DIR" fetch --prune origin
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
}

build_frontend() {
  [[ -d "$FRONTEND_DIR" ]] || die "Frontend directory not found: $FRONTEND_DIR"

  log "Building frontend"
  (
    cd "$FRONTEND_DIR"
    if ! npm ci; then
      if [[ "$NPM_FALLBACK" -eq 1 ]]; then
        log "npm ci failed, retrying with npm install (--npm-fallback enabled)"
        npm install
      else
        die "npm ci failed because package-lock.json is out of sync. Fix lockfile in git (npm install + commit) or rerun with --npm-fallback."
      fi
    fi
    VITE_API_BASE_URL="$API_BASE_URL" npm run build
  )
}

build_backend() {
  [[ -d "$BACKEND_DIR" ]] || die "Backend directory not found: $BACKEND_DIR"

  export PATH="$HOME/.cargo/bin:$PATH"
  require_command cargo

  log "Building backend"
  (
    cd "$BACKEND_DIR"
    cargo build --release
  )
}

restart_services() {
  if sudo systemctl list-unit-files | grep -q "^${SERVICE_NAME}\.service"; then
    log "Restarting backend service: $SERVICE_NAME"
    sudo systemctl restart "$SERVICE_NAME"
    sudo systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,12p'
  else
    log "Backend service not installed yet: $SERVICE_NAME"
  fi

  log "Reloading nginx"
  sudo nginx -t
  sudo systemctl reload nginx
}

smoke_test() {
  require_command curl
  log "Running health check on backend"
  curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null
  log "Health check passed"
}

main() {
  log "App name: $APP_NAME"
  log "App directory: $APP_DIR"
  log "Backend port: $BACKEND_PORT"

  if [[ "$BOOTSTRAP" -eq 1 ]]; then
    ensure_bootstrap_dependencies
    ensure_app_checkout_exists
    write_systemd_service
    write_nginx_site
  fi

  ensure_app_checkout_exists

  pull_latest
  build_frontend
  build_backend
  restart_services
  smoke_test

  log "Done"
}

main
