import type { CDSLink } from '../types';

/**
 * Validation error thrown when link is invalid
 */
export class LinkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkValidationError';
  }
}

/**
 * Link types supported by CDS Hooks
 */
export type LinkType = 'absolute' | 'smart';

/**
 * LinkBuilder - Fluent builder for CDS Hooks links
 *
 * Links provide access to external resources or SMART apps from cards.
 * Supports both absolute URLs (documentation, guidelines) and SMART app launches.
 *
 * @example
 * // Absolute link to documentation
 * const docLink = new LinkBuilder()
 *   .withLabel('View Guidelines')
 *   .withUrl('https://guidelines.example.com/diabetes')
 *   .asAbsolute()
 *   .build();
 *
 * @example
 * // SMART app launch link
 * const appLink = new LinkBuilder()
 *   .withLabel('Open Care Plan App')
 *   .withUrl('https://smartapp.example.com/launch')
 *   .asSmart()
 *   .withAppContext('patient=123&encounter=456')
 *   .build();
 */
export class LinkBuilder {
  private label?: string;
  private url?: string;
  private type?: LinkType;
  private appContext?: string;

  /**
   * Set the link label (required)
   *
   * Human-readable text that appears as the link anchor.
   */
  withLabel(label: string): this {
    this.label = label;
    return this;
  }

  /**
   * Set the link URL (required)
   *
   * For absolute links: the full URL to the resource.
   * For SMART links: the launch URL of the SMART app.
   */
  withUrl(url: string): this {
    this.url = url;
    return this;
  }

  /**
   * Set link type to 'absolute'
   *
   * Use for external documentation, guidelines, or any non-SMART URL.
   */
  asAbsolute(): this {
    this.type = 'absolute';
    return this;
  }

  /**
   * Set link type to 'smart'
   *
   * Use for SMART on FHIR app launches within the EHR context.
   */
  asSmart(): this {
    this.type = 'smart';
    return this;
  }

  /**
   * Set the link type explicitly
   */
  withType(type: LinkType): this {
    this.type = type;
    return this;
  }

  /**
   * Set the app context for SMART links
   *
   * Query string parameters passed to the SMART app on launch.
   * Only applicable for SMART links (type='smart').
   *
   * @example
   * .withAppContext('patient=123&encounter=456')
   */
  withAppContext(appContext: string): this {
    this.appContext = appContext;
    return this;
  }

  /**
   * Validate the link before building
   */
  private validate(): void {
    const errors: string[] = [];

    if (!this.label || this.label.trim() === '') {
      errors.push('label is required');
    }

    if (!this.url || this.url.trim() === '') {
      errors.push('url is required');
    } else {
      // Basic URL validation
      try {
        new URL(this.url);
      } catch {
        errors.push('url must be a valid URL');
      }
    }

    if (!this.type) {
      errors.push('type is required (call asAbsolute() or asSmart())');
    } else if (!['absolute', 'smart'].includes(this.type)) {
      errors.push(`type must be 'absolute' or 'smart', got '${this.type}'`);
    }

    // appContext validation
    if (this.appContext && this.type !== 'smart') {
      errors.push('appContext is only valid for SMART links');
    }

    if (errors.length > 0) {
      throw new LinkValidationError(`Link validation failed: ${errors.join('; ')}`);
    }
  }

  /**
   * Build the link
   *
   * Validates and returns a valid CDSLink object.
   */
  build(): CDSLink {
    this.validate();

    const link: CDSLink = {
      label: this.label!,
      url: this.url!,
      type: this.type!,
    };

    if (this.appContext && this.type === 'smart') {
      link.appContext = this.appContext;
    }

    return link;
  }

  /**
   * Build the link without throwing on validation errors
   */
  tryBuild(): { link: CDSLink | null; errors: string[] } {
    try {
      const link = this.build();
      return { link, errors: [] };
    } catch (error) {
      if (error instanceof LinkValidationError) {
        return { link: null, errors: [error.message] };
      }
      throw error;
    }
  }

  /**
   * Reset the builder to initial state
   */
  reset(): this {
    this.label = undefined;
    this.url = undefined;
    this.type = undefined;
    this.appContext = undefined;
    return this;
  }
}

/**
 * Create a new LinkBuilder instance
 */
export function createLinkBuilder(): LinkBuilder {
  return new LinkBuilder();
}

/**
 * Quick helper to create an absolute link
 */
export function createAbsoluteLink(label: string, url: string): CDSLink {
  return new LinkBuilder()
    .withLabel(label)
    .withUrl(url)
    .asAbsolute()
    .build();
}

/**
 * Quick helper to create a SMART app link
 */
export function createSmartLink(
  label: string,
  url: string,
  appContext?: string
): CDSLink {
  const builder = new LinkBuilder()
    .withLabel(label)
    .withUrl(url)
    .asSmart();

  if (appContext) {
    builder.withAppContext(appContext);
  }

  return builder.build();
}

/**
 * Quick helper to create a documentation link
 *
 * Creates an absolute link with a "View Documentation" style label.
 */
export function createDocumentationLink(
  label: string,
  documentationUrl: string
): CDSLink {
  return createAbsoluteLink(label, documentationUrl);
}

/**
 * Quick helper to create a guideline reference link
 */
export function createGuidelineLink(
  guidelineName: string,
  guidelineUrl: string
): CDSLink {
  return createAbsoluteLink(`View ${guidelineName} Guidelines`, guidelineUrl);
}
