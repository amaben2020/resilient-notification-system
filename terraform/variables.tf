variable "project_name" {
  type    = string
  default = "notif-system"
}

variable "environment" {
  type        = string
  description = "dev, staging, or prod"
}

variable "aws_region" {
  type    = string
  default = "eu-west-2"
}
variable "database_url" {
  type        = string
  description = "Neon Postgres connection string, injected into each Lambda. Pass via TF_VAR_database_url."
  sensitive   = true
}

variable "grafana_cloud_api_key" {
  type        = string
  description = "Grafana Cloud API key. Optional: SSM parameter is only created when set."
  sensitive   = true
  default     = ""
}
