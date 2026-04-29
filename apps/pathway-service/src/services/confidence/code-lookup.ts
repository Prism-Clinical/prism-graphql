import { GraphNode, GraphContext, CodeEntry } from './types';

/**
 * Traverses HAS_CODE edges to find CodeEntry children for any node.
 * This is the canonical way to look up clinical codes — nodes like LabTest,
 * Medication, Criterion, and Procedure do NOT store code_value directly;
 * instead they link to CodeEntry children via HAS_CODE edges.
 */
export function getLinkedCodes(node: GraphNode, graphContext: GraphContext): CodeEntry[] {
  const codeNodes = graphContext.linkedNodes(node.nodeIdentifier, 'HAS_CODE');
  return codeNodes
    .filter(n => n.nodeType === 'CodeEntry')
    .map(n => ({
      code: n.properties.code_value as string ?? n.properties.code as string,
      system: n.properties.code_system as string ?? n.properties.system as string,
      display: n.properties.display as string | undefined,
    }))
    .filter(c => c.code && c.system);
}

/**
 * Returns only codes matching a specific coding system (e.g. 'LOINC', 'RXNORM', 'ICD-10', 'SNOMED').
 */
export function getLinkedCodesBySystem(
  node: GraphNode,
  graphContext: GraphContext,
  system: string,
): CodeEntry[] {
  return getLinkedCodes(node, graphContext).filter(c => c.system === system);
}
