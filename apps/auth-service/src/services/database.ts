import { Pool, PoolClient } from 'pg';

// =============================================================================
// ADMIN USER FUNCTIONS
// =============================================================================

export interface AdminUserRow {
  id: string;
  email: string;
  password_hash: string | null;
  first_name: string;
  last_name: string;
  role: string;
  status: string;
  email_verified: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function getAdminUserByEmail(pool: Pool, email: string): Promise<AdminUserRow | null> {
  const result = await pool.query(
    'SELECT * FROM admin_users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  return result.rows[0] || null;
}

export async function getAdminUserById(pool: Pool, id: string): Promise<AdminUserRow | null> {
  const result = await pool.query('SELECT * FROM admin_users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function createAdminUser(
  pool: Pool,
  email: string,
  passwordHash: string,
  firstName: string,
  lastName: string,
  role: string = 'ADMIN'
): Promise<AdminUserRow> {
  const result = await pool.query(
    `INSERT INTO admin_users (email, password_hash, first_name, last_name, role, status, email_verified)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', false)
     RETURNING *`,
    [email, passwordHash, firstName, lastName, role]
  );
  return result.rows[0];
}

export async function verifyAdminEmail(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    `UPDATE admin_users SET email_verified = true, status = 'ACTIVE', updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}

export async function updateAdminLoginSuccess(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    `UPDATE admin_users SET last_login_at = NOW(), failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}

export async function updateAdminLoginFailure(pool: Pool, userId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE admin_users SET failed_login_attempts = failed_login_attempts + 1, updated_at = NOW() WHERE id = $1 RETURNING failed_login_attempts`,
    [userId]
  );
  return result.rows[0]?.failed_login_attempts || 0;
}

export async function lockAdminAccount(pool: Pool, userId: string, lockDuration: number = 15): Promise<void> {
  await pool.query(
    `UPDATE admin_users SET locked_until = NOW() + INTERVAL '${lockDuration} minutes', updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}

export async function updateAdminPassword(pool: Pool, userId: string, passwordHash: string): Promise<void> {
  await pool.query(
    `UPDATE admin_users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [userId, passwordHash]
  );
}

// =============================================================================
// PROVIDER USER FUNCTIONS
// =============================================================================

export interface ProviderUserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  npi: string;
  institution_id: string | null;
  role: string;
  status: string;
  email_verified: boolean;
  npi_verified: boolean;
  admin_approved: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function getProviderUserByEmail(pool: Pool, email: string): Promise<ProviderUserRow | null> {
  const result = await pool.query(
    'SELECT * FROM provider_users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  return result.rows[0] || null;
}

export async function getProviderUserById(pool: Pool, id: string): Promise<ProviderUserRow | null> {
  const result = await pool.query('SELECT * FROM provider_users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function getProviderUserByNpi(pool: Pool, npi: string): Promise<ProviderUserRow | null> {
  const result = await pool.query('SELECT * FROM provider_users WHERE npi = $1', [npi]);
  return result.rows[0] || null;
}

export async function createProviderUser(
  pool: Pool,
  email: string,
  passwordHash: string,
  firstName: string,
  lastName: string,
  npi: string,
  institutionId: string,
  role: string
): Promise<ProviderUserRow> {
  const result = await pool.query(
    `INSERT INTO provider_users (email, password_hash, first_name, last_name, npi, institution_id, role, status, email_verified, npi_verified, admin_approved)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_VERIFICATION', false, false, false)
     RETURNING *`,
    [email, passwordHash, firstName, lastName, npi, institutionId, role]
  );
  return result.rows[0];
}

export async function verifyProviderEmail(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    `UPDATE provider_users SET email_verified = true, status = 'PENDING_APPROVAL', updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}

export async function approveProvider(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    `UPDATE provider_users SET admin_approved = true, status = 'ACTIVE', updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}

export async function rejectProvider(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    `UPDATE provider_users SET admin_approved = false, status = 'INACTIVE', updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}

export async function updateProviderLoginSuccess(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    `UPDATE provider_users SET last_login_at = NOW(), failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}

export async function updateProviderLoginFailure(pool: Pool, userId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE provider_users SET failed_login_attempts = failed_login_attempts + 1, updated_at = NOW() WHERE id = $1 RETURNING failed_login_attempts`,
    [userId]
  );
  return result.rows[0]?.failed_login_attempts || 0;
}

export async function lockProviderAccount(pool: Pool, userId: string, lockDuration: number = 15): Promise<void> {
  await pool.query(
    `UPDATE provider_users SET locked_until = NOW() + INTERVAL '${lockDuration} minutes', updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}

export async function updateProviderPassword(pool: Pool, userId: string, passwordHash: string): Promise<void> {
  await pool.query(
    `UPDATE provider_users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [userId, passwordHash]
  );
}

// =============================================================================
// INSTITUTION FUNCTIONS
// =============================================================================

export interface InstitutionRow {
  id: string;
  name: string;
  code: string;
  domain: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function getInstitutionByCode(pool: Pool, code: string): Promise<InstitutionRow | null> {
  const result = await pool.query(
    'SELECT * FROM institutions WHERE UPPER(code) = UPPER($1) AND is_active = true',
    [code]
  );
  return result.rows[0] || null;
}

export async function getInstitutionById(pool: Pool, id: string): Promise<InstitutionRow | null> {
  const result = await pool.query('SELECT * FROM institutions WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function getAllInstitutions(pool: Pool): Promise<InstitutionRow[]> {
  const result = await pool.query('SELECT * FROM institutions WHERE is_active = true ORDER BY name');
  return result.rows;
}

export async function createInstitution(
  pool: Pool,
  name: string,
  code: string,
  domain?: string,
  addressStreet?: string,
  addressCity?: string,
  addressState?: string,
  addressZip?: string
): Promise<InstitutionRow> {
  const result = await pool.query(
    `INSERT INTO institutions (name, code, domain, address_street, address_city, address_state, address_zip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [name, code, domain, addressStreet, addressCity, addressState, addressZip]
  );
  return result.rows[0];
}

export async function deactivateInstitution(pool: Pool, id: string): Promise<InstitutionRow> {
  const result = await pool.query(
    `UPDATE institutions SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
}

// =============================================================================
// APPROVED DOMAIN FUNCTIONS
// =============================================================================

export interface ApprovedDomainRow {
  id: string;
  domain: string;
  organization_name: string;
  domain_type: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function getApprovedDomainByDomain(pool: Pool, domain: string): Promise<ApprovedDomainRow | null> {
  const result = await pool.query(
    'SELECT * FROM approved_domains WHERE LOWER(domain) = LOWER($1) AND is_active = true',
    [domain]
  );
  return result.rows[0] || null;
}

export async function getAllApprovedDomains(pool: Pool): Promise<ApprovedDomainRow[]> {
  const result = await pool.query('SELECT * FROM approved_domains WHERE is_active = true ORDER BY domain');
  return result.rows;
}

export async function createApprovedDomain(
  pool: Pool,
  domain: string,
  organizationName: string,
  domainType: string
): Promise<ApprovedDomainRow> {
  const result = await pool.query(
    `INSERT INTO approved_domains (domain, organization_name, domain_type)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [domain, organizationName, domainType]
  );
  return result.rows[0];
}

export async function deactivateDomain(pool: Pool, id: string): Promise<ApprovedDomainRow> {
  const result = await pool.query(
    `UPDATE approved_domains SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
}

// =============================================================================
// TOKEN FUNCTIONS
// =============================================================================

export async function createEmailVerificationToken(
  pool: Pool,
  userId: string,
  userType: string,
  token: string,
  expiresInHours: number = 24
): Promise<void> {
  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, user_type, token, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '${expiresInHours} hours')`,
    [userId, userType, token]
  );
}

export async function getEmailVerificationToken(pool: Pool, token: string): Promise<{
  id: string;
  user_id: string;
  user_type: string;
  expires_at: Date;
  used_at: Date | null;
} | null> {
  const result = await pool.query(
    'SELECT * FROM email_verification_tokens WHERE token = $1',
    [token]
  );
  return result.rows[0] || null;
}

export async function markEmailTokenUsed(pool: Pool, tokenId: string): Promise<void> {
  await pool.query(
    `UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`,
    [tokenId]
  );
}

export async function createRefreshToken(
  pool: Pool,
  userId: string,
  userType: string,
  tokenHash: string,
  expiresInDays: number = 7
): Promise<void> {
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, user_type, token_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '${expiresInDays} days')`,
    [userId, userType, tokenHash]
  );
}

export async function getRefreshToken(pool: Pool, tokenHash: string): Promise<{
  id: string;
  user_id: string;
  user_type: string;
  expires_at: Date;
  revoked_at: Date | null;
} | null> {
  const result = await pool.query(
    'SELECT * FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL',
    [tokenHash]
  );
  return result.rows[0] || null;
}

export async function revokeRefreshToken(pool: Pool, tokenHash: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
    [tokenHash]
  );
}

export async function revokeAllUserRefreshTokens(pool: Pool, userId: string, userType: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND user_type = $2 AND revoked_at IS NULL`,
    [userId, userType]
  );
}

export async function createPasswordResetToken(
  pool: Pool,
  userId: string,
  userType: string,
  token: string,
  expiresInHours: number = 1
): Promise<void> {
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, user_type, token, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '${expiresInHours} hours')`,
    [userId, userType, token]
  );
}

export async function getPasswordResetToken(pool: Pool, token: string): Promise<{
  id: string;
  user_id: string;
  user_type: string;
  expires_at: Date;
  used_at: Date | null;
} | null> {
  const result = await pool.query(
    'SELECT * FROM password_reset_tokens WHERE token = $1',
    [token]
  );
  return result.rows[0] || null;
}

export async function markPasswordResetTokenUsed(pool: Pool, tokenId: string): Promise<void> {
  await pool.query(
    `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
    [tokenId]
  );
}

// =============================================================================
// PROVIDER APPROVAL REQUEST FUNCTIONS
// =============================================================================

export interface ProviderApprovalRequestRow {
  id: string;
  provider_user_id: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createProviderApprovalRequest(pool: Pool, providerUserId: string): Promise<ProviderApprovalRequestRow> {
  const result = await pool.query(
    `INSERT INTO provider_approval_requests (provider_user_id, status)
     VALUES ($1, 'PENDING')
     RETURNING *`,
    [providerUserId]
  );
  return result.rows[0];
}

export async function getPendingApprovalRequests(
  pool: Pool,
  first: number = 20,
  after?: string
): Promise<{ rows: ProviderApprovalRequestRow[]; totalCount: number }> {
  let query = `SELECT * FROM provider_approval_requests WHERE status = 'PENDING'`;
  const params: (string | number)[] = [];

  if (after) {
    params.push(after);
    query += ` AND id > $${params.length}`;
  }

  query += ` ORDER BY created_at ASC LIMIT $${params.length + 1}`;
  params.push(first + 1);

  const result = await pool.query(query, params);
  const countResult = await pool.query(`SELECT COUNT(*) FROM provider_approval_requests WHERE status = 'PENDING'`);

  return {
    rows: result.rows,
    totalCount: parseInt(countResult.rows[0].count, 10),
  };
}

export async function getApprovalRequestById(pool: Pool, id: string): Promise<ProviderApprovalRequestRow | null> {
  const result = await pool.query('SELECT * FROM provider_approval_requests WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function updateApprovalRequest(
  pool: Pool,
  id: string,
  status: string,
  reviewedBy: string,
  reviewNotes?: string
): Promise<ProviderApprovalRequestRow> {
  const result = await pool.query(
    `UPDATE provider_approval_requests 
     SET status = $2, reviewed_by = $3, reviewed_at = NOW(), review_notes = $4, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, status, reviewedBy, reviewNotes]
  );
  return result.rows[0];
}
