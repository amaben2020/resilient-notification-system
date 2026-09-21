# ---------------------------------------------------------------
# API — the Express app on Lambda, public via a Function URL
# ---------------------------------------------------------------

data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../dist/api"
  output_path = "${path.module}/../dist/api.zip"
}

# Separate role: the API publishes to SNS, the workers only read queues.
resource "aws_iam_role" "api_exec_role" {
  name = "${local.name_prefix}-api-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "api_policy" {
  name = "${local.name_prefix}-api-policy"
  role = aws_iam_role.api_exec_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = aws_sns_topic.payment_confirmed.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_lambda_function" "api" {
  function_name    = "${local.name_prefix}-api"
  role             = aws_iam_role.api_exec_role.arn
  handler          = local.lambda_handler
  layers           = local.lambda_layers
  runtime          = "nodejs20.x"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 30
  memory_size      = 512 # load test: 223 of 244 MB used with the agent attached

  environment {
    variables = merge(local.new_relic_env, {
      NODE_ENV                    = var.environment
      SSM_PREFIX                  = local.ssm_prefix
      PAYMENT_CONFIRMED_TOPIC_ARN = aws_sns_topic.payment_confirmed.arn # not a secret
    })
  }
}

# Public HTTPS endpoint. NONE = no IAM signing required; the app does its own
# validation. Swap for API Gateway when you need auth, throttling or a domain.
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["*"]
    allow_methods = ["*"]
    allow_headers = ["content-type"]
  }
}

# Since Oct 2025 a public (auth NONE) Function URL needs TWO resource-policy
# statements: InvokeFunctionUrl, and InvokeFunction restricted to URL calls.
# Without the second one every request gets 403 Forbidden.
resource "aws_lambda_permission" "api_public_url" {
  statement_id           = "AllowPublicFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "api_public_invoke" {
  statement_id             = "AllowPublicInvokeViaFunctionUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.api.function_name
  principal                = "*"
  invoked_via_function_url = true
}

output "api_url" {
  description = "Public base URL of the payments API"
  value       = aws_lambda_function_url.api.function_url
}

moved {
  from = aws_lambda_permission.api_public
  to   = aws_lambda_permission.api_public_url
}
