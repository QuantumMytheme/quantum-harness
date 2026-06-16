"""
graph.py — tiny graph utilities for the architecture (topology) judge.

Pure-python, deterministic, dependency-free. A "coupling map" is a list of
undirected [a, b] edges over n qubits. These helpers let judge_verify.py grade a
proposed hardware topology: validity (degree budget, connectivity) and ROUTING
COST — the sum of shortest-path distances over a workload of required two-qubit
interactions, a standard proxy for the SWAP overhead of running that workload on
the topology. Lower is better; a fully-connected graph routes any workload at
cost == number-of-pairs.
"""

from collections import deque
import math


def normalize_edges(edges):
    """Undirected, de-duplicated edge set as (min, max) tuples."""
    out = set()
    for e in edges:
        a, b = int(e[0]), int(e[1])
        out.add((min(a, b), max(a, b)))
    return out


def adjacency(n, edges):
    adj = {i: set() for i in range(n)}
    for a, b in normalize_edges(edges):
        adj[a].add(b)
        adj[b].add(a)
    return adj


def degrees(n, edges):
    adj = adjacency(n, edges)
    return {i: len(adj[i]) for i in range(n)}


def bfs_distances(adj, src):
    dist = {src: 0}
    q = deque([src])
    while q:
        u = q.popleft()
        for v in adj[u]:
            if v not in dist:
                dist[v] = dist[u] + 1
                q.append(v)
    return dist


def is_connected(n, edges):
    if n <= 1:
        return True
    return len(bfs_distances(adjacency(n, edges), 0)) == n


def routing_cost(n, edges, workload):
    """Sum of shortest-path distances over the required interaction pairs.

    Returns math.inf if any required pair is unreachable (disconnected).
    """
    adj = adjacency(n, edges)
    cache = {}
    total = 0
    for pair in workload:
        a, b = int(pair[0]), int(pair[1])
        if a not in cache:
            cache[a] = bfs_distances(adj, a)
        d = cache[a].get(b)
        if d is None:
            return math.inf
        total += d
    return total
