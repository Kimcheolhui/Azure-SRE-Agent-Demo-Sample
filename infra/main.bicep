targetScope = 'subscription'

@minLength(3)
@maxLength(16)
param environmentName string
param location string = 'eastus2'
param principalId string
param enableIncidentScanning bool = false
param nodeVmSize string = 'Standard_D4s_v6'

var suffix = uniqueString(subscription().id, environmentName)
var tags = { 'azd-env-name': environmentName, purpose: 'sre-customer-demo' }

resource workloadGroup 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: 'rg-${environmentName}-workload'
  location: location
  tags: tags
}
resource agentGroup 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: 'rg-${environmentName}-agent'
  location: location
  tags: tags
}

module workload './workload.bicep' = {
  name: 'workload'
  scope: workloadGroup
  params: {
    clusterName: 'aks-${environmentName}'
    registryName: 'acrsredemo${suffix}'
    principalId: principalId
    nodeVmSize: nodeVmSize
  }
}
module agent './agent.bicep' = {
  name: 'agent'
  scope: agentGroup
  params: { agentName: 'sre-${environmentName}', principalId: principalId }
}
module readAccess './access.bicep' = {
  name: 'read-access'
  scope: workloadGroup
  params: {
    agentPrincipalId: agent.outputs.uamiPrincipalId
    agentSystemPrincipalId: agent.outputs.systemPrincipalId
    clusterName: workload.outputs.clusterName
    workspaceName: workload.outputs.workspaceName
    insightsName: workload.outputs.insightsName
  }
}
resource alertScanRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (enableIncidentScanning) {
  name: guid(subscription().id, environmentName, 'sre-demo-alert-scan')
  properties: {
    principalId: agent.outputs.uamiPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '749f88d5-cbae-40b8-bcfc-e573ddc772fa')
  }
}

output AZURE_RESOURCE_GROUP string = workloadGroup.name
output AGENT_RESOURCE_GROUP string = agentGroup.name
output AZURE_AKS_CLUSTER_NAME string = workload.outputs.clusterName
output AZURE_CONTAINER_REGISTRY_NAME string = workload.outputs.registryName
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = workload.outputs.registryEndpoint
output WORKSPACE_RESOURCE_ID string = workload.outputs.workspaceId
output WORKSPACE_CUSTOMER_ID string = workload.outputs.workspaceCustomerId
output APPINSIGHTS_RESOURCE_ID string = workload.outputs.insightsId
output APPINSIGHTS_APP_ID string = workload.outputs.insightsAppId
output PAYMENT_ALERT_NAME string = workload.outputs.alertName
output SRE_AGENT_NAME string = agent.outputs.agentName
output SRE_AGENT_RESOURCE_ID string = agent.outputs.agentId
output SRE_AGENT_ENDPOINT string = agent.outputs.endpoint
output SRE_AGENT_IDENTITY_ID string = agent.outputs.uamiId
output SRE_AGENT_PRINCIPAL_ID string = agent.outputs.uamiPrincipalId
output SRE_AGENT_SYSTEM_PRINCIPAL_ID string = agent.outputs.systemPrincipalId