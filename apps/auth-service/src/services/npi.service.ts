import { isValidNPIFormat } from '../utils/validation';

export interface NPIValidationResult {
  isValid: boolean;
  providerName?: string;
  specialty?: string;
  error?: string;
}

const NPI_REGISTRY_URL = 'https://npiregistry.cms.hhs.gov/api/';

export async function validateNPI(npi: string): Promise<NPIValidationResult> {
  if (!isValidNPIFormat(npi)) {
    return {
      isValid: false,
      error: 'Invalid NPI format. NPI must be 10 digits and pass checksum validation.',
    };
  }

  if (process.env.NODE_ENV === 'development' || process.env.SKIP_NPI_LOOKUP === 'true') {
    return {
      isValid: true,
      providerName: 'Development Provider',
      specialty: 'General Practice',
    };
  }

  try {
    const response = await fetch(`${NPI_REGISTRY_URL}?number=${npi}&version=2.1`);
    
    if (!response.ok) {
      return {
        isValid: false,
        error: 'Unable to verify NPI with registry. Please try again later.',
      };
    }

    const data = await response.json();

    if (data.result_count === 0) {
      return {
        isValid: false,
        error: 'NPI not found in the National Provider registry.',
      };
    }

    const provider = data.results[0];
    const basic = provider.basic || {};
    const taxonomy = provider.taxonomies?.[0] || {};

    let providerName = '';
    if (provider.enumeration_type === 'NPI-1') {
      providerName = `${basic.first_name || ''}  ${basic.last_name || ''}`.trim();
    } else {
      providerName = basic.organization_name || '';
    }

    return {
      isValid: true,
      providerName: providerName || 'Unknown Provider',
      specialty: taxonomy.desc || 'Unknown Specialty',
    };
  } catch (error) {
    console.error('NPI lookup error:', error);
    return {
      isValid: false,
      error: 'Unable to verify NPI. Please try again later.',
    };
  }
}

export function verifyNPIOwnership(
  npi: string,
  firstName: string,
  lastName: string,
  registryFirstName?: string,
  registryLastName?: string
): boolean {
  if (!registryFirstName || !registryLastName) {
    return true;
  }

  const normalizedFirst = firstName.toLowerCase().trim();
  const normalizedLast = lastName.toLowerCase().trim();
  const normalizedRegFirst = registryFirstName.toLowerCase().trim();
  const normalizedRegLast = registryLastName.toLowerCase().trim();

  const firstNameMatch = normalizedFirst === normalizedRegFirst || 
    normalizedRegFirst.startsWith(normalizedFirst) ||
    normalizedFirst.startsWith(normalizedRegFirst);
  
  const lastNameMatch = normalizedLast === normalizedRegLast;

  return firstNameMatch && lastNameMatch;
}
