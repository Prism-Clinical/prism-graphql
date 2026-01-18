'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation } from '@apollo/client';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  CloudArrowUpIcon,
  PlusIcon,
  TrashIcon,
  InformationCircleIcon,
  XMarkIcon,
  ClipboardDocumentIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { IMPORT_CARE_PLAN_FROM_PDF } from '@/lib/graphql/mutations/carePlans';

// Types matching the parser response
interface ExtractedCode {
  code: string;
  code_system: string;
  display_text: string | null;
  confidence: number;
}

interface SuggestedGoal {
  description: string;
  target_value: string | null;
  target_days: number | null;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface SuggestedIntervention {
  description: string;
  intervention_type: 'MEDICATION' | 'PROCEDURE' | 'EDUCATION' | 'MONITORING' | 'OTHER';
  medication_code: string | null;
  procedure_code: string | null;
  frequency: string | null;
  schedule_days: number | null;
}

interface ParsedCarePlan {
  title: string;
  raw_text: string;
  overview_section: string | null;
  symptoms_section: string | null;
  diagnosis_section: string | null;
  treatment_section: string | null;
  goals_section: string | null;
  interventions_section: string | null;
  follow_up_section: string | null;
  patient_education_section: string | null;
  complications_section: string | null;
  condition_codes: ExtractedCode[];
  medication_codes: ExtractedCode[];
  lab_codes: ExtractedCode[];
  procedure_codes: ExtractedCode[];
  suggested_goals: SuggestedGoal[];
  suggested_interventions: SuggestedIntervention[];
  extraction_confidence: number;
  warnings: string[];
  page_count: number;
  processing_time_ms: number;
}

type Step = 'upload' | 'review' | 'import';

const PDF_PARSER_URL = process.env.NEXT_PUBLIC_PDF_PARSER_URL || 'http://localhost:8085';

const priorityOptions = ['HIGH', 'MEDIUM', 'LOW'] as const;
const interventionTypeOptions = ['MEDICATION', 'PROCEDURE', 'EDUCATION', 'MONITORING', 'REFERRAL', 'LIFESTYLE', 'FOLLOW_UP', 'OTHER'] as const;

// Format Specification Modal
function FormatSpecificationModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose} />

        <div className="relative inline-block w-full max-w-4xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Standardized Care Plan Format</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="overflow-y-auto max-h-[70vh]">
            <div className="prose prose-sm max-w-none">
              <div className="bg-gray-50 p-4 rounded-lg mb-4">
                <p className="text-sm text-gray-600 mb-2">
                  Care plans must follow this standardized format for accurate parsing. The format uses clear delimiters and structured sections.
                </p>
              </div>

              <h4 className="text-md font-semibold mb-2">Document Structure</h4>
              <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-x-auto mb-4">
{`================================================================================
CARE PLAN DOCUMENT
================================================================================

[METADATA]
Title: Condition Name Care Pathway
Category: CHRONIC_DISEASE | ACUTE_CARE | PREVENTIVE_CARE | GENERAL
Version: 1.0
Last Updated: YYYY-MM-DD
Author: Author Name
Guideline Source: Guideline Reference
Evidence Grade: A | B | C | D

[CONDITION CODES]
| Code       | System    | Description                              |
|------------|-----------|------------------------------------------|
| J02.0      | ICD-10    | Condition name                           |
| 43878008   | SNOMED    | Condition description                    |

[MEDICATION CODES]
| Code       | System    | Description                              |
|------------|-----------|------------------------------------------|
| 834061     | RxNorm    | Medication Name 500 MG Oral Tab          |

[LAB CODES]
| Code       | System    | Description                              |
|------------|-----------|------------------------------------------|
| 78012-2    | LOINC     | Lab test name                            |

[PROCEDURE CODES]
| Code       | System    | Description                              |
|------------|-----------|------------------------------------------|
| 87880      | CPT       | Procedure description                    |

[GOALS]
GOAL-001:
  Description: Goal description text
  Target Value: Measurable target
  Target Days: 7
  Priority: HIGH | MEDIUM | LOW
  Guideline: Supporting guideline reference

[INTERVENTIONS]
INT-001:
  Type: MEDICATION | PROCEDURE | EDUCATION | MONITORING | LIFESTYLE | REFERRAL
  Description: Intervention description
  Medication Code: 834061
  Dosage: 500 mg
  Frequency: Twice daily for 10 days
  Instructions: Additional instructions

---

[OVERVIEW]
Overview text describing the condition and care approach.

[SYMPTOMS]
- Symptom 1
- Symptom 2

[DIAGNOSIS]
Diagnostic criteria and workup.

[TREATMENT]
Treatment approach and algorithm.

[FOLLOW_UP]
Follow-up recommendations.

[PATIENT_EDUCATION]
Patient education points.`}
              </pre>

              <h4 className="text-md font-semibold mb-2">Section Reference</h4>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-blue-50 p-3 rounded">
                  <h5 className="font-medium text-blue-800">Required Sections</h5>
                  <ul className="text-sm text-blue-700 mt-2">
                    <li>• [METADATA] - Title, Category</li>
                    <li>• [CONDITION CODES] - At least 1 code</li>
                    <li>• [GOALS] - At least 1 goal</li>
                    <li>• [INTERVENTIONS] - At least 1 intervention</li>
                  </ul>
                </div>
                <div className="bg-green-50 p-3 rounded">
                  <h5 className="font-medium text-green-800">Code Systems</h5>
                  <ul className="text-sm text-green-700 mt-2">
                    <li>• ICD-10 - Diagnosis codes</li>
                    <li>• SNOMED - Clinical terms</li>
                    <li>• RxNorm - Medications</li>
                    <li>• LOINC - Lab tests</li>
                    <li>• CPT - Procedures</li>
                  </ul>
                </div>
              </div>

              <h4 className="text-md font-semibold mb-2">Category Options</h4>
              <div className="flex flex-wrap gap-2 mb-4">
                {['CHRONIC_DISEASE', 'ACUTE_CARE', 'PREVENTIVE_CARE', 'POST_PROCEDURE', 'MEDICATION_MANAGEMENT', 'LIFESTYLE_MODIFICATION', 'MENTAL_HEALTH', 'PEDIATRIC', 'GERIATRIC', 'GENERAL'].map(cat => (
                  <span key={cat} className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded">{cat}</span>
                ))}
              </div>

              <h4 className="text-md font-semibold mb-2">Intervention Types</h4>
              <div className="flex flex-wrap gap-2">
                {['MEDICATION', 'PROCEDURE', 'EDUCATION', 'MONITORING', 'LIFESTYLE', 'REFERRAL', 'FOLLOW_UP', 'OTHER'].map(type => (
                  <span key={type} className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs rounded">{type}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// LLM Prompt Helper Modal
function LLMPromptModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const llmPrompt = `You are a clinical documentation specialist. Convert the following care plan document into a standardized format for import into a clinical care plan system.

OUTPUT FORMAT REQUIREMENTS:
1. Start with the exact header: ================================================================================
   CARE PLAN DOCUMENT
   ================================================================================

2. [METADATA] section with:
   - Title: Clear, descriptive title for the care plan
   - Category: Choose from CHRONIC_DISEASE, ACUTE_CARE, PREVENTIVE_CARE, POST_PROCEDURE, MEDICATION_MANAGEMENT, LIFESTYLE_MODIFICATION, MENTAL_HEALTH, PEDIATRIC, GERIATRIC, or GENERAL
   - Version: 1.0
   - Last Updated: Today's date (YYYY-MM-DD)
   - Author: Extract from document or use "Clinical Guidelines Committee"
   - Guideline Source: Reference to source guidelines (e.g., "IDSA 2023, CDC Guidelines")
   - Evidence Grade: A, B, C, or D based on evidence strength

3. [CONDITION CODES] table with pipe-delimited columns:
   | Code       | System    | Description                              |
   Include relevant ICD-10 and SNOMED codes. Look up accurate codes.

4. [MEDICATION CODES] table with RxNorm codes for all medications mentioned.
   Include specific formulations (e.g., "Amoxicillin 500 MG Oral Capsule").

5. [LAB CODES] table with LOINC codes for any lab tests mentioned.

6. [PROCEDURE CODES] table with CPT codes for procedures.

7. [GOALS] section with numbered goals (GOAL-001, GOAL-002, etc.):
   Each goal must have:
   - Description: Clear, measurable goal
   - Target Value: Specific target (e.g., "Symptom-free", "HbA1c < 7%")
   - Target Days: Number of days to achieve goal
   - Priority: HIGH, MEDIUM, or LOW
   - Guideline: Reference to supporting guideline

8. [INTERVENTIONS] section with numbered interventions (INT-001, INT-002, etc.):
   Each intervention must have:
   - Type: MEDICATION, PROCEDURE, EDUCATION, MONITORING, LIFESTYLE, REFERRAL, FOLLOW_UP, or OTHER
   - Description: Clear description of the intervention
   For MEDICATION type, also include:
   - Medication Code: RxNorm code
   - Dosage: Specific dosage
   - Frequency: How often (e.g., "Twice daily for 10 days")
   - Instructions: Patient instructions
   For PROCEDURE type, include:
   - Procedure Code: CPT code
   For REFERRAL type, include:
   - Referral Specialty: Specialty name

9. After "---" divider, include these clinical sections:
   [OVERVIEW] - Brief overview of the condition and care approach
   [SYMPTOMS] - Bulleted list of symptoms
   [DIAGNOSIS] - Diagnostic criteria and workup
   [TREATMENT] - Treatment algorithm and approach
   [FOLLOW_UP] - Follow-up recommendations
   [PATIENT_EDUCATION] - Patient education points

IMPORTANT:
- Use accurate medical codes (ICD-10, SNOMED, RxNorm, LOINC, CPT)
- Extract ALL medications mentioned and find their RxNorm codes
- Create specific, measurable goals with realistic timelines
- Include comprehensive interventions covering all treatment aspects
- Maintain clinical accuracy while standardizing format

---
CARE PLAN DOCUMENT TO CONVERT:

[Paste your care plan document here]`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(llmPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose} />

        <div className="relative inline-block w-full max-w-4xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <SparklesIcon className="h-6 w-6 text-purple-600" />
              <h3 className="text-lg font-semibold text-gray-900">LLM Conversion Prompt</h3>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="bg-purple-50 p-4 rounded-lg mb-4">
            <p className="text-sm text-purple-800">
              Use this prompt with an LLM (like Claude or GPT-4) to convert any care plan document into the standardized format.
              Copy the prompt, paste it into the LLM, and append your care plan document at the end.
            </p>
          </div>

          <div className="relative">
            <pre className="bg-gray-900 text-gray-300 p-4 rounded-lg text-xs overflow-auto max-h-[50vh] whitespace-pre-wrap">
              {llmPrompt}
            </pre>
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 flex items-center gap-1 px-3 py-1.5 bg-white rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 shadow-sm"
            >
              <ClipboardDocumentIcon className="h-4 w-4" />
              {copied ? 'Copied!' : 'Copy Prompt'}
            </button>
          </div>

          <div className="mt-4 bg-gray-50 p-4 rounded-lg">
            <h4 className="font-medium text-gray-900 mb-2">How to use:</h4>
            <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
              <li>Copy the prompt above</li>
              <li>Open Claude, ChatGPT, or another LLM</li>
              <li>Paste the prompt</li>
              <li>Add your care plan document after "[Paste your care plan document here]"</li>
              <li>Submit and receive the standardized output</li>
              <li>Save the output as a .txt file and upload it here</li>
            </ol>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={handleCopy}>
              <ClipboardDocumentIcon className="h-4 w-4 mr-2" />
              {copied ? 'Copied!' : 'Copy Prompt'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CarePlanImportPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedCarePlan | null>(null);

  // Modal states
  const [showFormatSpec, setShowFormatSpec] = useState(false);
  const [showLLMPrompt, setShowLLMPrompt] = useState(false);

  // Editable form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [conditionCodes, setConditionCodes] = useState<ExtractedCode[]>([]);
  const [medicationCodes, setMedicationCodes] = useState<ExtractedCode[]>([]);
  const [labCodes, setLabCodes] = useState<ExtractedCode[]>([]);
  const [goals, setGoals] = useState<SuggestedGoal[]>([]);
  const [interventions, setInterventions] = useState<SuggestedIntervention[]>([]);
  const [rawText, setRawText] = useState('');
  const [trainingTags, setTrainingTags] = useState('');
  const [trainingDescription, setTrainingDescription] = useState('');

  // Import options
  const [createTemplate, setCreateTemplate] = useState(true);
  const [createTrainingExample, setCreateTrainingExample] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);

  // File drop handler
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      const isValidType = droppedFile.name.toLowerCase().endsWith('.txt') || droppedFile.type === 'text/plain';
      if (isValidType) {
        setFile(droppedFile);
        setParseError(null);
      } else {
        setParseError('Please upload a .txt file in the standardized format');
      }
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setParseError(null);
    }
  }, []);

  // Parse the file
  const handleParse = async () => {
    if (!file) return;

    setParsing(true);
    setParseError(null);

    try {
      const textContent = await file.text();
      const response = await fetch(`${PDF_PARSER_URL}/parse-text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: textContent,
          filename: file.name,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to parse file');
      }

      const data: ParsedCarePlan = await response.json();
      setParsedData(data);

      // Initialize editable form state
      setTitle(data.title);
      setDescription(data.overview_section || data.treatment_section || '');
      if ((data as any).category) {
        setCategory((data as any).category);
      }
      setConditionCodes(data.condition_codes);
      setMedicationCodes(data.medication_codes);
      setLabCodes(data.lab_codes);
      setGoals(data.suggested_goals);
      setInterventions(data.suggested_interventions);
      setRawText(data.raw_text);
      setTrainingDescription(data.overview_section || '');

      setStep('review');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setParsing(false);
    }
  };

  // Code management
  const updateCode = (
    codes: ExtractedCode[],
    setCodes: React.Dispatch<React.SetStateAction<ExtractedCode[]>>,
    index: number,
    field: keyof ExtractedCode,
    value: string | number
  ) => {
    const updated = [...codes];
    updated[index] = { ...updated[index], [field]: value };
    setCodes(updated);
  };

  const addCode = (setCodes: React.Dispatch<React.SetStateAction<ExtractedCode[]>>, codeSystem: string) => {
    setCodes((prev) => [
      ...prev,
      { code: '', code_system: codeSystem, display_text: '', confidence: 1.0 },
    ]);
  };

  const removeCode = (
    codes: ExtractedCode[],
    setCodes: React.Dispatch<React.SetStateAction<ExtractedCode[]>>,
    index: number
  ) => {
    setCodes(codes.filter((_, i) => i !== index));
  };

  // Goal management
  const updateGoal = (index: number, field: keyof SuggestedGoal, value: string | number) => {
    const updated = [...goals];
    updated[index] = { ...updated[index], [field]: value };
    setGoals(updated);
  };

  const addGoal = () => {
    setGoals([
      ...goals,
      { description: '', target_value: null, target_days: null, priority: 'MEDIUM' },
    ]);
  };

  const removeGoal = (index: number) => {
    setGoals(goals.filter((_, i) => i !== index));
  };

  // Intervention management
  const updateIntervention = (index: number, field: keyof SuggestedIntervention, value: string | number | null) => {
    const updated = [...interventions];
    updated[index] = { ...updated[index], [field]: value };
    setInterventions(updated);
  };

  const addIntervention = () => {
    setInterventions([
      ...interventions,
      {
        description: '',
        intervention_type: 'OTHER',
        medication_code: null,
        procedure_code: null,
        frequency: null,
        schedule_days: null,
      },
    ]);
  };

  const removeIntervention = (index: number) => {
    setInterventions(interventions.filter((_, i) => i !== index));
  };

  // GraphQL mutation
  const [importCarePlanFromPdf] = useMutation(IMPORT_CARE_PLAN_FROM_PDF);

  // Import handler
  const handleImport = async () => {
    if (!createTemplate && !createTrainingExample) {
      setImportError('Please select at least one import option');
      return;
    }

    setImporting(true);
    setImportError(null);

    try {
      const input = {
        title,
        description: description || undefined,
        category,
        conditionCodes: conditionCodes.map(c => c.code).filter(Boolean),
        medicationCodes: medicationCodes.map(c => c.code).filter(Boolean),
        labCodes: labCodes.map(c => c.code).filter(Boolean),
        rawText,
        goals: goals.filter(g => g.description).map(g => ({
          description: g.description,
          defaultTargetValue: g.target_value || undefined,
          defaultTargetDays: g.target_days || undefined,
          priority: g.priority,
        })),
        interventions: interventions.filter(i => i.description).map(i => ({
          type: i.intervention_type,
          description: i.description,
          medicationCode: i.medication_code || undefined,
          procedureCode: i.procedure_code || undefined,
          defaultScheduleDays: i.schedule_days || undefined,
        })),
        createTemplate,
        createTrainingExample,
        trainingTags: trainingTags.split(',').map(t => t.trim()).filter(Boolean),
        trainingDescription: trainingDescription || undefined,
      };

      await importCarePlanFromPdf({ variables: { input } });

      setImportSuccess(true);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setImporting(false);
    }
  };

  // Render step indicator
  const renderStepIndicator = () => {
    const steps = [
      { key: 'upload', label: 'Upload File' },
      { key: 'review', label: 'Review & Edit' },
      { key: 'import', label: 'Import Options' },
    ];

    return (
      <div className="flex items-center justify-center mb-8">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                step === s.key
                  ? 'bg-indigo-600 text-white'
                  : steps.findIndex((x) => x.key === step) > i
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 text-gray-600'
              }`}
            >
              {steps.findIndex((x) => x.key === step) > i ? (
                <CheckCircleIcon className="w-5 h-5" />
              ) : (
                i + 1
              )}
            </div>
            <span className="ml-2 text-sm font-medium text-gray-700">{s.label}</span>
            {i < steps.length - 1 && (
              <div className="w-16 h-0.5 mx-4 bg-gray-200" />
            )}
          </div>
        ))}
      </div>
    );
  };

  // Render code editor section
  const renderCodeSection = (
    title: string,
    codes: ExtractedCode[],
    setCodes: React.Dispatch<React.SetStateAction<ExtractedCode[]>>,
    defaultCodeSystem: string
  ) => (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => addCode(setCodes, defaultCodeSystem)}
          >
            <PlusIcon className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </CardHeader>
      <CardBody>
        {codes.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No codes extracted. Add manually if needed.</p>
        ) : (
          <div className="space-y-3">
            {codes.map((code, index) => (
              <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    placeholder="Code"
                    value={code.code}
                    onChange={(e) => updateCode(codes, setCodes, index, 'code', e.target.value)}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <input
                    type="text"
                    placeholder="Display text"
                    value={code.display_text || ''}
                    onChange={(e) => updateCode(codes, setCodes, index, 'display_text', e.target.value)}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded">
                      {code.code_system}
                    </span>
                    {code.confidence < 0.8 && (
                      <ExclamationTriangleIcon className="h-4 w-4 text-yellow-500" title="Low confidence extraction" />
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeCode(codes, setCodes, index)}
                  className="text-red-600 hover:text-red-700"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );

  if (importSuccess) {
    return (
      <div className="text-center py-12">
        <CheckCircleIcon className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Import Successful!</h2>
        <p className="text-gray-600 mb-6">
          {createTemplate && createTrainingExample
            ? 'Care plan and training example have been created.'
            : createTemplate
            ? 'Care plan has been created.'
            : 'Training example has been created.'}
        </p>
        <div className="flex justify-center gap-4">
          <Link href="/care-plans">
            <Button variant="secondary">View Care Plans</Button>
          </Link>
          <Button onClick={() => {
            setStep('upload');
            setFile(null);
            setParsedData(null);
            setImportSuccess(false);
          }}>
            Import Another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <FormatSpecificationModal isOpen={showFormatSpec} onClose={() => setShowFormatSpec(false)} />
      <LLMPromptModal isOpen={showLLMPrompt} onClose={() => setShowLLMPrompt(false)} />

      <div className="flex items-center gap-4 mb-6">
        <Link href="/import-export">
          <Button variant="ghost" size="sm">
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Import Care Plan</h1>
          <p className="mt-1 text-sm text-gray-500">
            Upload a standardized care plan document (.txt), review extracted data, and import as template or training example
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFormatSpec(true)}>
            <InformationCircleIcon className="h-4 w-4 mr-1" />
            View Format
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowLLMPrompt(true)}>
            <SparklesIcon className="h-4 w-4 mr-1" />
            LLM Helper
          </Button>
        </div>
      </div>

      {renderStepIndicator()}

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="space-y-6">
          {/* Format Info Card */}
          <Card className="border-blue-200 bg-blue-50">
            <CardBody>
              <div className="flex items-start gap-3">
                <InformationCircleIcon className="h-6 w-6 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-medium text-blue-900">Standardized Format Required</h3>
                  <p className="text-sm text-blue-700 mt-1">
                    Care plans must be in the standardized .txt format with specific sections for metadata, codes, goals, and interventions.
                  </p>
                  <div className="flex gap-3 mt-3">
                    <button
                      onClick={() => setShowFormatSpec(true)}
                      className="text-sm font-medium text-blue-700 hover:text-blue-800 underline"
                    >
                      View Format Specification
                    </button>
                    <span className="text-blue-300">|</span>
                    <button
                      onClick={() => setShowLLMPrompt(true)}
                      className="text-sm font-medium text-blue-700 hover:text-blue-800 underline"
                    >
                      Get LLM Conversion Prompt
                    </button>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                  file ? 'border-green-300 bg-green-50' : 'border-gray-300 hover:border-indigo-400'
                }`}
              >
                {file ? (
                  <>
                    <DocumentTextIcon className="h-16 w-16 text-green-500 mx-auto mb-4" />
                    <p className="text-lg font-medium text-gray-900">{file.name}</p>
                    <p className="text-sm text-gray-500 mb-4">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setFile(null);
                        setParseError(null);
                      }}
                    >
                      Choose Different File
                    </Button>
                  </>
                ) : (
                  <>
                    <CloudArrowUpIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                    <p className="text-lg font-medium text-gray-900 mb-2">
                      Drop your care plan file here, or browse
                    </p>
                    <p className="text-sm text-gray-500 mb-4">
                      Accepts .txt files in the standardized care plan format
                    </p>
                    <label className="cursor-pointer">
                      <span className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                        Browse Files
                      </span>
                      <input
                        type="file"
                        accept=".txt,text/plain"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                    </label>
                  </>
                )}
              </div>

              {parseError && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-700">
                  <ExclamationTriangleIcon className="h-5 w-5 mr-2" />
                  {parseError}
                </div>
              )}

              <div className="mt-6 flex justify-end">
                <Button onClick={handleParse} disabled={!file || parsing}>
                  {parsing ? (
                    <>
                      <Spinner className="h-4 w-4 mr-2" />
                      Parsing...
                    </>
                  ) : (
                    <>
                      Parse File
                      <ArrowRightIcon className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Step 2: Review & Edit */}
      {step === 'review' && parsedData && (
        <div className="space-y-6">
          {/* Warnings */}
          {parsedData.warnings.length > 0 && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <h3 className="font-medium text-yellow-800 mb-2">Extraction Warnings</h3>
              <ul className="text-sm text-yellow-700 list-disc list-inside">
                {parsedData.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Confidence indicator */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">Extraction Confidence:</span>
            <div className="flex-1 max-w-xs bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${
                  parsedData.extraction_confidence >= 0.7
                    ? 'bg-green-500'
                    : parsedData.extraction_confidence >= 0.4
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
                }`}
                style={{ width: `${parsedData.extraction_confidence * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium">
              {Math.round(parsedData.extraction_confidence * 100)}%
            </span>
            {(parsedData as any).is_structured_format && (
              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                Standardized Format Detected
              </span>
            )}
          </div>

          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value="GENERAL">General</option>
                    <option value="CHRONIC_DISEASE">Chronic Disease</option>
                    <option value="ACUTE_CARE">Acute Care</option>
                    <option value="PREVENTIVE_CARE">Preventive Care</option>
                    <option value="POST_PROCEDURE">Post Procedure</option>
                    <option value="MEDICATION_MANAGEMENT">Medication Management</option>
                    <option value="LIFESTYLE_MODIFICATION">Lifestyle Modification</option>
                    <option value="MENTAL_HEALTH">Mental Health</option>
                    <option value="PEDIATRIC">Pediatric</option>
                    <option value="GERIATRIC">Geriatric</option>
                  </select>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Condition Codes */}
          {renderCodeSection('Condition Codes (SNOMED/ICD-10)', conditionCodes, setConditionCodes, 'SNOMED')}

          {/* Medication Codes */}
          {renderCodeSection('Medication Codes (RxNorm)', medicationCodes, setMedicationCodes, 'RxNorm')}

          {/* Lab Codes */}
          {renderCodeSection('Lab Codes (LOINC)', labCodes, setLabCodes, 'LOINC')}

          {/* Goals */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Goals</CardTitle>
                <Button type="button" variant="secondary" size="sm" onClick={addGoal}>
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Add Goal
                </Button>
              </div>
            </CardHeader>
            <CardBody>
              {goals.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No goals extracted. Add manually if needed.</p>
              ) : (
                <div className="space-y-4">
                  {goals.map((goal, index) => (
                    <div key={index} className="border border-gray-200 rounded-md p-4">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-sm font-medium text-gray-700">Goal {index + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeGoal(index)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="md:col-span-3">
                          <input
                            type="text"
                            placeholder="Description *"
                            value={goal.description}
                            onChange={(e) => updateGoal(index, 'description', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <input
                            type="text"
                            placeholder="Target value"
                            value={goal.target_value || ''}
                            onChange={(e) => updateGoal(index, 'target_value', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <input
                            type="number"
                            placeholder="Target days"
                            value={goal.target_days || ''}
                            onChange={(e) => updateGoal(index, 'target_days', parseInt(e.target.value) || 0)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <select
                            value={goal.priority}
                            onChange={(e) => updateGoal(index, 'priority', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          >
                            {priorityOptions.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Interventions */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Interventions</CardTitle>
                <Button type="button" variant="secondary" size="sm" onClick={addIntervention}>
                  <PlusIcon className="h-4 w-4 mr-1" />
                  Add Intervention
                </Button>
              </div>
            </CardHeader>
            <CardBody>
              {interventions.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No interventions extracted. Add manually if needed.</p>
              ) : (
                <div className="space-y-4">
                  {interventions.map((intervention, index) => (
                    <div key={index} className="border border-gray-200 rounded-md p-4">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-sm font-medium text-gray-700">Intervention {index + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeIntervention(index)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <select
                            value={intervention.intervention_type}
                            onChange={(e) => updateIntervention(index, 'intervention_type', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          >
                            {interventionTypeOptions.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <input
                            type="text"
                            placeholder="Frequency"
                            value={intervention.frequency || ''}
                            onChange={(e) => updateIntervention(index, 'frequency', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <input
                            type="text"
                            placeholder="Description *"
                            value={intervention.description}
                            onChange={(e) => updateIntervention(index, 'description', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                        </div>
                        {intervention.intervention_type === 'MEDICATION' && (
                          <div>
                            <input
                              type="text"
                              placeholder="Medication code (RxNorm)"
                              value={intervention.medication_code || ''}
                              onChange={(e) => updateIntervention(index, 'medication_code', e.target.value)}
                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            />
                          </div>
                        )}
                        {intervention.intervention_type === 'PROCEDURE' && (
                          <div>
                            <input
                              type="text"
                              placeholder="Procedure code (CPT)"
                              value={intervention.procedure_code || ''}
                              onChange={(e) => updateIntervention(index, 'procedure_code', e.target.value)}
                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Raw Text Preview */}
          <Card>
            <CardHeader>
              <CardTitle>Raw Text (for RAG context)</CardTitle>
            </CardHeader>
            <CardBody>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={8}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-2">
                This text will be used for semantic search and RAG context. Edit if needed.
              </p>
            </CardBody>
          </Card>

          {/* Navigation */}
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep('upload')}>
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Back to Upload
            </Button>
            <Button onClick={() => setStep('import')}>
              Continue to Import
              <ArrowRightIcon className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Import Options */}
      {step === 'import' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Import Options</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="space-y-4">
                <label className="flex items-start gap-3 p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={createTemplate}
                    onChange={(e) => setCreateTemplate(e.target.checked)}
                    className="mt-1 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  />
                  <div>
                    <p className="font-medium text-gray-900">Create Care Plan Template</p>
                    <p className="text-sm text-gray-500">
                      Creates a reusable template that providers can use when creating care plans for patients
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={createTrainingExample}
                    onChange={(e) => setCreateTrainingExample(e.target.checked)}
                    className="mt-1 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  />
                  <div>
                    <p className="font-medium text-gray-900">Create Training Example</p>
                    <p className="text-sm text-gray-500">
                      Creates a training example for the ML recommendation model. Embeddings will be generated automatically.
                    </p>
                  </div>
                </label>
              </div>

              {createTrainingExample && (
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-medium text-gray-900 mb-3">Training Metadata</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Training Tags (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={trainingTags}
                        onChange={(e) => setTrainingTags(e.target.value)}
                        placeholder="e.g., pregnancy, acute, infection"
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Training Description
                      </label>
                      <textarea
                        value={trainingDescription}
                        onChange={(e) => setTrainingDescription(e.target.value)}
                        rows={2}
                        placeholder="What this example demonstrates..."
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Import Summary</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-gray-500">Title</dt>
                  <dd className="font-medium text-gray-900">{title}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Category</dt>
                  <dd className="font-medium text-gray-900">{category}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Condition Codes</dt>
                  <dd className="font-medium text-gray-900">{conditionCodes.length}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Medication Codes</dt>
                  <dd className="font-medium text-gray-900">{medicationCodes.length}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Goals</dt>
                  <dd className="font-medium text-gray-900">{goals.length}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Interventions</dt>
                  <dd className="font-medium text-gray-900">{interventions.length}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          {importError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-700">
              <ExclamationTriangleIcon className="h-5 w-5 mr-2" />
              {importError}
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep('review')}>
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Back to Review
            </Button>
            <Button onClick={handleImport} disabled={importing || (!createTemplate && !createTrainingExample)}>
              {importing ? (
                <>
                  <Spinner className="h-4 w-4 mr-2" />
                  Importing...
                </>
              ) : (
                'Import Care Plan'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
