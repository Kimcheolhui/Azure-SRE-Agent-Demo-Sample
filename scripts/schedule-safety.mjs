import { readFile, writeFile, rm } from 'node:fs/promises';

export async function restoreSchedule(api, markerPath, target) {
  let marker;
  try { marker = JSON.parse(await readFile(markerPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (marker.target !== target || !marker.taskId || marker.name !== 'payment-daily-health') throw new Error('Pending schedule restoration belongs to a different Agent');
  const task = await api(`/api/v1/scheduledtasks/${marker.taskId}`);
  if (task.name !== marker.name) throw new Error('Pending restoration task name changed');
  await api(`/api/v1/scheduledtasks/${marker.taskId}/pause`, 'POST', {});
  if ((await api(`/api/v1/scheduledtasks/${marker.taskId}`)).status !== 'Paused') throw new Error('Schedule restoration did not reach Paused');
  await rm(markerPath);
  return true;
}

export async function withPausedSchedule(api, task, markerPath, target, operation, processHandle = process) {
  if (task.status !== 'Paused') throw new Error('Task must be paused before bounded execution');
  const controller = new AbortController();
  const handlers = new Map(['SIGINT', 'SIGTERM'].map(name => [name, () => {
    processHandle.exitCode = name === 'SIGINT' ? 130 : 143;
    controller.abort(new Error(`Schedule execution interrupted by ${name}`));
  }]));
  for (const [name, handler] of handlers) processHandle.on(name, handler);
  try {
    await writeFile(markerPath, JSON.stringify({ taskId: task.id, name: task.name, target, utc: new Date().toISOString() }), { mode: 0o600 });
    await api(`/api/v1/scheduledtasks/${task.id}/resume`, 'POST', {}, { signal: controller.signal });
    controller.signal.throwIfAborted();
    return await operation(controller.signal);
  } finally {
    try {
      await api(`/api/v1/scheduledtasks/${task.id}/pause`, 'POST', {});
      if ((await api(`/api/v1/scheduledtasks/${task.id}`)).status !== 'Paused') throw new Error('Interrupted task did not return to Paused; restoration record retained');
      await rm(markerPath, { force: true });
    } finally {
      for (const [name, handler] of handlers) processHandle.removeListener(name, handler);
    }
  }
}