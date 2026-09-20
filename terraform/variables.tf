variable "project_name" {
  type    = string
  default = "notif-system"
}

variable "environment" {
  type        = string
  description = "Resource name suffix and isolation unit: staging, prod, or dev-<developer> for a personal stack"

  validation {
    condition     = can(regex("^(staging|prod|dev-[a-z0-9]{1,20})$", var.environment))
    error_message = "environment must be staging, prod, or dev-<name> (lowercase letters/digits, max 20)."
  }
}

variable "aws_region" {
  type    = string
  default = "eu-west-2"
}


variable "new_relic_enabled" {
  type        = bool
  description = "Attach the New Relic layer + extension to every Lambda"
  default     = true
}

variable "new_relic_account_id" {
  type        = string
  description = "New Relic account ID (not a secret). The license key lives in SSM."
  default     = ""
}
