import { useState, useCallback } from 'react';
import { useMutation } from '@apollo/client/react';
import type { Node, Edge } from '@xyflow/react';
import { serializePathway } from '@/lib/pathway-json/serializer';
import { validatePathwayJson, type MappedValidationError } from '@/lib/pathway-json/validator';
import { IMPORT_PATHWAY, ACTIVATE_PATHWAY } from '@/lib/graphql/mutations/pathways';
import type {
  PathwayMetadata,
  ImportPathwayResult,
  PathwayStatusResult,
  ImportMode,
} from '@/types';

export interface SaveResult {
  success: boolean;
  result?: ImportPathwayResult;
  errors?: MappedValidationError[];
}

export function usePathwaySave() {
  const [isSaving, setIsSaving] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<MappedValidationError[]>([]);

  const [importPathwayMutation] = useMutation<
    { importPathway: ImportPathwayResult },
    { pathwayJson: string; importMode: ImportMode }
  >(IMPORT_PATHWAY);

  const [activatePathwayMutation] = useMutation<
    { activatePathway: PathwayStatusResult },
    { id: string }
  >(ACTIVATE_PATHWAY);

  const save = useCallback(async (
    nodes: Node[],
    edges: Edge[],
    metadata: PathwayMetadata,
    importMode: ImportMode,
  ): Promise<SaveResult> => {
    setIsSaving(true);
    setValidationErrors([]);

    try {
      // Serialize
      const pathwayJson = serializePathway(nodes, edges, metadata);

      // Client-side validation
      const clientValidation = validatePathwayJson(pathwayJson);
      if (!clientValidation.valid) {
        setValidationErrors(clientValidation.errors);
        return { success: false, errors: clientValidation.errors };
      }

      // Call backend
      const { data } = await importPathwayMutation({
        variables: {
          pathwayJson: JSON.stringify(pathwayJson),
          importMode,
        },
      });

      if (!data) {
        const error: MappedValidationError = {
          message: 'No response from server',
          path: '',
        };
        setValidationErrors([error]);
        return { success: false, errors: [error] };
      }

      const result = data.importPathway;

      // Check backend validation
      if (!result.validation.valid) {
        const backendErrors: MappedValidationError[] = result.validation.errors.map((msg) => ({
          message: msg,
          path: '',
        }));
        setValidationErrors(backendErrors);
        return { success: false, result, errors: backendErrors };
      }

      return { success: true, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      const error: MappedValidationError = { message, path: '' };
      setValidationErrors([error]);
      return { success: false, errors: [error] };
    } finally {
      setIsSaving(false);
    }
  }, [importPathwayMutation]);

  const activate = useCallback(async (pathwayId: string): Promise<boolean> => {
    setIsActivating(true);
    try {
      const { data } = await activatePathwayMutation({
        variables: { id: pathwayId },
      });
      return !!data?.activatePathway;
    } catch {
      return false;
    } finally {
      setIsActivating(false);
    }
  }, [activatePathwayMutation]);

  const clearErrors = useCallback(() => {
    setValidationErrors([]);
  }, []);

  return {
    save,
    activate,
    clearErrors,
    isSaving,
    isActivating,
    validationErrors,
  };
}
