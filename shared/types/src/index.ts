// Attack Profile Configuration (Red Team)
export interface AttackProfile {
  mode: 'headless' | 'headed';
  concurrency: number;
  requests_per_minute: number;
  warmup: boolean;
  query_strategy: {
    type: 'refine' | 'random' | 'sequential';
    edit_distance_max?: number;
  };
  pagination: {
    max_depth_per_session: number;
    rotate_sessions: boolean;
  };
  jitter_ms: [number, number];
}

// Policy Configuration (Blue Team)
export interface PolicyFeature {
  weight: number;
  threshold: number;
}

export interface PolicyActions {
  allow: { max_score: number };
  throttle: { max_score: number };
  challenge: { max_score: number };
  block: { max_score: number };
}

export interface PolicyConstraints {
  max_false_positive_rate: number;
}

export interface Policy {
  features: {
    reqs_per_min: PolicyFeature;
    unique_queries_per_hour: PolicyFeature;
    pagination_ratio: PolicyFeature;
    session_depth: PolicyFeature;
    dwell_time_avg: PolicyFeature;
    asset_warmup_missing: Omit<PolicyFeature, 'threshold'> & { threshold?: number };
  };
  actions: PolicyActions;
  constraints: PolicyConstraints;
}

// Detection Features
export interface SessionFeatures {
  sessionId: string;
  reqs_per_min: number;
  unique_queries_per_hour: number;
  pagination_ratio: number;
  session_depth: number;
  dwell_time_avg: number;
  asset_warmup_missing: boolean;
}

// Detection Actions
export type DetectorAction = 'allow' | 'throttle' | 'challenge' | 'block';

export interface DetectorResult {
  sessionId: string;
  score: number;
  action: DetectorAction;
  features: SessionFeatures;
  triggeredFeatures: string[];
}

// Traffic Profile Types
export type ProfileType = 'human' | 'naive' | 'moderate' | 'aggressive';

export interface TrafficProfile {
  name: string;
  type: ProfileType;
  isBot: boolean;
  pagesPerSession: { mean: number; stdDev: number };
  dwellTimeMs: { mean: number; stdDev: number };
  scrollBehavior: 'instant' | 'gradual';
  clickDelay: { mean: number; stdDev: number };
  loadAssets: boolean;
  searchBehavior: 'refine' | 'random' | 'sequential';
  bounceRate: number;
  concurrency?: number;
  requestsPerMinute?: number;
}

// Session Results
export interface SessionResult {
  sessionId: string;
  profileType: ProfileType;
  isBot: boolean;
  pagesRequested: number;
  pagesExtracted: number;
  searchesPerformed: number;
  detectorResults: DetectorResult[];
  wasBlocked: boolean;
  wasThrottled: boolean;
  wasChallenged: boolean;
  extractionRate: number;
  durationMs: number;
}

// Round Metrics
export interface ProfileMetrics {
  profileType: ProfileType;
  isBot: boolean;
  sessions: number;
  totalRequests: number;
  successfulExtractions: number;
  blockedRequests: number;
  throttledRequests: number;
  challengedRequests: number;
  extractionRate: number;
  avgScore: number;
  avgDwellTime: number;
}

export interface RoundMetrics {
  fightNumber: number;
  roundNumber: number;
  timestamp: string;
  profiles: ProfileMetrics[];
  humanSuccessRate: number;
  falsePositiveRate: number;
  botSuppressionRate: number;
  botExtractionRate: number;
}

// Agent Proposals
export interface AttackProfileProposal {
  changes: Partial<AttackProfile>;
  reasoning: string;
}

export interface PolicyProposal {
  changes: Partial<Policy>;
  reasoning: string;
}

// Validation Results
export interface ValidationResult {
  accepted: boolean;
  reason: string;
  beforeMetrics: RoundMetrics;
  afterMetrics: RoundMetrics;
  improvement?: {
    metric: string;
    before: number;
    after: number;
    delta: number;
  };
}

export interface RoundReport {
  fightNumber: number;
  roundNumber: number;
  timestamp: string;
  metrics: RoundMetrics;
  redProposal?: AttackProfileProposal;
  blueProposal?: PolicyProposal;
  redValidation?: ValidationResult;
  blueValidation?: ValidationResult;
  attackProfile: AttackProfile;
  policy: Policy;
  winner: 'red' | 'blue' | 'draw';
  winReason: string;
}

// Proposal History Entry for tracking previous attempts
export interface ProposalHistoryEntry {
  roundNumber: number;
  team: 'red' | 'blue';
  proposal: AttackProfileProposal | PolicyProposal;
  accepted: boolean;
  reason: string;
  metricsBefore: { extraction: number; suppression: number; fpr: number };
  metricsAfter?: { extraction: number; suppression: number; fpr: number };
}

// Request Logging
export interface RequestLog {
  sessionId: string;
  timestamp: number;
  path: string;
  method: string;
  query: Record<string, string>;
  userAgent: string;
  isAssetRequest: boolean;
}

// Product Data
export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  inStock: boolean;
}

export interface SearchResult {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Win Conditions
export interface WinConditions {
  fprThreshold: number;           // Max FPR for Blue to win (default 0.05)
  humanSuccessThreshold: number;  // Min human success for Blue validation (default 0.95)
  redWinThreshold: number;        // Min extraction for Red win (default 0.5)
  blueWinThreshold: number;       // Min suppression for Blue win (default 0.5)
}
