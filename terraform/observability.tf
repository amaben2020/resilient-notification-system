# ---------------------------------------------------------------
# OBSERVABILITY — secrets the EC2 box needs, kept out of configs
# ---------------------------------------------------------------

resource "aws_ssm_parameter" "grafana_cloud_api_key" {
  count = var.grafana_cloud_api_key != "" ? 1 : 0

  name  = "/${local.name_prefix}/grafana-cloud-api-key"
  type  = "SecureString"
  value = var.grafana_cloud_api_key
}
