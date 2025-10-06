import type { AuthContext, ApprovalEvidence } from '../middleware/authz.js';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      authContext?: AuthContext;
      approvalEvidence?: ApprovalEvidence;
    }
  }
}

export {};
