targetScope = 'resourceGroup'
param agentName string
param principalId string
param workloadResourceGroupName string
param clusterName string
param workspaceName string
param insightsName string

module presenter './agent.bicep' = {
  name: 'presenter-agent'
  params: { agentName: agentName, principalId: principalId }
}
module access './access.bicep' = {
  name: 'presenter-read-access'
  scope: resourceGroup(workloadResourceGroupName)
  params: {
    agentPrincipalId: presenter.outputs.uamiPrincipalId
    agentSystemPrincipalId: presenter.outputs.systemPrincipalId
    clusterName: clusterName
    workspaceName: workspaceName
    insightsName: insightsName
  }
}
output SRE_AGENT_NAME string = presenter.outputs.agentName
output SRE_AGENT_RESOURCE_ID string = presenter.outputs.agentId
output SRE_AGENT_ENDPOINT string = presenter.outputs.endpoint
output SRE_AGENT_IDENTITY_ID string = presenter.outputs.uamiId
output SRE_AGENT_PRINCIPAL_ID string = presenter.outputs.uamiPrincipalId
output SRE_AGENT_SYSTEM_PRINCIPAL_ID string = presenter.outputs.systemPrincipalId