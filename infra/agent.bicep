targetScope = 'resourceGroup'
param agentName string
param principalId string
param location string = resourceGroup().location

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-${agentName}'
  location: location
}
resource workspace 'Microsoft.OperationalInsights/workspaces@2026-03-01' = {
  name: 'law-${agentName}'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}
resource telemetry 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${agentName}'
  location: location
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: workspace.id }
}
resource agent 'Microsoft.App/agents@2026-01-01' = {
  name: agentName
  location: location
  tags: { purpose: 'sre-customer-demo' }
  identity: {
    type: 'SystemAssigned,UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    knowledgeGraphConfiguration: { identity: identity.id, managedResources: [] }
    actionConfiguration: { identity: identity.id, mode: 'Review', accessLevel: 'Low' }
    defaultModel: { name: 'Automatic', provider: 'Anthropic' }
    logConfiguration: {
      applicationInsightsConfiguration: { appId: telemetry.properties.AppId, connectionString: telemetry.properties.ConnectionString }
    }
    upgradeChannel: 'Stable'
  }
}
resource administrator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(agent.id, principalId, 'sre-administrator')
  scope: agent
  properties: {
    principalId: principalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'e79298df-d852-4c6d-84f9-5d13249d1e55')
  }
}
output agentName string = agent.name
output agentId string = agent.id
output endpoint string = agent.properties.agentEndpoint
output uamiId string = identity.id
output uamiPrincipalId string = identity.properties.principalId
output systemPrincipalId string = agent.identity.principalId!