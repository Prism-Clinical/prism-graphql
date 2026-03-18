# Manual Testing: Pathway Import Pipeline (Plan 2)

`feat/pathway-graph-import-pipeline`

This document walks through verifying the import pipeline: JSON validation, graph construction in Apache AGE, relational side-table writes, diff computation, and GraphQL mutations for import + lifecycle status transitions. Each section has expected results and known gaps.

---

## Prerequisites

```bash
# Start the stack (from main checkout — Docker Compose runs here)
cd workspace/prism-graphql
make compose-up

# Verify postgres + AGE are healthy
docker compose exec postgres pg_isready -U postgres
make migrate
```

Confirm the pathway-service is running:
```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathwayServiceHealth }"}' | python3 -m json.tool
```
**Expected:** `{"data":{"pathwayServiceHealth":true}}`

If testing via the gateway (port 4000):
```bash
curl -s -X POST http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathwayServiceHealth }"}' | python3 -m json.tool
```

> **Note:** All `curl` examples below target the pathway-service directly on port 4016. Replace with `http://localhost:4000/graphql` to test through the gateway.

---

## 1. Import a New Pathway (NEW_PATHWAY)

**What to verify:** A valid pathway JSON is validated, graph is created in AGE, relational tables are populated, and a synthetic creation diff is returned.

### 1a. Reference pathway — full node/edge coverage

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id logicalId title version category status conditionCodes scope targetPopulation isActive createdAt updatedAt } validation { valid errors warnings } diff { summary { nodesAdded nodesRemoved nodesModified edgesAdded edgesRemoved edgesModified } synthetic } importType } }",
    "variables": {
      "mode": "NEW_PATHWAY",
      "json": "{\"schema_version\":\"1.0\",\"pathway\":{\"logical_id\":\"CP-PriorUterineSurgery\",\"title\":\"Prior Uterine Surgery Management\",\"version\":\"1.0\",\"category\":\"OBSTETRIC\",\"scope\":\"Management of patients with prior uterine surgical history\",\"target_population\":\"Pregnant patients with history of cesarean delivery or other uterine surgery\",\"condition_codes\":[{\"code\":\"O34.211\",\"system\":\"ICD-10\",\"description\":\"Maternal care for unspecified type scar from previous cesarean delivery\",\"usage\":\"primary\",\"grouping\":\"prior_surgery\"},{\"code\":\"O34.29\",\"system\":\"ICD-10\",\"description\":\"Maternal care due to uterine scar from other previous surgery\",\"usage\":\"secondary\",\"grouping\":\"prior_surgery\"}]},\"nodes\":[{\"id\":\"stage-1\",\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Initial Assessment\",\"description\":\"Gather surgical history and assess risk factors\"}},{\"id\":\"step-1-1\",\"type\":\"Step\",\"properties\":{\"stage_number\":1,\"step_number\":1,\"display_number\":\"1.1\",\"title\":\"Obtain Surgical History\",\"description\":\"Document type, number, and indication of prior uterine surgeries\"}},{\"id\":\"step-1-2\",\"type\":\"Step\",\"properties\":{\"stage_number\":1,\"step_number\":2,\"display_number\":\"1.2\",\"title\":\"Review Operative Reports\",\"description\":\"Review prior operative reports for incision type and complications\"}},{\"id\":\"stage-2\",\"type\":\"Stage\",\"properties\":{\"stage_number\":2,\"title\":\"Risk Stratification\",\"description\":\"Determine delivery planning based on risk profile\"}},{\"id\":\"step-2-1\",\"type\":\"Step\",\"properties\":{\"stage_number\":2,\"step_number\":1,\"display_number\":\"2.1\",\"title\":\"Assess TOLAC Candidacy\",\"description\":\"Evaluate trial of labor after cesarean eligibility\"}},{\"id\":\"dp-1\",\"type\":\"DecisionPoint\",\"properties\":{\"title\":\"Delivery Method Decision\",\"auto_resolve_eligible\":true}},{\"id\":\"crit-1\",\"type\":\"Criterion\",\"properties\":{\"description\":\"Single prior low-transverse cesarean\",\"code_system\":\"ICD-10\",\"code_value\":\"O34.211\",\"base_rate\":0.006,\"is_critical\":true}},{\"id\":\"crit-2\",\"type\":\"Criterion\",\"properties\":{\"description\":\"Prior classical or T-incision\",\"code_system\":\"ICD-10\",\"code_value\":\"O34.29\",\"base_rate\":0.04,\"is_critical\":true}},{\"id\":\"stage-3\",\"type\":\"Stage\",\"properties\":{\"stage_number\":3,\"title\":\"TOLAC Management\",\"description\":\"Management for trial of labor after cesarean\"}},{\"id\":\"step-3-1\",\"type\":\"Step\",\"properties\":{\"stage_number\":3,\"step_number\":1,\"display_number\":\"3.1\",\"title\":\"Continuous Fetal Monitoring\",\"description\":\"Apply continuous electronic fetal monitoring during labor\"}},{\"id\":\"med-1\",\"type\":\"Medication\",\"properties\":{\"name\":\"Oxytocin\",\"dose\":\"2 milliunits/min initial\",\"route\":\"IV\",\"frequency\":\"Titrate per protocol\",\"role\":\"acceptable\"}},{\"id\":\"med-2\",\"type\":\"Medication\",\"properties\":{\"name\":\"Dinoprostone\",\"dose\":\"10mg insert\",\"route\":\"Vaginal\",\"frequency\":\"Once\",\"role\":\"acceptable\"}},{\"id\":\"med-3\",\"type\":\"Medication\",\"properties\":{\"name\":\"Misoprostol\",\"dose\":\"N/A\",\"route\":\"N/A\",\"frequency\":\"N/A\",\"role\":\"contraindicated\"}},{\"id\":\"lab-1\",\"type\":\"LabTest\",\"properties\":{\"name\":\"Complete Blood Count\",\"code_system\":\"LOINC\",\"code_value\":\"58410-2\"}},{\"id\":\"proc-1\",\"type\":\"Procedure\",\"properties\":{\"name\":\"Cesarean Delivery\",\"code_system\":\"CPT\",\"code_value\":\"59510\"}},{\"id\":\"ev-1\",\"type\":\"EvidenceCitation\",\"properties\":{\"reference_number\":1,\"title\":\"ACOG Practice Bulletin No. 205: Vaginal Birth After Cesarean Delivery\",\"source\":\"Obstetrics & Gynecology\",\"evidence_level\":\"Level A\",\"year\":2019}},{\"id\":\"ev-2\",\"type\":\"EvidenceCitation\",\"properties\":{\"reference_number\":2,\"title\":\"Uterine Rupture Risk Factors\",\"source\":\"American Journal of Obstetrics & Gynecology\",\"evidence_level\":\"Level B\",\"year\":2020}},{\"id\":\"qm-1\",\"type\":\"QualityMetric\",\"properties\":{\"name\":\"VBAC Success Rate\",\"measure\":\"Percentage of TOLAC attempts resulting in vaginal delivery\",\"target\":\">= 60%\"}},{\"id\":\"sched-1\",\"type\":\"Schedule\",\"properties\":{\"interval\":\"Every 15 minutes\",\"duration\":\"Throughout active labor\",\"description\":\"Fetal heart rate monitoring intervals during TOLAC\"}},{\"id\":\"code-1\",\"type\":\"CodeEntry\",\"properties\":{\"system\":\"ICD-10\",\"code\":\"O34.211\",\"description\":\"Low transverse cesarean scar\"}},{\"id\":\"code-2\",\"type\":\"CodeEntry\",\"properties\":{\"system\":\"CPT\",\"code\":\"59510\",\"description\":\"Cesarean delivery\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\",\"properties\":{\"order\":1}},{\"from\":\"root\",\"to\":\"stage-2\",\"type\":\"HAS_STAGE\",\"properties\":{\"order\":2}},{\"from\":\"root\",\"to\":\"stage-3\",\"type\":\"HAS_STAGE\",\"properties\":{\"order\":3}},{\"from\":\"stage-1\",\"to\":\"step-1-1\",\"type\":\"HAS_STEP\",\"properties\":{\"order\":1}},{\"from\":\"stage-1\",\"to\":\"step-1-2\",\"type\":\"HAS_STEP\",\"properties\":{\"order\":2}},{\"from\":\"stage-2\",\"to\":\"step-2-1\",\"type\":\"HAS_STEP\",\"properties\":{\"order\":1}},{\"from\":\"step-2-1\",\"to\":\"dp-1\",\"type\":\"HAS_DECISION_POINT\"},{\"from\":\"dp-1\",\"to\":\"crit-1\",\"type\":\"HAS_CRITERION\"},{\"from\":\"dp-1\",\"to\":\"crit-2\",\"type\":\"HAS_CRITERION\"},{\"from\":\"dp-1\",\"to\":\"stage-3\",\"type\":\"BRANCHES_TO\",\"properties\":{\"label\":\"TOLAC candidate\",\"confidence_threshold\":0.7}},{\"from\":\"stage-3\",\"to\":\"step-3-1\",\"type\":\"HAS_STEP\",\"properties\":{\"order\":1}},{\"from\":\"step-3-1\",\"to\":\"med-1\",\"type\":\"USES_MEDICATION\"},{\"from\":\"step-3-1\",\"to\":\"med-2\",\"type\":\"USES_MEDICATION\"},{\"from\":\"step-3-1\",\"to\":\"med-3\",\"type\":\"USES_MEDICATION\"},{\"from\":\"med-1\",\"to\":\"med-2\",\"type\":\"ESCALATES_TO\"},{\"from\":\"step-1-1\",\"to\":\"lab-1\",\"type\":\"HAS_LAB_TEST\"},{\"from\":\"step-2-1\",\"to\":\"proc-1\",\"type\":\"HAS_PROCEDURE\"},{\"from\":\"dp-1\",\"to\":\"ev-1\",\"type\":\"CITES_EVIDENCE\"},{\"from\":\"crit-2\",\"to\":\"ev-2\",\"type\":\"CITES_EVIDENCE\"},{\"from\":\"step-3-1\",\"to\":\"qm-1\",\"type\":\"HAS_QUALITY_METRIC\"},{\"from\":\"step-3-1\",\"to\":\"sched-1\",\"type\":\"HAS_SCHEDULE\"},{\"from\":\"crit-1\",\"to\":\"code-1\",\"type\":\"HAS_CODE\"},{\"from\":\"proc-1\",\"to\":\"code-2\",\"type\":\"HAS_CODE\"}]}"
    }
  }' | python3 -m json.tool
```

**Expected:**
- `validation.valid` = `true`, `errors` = `[]`
- `pathway` is not null, with:
  - `logicalId` = `"CP-PriorUterineSurgery"`
  - `version` = `"1.0"`
  - `status` = `"DRAFT"`
  - `category` = `"OBSTETRIC"`
  - `isActive` = `false`
  - `conditionCodes` = `["O34.211", "O34.29"]`
- `diff.summary.nodesAdded` = `21` (20 nodes + 1 root)
- `diff.summary.edgesAdded` = `23`
- `diff.synthetic` = `true` (creation summary, not a real diff)
- `importType` = `"NEW_PATHWAY"`

**Save the pathway ID** for subsequent tests:
```bash
# Store the ID (substitute from actual response)
PATHWAY_ID="<uuid from response>"
```

### 1b. Verify graph was written to AGE

```bash
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  LOAD 'age';
  SET search_path = ag_catalog, public;
  SELECT * FROM cypher('clinical_pathways', \$\$
    MATCH (p:Pathway {logical_id: 'CP-PriorUterineSurgery'})
    RETURN p.logical_id, p.title, p.version
  \$\$) AS (logical_id agtype, title agtype, version agtype);
"
```
**Expected:** One row: `CP-PriorUterineSurgery | Prior Uterine Surgery Management | 1.0`

```bash
# Count all nodes in the pathway subgraph
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  LOAD 'age';
  SET search_path = ag_catalog, public;
  SELECT * FROM cypher('clinical_pathways', \$\$
    MATCH (p:Pathway {logical_id: 'CP-PriorUterineSurgery'})-[*0..]->(n)
    RETURN count(DISTINCT n)
  \$\$) AS (node_count agtype);
"
```
**Expected:** `21` (1 root Pathway + 20 content nodes)

### 1c. Verify relational tables

```bash
# pathway_graph_index
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  SELECT id, logical_id, title, version, status, condition_codes, is_active
  FROM pathway_graph_index WHERE logical_id = 'CP-PriorUterineSurgery';
"
# Expected: One row, status=DRAFT, is_active=false

# pathway_condition_codes
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  SELECT code, system, description, usage, grouping
  FROM pathway_condition_codes
  WHERE pathway_id = (SELECT id FROM pathway_graph_index WHERE logical_id = 'CP-PriorUterineSurgery' LIMIT 1)
  ORDER BY code;
"
# Expected: 2 rows (O34.211, O34.29) with full metadata

# pathway_version_diffs
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  SELECT pathway_id, previous_pathway_id, import_type, diff_summary
  FROM pathway_version_diffs
  WHERE pathway_id = (SELECT id FROM pathway_graph_index WHERE logical_id = 'CP-PriorUterineSurgery' LIMIT 1);
"
# Expected: One row, import_type=NEW_PATHWAY, previous_pathway_id=NULL
# diff_summary JSON should show nodesAdded=21, edgesAdded=23
```

### 1d. Minimal pathway

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id logicalId title status } validation { valid errors warnings } diff { summary { nodesAdded edgesAdded } synthetic } importType } }",
    "variables": {
      "mode": "NEW_PATHWAY",
      "json": "{\"schema_version\":\"1.0\",\"pathway\":{\"logical_id\":\"CP-Minimal\",\"title\":\"Minimal Test Pathway\",\"version\":\"1.0\",\"category\":\"ACUTE_CARE\",\"condition_codes\":[{\"code\":\"J06.9\",\"system\":\"ICD-10\",\"description\":\"Acute upper respiratory infection\"}]},\"nodes\":[{\"id\":\"stage-1\",\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Assessment\"}},{\"id\":\"step-1-1\",\"type\":\"Step\",\"properties\":{\"stage_number\":1,\"step_number\":1,\"display_number\":\"1.1\",\"title\":\"Initial Evaluation\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\",\"properties\":{\"order\":1}},{\"from\":\"stage-1\",\"to\":\"step-1-1\",\"type\":\"HAS_STEP\",\"properties\":{\"order\":1}}]}"
    }
  }' | python3 -m json.tool
```

**Expected:**
- `validation.valid` = `true`
- `pathway.status` = `"DRAFT"`
- `diff.summary.nodesAdded` = `3` (root + stage + step)
- `diff.summary.edgesAdded` = `2`

---

## 2. Import Validation Errors

**What to verify:** The validator catches all errors at once and returns them without creating any data.

### 2a. Invalid JSON string

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id } validation { valid errors warnings } } }",
    "variables": { "mode": "NEW_PATHWAY", "json": "not valid json {{{" }
  }' | python3 -m json.tool
```
**Expected:** `validation.valid` = `false`, `errors` contains `"Invalid JSON"`, `pathway` = `null`

### 2b. Missing required fields (all errors at once)

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id } validation { valid errors warnings } } }",
    "variables": {
      "mode": "NEW_PATHWAY",
      "json": "{\"pathway\":{\"category\":\"OBSTETRIC\",\"condition_codes\":[{\"code\":\"O34.211\",\"system\":\"ICD-10\"}]},\"nodes\":[{\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Test\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\"}]}"
    }
  }' | python3 -m json.tool
```
**Expected:** Multiple errors reported simultaneously:
- `"Missing required field: schema_version"`
- `"Missing required field: pathway.logical_id"`
- `"Missing required field: pathway.title"`
- `"Missing required field: pathway.version"`
- `"node[0]: missing required field \"id\""`

### 2c. Invalid schema_version

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id } validation { valid errors warnings } } }",
    "variables": {
      "mode": "NEW_PATHWAY",
      "json": "{\"schema_version\":\"2.0\",\"pathway\":{\"logical_id\":\"CP-Bad\",\"title\":\"Bad\",\"version\":\"1.0\",\"category\":\"ACUTE_CARE\",\"condition_codes\":[{\"code\":\"J06.9\",\"system\":\"ICD-10\"}]},\"nodes\":[{\"id\":\"stage-1\",\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Test\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\"}]}"
    }
  }' | python3 -m json.tool
```
**Expected:** `errors` contains `"Unsupported schema_version \"2.0\". Currently supported: \"1.0\""`

### 2d. Invalid edge endpoint types

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id } validation { valid errors warnings } } }",
    "variables": {
      "mode": "NEW_PATHWAY",
      "json": "{\"schema_version\":\"1.0\",\"pathway\":{\"logical_id\":\"CP-BadEdge\",\"title\":\"Bad Edge\",\"version\":\"1.0\",\"category\":\"ACUTE_CARE\",\"condition_codes\":[{\"code\":\"J06.9\",\"system\":\"ICD-10\"}]},\"nodes\":[{\"id\":\"stage-1\",\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Test\"}},{\"id\":\"step-1\",\"type\":\"Step\",\"properties\":{\"stage_number\":1,\"step_number\":1,\"display_number\":\"1.1\",\"title\":\"Test\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\"},{\"from\":\"stage-1\",\"to\":\"step-1\",\"type\":\"HAS_STEP\"},{\"from\":\"step-1\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\"}]}"
    }
  }' | python3 -m json.tool
```
**Expected:** Error about `HAS_STAGE` requiring `from` to be `root`, not `Step`

### 2e. Invalid ICD-10 code format

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id } validation { valid errors warnings } } }",
    "variables": {
      "mode": "NEW_PATHWAY",
      "json": "{\"schema_version\":\"1.0\",\"pathway\":{\"logical_id\":\"CP-BadCode\",\"title\":\"Bad Code\",\"version\":\"1.0\",\"category\":\"ACUTE_CARE\",\"condition_codes\":[{\"code\":\"INVALID\",\"system\":\"ICD-10\"}]},\"nodes\":[{\"id\":\"stage-1\",\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Test\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\"}]}"
    }
  }' | python3 -m json.tool
```
**Expected:** Error about invalid ICD-10 code format

### 2f. Duplicate pathway (NEW_PATHWAY on existing logical_id + version)

```bash
# Re-import the reference pathway — should fail because it already exists from test 1a
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id } validation { valid errors warnings } } }",
    "variables": {
      "mode": "NEW_PATHWAY",
      "json": "{\"schema_version\":\"1.0\",\"pathway\":{\"logical_id\":\"CP-PriorUterineSurgery\",\"title\":\"Prior Uterine Surgery Management\",\"version\":\"1.0\",\"category\":\"OBSTETRIC\",\"condition_codes\":[{\"code\":\"O34.211\",\"system\":\"ICD-10\"}]},\"nodes\":[{\"id\":\"stage-1\",\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Test\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\"}]}"
    }
  }' | python3 -m json.tool
```
**Expected:** `validation.valid` = `false`, error mentions `"already exists"`

---

## 3. Draft Update (DRAFT_UPDATE)

**What to verify:** An existing DRAFT pathway can be updated. The old graph is deleted and replaced. A real diff is computed.

### 3a. Update the reference pathway title and add a node

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id logicalId title version status } validation { valid errors warnings } diff { summary { nodesAdded nodesRemoved nodesModified edgesAdded edgesRemoved edgesModified } details { entityType action entityId entityLabel } synthetic } importType } }",
    "variables": {
      "mode": "DRAFT_UPDATE",
      "json": "{\"schema_version\":\"1.0\",\"pathway\":{\"logical_id\":\"CP-PriorUterineSurgery\",\"title\":\"Prior Uterine Surgery Management (Updated)\",\"version\":\"1.0\",\"category\":\"OBSTETRIC\",\"scope\":\"Updated scope\",\"target_population\":\"Pregnant patients with history of cesarean delivery or other uterine surgery\",\"condition_codes\":[{\"code\":\"O34.211\",\"system\":\"ICD-10\",\"description\":\"Maternal care for unspecified type scar from previous cesarean delivery\",\"usage\":\"primary\",\"grouping\":\"prior_surgery\"},{\"code\":\"O34.29\",\"system\":\"ICD-10\",\"description\":\"Maternal care due to uterine scar from other previous surgery\",\"usage\":\"secondary\",\"grouping\":\"prior_surgery\"}]},\"nodes\":[{\"id\":\"stage-1\",\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Initial Assessment (Revised)\",\"description\":\"Gather surgical history and assess risk factors\"}},{\"id\":\"step-1-1\",\"type\":\"Step\",\"properties\":{\"stage_number\":1,\"step_number\":1,\"display_number\":\"1.1\",\"title\":\"Obtain Surgical History\",\"description\":\"Document type, number, and indication of prior uterine surgeries\"}},{\"id\":\"step-1-2\",\"type\":\"Step\",\"properties\":{\"stage_number\":1,\"step_number\":2,\"display_number\":\"1.2\",\"title\":\"Review Operative Reports\",\"description\":\"Review prior operative reports for incision type and complications\"}},{\"id\":\"step-1-3\",\"type\":\"Step\",\"properties\":{\"stage_number\":1,\"step_number\":3,\"display_number\":\"1.3\",\"title\":\"New Step: Imaging Review\",\"description\":\"Review ultrasound for scar thickness\"}},{\"id\":\"stage-2\",\"type\":\"Stage\",\"properties\":{\"stage_number\":2,\"title\":\"Risk Stratification\",\"description\":\"Determine delivery planning based on risk profile\"}},{\"id\":\"step-2-1\",\"type\":\"Step\",\"properties\":{\"stage_number\":2,\"step_number\":1,\"display_number\":\"2.1\",\"title\":\"Assess TOLAC Candidacy\",\"description\":\"Evaluate trial of labor after cesarean eligibility\"}},{\"id\":\"dp-1\",\"type\":\"DecisionPoint\",\"properties\":{\"title\":\"Delivery Method Decision\",\"auto_resolve_eligible\":true}},{\"id\":\"crit-1\",\"type\":\"Criterion\",\"properties\":{\"description\":\"Single prior low-transverse cesarean\",\"code_system\":\"ICD-10\",\"code_value\":\"O34.211\",\"base_rate\":0.006,\"is_critical\":true}},{\"id\":\"crit-2\",\"type\":\"Criterion\",\"properties\":{\"description\":\"Prior classical or T-incision\",\"code_system\":\"ICD-10\",\"code_value\":\"O34.29\",\"base_rate\":0.04,\"is_critical\":true}},{\"id\":\"stage-3\",\"type\":\"Stage\",\"properties\":{\"stage_number\":3,\"title\":\"TOLAC Management\",\"description\":\"Management for trial of labor after cesarean\"}},{\"id\":\"step-3-1\",\"type\":\"Step\",\"properties\":{\"stage_number\":3,\"step_number\":1,\"display_number\":\"3.1\",\"title\":\"Continuous Fetal Monitoring\",\"description\":\"Apply continuous electronic fetal monitoring during labor\"}},{\"id\":\"med-1\",\"type\":\"Medication\",\"properties\":{\"name\":\"Oxytocin\",\"dose\":\"2 milliunits/min initial\",\"route\":\"IV\",\"frequency\":\"Titrate per protocol\",\"role\":\"acceptable\"}},{\"id\":\"med-2\",\"type\":\"Medication\",\"properties\":{\"name\":\"Dinoprostone\",\"dose\":\"10mg insert\",\"route\":\"Vaginal\",\"frequency\":\"Once\",\"role\":\"acceptable\"}},{\"id\":\"med-3\",\"type\":\"Medication\",\"properties\":{\"name\":\"Misoprostol\",\"dose\":\"N/A\",\"route\":\"N/A\",\"frequency\":\"N/A\",\"role\":\"contraindicated\"}},{\"id\":\"lab-1\",\"type\":\"LabTest\",\"properties\":{\"name\":\"Complete Blood Count\",\"code_system\":\"LOINC\",\"code_value\":\"58410-2\"}},{\"id\":\"proc-1\",\"type\":\"Procedure\",\"properties\":{\"name\":\"Cesarean Delivery\",\"code_system\":\"CPT\",\"code_value\":\"59510\"}},{\"id\":\"ev-1\",\"type\":\"EvidenceCitation\",\"properties\":{\"reference_number\":1,\"title\":\"ACOG Practice Bulletin No. 205: Vaginal Birth After Cesarean Delivery\",\"source\":\"Obstetrics & Gynecology\",\"evidence_level\":\"Level A\",\"year\":2019}},{\"id\":\"ev-2\",\"type\":\"EvidenceCitation\",\"properties\":{\"reference_number\":2,\"title\":\"Uterine Rupture Risk Factors\",\"source\":\"American Journal of Obstetrics & Gynecology\",\"evidence_level\":\"Level B\",\"year\":2020}},{\"id\":\"qm-1\",\"type\":\"QualityMetric\",\"properties\":{\"name\":\"VBAC Success Rate\",\"measure\":\"Percentage of TOLAC attempts resulting in vaginal delivery\",\"target\":\">= 60%\"}},{\"id\":\"sched-1\",\"type\":\"Schedule\",\"properties\":{\"interval\":\"Every 15 minutes\",\"duration\":\"Throughout active labor\",\"description\":\"Fetal heart rate monitoring intervals during TOLAC\"}},{\"id\":\"code-1\",\"type\":\"CodeEntry\",\"properties\":{\"system\":\"ICD-10\",\"code\":\"O34.211\",\"description\":\"Low transverse cesarean scar\"}},{\"id\":\"code-2\",\"type\":\"CodeEntry\",\"properties\":{\"system\":\"CPT\",\"code\":\"59510\",\"description\":\"Cesarean delivery\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\",\"properties\":{\"order\":1}},{\"from\":\"root\",\"to\":\"stage-2\",\"type\":\"HAS_STAGE\",\"properties\":{\"order\":2}},{\"from\":\"root\",\"to\":\"stage-3\",\"type\":\"HAS_STAGE\",\"properties\":{\"order\":3}},{\"from\":\"stage-1\",\"to\":\"step-1-1\",\"type\":\"HAS_STEP\",\"properties\":{\"order\":1}},{\"from\":\"stage-1\",\"to\":\"step-1-2\",\"type\":\"HAS_STEP\",\"properties\":{\"order\":2}},{\"from\":\"stage-1\",\"to\":\"step-1-3\",\"type\":\"HAS_STEP\",\"properties\":{\"order\":3}},{\"from\":\"stage-2\",\"to\":\"step-2-1\",\"type\":\"HAS_STEP\",\"properties\":{\"order\":1}},{\"from\":\"step-2-1\",\"to\":\"dp-1\",\"type\":\"HAS_DECISION_POINT\"},{\"from\":\"dp-1\",\"to\":\"crit-1\",\"type\":\"HAS_CRITERION\"},{\"from\":\"dp-1\",\"to\":\"crit-2\",\"type\":\"HAS_CRITERION\"},{\"from\":\"dp-1\",\"to\":\"stage-3\",\"type\":\"BRANCHES_TO\",\"properties\":{\"label\":\"TOLAC candidate\",\"confidence_threshold\":0.7}},{\"from\":\"stage-3\",\"to\":\"step-3-1\",\"type\":\"HAS_STEP\",\"properties\":{\"order\":1}},{\"from\":\"step-3-1\",\"to\":\"med-1\",\"type\":\"USES_MEDICATION\"},{\"from\":\"step-3-1\",\"to\":\"med-2\",\"type\":\"USES_MEDICATION\"},{\"from\":\"step-3-1\",\"to\":\"med-3\",\"type\":\"USES_MEDICATION\"},{\"from\":\"med-1\",\"to\":\"med-2\",\"type\":\"ESCALATES_TO\"},{\"from\":\"step-1-1\",\"to\":\"lab-1\",\"type\":\"HAS_LAB_TEST\"},{\"from\":\"step-2-1\",\"to\":\"proc-1\",\"type\":\"HAS_PROCEDURE\"},{\"from\":\"dp-1\",\"to\":\"ev-1\",\"type\":\"CITES_EVIDENCE\"},{\"from\":\"crit-2\",\"to\":\"ev-2\",\"type\":\"CITES_EVIDENCE\"},{\"from\":\"step-3-1\",\"to\":\"qm-1\",\"type\":\"HAS_QUALITY_METRIC\"},{\"from\":\"step-3-1\",\"to\":\"sched-1\",\"type\":\"HAS_SCHEDULE\"},{\"from\":\"crit-1\",\"to\":\"code-1\",\"type\":\"HAS_CODE\"},{\"from\":\"proc-1\",\"to\":\"code-2\",\"type\":\"HAS_CODE\"}]}"
    }
  }' | python3 -m json.tool
```

**Expected:**
- `validation.valid` = `true`
- `pathway.title` = `"Prior Uterine Surgery Management (Updated)"`
- `pathway.status` = `"DRAFT"` (same version, updated in-place)
- `diff.synthetic` = `false` (real diff computed from old graph)
- `diff.summary.nodesAdded` = `1` (step-1-3 added)
- `diff.summary.nodesModified` >= `1` (stage-1 title changed)
- `diff.summary.edgesAdded` = `1` (stage-1 → step-1-3)
- `diff.details` contains entries for the specific changes
- `importType` = `"DRAFT_UPDATE"`

### 3b. Verify no duplicate graph nodes

```bash
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  LOAD 'age';
  SET search_path = ag_catalog, public;
  SELECT * FROM cypher('clinical_pathways', \$\$
    MATCH (p:Pathway {logical_id: 'CP-PriorUterineSurgery'})
    RETURN count(p)
  \$\$) AS (pathway_count agtype);
"
```
**Expected:** `1` (not 2 — old graph was deleted before new one was created)

### 3c. DRAFT_UPDATE on non-existent pathway

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id } validation { valid errors } } }",
    "variables": {
      "mode": "DRAFT_UPDATE",
      "json": "{\"schema_version\":\"1.0\",\"pathway\":{\"logical_id\":\"CP-NonExistent\",\"title\":\"Does Not Exist\",\"version\":\"1.0\",\"category\":\"ACUTE_CARE\",\"condition_codes\":[{\"code\":\"J06.9\",\"system\":\"ICD-10\"}]},\"nodes\":[{\"id\":\"stage-1\",\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Test\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\"}]}"
    }
  }' | python3 -m json.tool
```
**Expected:** `validation.valid` = `false`, error mentions `"DRAFT_UPDATE requires an existing DRAFT pathway"`

---

## 4. Lifecycle Mutations (Activate, Archive, Reactivate)

**What to verify:** Status transitions follow the correct state machine: DRAFT → ACTIVE → ARCHIVED/SUPERSEDED → (reactivatable).

### 4a. Activate the reference pathway

```bash
# Use the pathway ID from test 1a (or query for it)
PATHWAY_ID=$(curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathways(status: DRAFT) { id logicalId } }"}' | python3 -c "import sys,json; data=json.load(sys.stdin); pw=[p for p in data['data']['pathways'] if p['logicalId']=='CP-PriorUterineSurgery']; print(pw[0]['id'] if pw else '')")

echo "Activating pathway: $PATHWAY_ID"

curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d "{
    \"query\": \"mutation { activatePathway(id: \\\"$PATHWAY_ID\\\") { pathway { id status isActive } previousStatus } }\"
  }" | python3 -m json.tool
```

**Expected:**
- `pathway.status` = `"ACTIVE"`
- `pathway.isActive` = `true`
- `previousStatus` = `"DRAFT"`

### 4b. Cannot activate an already-active pathway

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d "{
    \"query\": \"mutation { activatePathway(id: \\\"$PATHWAY_ID\\\") { pathway { id status } previousStatus } }\"
  }" | python3 -m json.tool
```
**Expected:** GraphQL error: `"Cannot activate pathway with status \"ACTIVE\""`

### 4c. Cannot DRAFT_UPDATE an active pathway

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id } validation { valid errors } } }",
    "variables": {
      "mode": "DRAFT_UPDATE",
      "json": "{\"schema_version\":\"1.0\",\"pathway\":{\"logical_id\":\"CP-PriorUterineSurgery\",\"title\":\"Should Fail\",\"version\":\"1.0\",\"category\":\"OBSTETRIC\",\"condition_codes\":[{\"code\":\"O34.211\",\"system\":\"ICD-10\"}]},\"nodes\":[{\"id\":\"stage-1\",\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Test\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\"}]}"
    }
  }' | python3 -m json.tool
```
**Expected:** `validation.valid` = `false`, error about `"DRAFT_UPDATE requires an existing DRAFT pathway"`

### 4d. Archive the active pathway

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d "{
    \"query\": \"mutation { archivePathway(id: \\\"$PATHWAY_ID\\\") { pathway { id status isActive } previousStatus } }\"
  }" | python3 -m json.tool
```

**Expected:**
- `pathway.status` = `"ARCHIVED"`
- `pathway.isActive` = `false`
- `previousStatus` = `"ACTIVE"`

### 4e. Reactivate the archived pathway

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d "{
    \"query\": \"mutation { reactivatePathway(id: \\\"$PATHWAY_ID\\\") { pathway { id status isActive } previousStatus } }\"
  }" | python3 -m json.tool
```

**Expected:**
- `pathway.status` = `"ACTIVE"`
- `pathway.isActive` = `true`
- `previousStatus` = `"ARCHIVED"`

### 4f. Non-existent pathway

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{"query": "mutation { activatePathway(id: \"00000000-0000-0000-0000-000000000000\") { pathway { id } previousStatus } }"}' | python3 -m json.tool
```
**Expected:** GraphQL error: `"Pathway not found"` with extension code `NOT_FOUND`

---

## 5. New Version (NEW_VERSION)

**What to verify:** A new version of an existing pathway creates a separate entry with its own graph. The diff is computed against the previous version.

### 5a. Import version 2.0

First, archive the current active pathway so we have a clean state:
```bash
# Archive it if still active
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d "{
    \"query\": \"mutation { archivePathway(id: \\\"$PATHWAY_ID\\\") { pathway { id status } } }\"
  }" 2>/dev/null || true
```

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id logicalId title version status } validation { valid errors warnings } diff { summary { nodesAdded nodesRemoved nodesModified edgesAdded edgesRemoved edgesModified } synthetic } importType } }",
    "variables": {
      "mode": "NEW_VERSION",
      "json": "{\"schema_version\":\"1.0\",\"pathway\":{\"logical_id\":\"CP-PriorUterineSurgery\",\"title\":\"Prior Uterine Surgery Management v2\",\"version\":\"2.0\",\"category\":\"OBSTETRIC\",\"scope\":\"Updated v2 scope\",\"target_population\":\"Pregnant patients with history of cesarean delivery\",\"condition_codes\":[{\"code\":\"O34.211\",\"system\":\"ICD-10\",\"description\":\"Maternal care for cesarean scar\"},{\"code\":\"O34.29\",\"system\":\"ICD-10\",\"description\":\"Other uterine scar\"}]},\"nodes\":[{\"id\":\"stage-1\",\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Initial Assessment v2\",\"description\":\"Updated assessment\"}},{\"id\":\"step-1-1\",\"type\":\"Step\",\"properties\":{\"stage_number\":1,\"step_number\":1,\"display_number\":\"1.1\",\"title\":\"Obtain Surgical History\",\"description\":\"Same as v1\"}},{\"id\":\"stage-2\",\"type\":\"Stage\",\"properties\":{\"stage_number\":2,\"title\":\"Risk Stratification\",\"description\":\"Simplified v2\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\",\"properties\":{\"order\":1}},{\"from\":\"root\",\"to\":\"stage-2\",\"type\":\"HAS_STAGE\",\"properties\":{\"order\":2}},{\"from\":\"stage-1\",\"to\":\"step-1-1\",\"type\":\"HAS_STEP\",\"properties\":{\"order\":1}}]}"
    }
  }' | python3 -m json.tool
```

**Expected:**
- `validation.valid` = `true`
- `pathway.version` = `"2.0"`
- `pathway.status` = `"DRAFT"`
- `diff.synthetic` = `false` (real diff against v1.0)
- `diff.summary.nodesRemoved` > `0` (many v1 nodes are gone in v2)
- `diff.summary.nodesAdded` > `0` (some new nodes)
- `importType` = `"NEW_VERSION"`

### 5b. Verify both versions exist independently

```bash
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  SELECT logical_id, version, status, is_active
  FROM pathway_graph_index
  WHERE logical_id = 'CP-PriorUterineSurgery'
  ORDER BY version;
"
```
**Expected:** Two rows: v1.0 (ARCHIVED or ACTIVE) and v2.0 (DRAFT)

### 5c. Verify version diff audit trail

```bash
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  SELECT pvd.import_type, pvd.diff_summary, pvd.previous_pathway_id IS NOT NULL AS has_previous
  FROM pathway_version_diffs pvd
  JOIN pathway_graph_index pgi ON pgi.id = pvd.pathway_id
  WHERE pgi.logical_id = 'CP-PriorUterineSurgery'
  ORDER BY pvd.created_at;
"
```
**Expected:**
- Row 1: `NEW_PATHWAY`, `has_previous` = `false`
- Row 2: `DRAFT_UPDATE`, `has_previous` = `false` (same pathway, not a version diff)
- Row 3: `NEW_VERSION`, `has_previous` = `true` (linked to v1.0)

### 5d. NEW_VERSION on non-existent logical_id

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id } validation { valid errors } } }",
    "variables": {
      "mode": "NEW_VERSION",
      "json": "{\"schema_version\":\"1.0\",\"pathway\":{\"logical_id\":\"CP-DoesNotExist\",\"title\":\"No Previous\",\"version\":\"2.0\",\"category\":\"ACUTE_CARE\",\"condition_codes\":[{\"code\":\"J06.9\",\"system\":\"ICD-10\"}]},\"nodes\":[{\"id\":\"stage-1\",\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Test\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\"}]}"
    }
  }' | python3 -m json.tool
```
**Expected:** Error: `"NEW_VERSION requires an existing pathway with logical_id"`

---

## 6. Supersession (Activate New Version)

**What to verify:** Activating a new version automatically supersedes the old active version.

### 6a. Reactivate v1.0, then activate v2.0

```bash
# Get v1 and v2 IDs
docker compose exec postgres psql -U postgres -d healthcare_federation -t -c "
  SELECT id, version, status FROM pathway_graph_index
  WHERE logical_id = 'CP-PriorUterineSurgery' ORDER BY version;
"

V1_ID=$(docker compose exec postgres psql -U postgres -d healthcare_federation -t -A -c "
  SELECT id FROM pathway_graph_index WHERE logical_id = 'CP-PriorUterineSurgery' AND version = '1.0';
")
V2_ID=$(docker compose exec postgres psql -U postgres -d healthcare_federation -t -A -c "
  SELECT id FROM pathway_graph_index WHERE logical_id = 'CP-PriorUterineSurgery' AND version = '2.0';
")

# Reactivate v1 (if archived)
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d "{\"query\": \"mutation { reactivatePathway(id: \\\"$V1_ID\\\") { pathway { id version status } } }\"}" | python3 -m json.tool

# Now activate v2 — this should supersede v1
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d "{\"query\": \"mutation { activatePathway(id: \\\"$V2_ID\\\") { pathway { id version status isActive } previousStatus } }\"}" | python3 -m json.tool
```

**Expected:**
- v2 becomes `ACTIVE`, `isActive` = `true`
- v1 is now `SUPERSEDED`:

```bash
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  SELECT version, status, is_active FROM pathway_graph_index
  WHERE logical_id = 'CP-PriorUterineSurgery' ORDER BY version;
"
```
**Expected:**
- `1.0` — `SUPERSEDED` — `false`
- `2.0` — `ACTIVE` — `true`

---

## 7. Query Resolvers

**What to verify:** The query resolvers correctly filter and return pathway data.

### 7a. List all pathways

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathways { id logicalId title version status category isActive } }"}' | python3 -m json.tool
```
**Expected:** Returns all imported pathways (CP-PriorUterineSurgery v1+v2, CP-Minimal)

### 7b. Filter by status

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathways(status: ACTIVE) { id logicalId version status } }"}' | python3 -m json.tool
```
**Expected:** Only active pathways

### 7c. Filter by category

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathways(category: OBSTETRIC) { id logicalId title } }"}' | python3 -m json.tool
```
**Expected:** Only OBSTETRIC pathways (CP-PriorUterineSurgery v1+v2)

### 7d. Limit with `first`

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathways(first: 1) { id logicalId } }"}' | python3 -m json.tool
```
**Expected:** Exactly 1 result

### 7e. Get by ID

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d "{\"query\":\"{ pathway(id: \\\"$V2_ID\\\") { id logicalId title version status conditionCodes scope targetPopulation isActive createdAt updatedAt } }\"}" | python3 -m json.tool
```
**Expected:** Full pathway object with all fields populated

### 7f. Get non-existent ID

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ pathway(id: \"00000000-0000-0000-0000-000000000000\") { id title } }"}' | python3 -m json.tool
```
**Expected:** `{"data":{"pathway":null}}`

---

## 8. Security Checks

**What to verify:** The pipeline resists injection attempts.

### 8a. Dollar-quoting injection in pathway title

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { pathway { id title } validation { valid errors } } }",
    "variables": {
      "mode": "NEW_PATHWAY",
      "json": "{\"schema_version\":\"1.0\",\"pathway\":{\"logical_id\":\"CP-Injection\",\"title\":\"test $$ ) AS (v agtype); DROP TABLE patients; --\",\"version\":\"1.0\",\"category\":\"ACUTE_CARE\",\"condition_codes\":[{\"code\":\"J06.9\",\"system\":\"ICD-10\"}]},\"nodes\":[{\"id\":\"stage-1\",\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Test\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\"}]}"
    }
  }' | python3 -m json.tool
```

**Expected:** Either succeeds safely (title stored with `$$` literally) or fails gracefully — **NOT** a SQL injection. Verify the `patients` table still exists:
```bash
docker compose exec postgres psql -U postgres -d healthcare_federation -c "SELECT count(*) FROM patients;"
```

### 8b. Cypher injection via property key

```bash
curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "mutation ImportPathway($json: String!, $mode: ImportMode!) { importPathway(pathwayJson: $json, importMode: $mode) { validation { valid errors } } }",
    "variables": {
      "mode": "NEW_PATHWAY",
      "json": "{\"schema_version\":\"1.0\",\"pathway\":{\"logical_id\":\"CP-PropInjection\",\"title\":\"Prop Injection\",\"version\":\"1.0\",\"category\":\"ACUTE_CARE\",\"condition_codes\":[{\"code\":\"J06.9\",\"system\":\"ICD-10\"}]},\"nodes\":[{\"id\":\"stage-1\",\"type\":\"Stage\",\"properties\":{\"stage_number\":1,\"title\":\"Test\",\"bad key with spaces\":\"value\"}}],\"edges\":[{\"from\":\"root\",\"to\":\"stage-1\",\"type\":\"HAS_STAGE\"}]}"
    }
  }' | python3 -m json.tool
```
**Expected:** Error — the `SAFE_KEY_PATTERN` rejects property keys with spaces/special characters

---

## 9. Edge Cases

### 9a. Very large node count (boundary test)

```bash
# Generate a pathway with 501 nodes (exceeds MAX_GRAPH_NODES=500)
python3 -c "
import json
nodes = [{'id': f'stage-{i}', 'type': 'Stage', 'properties': {'stage_number': i, 'title': f'Stage {i}'}} for i in range(1, 502)]
edges = [{'from': 'root', 'to': 'stage-1', 'type': 'HAS_STAGE'}]
pw = {'schema_version': '1.0', 'pathway': {'logical_id': 'CP-TooMany', 'title': 'Too Many Nodes', 'version': '1.0', 'category': 'ACUTE_CARE', 'condition_codes': [{'code': 'J06.9', 'system': 'ICD-10'}]}, 'nodes': nodes, 'edges': edges}
print(json.dumps(pw))
" > /tmp/large-pathway.json

curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d "{
    \"query\": \"mutation ImportPathway(\$json: String!, \$mode: ImportMode!) { importPathway(pathwayJson: \$json, importMode: \$mode) { validation { valid errors } } }\",
    \"variables\": {\"mode\": \"NEW_PATHWAY\", \"json\": $(cat /tmp/large-pathway.json | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}
  }" | python3 -m json.tool
```
**Expected:** `validation.valid` = `false`, error mentions `"exceeds maximum node count"`

### 9b. Edge count limit

```bash
python3 -c "
import json
nodes = [{'id': 'stage-1', 'type': 'Stage', 'properties': {'stage_number': 1, 'title': 'Stage 1'}}, {'id': 'step-1', 'type': 'Step', 'properties': {'stage_number': 1, 'step_number': 1, 'display_number': '1.1', 'title': 'Step 1'}}]
edges = [{'from': 'root', 'to': 'stage-1', 'type': 'HAS_STAGE'}] + [{'from': 'stage-1', 'to': 'step-1', 'type': 'HAS_STEP'} for _ in range(2001)]
pw = {'schema_version': '1.0', 'pathway': {'logical_id': 'CP-TooManyEdges', 'title': 'Too Many Edges', 'version': '1.0', 'category': 'ACUTE_CARE', 'condition_codes': [{'code': 'J06.9', 'system': 'ICD-10'}]}, 'nodes': nodes, 'edges': edges}
print(json.dumps(pw))
" > /tmp/large-edges-pathway.json

curl -s -X POST http://localhost:4016/ \
  -H 'Content-Type: application/json' \
  -d "{
    \"query\": \"mutation ImportPathway(\$json: String!, \$mode: ImportMode!) { importPathway(pathwayJson: \$json, importMode: \$mode) { validation { valid errors } } }\",
    \"variables\": {\"mode\": \"NEW_PATHWAY\", \"json\": $(cat /tmp/large-edges-pathway.json | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}
  }" | python3 -m json.tool
```
**Expected:** `validation.valid` = `false`, error mentions `"exceeds maximum edge count"`

---

## 10. Cleanup

Remove all test data created during manual testing:

```bash
# Delete all test pathways
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  DELETE FROM pathway_version_diffs WHERE pathway_id IN (
    SELECT id FROM pathway_graph_index WHERE logical_id IN ('CP-PriorUterineSurgery', 'CP-Minimal', 'CP-Injection')
  );
  DELETE FROM pathway_condition_codes WHERE pathway_id IN (
    SELECT id FROM pathway_graph_index WHERE logical_id IN ('CP-PriorUterineSurgery', 'CP-Minimal', 'CP-Injection')
  );
  DELETE FROM pathway_graph_index WHERE logical_id IN ('CP-PriorUterineSurgery', 'CP-Minimal', 'CP-Injection');
"

# Delete test graph nodes
docker compose exec postgres psql -U postgres -d healthcare_federation -c "
  LOAD 'age';
  SET search_path = ag_catalog, public;
  SELECT * FROM cypher('clinical_pathways', \$\$
    MATCH (n) DETACH DELETE n
  \$\$) AS (v agtype);
"
```

---

## Summary of Known Gaps

| Gap | Severity | When to Fix |
|-----|----------|-------------|
| `archivePathway` has a TOCTOU window (SELECT then UPDATE, not CTE) | Low | Post-MVP — race requires concurrent archive of same pathway |
| No auth context on mutations — all imports are `userId: 'system'` | Expected | When auth is wired into resolvers (post-MVP) |
| `reconstructPathwayJson` is best-effort — if it fails, DRAFT_UPDATE diffs are synthetic | Low | Improve AGE result parsing if edge cases found |
| `createdAt`/`updatedAt` are ISO strings, not DateTime scalars | Low | Consistent with other services |
| No cursor-based pagination on `pathways` query | Low | Add when needed for frontend |
| No rate limiting on import mutation (expensive operation) | Low | Add at gateway level post-MVP |
| `spread merge` in `resolvers/index.ts` will shadow if both files export same key | Low | Refactor if federation resolvers added |
