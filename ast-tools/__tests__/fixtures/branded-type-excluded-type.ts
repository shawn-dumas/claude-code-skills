// Fixture: interface with excluded type name (should NOT produce UNBRANDED_ID_FIELD)
// Tests that types containing 'Response', 'Request', etc. are excluded.

// This interface has 'Response' in the name -- userId: string should NOT be flagged
export interface UserResponse {
  userId: string;
  teamId: number;
  name: string;
}

// This interface has 'Request' in the name -- userId: string should NOT be flagged
export interface CreateUserRequest {
  userId: string;
  organizationId: number;
}

// This plain interface SHOULD be flagged (no excluded pattern in name)
export interface UserRecord {
  userId: string;
  teamId: number;
}
