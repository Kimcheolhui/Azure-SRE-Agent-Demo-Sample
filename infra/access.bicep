targetScope = 'resourceGroup'
param agentPrincipalId string
param agentSystemPrincipalId string
param clusterName string
param workspaceName string
param insightsName string

resource cluster 'Microsoft.ContainerService/managedClusters@2026-07-01' existing = { name: clusterName }
resource workspace 'Microsoft.OperationalInsights/workspaces@2026-03-01' existing = { name: workspaceName }
resource insights 'Microsoft.Insights/components@2020-02-02' existing = { name: insightsName }

var readRoles = ['acdd72a7-3385-48ef-bd42-f606fba81ae7', '73c42c96-874c-492b-b04d-ab87d138a893', '43d0d8ad-25c7-4714-9337-8ba259a9fe05']
resource resourceReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for roleId in readRoles: {
  name: guid(resourceGroup().id, agentPrincipalId, roleId)
  properties: { principalId: agentPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId) }
}]
resource clusterUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(cluster.id, agentPrincipalId, 'cluster-user')
  scope: cluster
  properties: { principalId: agentPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4abbcc35-e782-43d8-92c5-2d3f1bd2253f') }
}
resource kubernetesReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(cluster.id, agentPrincipalId, 'namespace-reader')
  scope: cluster
  properties: { principalId: agentPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f6c6a51-bcf8-42ba-9220-52d62157d7db') }
}
resource connectorWorkspaceReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(workspace.id, agentSystemPrincipalId, 'connector-read')
  scope: workspace
  properties: { principalId: agentSystemPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '73c42c96-874c-492b-b04d-ab87d138a893') }
}
resource connectorInsightsReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(insights.id, agentSystemPrincipalId, 'connector-read')
  scope: insights
  properties: { principalId: agentSystemPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '43d0d8ad-25c7-4714-9337-8ba259a9fe05') }
}