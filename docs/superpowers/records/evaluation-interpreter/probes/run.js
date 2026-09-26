// Scratch runner: loads live graph JSON, runs deployed (dist) TraversalEngine. Read-only.
const D=require('path').resolve(__dirname, '../../../../..') + '/apps/pathway-service/dist';
const {TraversalEngine}=require(D+'/services/resolution/traversal-engine');
const {buildGraphContext}=require(D+'/resolvers/helpers/resolution-context');
const {makeEvaluationTemporalContext}=require(D+'/services/resolution/temporal/evaluation-context');
const {factStoreFor}=require(D+'/services/resolution/temporal/fact-store');
const {buildCodeMap}=require(D+'/services/resolution/attribute-code-map');
const fs=require('fs');
const P=x=>typeof x==='string'?JSON.parse(x):x;
module.exports=async function run(file,patient,{answers=new Map(),overrides=new Map(),policy='v1',asOf='2026-09-26T12:00:00.000Z',conf=0.9,llm}={}){
  const g=JSON.parse(fs.readFileSync(file)).data.pathwayGraph;
  const nodes=g.nodes.map(n=>({nodeIdentifier:n.id,nodeType:n.type,properties:P(n.properties)||{}}));
  const edges=g.edges.map(e=>({edgeType:e.type,sourceId:e.from,targetId:e.to,properties:P(e.properties)||{}}));
  const gc=buildGraphContext(nodes,edges);
  const tc=makeEvaluationTemporalContext({evaluationAsOf:asOf,temporalPolicyVersion:policy});
  const codeMap=buildCodeMap([{attributeName:'lab.hemoglobin',namespace:'lab',system:'LOINC',code:'718-7',valueType:'number'},{attributeName:'lab.ferritin',namespace:'lab',system:'LOINC',code:'2276-4',valueType:'number'}]);
  const ce={computeNodeConfidence:async n=>({nodeIdentifier:n.nodeIdentifier,confidence:conf,breakdown:[],resolutionType:'AUTO_RESOLVED',propagationInfluences:[]})};
  const eng=new TraversalEngine(ce,{autoResolveThreshold:0.85,suggestThreshold:0.6},tc,{},policy==='v1'?factStoreFor(patient,tc):[],codeMap,llm);
  const t=await eng.traverse(gc,patient,answers,overrides);
  return t;
};
module.exports.show=function(t,ids){const out=[];for(const [id,r] of t.resolutionState){if(ids&&!ids.some(x=>id.startsWith(x)))continue;out.push(`${id.padEnd(28)} ${String(r.status).padEnd(14)} parent=${r.parentNodeId||''} ${r.excludeReason?'| '+r.excludeReason.slice(0,90):''}`)}console.log(out.join('\n'));if(t.pendingQuestions.length)console.log('PENDING',t.pendingQuestions.map(q=>q.gateId).join(','));if(t.redFlags.length)console.log('REDFLAGS',JSON.stringify(t.redFlags.map(f=>[f.nodeId,f.type])));}
