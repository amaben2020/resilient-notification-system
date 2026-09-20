#!/usr/bin/env bash
# Manage runtime secrets in SSM Parameter Store (/notif-system/<env>/<name>).
#   secrets.sh list <env>                    names + last modified (never values)
#   secrets.sh get  <env> <name>             print decrypted value
#   secrets.sh put  <env> <name> <value>     set / rotate (Lambdas pick it up on next cold start)
#   secrets.sh seed <env> <name> <value>     set only if still PLACEHOLDER (safe for CI)
# Terraform creates the parameters; this script only changes their values.
set -euo pipefail
action=$1; env=$2; name=${3:-}; value=${4:-}
region=${AWS_REGION:-eu-west-2}
path="/notif-system/${env}/${name}"

case "$action" in
  list) aws ssm get-parameters-by-path --region "$region" --path "/notif-system/${env}" \
          --query 'Parameters[].[Name,Type,LastModifiedDate]' --output table ;;
  get)  aws ssm get-parameter --region "$region" --name "$path" --with-decryption --query Parameter.Value --output text ;;
  put)  aws ssm put-parameter --region "$region" --name "$path" --type SecureString --value "$value" --overwrite >/dev/null
        echo "set $path" >&2 ;;
  seed) current=$(aws ssm get-parameter --region "$region" --name "$path" --with-decryption --query Parameter.Value --output text 2>/dev/null || echo MISSING)
        if [ "$current" = "PLACEHOLDER" ]; then
          aws ssm put-parameter --region "$region" --name "$path" --type SecureString --value "$value" --overwrite >/dev/null
          echo "seeded $path" >&2
        else
          echo "kept $path (already set)" >&2
        fi ;;
  *) echo "usage: $0 list|get|put|seed <env> [name] [value]" >&2; exit 2 ;;
esac
