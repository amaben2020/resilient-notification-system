#!/usr/bin/env bash
# Create / resolve / delete a Neon database branch for a personal dev stack.
#   neon-branch.sh up   <name>   -> prints the pooled connection string for branch <name> (creates it if missing)
#   neon-branch.sh down <name>   -> deletes branch <name>
# Needs NEON_API_KEY and NEON_PROJECT_ID. Branches are copy-on-write clones of
# the parent (default: the project's default branch), so they start with the
# current schema and data but are fully isolated.
set -euo pipefail

action=$1; name=$2
api="https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}"
auth=(-H "Authorization: Bearer ${NEON_API_KEY}" -H "Accept: application/json" -H "Content-Type: application/json")

branch_id() {
  curl -fsS "${auth[@]}" "${api}/branches" | jq -r --arg n "$name" '.branches[] | select(.name == $n) | .id'
}

case "$action" in
  up)
    id=$(branch_id)
    if [ -z "$id" ]; then
      id=$(curl -fsS "${auth[@]}" -X POST "${api}/branches" \
        -d "{\"branch\":{\"name\":\"${name}\"},\"endpoints\":[{\"type\":\"read_write\"}]}" | jq -r '.branch.id')
      echo "created neon branch ${name} (${id})" >&2
      sleep 5 # endpoint becomes ready shortly after creation
    else
      echo "reusing neon branch ${name} (${id})" >&2
    fi
    curl -fsS "${auth[@]}" \
      "${api}/connection_uri?branch_id=${id}&database_name=neondb&role_name=neondb_owner&pooled=true" | jq -r '.uri'
    ;;
  down)
    id=$(branch_id)
    if [ -n "$id" ]; then
      curl -fsS "${auth[@]}" -X DELETE "${api}/branches/${id}" > /dev/null
      echo "deleted neon branch ${name} (${id})" >&2
    else
      echo "neon branch ${name} does not exist" >&2
    fi
    ;;
  *) echo "usage: $0 up|down <name>" >&2; exit 2 ;;
esac
