export type Role = "management" | "staff" | "facility" | "pending";

export interface Facility {
  id: string;
  name: string;
  short_name: string | null;
  npi: string | null;
  ein: string | null;
  state: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  initials: string | null;
  role: Role;
  facility_id: string | null;
  created_at: string;
}

export interface Assignment {
  id: string;
  profile_id: string;
  facility_id: string;
  created_at: string;
}

export interface Claim {
  id: string;
  claim_id: string;
  facility_id: string;
  patient_name: string | null;
  member_id: string | null;
  dob: string | null;
  dos_from: string | null;
  dos_to: string | null;
  charge_amount: number | null;
  balance: number | null;
  age_days: number | null;
  bucket: string | null;
  claim_status: string | null;
  week: string | null;
  present: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClaimWork {
  claim_id: string;
  notes: string;
  initials: string;
  date_worked: string;
  med_rec: string;
  auth_flag: string;
  billing: string;
  cap_blue: string;
  highmark: string;
  rebill: string;
  mgmt_needed: boolean;
  auth_issue_status: string; // '', 'open', 'completed'
  auth_notes: string;
  updated_by: string | null;
  updated_at: string;
}

export interface AuthIssue {
  id: string;
  claim_id: string | null;
  facility_id: string | null;
  patient_name: string | null;
  payer: string | null;
  dos_from: string | null;
  dos_to: string | null;
  charge_amount: number | null;
  status: string; // Not Worked / Working / Completed
  mgmt_needed: boolean;
  notes: string;
  from_collection: boolean;
  completed_at: string | null;
  created_at: string;
}

// A claim joined with its persistent collector work layer (left join).
export type ClaimRow = Claim & { work: ClaimWork | null };

export const RISK_AGE_THRESHOLD = 65;
