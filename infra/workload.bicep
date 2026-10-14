targetScope = 'resourceGroup'
param clusterName string
param registryName string
param principalId string
param nodeVmSize string
param location string = resourceGroup().location

resource workspace 'Microsoft.OperationalInsights/workspaces@2026-03-01' = {
  name: 'law-${clusterName}'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}
resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${clusterName}'
  location: location
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: workspace.id }
}
resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: registryName
  location: location
  sku: { name: 'Standard' }
  properties: { adminUserEnabled: false, anonymousPullEnabled: false }
}
resource cluster 'Microsoft.ContainerService/managedClusters@2026-07-01' = {
  name: clusterName
  location: location
  identity: { type: 'SystemAssigned' }
  sku: { name: 'Base', tier: 'Standard' }
  properties: {
    dnsPrefix: clusterName
    enableRBAC: true
    disableLocalAccounts: true
    aadProfile: { managed: true, enableAzureRBAC: true, tenantID: tenant().tenantId }
    agentPoolProfiles: [
      { name: 'system', mode: 'System', count: 2, vmSize: nodeVmSize, osType: 'Linux', osSKU: 'Ubuntu', type: 'VirtualMachineScaleSets', osDiskSizeGB: 64 }
    ]
    networkProfile: { networkPlugin: 'azure', networkPluginMode: 'overlay', loadBalancerSku: 'standard', outboundType: 'loadBalancer' }
    addonProfiles: {
      omsagent: { enabled: true, config: { logAnalyticsWorkspaceResourceID: workspace.id, useAADAuth: 'true' } }
    }
    autoUpgradeProfile: { upgradeChannel: 'patch', nodeOSUpgradeChannel: 'NodeImage' }
  }
}
resource registryPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, cluster.id, 'kubelet-pull')
  scope: registry
  properties: { principalId: cluster.properties.identityProfile.kubeletidentity.objectId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d') }
}
resource deployer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(cluster.id, principalId, 'deployer')
  scope: cluster
  properties: { principalId: principalId, principalType: 'User', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b1ff04bb-8a4e-4dc4-8eb5-8693973ce19b') }
}
resource collectionRule 'Microsoft.Insights/dataCollectionRules@2023-03-11' = {
  name: 'dcr-${clusterName}'
  location: location
  kind: 'Linux'
  properties: {
    dataSources: { extensions: [{ name: 'ContainerInsightsExtension', extensionName: 'ContainerInsights', streams: ['Microsoft-ContainerInsights-Group-Default'], extensionSettings: { dataCollectionSettings: { interval: '1m', namespaceFilteringMode: 'Off', enableContainerLogV2: true } } }] }
    destinations: { logAnalytics: [{ name: 'paymentLogs', workspaceResourceId: workspace.id }] }
    dataFlows: [{ streams: ['Microsoft-ContainerInsights-Group-Default'], destinations: ['paymentLogs'] }]
  }
}
resource association 'Microsoft.Insights/dataCollectionRuleAssociations@2023-03-11' = {
  name: 'container-insights'
  scope: cluster
  properties: { dataCollectionRuleId: collectionRule.id }
}
resource audit 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'payment-audit'
  scope: cluster
  properties: { workspaceId: workspace.id, logAnalyticsDestinationType: 'Dedicated', logs: [{ category: 'kube-audit-admin', enabled: true }] }
}
resource alert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: 'payment-api-errors-${clusterName}'
  location: location
  kind: 'LogAlert'
  properties: {
    displayName: 'payment-api-errors-${clusterName}'
    description: 'Payment API 504 responses in the dedicated demo workload.'
    enabled: true
    severity: 2
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    scopes: [workspace.id]
    autoMitigate: true
    resolveConfiguration: { autoResolved: true, timeToResolve: 'PT5M' }
    skipQueryValidation: true
    criteria: { allOf: [{ query: 'AppRequests | where AppRoleName == "payment-api" and ResultCode == "504" | summarize FailedRequests=count()', timeAggregation: 'Maximum', metricMeasureColumn: 'FailedRequests', operator: 'GreaterThanOrEqual', threshold: 5, failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 } }] }
  }
}
output clusterName string = cluster.name
output registryName string = registry.name
output registryEndpoint string = registry.properties.loginServer
output workspaceName string = workspace.name
output workspaceId string = workspace.id
output workspaceCustomerId string = workspace.properties.customerId
output insightsName string = insights.name
output insightsId string = insights.id
output insightsAppId string = insights.properties.AppId
output alertName string = alert.name