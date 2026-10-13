export function reviewedReportApproval(messages, threadId, reviewedId) {
  if (!reviewedId) throw new Error('Review all tools, arguments and targets in the native approval card, then use report-approve --reviewed <APPROVAL_ID>. Description text alone is not authorization.');
  const approvals = messages.map(message => message.approval).filter(Boolean);
  const approval = approvals.find(item => item.id === reviewedId);
  if (!approval || approval.threadId !== threadId || approval.status !== 'Pending' || !approval.title?.includes('SaveReport') || approval.command) throw new Error('Reviewed approval does not match the pending report-save request in this thread');
  return approval;
}