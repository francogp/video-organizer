import { executeTableQuery } from './tableQueryCore.ts';
import type { TableWorkerInMessage, TableWorkerResult, TableWorkerRowInput } from './tableTypes.ts';

interface WorkerPostTarget {
  postMessage: (message: TableWorkerResult, transfer: Transferable[]) => void;
}

function isWorkerPostTarget(scope: object): scope is WorkerPostTarget {
  return 'postMessage' in scope && typeof scope.postMessage === 'function';
}

let cachedRows: readonly TableWorkerRowInput[] = [];

globalThis.addEventListener('message', (event: MessageEvent<TableWorkerInMessage>): void => {
  const payload = event.data;
  if (payload.type === 'SET_ROWS') {
    cachedRows = payload.rows;
    return;
  }

  const result = executeTableQuery(cachedRows, payload);
  const scope: object = globalThis;
  if (isWorkerPostTarget(scope)) {
    scope.postMessage(result, [result.indices.buffer]);
  }
});
