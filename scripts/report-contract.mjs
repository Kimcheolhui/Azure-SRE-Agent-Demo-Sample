import { parse as parseHtml } from 'parse5';
import { parse as parseJavaScript } from 'acorn';
import { full, fullAncestor } from 'acorn-walk';

function scripts(document) {
  const result = [];
  function visit(node) {
    if (node.tagName === 'script' && !node.attrs.some(attribute => attribute.name === 'src') && !node.attrs.some(attribute => attribute.name === 'type' && attribute.value === 'application/json')) result.push(node.childNodes.map(child => child.value || '').join(''));
    for (const child of node.childNodes || []) visit(child);
  }
  visit(document);
  return result;
}

function value(node, declarations, parameters = {}, resolving = new Set()) {
  if (node.type === 'Literal') return node.value;
  if (node.type === 'Identifier') {
    if (Object.hasOwn(parameters, node.name)) return parameters[node.name];
    if (!declarations.has(node.name) || resolving.has(node.name)) throw new Error(`Unresolved report expression: ${node.name}`);
    return value(declarations.get(node.name), declarations, parameters, new Set([...resolving, node.name]));
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') return value(node.left, declarations, parameters, resolving) + value(node.right, declarations, parameters, resolving);
  if (node.type === 'TemplateLiteral') return node.quasis.reduce((text, part, index) => text + part.value.cooked + (index < node.expressions.length ? value(node.expressions[index], declarations, parameters, resolving) : ''), '');
  if (node.type === 'ObjectExpression') return Object.fromEntries(node.properties.map(property => {
    if (property.type !== 'Property' || property.computed || property.kind !== 'init') throw new Error('Dynamic report argument objects are not supported');
    return [property.key.name || property.key.value, value(property.value, declarations, parameters, resolving)];
  }));
  throw new Error(`Unsupported dynamic report expression: ${node.type}`);
}

export function validateReportCall(call, env) {
  if (call.toolName !== 'system-mcp-monitor_monitor_resource_log_query') throw new Error('Report contains an unapproved tool');
  const args = call.args;
  if (args['resource-id']?.toLowerCase() !== env.APPINSIGHTS_RESOURCE_ID.toLowerCase() || args.subscription !== env.AZURE_SUBSCRIPTION_ID) throw new Error('Report query targets a different environment');
  if (!['requests', 'exceptions'].includes(args.table) || !Number.isFinite(args.hours) || args.hours > 1 || !Number.isFinite(args.limit) || args.limit > 500) throw new Error('Report query scope is not bounded');
  if (typeof args.query !== 'string' || !/\bwhere\s+timestamp\s*>\s*ago\(30m\)/i.test(args.query)) throw new Error('Actual report query does not use the displayed thirty-minute window');
  if (/\b(?:workspace|app|externaldata)\s*\(|\b(?:evaluate|execute|set|drop)\b/i.test(args.query)) throw new Error('Cross-source or unreviewed report query is not allowed');
  return call;
}

export function reportCalls(html, env) {
  const calls = [];
  for (const script of scripts(parseHtml(html))) {
    const ast = parseJavaScript(script, { ecmaVersion: 'latest', sourceType: 'script' });
    const declarations = new Map();
    const invocations = [];
    full(ast, node => {
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init && ['Literal', 'Identifier', 'BinaryExpression', 'TemplateLiteral', 'ObjectExpression'].includes(node.init.type)) declarations.set(node.id.name, node.init);
      if (node.type === 'CallExpression') invocations.push(node);
    });
    fullAncestor(ast, (node, state, ancestors) => {
      if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression' || node.callee.computed || node.callee.property.name !== 'callTool') return;
      const receiver = node.callee.object;
      if (receiver.type !== 'MemberExpression' || receiver.computed || receiver.object.name !== 'window' || receiver.property.name !== 'sreagent') throw new Error('Unknown report tool receiver');
      const toolName = value(node.arguments[0], declarations);
      if (toolName !== 'system-mcp-monitor_monitor_resource_log_query') throw new Error('Report contains an unapproved tool');
      const enclosing = [...ancestors].reverse().find(ancestor => ancestor.type === 'FunctionDeclaration');
      const uses = enclosing ? invocations.filter(invocation => invocation.callee.type === 'Identifier' && invocation.callee.name === enclosing.id.name) : [null];
      for (const invocation of uses) {
        const parameters = enclosing ? Object.fromEntries(enclosing.params.map((parameter, index) => {
          if (parameter.type !== 'Identifier' || !invocation.arguments[index]) throw new Error('Dynamic report wrapper parameters are unsupported');
          return [parameter.name, value(invocation.arguments[index], declarations)];
        })) : {};
        calls.push(validateReportCall({ toolName, args: value(node.arguments[1], declarations, parameters) }, env));
      }
    });
  }
  if (!calls.length) throw new Error('No statically verified calls found in the actual saved report');
  return [...new Map(calls.map(call => [JSON.stringify(call), call])).values()];
}