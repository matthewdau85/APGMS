import { RailsConfig } from '../config/rails.js';
import { HttpError } from '../utils/errors.js';

export function assertABNAllowed(abn: string): void {
  if (!abn) {
    throw new HttpError(400, 'RAIL_ABN_REQUIRED', 'abn is required');
  }
  if (RailsConfig.ALLOWLIST_ABNS.length && !RailsConfig.ALLOWLIST_ABNS.includes(abn)) {
    throw new HttpError(422, 'RAIL_ABN_NOT_ALLOWLISTED', 'abn is not allowlisted', { abn });
  }
}

export function assertBSB(bsb: string): void {
  if (!bsb) {
    throw new HttpError(400, 'RAIL_BSB_REQUIRED', 'bsb is required');
  }
  const regex = new RegExp(RailsConfig.ALLOWLIST_BSB_REGEX);
  if (!regex.test(bsb)) {
    throw new HttpError(422, 'RAIL_BSB_INVALID', 'bsb failed validation', { bsb, pattern: RailsConfig.ALLOWLIST_BSB_REGEX });
  }
}

export function assertCRN(crn: string): void {
  if (!crn) {
    throw new HttpError(400, 'RAIL_CRN_REQUIRED', 'crn is required');
  }
  const regex = new RegExp(RailsConfig.ALLOWLIST_CRN_REGEX);
  if (!regex.test(crn)) {
    throw new HttpError(422, 'RAIL_CRN_INVALID', 'crn failed validation', { crn, pattern: RailsConfig.ALLOWLIST_CRN_REGEX });
  }
}
