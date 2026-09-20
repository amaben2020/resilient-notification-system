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

