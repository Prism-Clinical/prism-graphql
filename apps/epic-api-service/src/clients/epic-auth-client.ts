/**
 * Epic Auth Client
 *
 * JWT-based Backend Services OAuth 2.0 authentication for Epic FHIR APIs.
 * Features:
 * - RS384 JWT signing using Node.js crypto (no external dependencies)
 * - Token caching with automatic refresh before expiry
 * - Refresh deduplication to prevent thundering herd
 * - Structured logging with request correlation
 * - Dependency injection support for testing
 */

import * as crypto from "crypto";
import * as fs from "fs";
import { Logger, createLogger } from "./logger";

// =============================================================================
// TYPES
// =============================================================================

export interface EpicAuthConfig {
  clientId: string;
  tokenUrl: string;
  privateKeyPath: string;
  kid: string;
  scope: string;
  tokenRefreshBufferSeconds: number;
}

interface EpicTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// =============================================================================
// JWT HELPERS
// =============================================================================

function base64url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function createSignedJwt(config: EpicAuthConfig, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS384",
    typ: "JWT",
    kid: config.kid,
  };

  const payload = {
    iss: config.clientId,
    sub: config.clientId,
    aud: config.tokenUrl,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 300, // 5 minutes
  };

  const encodedHeader = base64url(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createSign("RSA-SHA384")
    .update(signingInput)
    .sign(privateKey, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${signingInput}.${signature}`;
}

// =============================================================================
// CLIENT IMPLEMENTATION
// =============================================================================

export class EpicAuthClient {
  private readonly config: EpicAuthConfig;
  private readonly logger: Logger;
  private cachedToken: CachedToken | null = null;
  private privateKey: string | null = null;
  private tokenRefreshPromise: Promise<string> | null = null;

  constructor(config?: Partial<EpicAuthConfig>) {
    this.config = {
      clientId: config?.clientId || process.env.EPIC_CLIENT_ID || "",
      tokenUrl:
        config?.tokenUrl ||
        process.env.EPIC_TOKEN_URL ||
        "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
      privateKeyPath:
        config?.privateKeyPath ||
        process.env.EPIC_PRIVATE_KEY_PATH ||
        "./keys/epic-private-key.pem",
      kid: config?.kid || process.env.EPIC_KID || "prism-clinical-sandbox",
      scope:
        config?.scope ||
        process.env.EPIC_SCOPE ||
        "system/Patient.rs system/Observation.rs system/MedicationRequest.rs system/Condition.rs system/AllergyIntolerance.rs",
      tokenRefreshBufferSeconds: config?.tokenRefreshBufferSeconds ?? 30,
    };
    this.logger = createLogger("epic-auth-client");
  }

  private loadPrivateKey(): string {
    if (this.privateKey) {
      return this.privateKey;
    }

    try {
      this.privateKey = fs.readFileSync(this.config.privateKeyPath, "utf8");
      this.logger.info("Private key loaded", {
        path: this.config.privateKeyPath,
      });
      return this.privateKey;
    } catch (error) {
      this.logger.error(
        "Failed to load private key",
        error instanceof Error ? error : undefined,
        { path: this.config.privateKeyPath }
      );
      throw new Error(
        `Failed to load Epic private key from ${this.config.privateKeyPath}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  private isTokenValid(): boolean {
    if (!this.cachedToken) {
      return false;
    }
    const bufferMs = this.config.tokenRefreshBufferSeconds * 1000;
    return Date.now() < this.cachedToken.expiresAt - bufferMs;
  }

  async getAccessToken(): Promise<string> {
    if (this.isTokenValid()) {
      return this.cachedToken!.accessToken;
    }

    // Deduplication: if a refresh is already in-flight, wait for it
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    this.tokenRefreshPromise = this.refreshToken();
    try {
      const token = await this.tokenRefreshPromise;
      return token;
    } finally {
      this.tokenRefreshPromise = null;
    }
  }

  private async refreshToken(): Promise<string> {
    const key = this.loadPrivateKey();
    const jwt = createSignedJwt(this.config, key);

    this.logger.info("Requesting access token from Epic", {
      tokenUrl: this.config.tokenUrl,
      clientId: this.config.clientId,
    });

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: jwt,
      scope: this.config.scope,
    });

    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        "Token request failed",
        new Error(`HTTP ${response.status}: ${errorBody}`),
        {
          status: response.status,
          tokenUrl: this.config.tokenUrl,
        }
      );
      throw new Error(
        `Epic token request failed with HTTP ${response.status}: ${errorBody}`
      );
    }

    const tokenResponse: EpicTokenResponse = await response.json();

    this.cachedToken = {
      accessToken: tokenResponse.access_token,
      expiresAt: Date.now() + tokenResponse.expires_in * 1000,
    };

    this.logger.info("Access token acquired", {
      expiresIn: tokenResponse.expires_in,
      scope: tokenResponse.scope,
    });

    return tokenResponse.access_token;
  }
}

// =============================================================================
// SINGLETON WITH RESET FOR TESTING
// =============================================================================

let authClient: EpicAuthClient | null = null;

export function getAuthClient(): EpicAuthClient {
  if (!authClient) {
    authClient = new EpicAuthClient();
  }
  return authClient;
}

export function resetAuthClient(): void {
  authClient = null;
}

export function setAuthClient(client: EpicAuthClient): void {
  authClient = client;
}
