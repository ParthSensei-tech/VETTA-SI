import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/platform/auth/middleware";
import { getSql } from "@/platform/db";
import { ROLE_TEMPLATES } from "./constants";
import type { PipelineStatus, RankResult, ScreenEvaluation, ScreenQuestion } from "./types";

function nid(): string {
  return crypto.randomUUID();
}

type LiveApplicant = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  currentTitle: string;
  currentCompany: string;
  yearsExperience: string;
  noticePeriod: string;
  expectedCtc: string;
  coverNote: string;
  resumeText: string;
  tier: "strong" | "medium" | "weak";
};

export type LiveCandidateResult = {
  name: string;
  email: string;
  roleTitle: string;
  companyName: string;
  rankScore: number | null;
  rankLevel: string;
  rankSummary: string;
  gaps: string[];
  evidence: string[];
  questions: Array<{ id: string; intent: string; prompt: string }>;
  answers: Array<{ question_id: string; answer: string }>;
  screenScore: number | null;
  screenVerdict: string;
  screenStrengths: string[];
  screenConcerns: string[];
  decision: PipelineStatus;
  reasoning: string;
};

export type LivePipelineReport = {
  jobs: Array<{
    roleId: string;
    title: string;
    companyName: string;
    shortlisted: number;
    hold: number;
    rejected: number;
    candidates: LiveCandidateResult[];
  }>;
};

function answersFor(tier: LiveApplicant["tier"], title: string): string[] {
  if (tier === "strong") {
    return [
      `I owned the work for ${title} end-to-end. Last cycle I moved a real number (pipeline, activation, or reliability), wrote the artefact the team still uses, and told the founder what to kill. I would still add a weekly scorecard.`,
      `First 90 days: one loop, one metric, clear artefacts. I sit with customers and the founder weekly. I refuse busywork that does not move the seat.`,
      `The ranking gap is real. Six-week plan: do the work in public — a sequence, a spec, a close, or a hire — and show evidence in week two, not a course list.`,
      `A founder wanted to skip the unglamorous step. I pushed back with a number. We shipped the boring path first; the shiny one came later.`,
    ];
  }
  if (tier === "medium") {
    return [
      `We had a messy quarter last year. I helped recover and reported up. I monitored the dashboard afterwards.`,
      `I would learn the playbook and ship small pieces for ${title} in the first 90 days.`,
      `I would take a course on the missing craft items and pair with a senior.`,
      `I usually align with the lead so we keep velocity.`,
    ];
  }
  return [
    `Not much ownership of this motion yet.`,
    `Still learning this craft.`,
    `I would study documentation and tutorials.`,
    `I prefer clear instructions from seniors.`,
  ];
}

function decide(
  rank: RankResult | null,
  evaluation: ScreenEvaluation | null,
): {
  status: PipelineStatus;
  reasoning: string;
} {
  const score = rank?.score ?? 0;
  const level = rank?.level ?? "no";
  const screen = evaluation?.score ?? 0;
  const verdict = evaluation?.verdict ?? "No screen";
  const gaps = (rank?.gaps ?? []).slice(0, 2).join("; ") || "insufficient evidence";
  if ((level === "yes" || level === "strong_yes") && screen >= 55) {
    return {
      status: "shortlisted",
      reasoning: `Rank ${score} (${level}) + screen ${screen} (${verdict}). Craft and ownership evidence support advancing.`,
    };
  }
  if (level === "maybe" && screen >= 60) {
    return {
      status: "hold",
      reasoning: `Borderline rank ${score}; screen ${screen} is decent — hold for a human read.`,
    };
  }
  if (level === "no" || score < 50) {
    return {
      status: "rejected",
      reasoning: `Rank ${score} (${level}). Gaps: ${gaps}.`,
    };
  }
  if (screen < 50) {
    return {
      status: "rejected",
      reasoning: `Screen too thin (${screen}: ${verdict}) despite rank ${score}.`,
    };
  }
  return {
    status: "hold",
    reasoning: `Rank ${score} / screen ${screen} — not enough signal to shortlist without a human.`,
  };
}

function gtmApplicants(): LiveApplicant[] {
  const rows: Array<[string, string, string, LiveApplicant["tier"], string, string, string]> = [
    ["Arjun Nair", "Bengaluru", "Account Executive", "strong", "Razorpay", "8", "30 days"],
    ["Priya Mehta", "Pune", "Enterprise AE", "strong", "Chargebee", "9", "60 days"],
    ["Rohan Sharma", "Hyderabad", "Sales Executive", "medium", "Infosys", "6", "90 days"],
    ["Ananya Iyer", "Delhi", "Frontend Developer", "weak", "Agency", "3", "immediate"],
    ["Vikram Reddy", "Bengaluru", "SDR", "medium", "Freshworks", "5", "60 days"],
    ["Sneha Patel", "Bengaluru", "Founding Seller", "strong", "Seed SaaS", "7", "30 days"],
    ["Karthik Singh", "Mumbai", "Graduate", "weak", "Campus", "0.5", "immediate"],
    ["Meera Gupta", "Chennai", "Inside Sales", "medium", "Zoho", "6", "45 days"],
    ["Aditya Krishnan", "Bengaluru", "Senior AE", "strong", "Postman", "9", "60 days"],
    ["Divya Joshi", "Noida", "QA Engineer", "weak", "Services firm", "6", "30 days"],
    ["Suresh Banerjee", "Bengaluru", "Account Executive", "strong", "Razorpay", "8", "30 days"],
    ["Nisha Desai", "Pune", "Enterprise AE", "strong", "Chargebee", "9", "45 days"],
    ["Rahul Kulkarni", "Hyderabad", "Sales Executive", "medium", "Infosys", "6", "90 days"],
    ["Kavya Menon", "Delhi", "UI Developer", "weak", "Agency", "3", "immediate"],
    ["Amit Chatterjee", "Bengaluru", "SDR", "medium", "Freshworks", "5", "60 days"],
    ["Pooja Pillai", "Bengaluru", "Founding AE", "strong", "Fintech seed", "7", "30 days"],
    ["Nikhil Bhat", "Mumbai", "Intern", "weak", "Campus", "1", "immediate"],
    ["Isha Rao", "Chennai", "Inside Sales", "medium", "Zoho", "6", "45 days"],
    ["Dev Shah", "Bengaluru", "Senior AE", "strong", "Postman", "9", "60 days"],
    ["Ritu Verma", "Noida", "Manual QA", "weak", "Product co", "6", "30 days"],
  ];
  return rows.map((r, i) => {
    const [fullName, location, currentTitle, tier, currentCompany, yearsExperience, noticePeriod] =
      r;
    const email = `${fullName.toLowerCase().replace(/ /g, ".")}.${i}@live.vetta.test`;
    const strongResume = `${fullName}
${location}
${email} | +91 98${(10000000 + i * 17).toString().slice(0, 8)}

${currentTitle}, ${currentCompany} (2018–present)
- Closed B2B SaaS deals myself — ₹1.8 Cr closed-won last year, mid-market India
- Built outbound sequences in HubSpot; discovery notes the founder still uses
- First seller at a Seed company earlier; no SDR army, wrote the playbook
- Forecast hygiene; disqualified noise; travel across Bengaluru / Pune

Notice period: ${noticePeriod}
Current CTC: 22 LPA + variable. Expected: 26 LPA + uncapped + ESOP
${yearsExperience} years of experience
Craft: Outbound, Discovery, HubSpot, Closing
Clear written follow-ups`;
    const mediumResume = `${fullName}
${location}
${email}

${currentTitle}, ${currentCompany} (2018–present)
- Inside sales / SDR motion for enterprise accounts
- Some CRM hygiene; mixed inbound
- Worked in teams of 20+; hit activity targets more than close

B.E. / B.Com
Notice period: ${noticePeriod}
Expected CTC: 16 LPA
${yearsExperience} years of experience
Craft: Cold calling, Excel, limited HubSpot`;
    const weakResume = `${fullName}
${location}
${email}

${currentTitle}, ${currentCompany}
- Built React landing pages / QA scripts / campus projects
- No quota ownership, no discovery calls
- Looking to transition into sales

${yearsExperience} years of experience
Notice: ${noticePeriod}
Expected: 12 LPA
Craft: React, JavaScript`;
    const resumeText =
      tier === "strong" ? strongResume : tier === "medium" ? mediumResume : weakResume;
    return {
      fullName,
      email,
      phone: `98${(10000000 + i).toString().slice(0, 8)}`,
      location,
      currentTitle,
      currentCompany,
      yearsExperience,
      noticePeriod,
      expectedCtc: tier === "strong" ? "26 LPA" : tier === "medium" ? "16 LPA" : "12 LPA",
      coverNote: tier === "strong" ? "Want a founding seller seat with real quota." : "",
      resumeText,
      tier,
    };
  });
}

function productApplicants(): LiveApplicant[] {
  const rows: Array<[string, string, string, LiveApplicant["tier"], string, string, string]> = [
    ["Meera Iyer", "Bengaluru", "Product Manager", "strong", "Razorpay", "8", "30 days"],
    ["Aditya Reddy", "Bengaluru", "Senior PM", "strong", "Groww", "9", "60 days"],
    ["Nisha Gupta", "Pune", "Business Analyst", "medium", "Cognizant", "6", "90 days"],
    ["Amit Banerjee", "Delhi", "Backend Engineer", "weak", "Startup", "5", "30 days"],
    ["Isha Menon", "Hyderabad", "Product Lead", "strong", "Freshworks", "8", "45 days"],
    ["Dev Chatterjee", "Bengaluru", "Associate PM", "medium", "Amazon", "5", "60 days"],
    ["Priya Rao", "Mumbai", "UI Developer", "weak", "Agency", "2", "immediate"],
    ["Vikram Nair", "Bengaluru", "Founding PM", "strong", "Design-led startup", "7", "30 days"],
    ["Rahul Krishnan", "Chennai", "Product Analyst", "medium", "Zoho", "6", "45 days"],
    ["Rohan Shah", "Noida", "Android Developer", "weak", "Product co", "6", "30 days"],
    ["Divya Patel", "Bengaluru", "Product Manager", "strong", "Razorpay", "8", "30 days"],
    ["Ritu Pillai", "Bengaluru", "Senior PM", "strong", "Groww", "9", "60 days"],
    ["Karthik Joshi", "Pune", "Business Analyst", "medium", "Cognizant", "6", "90 days"],
    ["Sneha Verma", "Delhi", "Java Engineer", "weak", "Services", "5", "30 days"],
    ["Ananya Bhat", "Hyderabad", "Product Lead", "strong", "Freshworks", "8", "45 days"],
    ["Suresh Mehta", "Bengaluru", "Associate PM", "medium", "Amazon", "5", "60 days"],
    ["Kavya Shah", "Mumbai", "HTML/CSS Developer", "weak", "Agency", "2", "immediate"],
    ["Nikhil Iyer", "Bengaluru", "Founding Product", "strong", "Canvas startup", "7", "30 days"],
    ["Pooja Reddy", "Chennai", "Product Analyst", "medium", "Zoho", "6", "45 days"],
    ["Arjun Verma", "Noida", "Android Engineer", "weak", "App studio", "6", "30 days"],
  ];
  return rows.map((r, i) => {
    const [fullName, location, currentTitle, tier, currentCompany, yearsExperience, noticePeriod] =
      r;
    const email = `${fullName.toLowerCase().replace(/ /g, ".")}.fe${i}@live.vetta.test`;
    const strongResume = `${fullName}
${location}
${email}

${currentTitle}, ${currentCompany} (2018–present)
- Shipped operator workflows end-to-end with engineers in the room
- Ran user interviews without a research team; wrote PRDs engineers built
- SQL + Amplitude: killed two bets that missed activation
- Founding product at a Seed company earlier; weekly product review with founders

Notice period: ${noticePeriod}
${yearsExperience} years of experience
Expected: 42 LPA
Craft: User interviews, PRDs, SQL, Amplitude`;
    const mediumResume = `${fullName}
${location}
${email}

${currentTitle}, ${currentCompany} (2018–present)
- Business analysis and ticket grooming for enterprise clients
- Limited user contact; specs handed down by a director
- Some SQL dashboards; no ownership of a surface

Notice period: ${noticePeriod}
${yearsExperience} years of experience
Expected: 28 LPA
Craft: Jira, Excel, stakeholder decks`;
    const weakResume = `${fullName}
${location}
${email}

${currentTitle}, ${currentCompany}
- Pixel-perfect HTML/CSS or Kotlin apps
- No product ownership, no user interviews
- Applying from another track

${yearsExperience} years of experience
Notice: ${noticePeriod}
Expected: 18 LPA
Craft: HTML, CSS, JavaScript`;
    const resumeText =
      tier === "strong" ? strongResume : tier === "medium" ? mediumResume : weakResume;
    return {
      fullName,
      email,
      phone: `97${(20000000 + i).toString().slice(0, 8)}`,
      location,
      currentTitle,
      currentCompany,
      yearsExperience,
      noticePeriod,
      expectedCtc: tier === "strong" ? "55 LPA" : "28 LPA",
      coverNote: "",
      resumeText,
      tier,
    };
  });
}

async function processApplicant(opts: {
  userId: string;
  roleId: string;
  role: (typeof ROLE_TEMPLATES)[number] & { companyName: string };
  person: LiveApplicant;
}): Promise<LiveCandidateResult> {
  const sql = await getSql();
  const resume = [
    "APPLICANT DETAILS",
    `Name: ${opts.person.fullName}`,
    `Email: ${opts.person.email}`,
    `Phone: ${opts.person.phone}`,
    `Location: ${opts.person.location}`,
    `Current title: ${opts.person.currentTitle}`,
    `Current company: ${opts.person.currentCompany}`,
    `Years of experience: ${opts.person.yearsExperience}`,
    `Notice period: ${opts.person.noticePeriod}`,
    `Expected CTC: ${opts.person.expectedCtc}`,
    "",
    "RESUME",
    opts.person.resumeText,
  ].join("\n");

  const { generateScreen, evaluateScreen } = await import("../../features/ai/server/ai.server");
  const roleInput = {
    companyName: opts.role.companyName,
    companyStage: opts.role.companyStage,
    title: opts.role.title,
    location: opts.role.location,
    workMode: opts.role.workMode,
    compensationBand: opts.role.compensationBand,
    stack: opts.role.stack,
    mustHaves: opts.role.mustHaves,
    niceToHaves: opts.role.niceToHaves,
    jdText: opts.role.jdText,
  };
  const { rankWithProductionPrompt, safeRecordLiveRank } = await import("./harness/harness.server");
  const ranked = await rankWithProductionPrompt(opts.userId, {
    resumeText: resume,
    role: roleInput,
  });

  const profile = ranked.ok
    ? {
        ...ranked.profile,
        full_name: opts.person.fullName,
        email: opts.person.email,
        phone: opts.person.phone,
        location: opts.person.location,
        current_title: opts.person.currentTitle,
        current_company: opts.person.currentCompany,
      }
    : {
        full_name: opts.person.fullName,
        email: opts.person.email,
        phone: opts.person.phone,
        location: opts.person.location,
        linkedin_url: "",
        current_title: opts.person.currentTitle,
        current_company: opts.person.currentCompany,
        years_experience: Number(opts.person.yearsExperience) || null,
        skills: [],
        summary: "",
      };

  const candId = nid();
  const appId = nid();
  const rankJson = ranked.ok ? JSON.stringify(ranked.rank) : "{}";
  const score = ranked.ok ? ranked.rank.score : null;

  let orgId: string | null = (opts.role as { orgId?: string }).orgId ?? null;
  if (!orgId) {
    try {
      const { ensureUserOrg } = await import("./org.server");
      orgId = (await ensureUserOrg(opts.userId)).orgId;
    } catch {
      orgId = null;
    }
  }

  await sql`
    insert into candidates (
      id, user_id, org_id, full_name, email, phone, location, linkedin_url,
      current_title, current_company, years_experience, resume_text, parsed_json
    ) values (
      ${candId}, ${opts.userId}, ${orgId}, ${profile.full_name}, ${profile.email}, ${profile.phone},
      ${profile.location}, ${profile.linkedin_url ?? ""}, ${profile.current_title}, ${profile.current_company},
      ${profile.years_experience ?? null}, ${resume}, ${JSON.stringify(profile)}
    )`;
  try {
    const { indexNewCandidate } = await import("./search.server");
    await indexNewCandidate(
      candId,
      ranked.ok ? ranked.rank.india.notice_period_days : null,
      ranked.ok ? ranked.rank.india.expected_ctc_lakh : null,
    );
  } catch {
    /* indexed on the next talent search */
  }
  await sql`
    insert into applications (
      id, user_id, org_id, role_id, candidate_id, pipeline_status, rank_score, rank_json, source
    ) values (
      ${appId}, ${opts.userId}, ${orgId}, ${opts.roleId}, ${candId}, ${ranked.ok ? "ranked" : "ingested"},
      ${score}, ${rankJson}, ${"portal"}
    )`;
  if (ranked.ok) {
    await safeRecordLiveRank({
      userId: opts.userId,
      applicationId: appId,
      resumeText: resume,
      role: roleInput,
      result: ranked,
    });
  }

  const screenGen = await generateScreen({
    roleTitle: opts.role.title,
    companyName: opts.role.companyName,
    jdText: opts.role.jdText,
    stack: opts.role.stack,
    candidateName: opts.person.fullName,
    currentTitle: opts.person.currentTitle,
    rankSummary: ranked.ok ? ranked.rank.summary : "",
    screenFocus: ranked.ok ? ranked.rank.screen_focus : opts.role.mustHaves,
  });
  const questions: ScreenQuestion[] = screenGen.ok ? screenGen.questions : [];
  const rawAnswers = answersFor(opts.person.tier, opts.role.title);
  const answers = questions.map((q, idx) => ({
    question_id: q.id,
    answer: rawAnswers[idx] ?? rawAnswers[rawAnswers.length - 1] ?? "",
  }));

  let evaluation: ScreenEvaluation | null = null;
  const screenId = nid();
  if (questions.length) {
    const evaluated = await evaluateScreen({
      roleTitle: opts.role.title,
      questions,
      answers,
    });
    evaluation = evaluated.ok ? evaluated.evaluation : null;
    await sql`
      insert into screens (
        id, user_id, org_id, application_id, questions_json, answers_json, evaluation_json, status
      ) values (
        ${screenId}, ${opts.userId}, ${orgId}, ${appId}, ${JSON.stringify(questions)},
        ${JSON.stringify(answers)}, ${JSON.stringify(evaluation ?? {})}, ${evaluation ? "evaluated" : "awaiting"}
      )`;
  }

  const { status, reasoning } = decide(ranked.ok ? ranked.rank : null, evaluation);
  await sql`
    update applications set
      pipeline_status = ${status},
      recruiter_notes = ${reasoning},
      updated_at = now()
    where id = ${appId} and (org_id = ${orgId} or (org_id is null and user_id = ${opts.userId}))`;

  const rank: RankResult | null = ranked.ok ? ranked.rank : null;
  return {
    name: opts.person.fullName,
    email: opts.person.email,
    roleTitle: opts.role.title,
    companyName: opts.role.companyName,
    rankScore: score,
    rankLevel: rank?.level ?? "unranked",
    rankSummary: rank?.summary ?? "Not ranked",
    gaps: rank?.gaps ?? [],
    evidence: (rank?.evidence ?? []).map((e) => e.claim),
    questions: questions.map((q) => ({ id: q.id, intent: q.intent, prompt: q.prompt })),
    answers,
    screenScore: evaluation?.score ?? null,
    screenVerdict: evaluation?.verdict ?? "",
    screenStrengths: evaluation?.strengths ?? [],
    screenConcerns: evaluation?.concerns ?? [],
    decision: status,
    reasoning,
  };
}

export const runLivePipeline = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<LivePipelineReport> => {
    const sql = await getSql();
    const jobs = [
      { companyName: "Northbeam", templateId: "founding-ae", people: gtmApplicants() },
      { companyName: "Lumenfold", templateId: "founding-pm", people: productApplicants() },
    ] as const;

    const report: LivePipelineReport = { jobs: [] };

    for (const job of jobs) {
      const tmpl = ROLE_TEMPLATES.find((t) => t.id === job.templateId);
      if (!tmpl) throw new Error(`Missing template ${job.templateId}`);
      const roleId = nid();
      await sql`
        insert into roles (
          id, user_id, company_name, company_stage, title, location, work_mode,
          employment_type, compensation_band, stack, must_haves, nice_to_haves, jd_text, status
        ) values (
          ${roleId}, ${context.userId}, ${job.companyName}, ${tmpl.companyStage}, ${tmpl.title},
          ${tmpl.location}, ${tmpl.workMode}, ${"full_time"}, ${tmpl.compensationBand},
          ${JSON.stringify(tmpl.stack)}, ${JSON.stringify(tmpl.mustHaves)},
          ${JSON.stringify(tmpl.niceToHaves)}, ${tmpl.jdText}, ${"open"}
        )`;

      const candidates: LiveCandidateResult[] = [];
      for (const person of job.people) {
        const row = await processApplicant({
          userId: context.userId,
          roleId,
          role: { ...tmpl, companyName: job.companyName },
          person,
        });
        candidates.push(row);
      }
      candidates.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
      report.jobs.push({
        roleId,
        title: tmpl.title,
        companyName: job.companyName,
        shortlisted: candidates.filter((c) => c.decision === "shortlisted").length,
        hold: candidates.filter((c) => c.decision === "hold").length,
        rejected: candidates.filter((c) => c.decision === "rejected").length,
        candidates,
      });
    }

    await sql`
      insert into audit_events (id, user_id, entity_type, entity_id, action, meta_json)
      values (
        ${nid()}, ${context.userId}, ${"workspace"}, ${context.userId}, ${"live_pipeline"},
        ${JSON.stringify({
          jobs: report.jobs.map((j) => ({
            title: j.title,
            shortlisted: j.shortlisted,
            hold: j.hold,
            rejected: j.rejected,
          })),
        })}
      )`;

    return report;
  });
