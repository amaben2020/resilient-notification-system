# main.tf

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # Remote state so every CI run (and your laptop) sees the same resources.
  # bucket/key/region are passed at init time: see backend.hcl files and the workflows.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  workers     = ["email", "sms", "order"]
}

# ---------------------------------------------------------------
# SNS — payment.service.js publishes ONE message here
# ---------------------------------------------------------------

resource "aws_sns_topic" "payment_confirmed" {
  name = "${local.name_prefix}-payment-confirmed"
}

# ---------------------------------------------------------------
# SQS — one queue per channel, each with its own dead-letter queue
# ---------------------------------------------------------------

resource "aws_sqs_queue" "dlq" {
  for_each = toset(local.workers)
  name     = "${local.name_prefix}-${each.key}-dlq"
}

resource "aws_sqs_queue" "notification_queue" {
  for_each                   = toset(local.workers)
  name                       = "${local.name_prefix}-${each.key}-queue"
  visibility_timeout_seconds = 60

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = 3
  })
}

# SNS -> SQS subscriptions (this IS the fan-out)
resource "aws_sns_topic_subscription" "queue_subs" {
  for_each  = toset(local.workers)
  topic_arn = aws_sns_topic.payment_confirmed.arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.notification_queue[each.key].arn
}

# SQS must explicitly allow SNS to deliver messages to it
resource "aws_sqs_queue_policy" "allow_sns" {
  for_each  = toset(local.workers)
  queue_url = aws_sqs_queue.notification_queue[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "sns.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.notification_queue[each.key].arn
      Condition = {
        ArnEquals = { "aws:SourceArn" = aws_sns_topic.payment_confirmed.arn }
      }
    }]
  })
}

# ---------------------------------------------------------------
# IAM — permissions the Lambda workers need
# ---------------------------------------------------------------

resource "aws_iam_role" "lambda_exec_role" {
  name = "${local.name_prefix}-lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda_policy" {
  name = "${local.name_prefix}-lambda-policy"
  role = aws_iam_role.lambda_exec_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = [for w in local.workers : aws_sqs_queue.notification_queue[w].arn]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ---------------------------------------------------------------
# LAMBDA — one worker per channel, each triggered by its own queue
# ---------------------------------------------------------------

# `npm run build:workers` writes dist/<worker>/index.mjs; Terraform zips it.
data "archive_file" "worker" {
  for_each    = toset(local.workers)
  type        = "zip"
  source_dir  = "${path.module}/../dist/${each.key}"
  output_path = "${path.module}/../dist/${each.key}.zip"
}

resource "aws_lambda_function" "worker" {
  for_each      = toset(local.workers)
  function_name = "${local.name_prefix}-${each.key}-worker"
  role          = aws_iam_role.lambda_exec_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = data.archive_file.worker[each.key].output_path
  # Changes when the bundle changes -> Terraform knows to redeploy the code.
  source_code_hash = data.archive_file.worker[each.key].output_base64sha256
  timeout          = 30

  environment {
    variables = merge(local.new_relic_env, {
      NODE_ENV   = var.environment
      SSM_PREFIX = local.ssm_prefix # secrets are fetched at cold start, never stored here
    })
  }
}

resource "aws_lambda_event_source_mapping" "trigger" {
  for_each         = toset(local.workers)
  event_source_arn = aws_sqs_queue.notification_queue[each.key].arn
  function_name    = aws_lambda_function.worker[each.key].arn
  batch_size       = 10
}

# ---------------------------------------------------------------
# OUTPUTS — what the Express app / you need after apply
# ---------------------------------------------------------------

output "payment_confirmed_topic_arn" {
  description = "Set this as PAYMENT_CONFIRMED_TOPIC_ARN on the Express app"
  value       = aws_sns_topic.payment_confirmed.arn
}

output "queue_urls" {
  value = { for w in local.workers : w => aws_sqs_queue.notification_queue[w].url }
}

output "lambda_function_names" {
  value = { for w in local.workers : w => aws_lambda_function.worker[w].function_name }
}