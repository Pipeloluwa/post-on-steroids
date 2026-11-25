import type { RequestState } from '../services/tab.state.service';

export interface TriggerCycleAnalysis {
    hasLoops: boolean;
    cyclePaths: string[][];
    cycleDescriptions: string[];
    involvedRequestIds: Set<string>;
    requestCycleMessages: Map<string, string[]>;
}

/**
 * Analyzes `postTriggerTabId` edges across a set of requests to detect self-loops (A -> A),
 * mutual loops (A -> B -> A), and multi-hop cycles (A -> B -> C -> A).
 */
export function analyzeTriggerLoops(
    requests: RequestState[],
    resolveLabel?: (req: RequestState) => string
): TriggerCycleAnalysis {
    const labelOf = resolveLabel || ((r: RequestState) => r.name || r.url || r.id);
    const byId = new Map<string, RequestState>();
    const edges = new Map<string, string>();

    for (const req of requests || []) {
        if (!req?.id) continue;
        byId.set(req.id, req);
        const target = (req.postTriggerTabId || '').trim();
        if (target && target !== '__script__') {
            edges.set(req.id, target);
        }
    }

    const cyclePaths: string[][] = [];
    const seenSignatures = new Set<string>();
    const involvedRequestIds = new Set<string>();
    const requestCycleMessages = new Map<string, string[]>();

    for (const startId of edges.keys()) {
        const path: string[] = [startId];
        const indexInPath = new Map<string, number>([[startId, 0]]);
        let cur: string | undefined = edges.get(startId);

        while (cur && byId.has(cur)) {
            const hitIdx = indexInPath.get(cur);
            if (hitIdx !== undefined) {
                const cycle = [...path.slice(hitIdx), cur];
                const canonicalNodes = cycle.slice(0, -1);
                // Canonical rotation prevents reporting the same loop twice from different start nodes
                let minIdx = 0;
                for (let i = 1; i < canonicalNodes.length; i++) {
                    if (canonicalNodes[i] < canonicalNodes[minIdx]) minIdx = i;
                }
                const rotated = [...canonicalNodes.slice(minIdx), ...canonicalNodes.slice(0, minIdx)];
                const sig = rotated.join('->');
                if (!seenSignatures.has(sig)) {
                    seenSignatures.add(sig);
                    cyclePaths.push(cycle);
                    const desc = cycle
                        .map(id => {
                            const r = byId.get(id);
                            return r ? `${r.method || 'GET'} ${labelOf(r)}` : id;
                        })
                        .join(' → ');
                    for (const nodeId of rotated) {
                        involvedRequestIds.add(nodeId);
                        const existing = requestCycleMessages.get(nodeId) || [];
                        existing.push(desc);
                        requestCycleMessages.set(nodeId, existing);
                    }
                }
                break;
            }
            indexInPath.set(cur, path.length);
            path.push(cur);
            cur = edges.get(cur);
        }
    }

    const cycleDescriptions = cyclePaths.map(cycle =>
        cycle
            .map(id => {
                const r = byId.get(id);
                return r ? `${r.method || 'GET'} ${labelOf(r)}` : id;
            })
            .join(' → ')
    );

    return {
        hasLoops: cyclePaths.length > 0,
        cyclePaths,
        cycleDescriptions,
        involvedRequestIds,
        requestCycleMessages
    };
}

/**
 * Simulates setting `sourceId.postTriggerTabId = targetId` and checks whether it introduces a trigger loop.
 */
export function detectProposedTriggerLoop(
    requests: RequestState[],
    sourceId: string,
    targetId: string | null | undefined,
    resolveLabel?: (req: RequestState) => string
): { hasLoop: boolean; descriptions: string[] } {
    const cleanTarget = (targetId || '').trim();
    if (!cleanTarget || cleanTarget === '__script__' || !sourceId) {
        return { hasLoop: false, descriptions: [] };
    }
    const simulated = (requests || []).map(r =>
        r.id === sourceId ? { ...r, postTriggerTabId: cleanTarget } : r
    );
    const analysis = analyzeTriggerLoops(simulated, resolveLabel);
    const messages = analysis.requestCycleMessages.get(sourceId) || [];
    return {
        hasLoop: messages.length > 0,
        descriptions: messages
    };
}
