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

export interface MarketplaceClaim {
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
  payer: string | null;
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
  sender_name?: string;
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
  queue_tier: string | null; // 'standard' | 'priority_100'
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
  collab_note: string; // the single note to push into CollaborateMD (required to mark worked)
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
  claimed_by: string | null;
  claimed_at: string | null;
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
  collector_notes?: string; // collector's notes carried over at routing time
  from_collection: boolean;
  submitted_by: string | null;
  submitted_by_name: string | null;
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
  total_days: number | null;
  status: string;
  notes: string;
  discharged: boolean;
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

export interface Payment {
  id: string;
  facility_id: string | null;
  payment_entered: string | null;
  deposit_date: string | null;
  patient_name: string | null;
  member_id: string | null;
  cpt_description: string | null;
  payment_source: string | null;
  dos_from: string | null;
  dos_to: string | null;
  charge_amount: number | null;
  paid_amount: number | null;
  payment_type: string | null;
  check_number: string | null;
  period: string | null;
  notes: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BilledClaim {
  id: string;
  facility_id: string | null;
  claim_id: string;
  times_billed: number | null;
  from_date: string | null;
  to_date: string | null;
  entered_date: string | null;
  total_amount: number | null;
  balance: number | null;
  patient_id: string | null;
  patient_name: string | null;
  payer_name: string | null;
  payer_type: string | null;
  period: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  category: string; // 'medical_records' | 'licenses_w9'
  name: string;
  path: string;
  size_bytes: number | null;
  content_type: string | null;
  facility_id: string | null;
  uploaded_by: string | null;
  created_at: string;
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

export const WATCH_AGE_THRESHOLD = 45;
export const RISK_AGE_THRESHOLD = 65;
// Claims at or past this age are the top priority tier ("100+"), worked ahead
// of the 65–99 risk band.
export const PRIORITY_AGE_THRESHOLD = 100;

// A collector's queue tier. "standard" works everything (100+ first, then
// 65–99, then younger). "priority_100" is a dedicated 100+ specialist: their
// queue shows only 100+ claims, capped by their daily target.
export const QUEUE_TIERS = ["standard", "priority_100"] as const;
export type QueueTier = (typeof QUEUE_TIERS)[number];

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
  "MH PHP",
  "MH IOP",
  "MH OP",
];
export const NEGOTIATION_STATUS_OPTIONS = [
  "",
  "Pending",
  "Proposed",
  "Approved",
  "Rejected",
  "Signed",
];
export interface Census {
  id: string;
  facility_id: string | null;
  week_start: string | null;
  week_label: string | null;
  level_of_care: string | null;
  patient_name: string | null;
  admit_date: string | null;
  insurance: string | null;
  member_id: string | null;
  auth: string | null;
  comments: string | null;
  step_up: string | null;
  repriced: string | null;
  days: Record<string, string> | null;
  day_status: Record<string, string> | null; // { "YYYY-MM-DD": "billed"|"pending"|"scholarship" }
  gn_rate: number | null; // $ per GN session
  paid_amount: number | null; // $ actually paid
  billing_status: string;
  notes: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// Levels of care for the weekly census, each mapped to the GN (group note)
// sessions expected per week — this is how "Missed GN" is calculated
// (e.g. IOP 5 → 5 GN/week). Adjust the numbers here if a level differs.
export const CENSUS_LOC_GN: Record<string, number> = {
  Detox: 7,
  Residential: 7,
  "PHP 6": 6,
  "PHP MH 6": 6,
  "PHP 5": 5,
  "PHP MH 5": 5,
  "IOP 5": 5,
  "IOP MH 5": 5,
  "IOP 4": 4,
  "IOP 3": 3,
  "OP 2": 2,
  "OP 1": 1,
};
export const CENSUS_LOC_OPTIONS = ["", ...Object.keys(CENSUS_LOC_GN)];

export const CENSUS_BILLING_STATUS = [
  "",
  "Not Billed",
  "Ready to Bill",
  "Biller Awaiting Something",
  "Billed",
  "Self Pay",
  "Paid",
  "Partial Paid",
  "Write Off",
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
