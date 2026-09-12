export type CodedRelation = {
  actor: string;
  concept: string;
  stance: string;
  document_id: string;
  statement_id: string;
  network_included?: boolean;
};

// Document weights preserve both positions. Projections use binary positions.
export function calculateNetworkMetrics(rows: CodedRelation[], concepts: string[]) {
  const valid = rows.filter(row => row.network_included !== false && concepts.includes(row.concept) && ["support", "oppose"].includes(row.stance));
  const actors = [...new Set(valid.map(row => row.actor))].map(actor => {
    const relations = valid.filter(row => row.actor === actor);
    const cells = concepts.map(concept => {
      const entries = relations.filter(row => row.concept === concept);
      return {
        concept,
        support: new Set(entries.filter(row => row.stance === "support").map(row => row.document_id)).size,
        oppose: new Set(entries.filter(row => row.stance === "oppose").map(row => row.document_id)).size,
      };
    });
    return {
      actor, cells,
      documents: new Set(relations.map(row => row.document_id)).size,
      statements: new Set(relations.map(row => row.statement_id)).size,
      degree: cells.filter(cell => cell.support || cell.oppose).length,
      positions: cells.reduce((sum, cell) => sum + Number(cell.support > 0) + Number(cell.oppose > 0), 0),
      weight: cells.reduce((sum, cell) => sum + cell.support + cell.oppose, 0),
    };
  }).sort((a, b) => b.documents - a.documents || a.actor.localeCompare(b.actor));
  const pairs = actors.flatMap((a, index) => actors.slice(index + 1).map(b => {
    let congruence = 0;
    let conflict = 0;
    const shared: string[] = [];
    a.cells.forEach((cell, c) => {
      const other = b.cells[c];
      const ap = Number(cell.support > 0), an = Number(cell.oppose > 0);
      const bp = Number(other.support > 0), bn = Number(other.oppose > 0);
      congruence += ap * bp + an * bn;
      conflict += ap * bn + an * bp;
      if ((ap || an) && (bp || bn)) shared.push(cell.concept);
    });
    const denominator = Math.sqrt(a.positions * b.positions);
    return { a: a.actor, b: b.actor, shared, congruence, conflict,
      congruenceCosine: denominator ? congruence / denominator : 0,
      conflictCosine: denominator ? conflict / denominator : 0 };
  }));
  const edges = actors.reduce((sum, actor) => sum + actor.degree, 0);
  return { actors, pairs, edges,
    documents: new Set(valid.map(row => row.document_id)).size,
    statements: new Set(valid.map(row => row.statement_id)).size,
    density: actors.length && concepts.length ? edges / (actors.length * concepts.length) : 0,
  };
}

export type FacetRelation = CodedRelation & { subconcept: string };

function shortestPathScores(adjacency: Map<string, Set<string>>, source: string) {
  const distance = new Map<string, number>([[source, 0]]);
  const paths = new Map<string, number>([[source, 1]]);
  const predecessors = new Map<string, string[]>();
  const queue = [source];
  const stack: string[] = [];
  while (queue.length) {
    const node = queue.shift()!;
    stack.push(node);
    for (const neighbor of adjacency.get(node) || []) {
      if (!distance.has(neighbor)) {
        distance.set(neighbor, distance.get(node)! + 1);
        queue.push(neighbor);
      }
      if (distance.get(neighbor) === distance.get(node)! + 1) {
        paths.set(neighbor, (paths.get(neighbor) || 0) + (paths.get(node) || 0));
        predecessors.set(neighbor, [...(predecessors.get(neighbor) || []), node]);
      }
    }
  }
  const dependency = new Map<string, number>();
  const contribution = new Map<string, number>();
  while (stack.length) {
    const node = stack.pop()!;
    for (const previous of predecessors.get(node) || []) {
      const value = ((paths.get(previous) || 0) / (paths.get(node) || 1)) * (1 + (dependency.get(node) || 0));
      dependency.set(previous, (dependency.get(previous) || 0) + value);
    }
    if (node !== source) contribution.set(node, dependency.get(node) || 0);
  }
  return { distance, contribution };
}

export function calculateConceptCentrality(rows: FacetRelation[], concept: string, subconcepts: string[], actorUniverse: string[]) {
  const valid = rows.filter(row => row.network_included !== false && row.concept === concept && row.subconcept && ["support", "oppose"].includes(row.stance));
  const actors = [...new Set(actorUniverse)];
  const actorIds = actors.map(actor => `actor:${actor}`);
  const subconceptIds = subconcepts.map(item => `subconcept:${item}`);
  const nodes = [...actorIds, ...subconceptIds];
  const adjacency = new Map(nodes.map(node => [node, new Set<string>()]));
  for (const row of valid) {
    if (!actors.includes(row.actor) || !subconcepts.includes(row.subconcept)) continue;
    adjacency.get(`actor:${row.actor}`)!.add(`subconcept:${row.subconcept}`);
    adjacency.get(`subconcept:${row.subconcept}`)!.add(`actor:${row.actor}`);
  }
  const betweenness = new Map(nodes.map(node => [node, 0]));
  const harmonic = new Map(nodes.map(node => [node, 0]));
  for (const source of nodes) {
    const paths = shortestPathScores(adjacency, source);
    for (const [node, value] of paths.contribution) betweenness.set(node, betweenness.get(node)! + value);
    for (const [node, distance] of paths.distance) if (node !== source) harmonic.set(source, harmonic.get(source)! + 1 / distance);
  }
  const n = nodes.length;
  const betweennessDenominator = n > 2 ? (n - 1) * (n - 2) : 1;
  return actors.map(actor => {
    const actorRows = valid.filter(row => row.actor === actor);
    const activeSubconcepts = new Set(actorRows.map(row => row.subconcept));
    const support = new Set(actorRows.filter(row => row.stance === "support").map(row => row.document_id)).size;
    const oppose = new Set(actorRows.filter(row => row.stance === "oppose").map(row => row.document_id)).size;
    const relationDocuments = new Set(actorRows.map(row => `${row.document_id}|${row.subconcept}|${row.stance}`)).size;
    const id = `actor:${actor}`;
    return {
      actor,
      active: actorRows.length > 0,
      degree: activeSubconcepts.size,
      degreeNormalized: subconcepts.length ? activeSubconcepts.size / subconcepts.length : 0,
      strength: relationDocuments,
      documents: new Set(actorRows.map(row => row.document_id)).size,
      statements: new Set(actorRows.map(row => row.statement_id)).size,
      support,
      oppose,
      harmonic: n > 1 ? harmonic.get(id)! / (n - 1) : 0,
      betweenness: betweenness.get(id)! / betweennessDenominator,
    };
  }).filter(row => row.active).sort((a, b) => b.strength - a.strength || b.degree - a.degree || a.actor.localeCompare(b.actor));
}
