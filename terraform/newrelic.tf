# ---------------------------------------------------------------
# NEW RELIC — APM for every Lambda via the official layer + extension
# ---------------------------------------------------------------
# The layer adds (1) the Node agent, which wraps the handler and records the
# invocation as a transaction with DB/SNS/HTTP segments and distributed
# tracing, and (2) an extension process that ships traces, invocation
# telemetry (duration, memory used, cold starts, errors) and CloudWatch-bound
# function logs to New Relic without any code change in the function.
#
# Fail-safe by design: the agent is fire-and-forget. A missing, expired or
# wrong license key means telemetry is dropped and a warning is logged; the
# handler still runs. `new_relic_enabled = false` removes the layer entirely.

locals {
  # https://<region>.layers.newrelic-external.com/get-layers?CompatibleRuntime=nodejs20.x
  new_relic_layer_arn = "arn:aws:lambda:${var.aws_region}:451483290750:layer:NewRelicNodeJS20X:125"

  new_relic_env = var.new_relic_enabled ? {
    NEW_RELIC_LAMBDA_HANDLER                 = "index.handler"                                                          # the real handler; the layer's wrapper calls it
    NEW_RELIC_USE_ESM                        = "true"                                                                   # our bundles are index.mjs
    NODE_OPTIONS                             = "--experimental-loader /opt/nodejs/node_modules/newrelic/esm-loader.mjs" # absolute: ESM resolution ignores NODE_PATH, so the bare package name fails
    NEW_RELIC_ACCOUNT_ID                     = var.new_relic_account_id
    NEW_RELIC_LICENSE_KEY_SSM_PARAMETER_NAME = aws_ssm_parameter.secret["new-relic-license-key"].name
    NEW_RELIC_DISTRIBUTED_TRACING_ENABLED    = "true"
    NEW_RELIC_EXTENSION_SEND_FUNCTION_LOGS   = "true" # our pino JSON lines -> New Relic Logs, linked to traces
    NEW_RELIC_EXTENSION_LOG_LEVEL            = "WARN"
    NEW_RELIC_TRUSTED_ACCOUNT_KEY            = var.new_relic_account_id
  } : {}

  lambda_handler = var.new_relic_enabled ? "newrelic-lambda-wrapper.handler" : "index.handler"
  lambda_layers  = var.new_relic_enabled ? [local.new_relic_layer_arn] : []
}
