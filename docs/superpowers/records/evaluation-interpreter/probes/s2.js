const run=require('./run');const G=__dirname+'/graphs/';
const A=G+'a1774566-42ce-43cc-b83c-1a5749b240e1.json', H=G+'9ee949c9-625a-48ac-873b-c121e8fd24e2.json', C=G+'8d7fbfc6-06cf-4caa-a4e7-2efe07e9ea6c.json';
const base={patientId:'p',conditionCodes:[],medications:[],allergies:[],vitalSigns:{},freeformData:{}};
const K=['step','gate','dp','med','proc','stage'];
const T=async(title,f,p,o,ids=K)=>{console.log('\n=== '+title);try{run.show(await run(f,p,o),ids)}catch(e){console.log('THREW',e.message.slice(0,300))}};
(async()=>{
await T('A2 anemia T1 Hb 9 ferritin 12 (iron-def anemic)',A,{...base,labResults:[{code:'718-7',system:'LOINC',value:9,date:'2026-09-20'},{code:'2276-4',system:'LOINC',value:12,date:'2026-09-20'}],patientAttributes:{trimester:1}});
await T('A3 anemia missing facts: no labs, no trimester',A,{...base,labResults:[],patientAttributes:{}});
await T('A4 anemia T1 Hb 9, dp-1 answered -> step-2-3 (alt etiology)',A,{...base,labResults:[{code:'718-7',system:'LOINC',value:9,date:'2026-09-20'},{code:'2276-4',system:'LOINC',value:80,date:'2026-09-20'}],patientAttributes:{trimester:1}},{answers:new Map([['dp-1',{gateId:'dp-1',selectedOption:'step-2-3'}]])},['step-2','step-3-1','dp','gate-iron','med-1','med-2']);
await T('A5 anemia non-anemic + override INCLUDE gate-anemia-t2 (closed ancestor w/ override)',A,{...base,labResults:[{code:'718-7',system:'LOINC',value:12.5,date:'2026-09-20'}],patientAttributes:{trimester:2}},{overrides:new Map([['gate-anemia-t2',{nodeId:'gate-anemia-t2',action:'INCLUDE',originalStatus:'GATED_OUT',originalConfidence:0,reason:'x'}]])},['step-2','gate-anemia','dp','lab-2']);
await T('A6 anemia legacy-v0 same non-anemic patient',A,{...base,labResults:[{code:'718-7',system:'LOINC',value:12.5},{code:'2276-4',system:'LOINC',value:80}],patientAttributes:{trimester:2}},{policy:'legacy-v0'},['gate','med-1','proc-1','dp']);
await T('A7 anemia Hb reading 400 days old (temporal) T2',A,{...base,labResults:[{code:'718-7',system:'LOINC',value:6,date:'2025-08-20'}],patientAttributes:{trimester:2}},{},['gate','step-2-2','step-3-3','proc-1']);
await T('H1 GHTN no data',H,{...base,labResults:[],patientAttributes:{}},{});
await T('H2 GHTN BP 150/95 3 days ago, aspirin=yes, htn-confirmed=yes',H,{...base,labResults:[{code:'8480-6',system:'LOINC',value:150,date:'2026-09-23'},{code:'8462-4',system:'LOINC',value:95,date:'2026-09-23'}],patientAttributes:{}},{answers:new Map([['gate-aspirin-indicated',{gateId:'gate-aspirin-indicated',value:true}],['gate-htn-confirmed',{gateId:'gate-htn-confirmed',value:true}]])});
await T('H3 GHTN BP 150/95 10 days ago (outside 7d horizon)',H,{...base,labResults:[{code:'8480-6',system:'LOINC',value:150,date:'2026-09-16'},{code:'8462-4',system:'LOINC',value:95,date:'2026-09-16'}],patientAttributes:{}},{},['gate-bp','step-2']);
await T('C1 chronic HTN, empty patient',C,{...base,labResults:[],patientAttributes:{}},{},['step-3','stage-6','dp','med']);
})();
