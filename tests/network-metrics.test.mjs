import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateConceptCentrality, calculateNetworkMetrics } from '../app/network-metrics.ts';

const row = (actor, concept, stance, id = `${actor}-${concept}-${stance}`) => ({ actor, concept, stance, document_id: id, statement_id: id });

test('binary congruence and conflict preserve mixed positions and missing concepts', () => {
  const result = calculateNetworkMetrics([
    row('A', 'x', 'support'), row('B', 'x', 'support'),
    row('C', 'x', 'oppose'), row('D', 'y', 'support'),
    row('E', 'x', 'support'), row('E', 'x', 'oppose'),
  ], ['x', 'y']);
  const pair = (a, b) => result.pairs.find(p => [p.a, p.b].includes(a) && [p.a, p.b].includes(b));
  assert.equal(pair('A', 'B').congruenceCosine, 1);
  assert.equal(pair('A', 'B').conflictCosine, 0);
  assert.equal(pair('A', 'C').conflictCosine, 1);
  assert.equal(pair('A', 'C').congruenceCosine, 0);
  assert.equal(pair('A', 'D').shared.length, 0);
  assert.equal(pair('A', 'D').conflictCosine, 0);
  assert.equal(pair('A', 'D').congruenceCosine, 0);
  assert.ok(pair('A', 'E').congruenceCosine > 0);
  assert.ok(pair('A', 'E').conflictCosine > 0);
  assert.equal(result.density, 0.5);
  assert.equal(result.pairs.length, 10);
});

test('document and statement weights are distinct; repeats do not increase binary scores', () => {
  const original = row('A', 'x', 'support', 'doc1');
  const rows = [original, original, { ...original, statement_id: 'statement2' }, row('B', 'x', 'support')];
  const result = calculateNetworkMetrics(rows, ['x']);
  const actor = result.actors.find(a => a.actor === 'A');
  assert.equal(actor.documents, 1);
  assert.equal(actor.statements, 2);
  assert.equal(actor.weight, 1);
  assert.equal(result.pairs[0].congruenceCosine, 1);
  assert.equal(calculateNetworkMetrics([], ['x']).density, 0);
  assert.equal(calculateNetworkMetrics([row('A', 'x', 'unclear')], ['x']).actors.length, 0);
});

test('real coded data: finite scores and invariance to duplicated input', () => {
  const rows = JSON.parse(readFileSync(new URL('../public/data/statements.json', import.meta.url), 'utf8')).map(row => ({ ...row, actor: row.actor_normalized || row.actor }));
  const concepts = ['ponzi', 'kenaikan_biaya', 'keamanan_dana', 'keadilan', 'keberlanjutan', 'subsidi_silang'];
  const result = calculateNetworkMetrics(rows, concepts);
  assert.deepEqual(calculateNetworkMetrics([...rows, ...rows], concepts), result);
  for (const pair of result.pairs) {
    for (const value of [pair.congruenceCosine, pair.conflictCosine]) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1 + 1e-12);
  }
  for (const year of [2021, 2022, 2023, 2024]) {
    const filtered = calculateNetworkMetrics(rows.filter(row => Number(row.year) === year), concepts);
    assert.ok(filtered.documents <= result.documents);
  }
});

test('concept centrality uses a fixed bipartite universe and document weights', () => {
  const rows = [
    { ...row('A', 'issue', 'support', 'd1'), subconcept: 'x' },
    { ...row('A', 'issue', 'oppose', 'd2'), subconcept: 'y' },
    { ...row('B', 'issue', 'support', 'd3'), subconcept: 'y' },
    { ...row('B', 'issue', 'support', 'd4'), subconcept: 'x', network_included: false },
  ];
  const result = calculateConceptCentrality(rows, 'issue', ['x', 'y'], ['A', 'B']);
  const a = result.find(item => item.actor === 'A');
  const b = result.find(item => item.actor === 'B');
  assert.equal(a.degreeNormalized, 1);
  assert.equal(a.strength, 2);
  assert.equal(a.support, 1);
  assert.equal(a.oppose, 1);
  assert.equal(b.degreeNormalized, 0.5);
  assert.ok(a.harmonic > b.harmonic);
  assert.ok(a.betweenness > b.betweenness);
});
