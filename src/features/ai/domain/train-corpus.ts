/**
 * Pure domain training corpus and benchmark dataset for Indian tech hiring AI models.
 * Zero IO, zero network, deterministic seedable splits.
 *
 * Provides:
 *  1. Unsupervised technical document corpora for domain autoencoder reconstruction.
 *  2. Supervised pairwise ranking triplets (Job, Positive, Hard Negative, Easy Negative).
 *  3. Historical hiring funnel progression outcomes for multi-head logistic models.
 *  4. Notice-period telemetry observations for Offer Guard hazard calibration.
 */

export interface RoleDocument {
  id: string;
  family: string;
  title: string;
  companyStage: string;
  stack: string[];
  mustHaves: string[];
  text: string;
}

export interface CandidateDocument {
  id: string;
  fullName: string;
  title: string;
  yearsExp: number;
  stack: string[];
  noticeDays: number;
  expectedCtcHike: number;
  resumeText: string;
}

export interface RankingTriplet {
  id: string;
  role: RoleDocument;
  positive: CandidateDocument;
  hardNegative: CandidateDocument;
  easyNegative: CandidateDocument;
}

export interface FunnelOutcomeSample {
  id: string;
  candidateId: string;
  roleId: string;
  score: number;
  familyAligned: boolean;
  noticeDays: number;
  riskCount: number;
  domainScore: number;
  screenScore: number;
  interviewPass: boolean;
  offerMade: boolean;
  joined: boolean;
  retained90: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Curated Indian Tech Roles
// ─────────────────────────────────────────────────────────────────────────────

export const TRAINING_ROLES: RoleDocument[] = [
  {
    id: "role_sre_k8s",
    family: "engineering",
    title: "Lead Site Reliability Engineer",
    companyStage: "Series B",
    stack: ["Kubernetes", "EKS", "Terraform", "Go", "Prometheus", "AWS"],
    mustHaves: ["5+ years infra/SRE", "Production Kubernetes clusters", "Multi-region AWS"],
    text: `Lead Site Reliability Engineer at high-scale Indian fintech. Architect and manage multi-region Kubernetes clusters on AWS EKS. Implement GitOps with ArgoCD, Terraform IaC, distributed tracing with OpenTelemetry, and Prometheus alerting. On-call escalation, MTTR reduction, disaster recovery protocols.`,
  },
  {
    id: "role_backend_go",
    family: "engineering",
    title: "Senior Backend Engineer (Go / Distributed Systems)",
    companyStage: "Series A",
    stack: ["Go", "Golang", "PostgreSQL", "Kafka", "gRPC", "Redis"],
    mustHaves: ["4+ years Golang", "High-throughput microservices", "Distributed consensus/Kafka"],
    text: `Senior Backend Engineer building low-latency payment rails. Design and maintain high-throughput Go microservices handling 50k+ transactions per minute. Kafka event streaming, gRPC RPC services, distributed locking with Redis, database sharding with PostgreSQL.`,
  },
  {
    id: "role_frontend_react",
    family: "engineering",
    title: "Staff Frontend Engineer",
    companyStage: "Growth / Pre-IPO",
    stack: ["React", "TypeScript", "Next.js", "Tailwind CSS", "Web Vitals", "GraphQL"],
    mustHaves: ["6+ years frontend", "Design systems at scale", "Sub-second LCP optimization"],
    text: `Staff Frontend Engineer owning customer-facing web platforms. Deep experience with React 19, Next.js App Router, SSR/ISR caching architectures, atomic design systems with Tailwind CSS, Core Web Vitals optimization, and real-time WebSocket state management.`,
  },
  {
    id: "role_ml_nlp",
    family: "engineering",
    title: "Senior Machine Learning Engineer (NLP / LLMs)",
    companyStage: "Series A",
    stack: ["Python", "PyTorch", "HuggingFace", "FastAPI", "ONNX", "Vector DBs"],
    mustHaves: ["3+ years ML production", "Transformers & LLM fine-tuning", "ONNX model serving"],
    text: `Senior ML Engineer building conversational AI and ranking engines. Fine-tune open-source LLMs (Llama, Mistral) with LoRA/QLoRA, implement RAG with vector search (pgvector, Qdrant), deploy quantized ONNX models with TensorRT, and measure embedding cosine drift.`,
  },
  {
    id: "role_product_mgr",
    family: "product",
    title: "Principal Product Manager",
    companyStage: "Series B",
    stack: ["PRDs", "Product Analytics", "A/B Testing", "Mixpanel", "Roadmapping"],
    mustHaves: ["5+ years B2B SaaS PM", "0-to-1 product discovery", "Strong data fluency"],
    text: `Principal Product Manager driving enterprise product expansion. Lead cross-functional pods across engineering, design, and GTM. Draft high-fidelity PRDs, conduct qualitative customer discovery interviews, run rigorous A/B experiments, and drive Net Revenue Retention (NRR).`,
  },
  {
    id: "role_gtm_ae",
    family: "gtm",
    title: "Enterprise Account Executive",
    companyStage: "Series B",
    stack: ["Salesforce", "Outreach", "MEDDPICC", "Enterprise Contracts"],
    mustHaves: ["4+ years enterprise SaaS sales", "Consistent $800k+ ARR quota attainment"],
    text: `Enterprise Account Executive closing enterprise SaaS deals across India and APAC. Run complex multi-stakeholder MEDDPICC sales cycles with CXOs, manage sales pipelines in Salesforce, negotiate Master Subscription Agreements, and partner with Solutions Engineers.`,
  },
  {
    id: "role_people_hrbp",
    family: "people",
    title: "Senior HR Business Partner & Talent Lead",
    companyStage: "Series A",
    stack: ["HRBP", "Performance Management", "Talent Sourcing", "Compensation Benchmarking"],
    mustHaves: ["5+ years tech HRBP", "Scaling tech headcount 50 to 200", "DPDP compliance"],
    text: `Senior HR Business Partner partnering with engineering and product leaders. Lead technical talent acquisition, conduct compensation benchmarking, manage biannual performance evaluation cycles, drive employee retention, and oversee DPDP compliance in hiring records.`,
  },
  {
    id: "role_finance_controller",
    family: "finance",
    title: "Financial Controller / Head of Finance",
    companyStage: "Series B",
    stack: ["GAAP", "Ind AS", "Statutory Audit", "FP&A", "Cap Table Management"],
    mustHaves: ["Chartered Accountant (CA)", "Venture-backed startup experience", "Audit closure"],
    text: `Head of Finance managing financial strategy and regulatory compliance. Direct statutory audits under Ind AS, oversee monthly FP&A reporting, manage venture investor relations and cap table updates, coordinate tax filings, and maintain rolling cash runway models.`,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 2. Curated Candidate Documents (Positives, Hard Negatives, Easy Negatives)
// ─────────────────────────────────────────────────────────────────────────────

export const TRAINING_CANDIDATES: CandidateDocument[] = [
  // --- SRE & Cloud Candidates ---
  {
    id: "cand_sre_lead",
    fullName: "Vikram Sengupta",
    title: "Staff SRE & Platform Architect",
    yearsExp: 7,
    stack: ["Kubernetes", "AWS EKS", "Terraform", "Prometheus", "Go", "Helm"],
    noticeDays: 30,
    expectedCtcHike: 28,
    resumeText: `Staff SRE with 7 years managing mission-critical AWS infrastructure. Architected multi-region EKS clusters serving 100M daily API calls. Built Terraform modules for automated VPC, IAM, and security groups. Implemented Prometheus, Grafana, and OpenTelemetry distributed tracing. Automated cluster node provisioning reducing compute costs by 34%. Reduced MTTR by 45% with automated rollback scripts.`,
  },
  {
    id: "cand_sre_hard_negative",
    fullName: "Ramesh Kulkarni",
    title: "IT Infrastructure & Desktop Support Lead",
    yearsExp: 8,
    stack: ["Windows Server", "Active Directory", "VMware vSphere", "LAN/WAN", "Cisco"],
    noticeDays: 60,
    expectedCtcHike: 15,
    resumeText: `Senior IT Infrastructure Manager with 8 years overseeing enterprise office networks and Windows Server environments. Managed Active Directory domains, Office 365 migrations, and VMware virtual machines. Maintained corporate firewalls, patch management, and local backup arrays. Handled vendor hardware procurement and IT asset lifecycle.`,
  },

  // --- Backend Go Candidates ---
  {
    id: "cand_backend_go_lead",
    fullName: "Divya Krishnan",
    title: "Senior Distributed Systems Engineer (Golang)",
    yearsExp: 5,
    stack: ["Go", "Golang", "Kafka", "PostgreSQL", "gRPC", "Redis", "Docker"],
    noticeDays: 30,
    expectedCtcHike: 25,
    resumeText: `Senior Golang Engineer with 5 years building scalable microservices for payments and logistics. Built high-throughput payment settlement pipelines processing 40k events/sec using Go and Apache Kafka. Optimized PostgreSQL indexing and query execution plans for sub-10ms response times. Engineered gRPC service interfaces with protobuf schemas and distributed tracing.`,
  },
  {
    id: "cand_backend_go_hard_negative",
    fullName: "Anupama Roy",
    title: "Senior Python Django Web Developer",
    yearsExp: 6,
    stack: ["Python", "Django", "MySQL", "jQuery", "HTML5", "Celery"],
    noticeDays: 90,
    expectedCtcHike: 45,
    resumeText: `Senior Web Developer with 6 years experience building content management and ecommerce platforms using Python Django and MySQL. Implemented Django template views, Celery asynchronous email tasks, and REST APIs. Built internal analytics dashboards with jQuery and Bootstrap. Managed MySQL database backups and Apache web server configurations.`,
  },

  // --- Frontend React Candidates ---
  {
    id: "cand_frontend_staff",
    fullName: "Aditya Malhotra",
    title: "Staff Frontend Architect",
    yearsExp: 7,
    stack: ["React", "TypeScript", "Next.js", "Tailwind CSS", "Redux Toolkit", "Web Vitals"],
    noticeDays: 45,
    expectedCtcHike: 30,
    resumeText: `Staff Frontend Engineer with 7 years specializing in high-performance web applications. Architected enterprise SaaS UI using React 19, TypeScript, and Next.js App Router. Reduced Largest Contentful Paint (LCP) from 3.8s to 1.1s across core dashboard flows. Built accessible design system components adhering to WCAG 2.1 AA with Tailwind CSS. Mentored 8 junior and mid-level frontend engineers.`,
  },
  {
    id: "cand_frontend_hard_negative",
    fullName: "Pooja Hegde",
    title: "UI/UX Graphic Designer",
    yearsExp: 5,
    stack: ["Figma", "Adobe Illustrator", "Photoshop", "Canva", "HTML/CSS Basics"],
    noticeDays: 15,
    expectedCtcHike: 20,
    resumeText: `Visual and UI/UX Designer with 5 years crafting product visual mockups and mobile app wireframes. Designed wireframes and component UI in Figma, Adobe XD, and Illustrator. Created marketing banners, branding assets, social media creatives, and icon sets. Knowledge of basic HTML and CSS styles for handoff to software developers.`,
  },

  // --- ML NLP Candidates ---
  {
    id: "cand_ml_lead",
    fullName: "Dr. Sandeep Banerjee",
    title: "Principal Machine Learning Engineer (NLP)",
    yearsExp: 6,
    stack: ["Python", "PyTorch", "HuggingFace", "Transformers", "FastAPI", "ONNX", "pgvector"],
    noticeDays: 30,
    expectedCtcHike: 32,
    resumeText: `Principal ML Engineer with 6 years deploying deep learning models to production. Trained and fine-tuned multilingual transformer models (BERT, RoBERTa, Llama-3) using PyTorch and HuggingFace. Quantized models with ONNX Runtime and TensorRT achieving 4x latency reduction. Built real-time semantic retrieval pipeline with pgvector and cosine distance metrics. Published 3 papers in ACL/EMNLP conferences.`,
  },
  {
    id: "cand_ml_hard_negative",
    fullName: "Rohan Deshmukh",
    title: "Data Analyst & Business Intelligence Specialist",
    yearsExp: 5,
    stack: ["SQL", "PowerBI", "Tableau", "Excel", "Python (Pandas)"],
    noticeDays: 60,
    expectedCtcHike: 18,
    resumeText: `Senior Business Intelligence Analyst with 5 years creating executive reporting dashboards. Built SQL queries and ETL stored procedures across data warehouses. Designed interactive revenue and customer churn dashboards in PowerBI and Tableau. Conducted cohort analyses in Excel and Pandas to present monthly churn trends to leadership.`,
  },

  // --- Easy Negative / Distractor Candidates ---
  {
    id: "cand_distractor_chef",
    fullName: "Antonio De Souza",
    title: "Executive Head Pastry Chef",
    yearsExp: 10,
    stack: ["Culinary Management", "Pastry Formulation", "HACCP Hygiene", "Kitchen Inventory"],
    noticeDays: 15,
    expectedCtcHike: 15,
    resumeText: `Award-winning Executive Pastry Chef with 10 years directing luxury hotel bakery operations. Formulated artisanal French patisserie, sourdough breads, and chocolate confections. Managed kitchen staff, ingredient sourcing, HACCP safety compliance, and seasonal banquet menus.`,
  },
  {
    id: "cand_distractor_nurse",
    fullName: "Priya Nair",
    title: "Lead ICU Registered Nurse",
    yearsExp: 7,
    stack: ["Critical Care", "Patient Triage", "Ventilator Protocols", "Clinical Records"],
    noticeDays: 30,
    expectedCtcHike: 12,
    resumeText: `Critical Care Registered Nurse with 7 years managing emergency and surgical intensive care units. Administered intravenous medication protocols, monitored hemodynamic telemetry, and assisted surgical teams. Supervised hospital ward shifts and clinical patient compliance documentation.`,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 3. Supervised Triplet Generator (With Hard Negative Mining)
// ─────────────────────────────────────────────────────────────────────────────

export const RANKING_TRIPLETS: RankingTriplet[] = [
  {
    id: "triplet_sre",
    role: TRAINING_ROLES[0]!, // SRE K8s
    positive: TRAINING_CANDIDATES[0]!, // Vikram Sengupta (SRE)
    hardNegative: TRAINING_CANDIDATES[1]!, // Ramesh Kulkarni (IT Desktop Support)
    easyNegative: TRAINING_CANDIDATES[8]!, // Chef
  },
  {
    id: "triplet_go",
    role: TRAINING_ROLES[1]!, // Backend Go
    positive: TRAINING_CANDIDATES[2]!, // Divya Krishnan (Golang Distributed)
    hardNegative: TRAINING_CANDIDATES[3]!, // Anupama Roy (Python Django)
    easyNegative: TRAINING_CANDIDATES[9]!, // Nurse
  },
  {
    id: "triplet_frontend",
    role: TRAINING_ROLES[2]!, // Frontend React
    positive: TRAINING_CANDIDATES[4]!, // Aditya Malhotra (Staff React/Next.js)
    hardNegative: TRAINING_CANDIDATES[5]!, // Pooja Hegde (UI Designer / Illustrator)
    easyNegative: TRAINING_CANDIDATES[8]!, // Chef
  },
  {
    id: "triplet_ml",
    role: TRAINING_ROLES[3]!, // ML NLP
    positive: TRAINING_CANDIDATES[6]!, // Sandeep Banerjee (PyTorch/NLP)
    hardNegative: TRAINING_CANDIDATES[7]!, // Rohan Deshmukh (BI / Tableau)
    easyNegative: TRAINING_CANDIDATES[9]!, // Nurse
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 4. Funnel Outcome Training Telemetry (Calibration & Outcome Heads)
// ─────────────────────────────────────────────────────────────────────────────

export const FUNNEL_TRAINING_SAMPLES: FunnelOutcomeSample[] = [
  // ─── Stage 4 Completion: Joined & Retained 90+ Days (Strong Positives) ───
  {
    id: "funnel_sample_1",
    candidateId: "cand_sre_lead",
    roleId: "role_sre_k8s",
    score: 94,
    familyAligned: true,
    noticeDays: 30,
    riskCount: 0,
    domainScore: 90,
    screenScore: 92,
    interviewPass: true,
    offerMade: true,
    joined: true,
    retained90: true,
  },
  {
    id: "funnel_sample_2",
    candidateId: "cand_backend_go_lead",
    roleId: "role_backend_go",
    score: 91,
    familyAligned: true,
    noticeDays: 30,
    riskCount: 0,
    domainScore: 88,
    screenScore: 89,
    interviewPass: true,
    offerMade: true,
    joined: true,
    retained90: true,
  },
  {
    id: "funnel_sample_3",
    candidateId: "cand_frontend_staff",
    roleId: "role_frontend_react",
    score: 88,
    familyAligned: true,
    noticeDays: 30,
    riskCount: 0,
    domainScore: 86,
    screenScore: 86,
    interviewPass: true,
    offerMade: true,
    joined: true,
    retained90: true,
  },
  {
    id: "funnel_sample_4",
    candidateId: "cand_ml_lead",
    roleId: "role_ml_nlp",
    score: 95,
    familyAligned: true,
    noticeDays: 15,
    riskCount: 0,
    domainScore: 93,
    screenScore: 94,
    interviewPass: true,
    offerMade: true,
    joined: true,
    retained90: true,
  },

  // ─── Stage 3: Joined but Left Before 90 Days (left_90 negative for retain90) ───
  {
    id: "funnel_sample_5",
    candidateId: "cand_early_churn_1",
    roleId: "role_sre_k8s",
    score: 74,
    familyAligned: true,
    noticeDays: 45,
    riskCount: 2,
    domainScore: 70,
    screenScore: 68,
    interviewPass: true,
    offerMade: true,
    joined: true,
    retained90: false, // left before 90 days
  },
  {
    id: "funnel_sample_6",
    candidateId: "cand_early_churn_2",
    roleId: "role_frontend_react",
    score: 72,
    familyAligned: true,
    noticeDays: 60,
    riskCount: 2,
    domainScore: 66,
    screenScore: 65,
    interviewPass: true,
    offerMade: true,
    joined: true,
    retained90: false, // left before 90 days
  },

  // ─── Stage 2: Offered but Reneged / Declined (join_no negative for join) ───
  {
    id: "funnel_sample_7",
    candidateId: "cand_renege_1",
    roleId: "role_backend_go",
    score: 76,
    familyAligned: true,
    noticeDays: 90, // 90-day shopping leak
    riskCount: 2,
    domainScore: 72,
    screenScore: 75,
    interviewPass: true,
    offerMade: true,
    joined: false, // reneged during 90-day window
    retained90: false,
  },
  {
    id: "funnel_sample_8",
    candidateId: "cand_renege_2",
    roleId: "role_ml_nlp",
    score: 78,
    familyAligned: true,
    noticeDays: 90,
    riskCount: 2,
    domainScore: 75,
    screenScore: 76,
    interviewPass: true,
    offerMade: true,
    joined: false, // took counteroffer
    retained90: false,
  },

  // ─── Stage 1: Cleared Technical Screen but Dropped at Offer (offer_drop negative for offer) ───
  {
    id: "funnel_sample_9",
    candidateId: "cand_offer_drop_1",
    roleId: "role_sre_k8s",
    score: 68,
    familyAligned: true,
    noticeDays: 90,
    riskCount: 3,
    domainScore: 60,
    screenScore: 62,
    interviewPass: true,
    offerMade: false, // compensation expectations far outside budget
    joined: false,
    retained90: false,
  },
  {
    id: "funnel_sample_10",
    candidateId: "cand_offer_drop_2",
    roleId: "role_frontend_react",
    score: 66,
    familyAligned: true,
    noticeDays: 60,
    riskCount: 3,
    domainScore: 58,
    screenScore: 60,
    interviewPass: true,
    offerMade: false, // bar raiser veto
    joined: false,
    retained90: false,
  },

  // ─── Stage 0: Interview Rejections (interview_fail negative for interview) ───
  {
    id: "funnel_sample_11",
    candidateId: "cand_backend_go_hard_negative",
    roleId: "role_backend_go",
    score: 55,
    familyAligned: true,
    noticeDays: 90,
    riskCount: 3,
    domainScore: 48,
    screenScore: 45,
    interviewPass: false,
    offerMade: false,
    joined: false,
    retained90: false,
  },
  {
    id: "funnel_sample_12",
    candidateId: "cand_sre_hard_negative",
    roleId: "role_sre_k8s",
    score: 42,
    familyAligned: false,
    noticeDays: 60,
    riskCount: 3,
    domainScore: 36,
    screenScore: 38,
    interviewPass: false,
    offerMade: false,
    joined: false,
    retained90: false,
  },
  {
    id: "funnel_sample_13",
    candidateId: "cand_frontend_hard_negative",
    roleId: "role_frontend_react",
    score: 38,
    familyAligned: false,
    noticeDays: 30,
    riskCount: 4,
    domainScore: 30,
    screenScore: 32,
    interviewPass: false,
    offerMade: false,
    joined: false,
    retained90: false,
  },
  {
    id: "funnel_sample_14",
    candidateId: "cand_ml_hard_negative",
    roleId: "role_ml_nlp",
    score: 44,
    familyAligned: false,
    noticeDays: 60,
    riskCount: 3,
    domainScore: 35,
    screenScore: 36,
    interviewPass: false,
    offerMade: false,
    joined: false,
    retained90: false,
  },
  {
    id: "funnel_sample_15",
    candidateId: "cand_distractor_chef",
    roleId: "role_sre_k8s",
    score: 8,
    familyAligned: false,
    noticeDays: 15,
    riskCount: 4,
    domainScore: 5,
    screenScore: 10,
    interviewPass: false,
    offerMade: false,
    joined: false,
    retained90: false,
  },
  {
    id: "funnel_sample_16",
    candidateId: "cand_distractor_nurse",
    roleId: "role_ml_nlp",
    score: 6,
    familyAligned: false,
    noticeDays: 30,
    riskCount: 4,
    domainScore: 4,
    screenScore: 12,
    interviewPass: false,
    offerMade: false,
    joined: false,
    retained90: false,
  },
];
