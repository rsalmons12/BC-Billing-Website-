export type Role = "management" | "staff" | "facility" | "pending";

export interface Facility {
  id: string;
  name: string;
  short_name: string | null;
  npi: string | null;
  ein: string | null;
  state: string | null;
  email: string | null;
  created_at: string;
}

export interface ClaimAdjustment {
  id: string;
  claim_id: string | null;
  facility_id: string | null;
  patient_name: string | null;
  member_id: string | null;
  dob: string | null;
  dos_from: string | null;
  dos_to: string | null;
  charge_amount: number | null;
  balance: number | null;
  age_days: number | null;
  claim_status: string | null;
  reason: string;
  initials: string;
  created_by: string | null;
  created_at: string;
}

export interface FacilityMessage {
  id: string;
  facility_id: string | null;
  claim_id: string | null;
  patient_name: string | null;
  subject: string;
  body: string;
  direction: "outbound" | "inbound";
  from_email: string;
  to_email: string;
  sender_id: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string | null;
  initials: string | null;
  role: Role;
  facility_id: string | null;
  allowed_tabs: string[] | null;
  daily_target: number | null;
  job_title: string | null;
  created_at: string;
}

// Job titles a staff member can hold. "Collector" is the default and the only
// one that drives the Collection Queue; the rest are organizational labels.
export const JOB_TITLES = [
  "Collector",
  "Repricing",
  "Negotiations",
  "Utilization Specialist",
  "Biller",
] as const;

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
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
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

export interface Authorization {
  id: string;
  facility_id: string | null;
  patient_name: string | null;
  admit_date: string | null;
  start_date: string | null;
  end_date: string | null;
  discharge_date: string | null;
  next_review_date: string | null;
  auth_number: string | null;
  level_of_care: string | null;
  status: string;
  notes: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Negotiation {
  id: string;
  facility_id: string | null;
  patient_name: string | null;
  dos: string | null;
  vendor: string | null;
  carrier: string | null;
  charged_amount: number | null;
  proposed_amount: number | null;
  negotiated_amount: number | null;
  status: string;
  date_signed: string | null;
  extra_paid: number | null;
  proposed_rate: number | null;
  approved_rate: number | null;
  other_vendor: string | null;
  negotiator: string | null;
  work_date: string | null;
  notes: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MedicalRecord {
  id: string;
  facility_id: string | null;
  patient_name: string | null;
  dos_from: string | null;
  dos_to: string | null;
  charge_amount: number | null;
  payer: string | null;
  record_status: string;
  claim_status: string | null;
  date_received: string | null;
  dcn: string | null;
  pages: string | null;
  paid_amount: number | null;
  notes: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export const RISK_AGE_THRESHOLD = 65;

export const AUTH_STATUS_OPTIONS = [
  "Pending",
  "Approval",
  "Denied",
  "Peer to Peer",
];
export const LEVEL_OF_CARE_OPTIONS = [
  "",
  "Detox",
  "RTC",
  "PHP",
  "IOP",
  "OP",
];
export const NEGOTIATION_STATUS_OPTIONS = [
  "",
  "Pending",
  "Proposed",
  "Approved",
  "Rejected",
  "Signed",
];
export const RECORD_STATUS_OPTIONS = [
  "",
  "Requested",
  "Received",
  "Faxed",
  "Electronically",
  "Mailed",
  "Appeal",
  "Denied",
  "Approved",
];
