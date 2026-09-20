# ---------------------------------------------------------------
# SECRETS — SSM Parameter Store, values set out of band
# ---------------------------------------------------------------
# Terraform owns that the parameter EXISTS (name, type, tags). It does not own
# the value: it is created as PLACEHOLDER and `ignore_changes` means later
# `aws ssm put-parameter --overwrite` (scripts/secrets.sh) is never reverted.
# The real value therefore never appears in .tf files, tfvars, CI logs, state,
# or the Lambda console. Lambdas read the values at cold start (src/config/secrets.js).

locals {
  ssm_prefix = "/${var.project_name}/${var.environment}"
  secrets    = ["database-url", "grafana-cloud-api-key"]
}

resource "aws_ssm_parameter" "secret" {
  for_each = toset(local.secrets)

  name        = "${local.ssm_prefix}/${each.key}"
  type        = "SecureString" # encrypted with the account's aws/ssm KMS key
  value       = "PLACEHOLDER"
  description = "Set with: scripts/secrets.sh put ${var.environment} ${each.key} <value>"

  lifecycle {
    ignore_changes = [value]
  }
}

# Read-only access to this environment's parameters, attached to both roles.
data "aws_iam_policy_document" "read_secrets" {
  statement {
    actions = ["ssm:GetParametersByPath", "ssm:GetParameter", "ssm:GetParameters"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_prefix}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_prefix}/*",
    ]
  }
}

data "aws_caller_identity" "current" {}

resource "aws_iam_role_policy" "workers_read_secrets" {
  name   = "${local.name_prefix}-workers-read-secrets"
  role   = aws_iam_role.lambda_exec_role.id
  policy = data.aws_iam_policy_document.read_secrets.json
}

resource "aws_iam_role_policy" "api_read_secrets" {
  name   = "${local.name_prefix}-api-read-secrets"
  role   = aws_iam_role.api_exec_role.id
  policy = data.aws_iam_policy_document.read_secrets.json
}

output "ssm_prefix" {
  description = "Where this environment's secrets live"
  value       = local.ssm_prefix
}
