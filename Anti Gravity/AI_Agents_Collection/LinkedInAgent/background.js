// LinkedIn AI Recruiter - Background Script

let isRunning = false;
let config = {};
let targetTabId = null;

// Persistent State arrays
let collectedCandidates = [];
let instanceLogs = [];
let lastConfig = null;
let currentPage = 1;
let totalProcessedCount = 0;

// Load state from Chrome Storage (Service Worker safe)
async function loadState() {
  const data = await chrome.storage.local.get(['collectedCandidates', 'instanceLogs', 'lastConfig', 'currentPage', 'isRunning', 'config', 'totalProcessedCount']);
  collectedCandidates = data.collectedCandidates || [];
  instanceLogs = data.instanceLogs || [];
  lastConfig = data.lastConfig || null;
  currentPage = data.currentPage || 1;
  isRunning = data.isRunning || false;
  config = data.config || {};
  totalProcessedCount = data.totalProcessedCount || 0;
}

// Save state to Chrome Storage
function saveState() {
  chrome.storage.local.set({
    collectedCandidates,
    instanceLogs,
    lastConfig,
    currentPage,
    isRunning,
    config,
    totalProcessedCount
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getInitialState') {
    // Because it's async, we handle it inside an IIFE
    (async () => {
      await loadState();
      sendResponse({
        isRunning,
        logs: instanceLogs,
        count: collectedCandidates.length
      });
    })();
    return true; // Keep message channel open for async response
  } else if (request.action === 'startSearch') {
    startProcess(request.payload);
    sendResponse({ status: 'started' });
  } else if (request.action === 'stopSearch') {
    stopProcess();
    sendResponse({ status: 'stopped' });
  } else if (request.action === 'candidateFound') {
    (async () => {
      totalProcessedCount++;

      let candidateLabel = request.candidate.name !== "Indeed Candidate" ? request.candidate.name : request.candidate.headline.substring(0, 35);
      sendLog(`[AI] Evaluating #${totalProcessedCount}: ${candidateLabel}...`);

      const result = await evaluateCandidateWithAI(request.candidate, config);
      if (result) {
        request.candidate.score = result.score;
        request.candidate.decision = result.decision;
        request.candidate.reasoning = result.reasoning;
        if (result.extracted_location && result.extracted_location !== "Unknown") {
          request.candidate.location = result.extracted_location;
        }

        if (result.decision === 'Fit' && result.score >= 80) {
          collectedCandidates.push(request.candidate);
          saveState();
          sendLog(`⭐ MATCH! [Score ${result.score}/100]: ${candidateLabel} FIT!`);
        } else {
          sendLog(`❌ REJECTED [Score ${result.score}/100]: ${result.reasoning}`);
        }
      }
    })();
    return true;
  } else if (request.action === 'fetchNextPage') {
    (async () => {
      await loadState();
      currentPage++;
      saveState();
      sendLog(`Navigating to search page ${currentPage}...`);
    })();
  } else if (request.action === 'downloadCsv') {
    (async () => {
      await loadState();
      generateAndDownloadCsv();
      sendResponse({ count: collectedCandidates.length });
    })();
    return true;
  } else if (request.action === 'log_from_content') {
    sendLog(`[Scraper] ${request.text}`);
  } else if (request.action === 'clearLogs') {
    instanceLogs = [];
    saveState();
  } else if (request.action === 'answerJobQuestion') {
    (async () => {
      try {
        const answer = await answerJobQuestionWithAI(request.question, request.inputType, request.options, config);
        sendResponse({ status: 'success', answer: answer });
      } catch (err) {
        sendLog(`AI Question Error: ${err.message}`);
        sendResponse({ status: 'error' });
      }
    })();
    return true;
  }
  return true;
});

async function startProcess(payload) {
  await loadState();

  let isResume = payload.isResume === true;

  if (!isResume) {
    collectedCandidates = [];
    instanceLogs = [];
    currentPage = 1;
    totalProcessedCount = 0; // Wipe the absolute metric counter
    lastConfig = { role: payload.role, requirements: payload.req, country: payload.country };
  }

  config = payload;
  isRunning = true;
  saveState(); // Commit to DB instantly

  if (isResume && currentPage > 1) {
    sendLog(`Resuming AI Search exactly from Page ${currentPage}...`);
  } else {
    sendLog(`Starting AI Search for: ${config.role}`);
  }

  let searchUrl = '';

  if (config.platform === 'indeed') {
    let exactRole = config.role.trim();
    let location = config.country !== 'Anywhere' ? config.country : '';
    let cityStr = (config.cities && config.cities.length > 0) ? config.cities.join(' ') : '';
    searchUrl = `https://resumes.indeed.com/search?q=${encodeURIComponent(`"${exactRole}"`)}&l=${encodeURIComponent(location + (cityStr ? ' ' + cityStr : ''))}`;
    if (currentPage > 1) {
      searchUrl += `&start=${(currentPage - 1) * 50}`;
    }
  } else if (config.platform === 'linkedin_jobs') {
    let location = config.country === 'Anywhere' ? 'Worldwide' : config.country;
    let exactRole = config.role.trim();
    if (config.cities && config.cities.length > 0) {
      exactRole += ` ${config.cities.join(' ')}`;
    }
    // f_AL=true forces Easy Apply filtering
    searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(exactRole)}&location=${encodeURIComponent(location)}&f_AL=true`;
    if (currentPage > 1) {
      searchUrl += `&start=${(currentPage - 1) * 25}`; // LinkedIn jobs paginate by 25
    }
  } else {
    const geoMap = {
      'UAE': '104305776',
      'KSA': '100459316',
      'EGY': '106155605',
      'QAT': '104514075',
      'IND': '102713980',
      'USA': '103644278',
      'UK': '101165590'
    };

    let location = config.country === 'Anywhere' ? 'Worldwide' : config.country;
    let exactRole = `"${config.role.trim()}"`;

    if (config.cities && config.cities.length > 0) {
      let cityQueries = config.cities.map(c => `"${c}"`).join(' OR ');
      exactRole += ` (${cityQueries})`;
    }

    let geoUrn = geoMap[config.country] || '92000000'; // worldwide fallback
    searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(exactRole)}&geoUrn=[%22${geoUrn}%22]&origin=FACETED_SEARCH`;
    if (currentPage > 1) {
      searchUrl += `&page=${currentPage}`;
    }
  }

  // Create the tab actively so the user can pass Cloudflare or Login checks
  chrome.tabs.create({ url: searchUrl, active: true }, (tab) => {
    targetTabId = tab.id;

    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === targetTabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        sendLog("Target page attached. Injecting scraper protocols...");

        chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          files: ['content.js']
        }).then(() => {
          setTimeout(() => {
            chrome.tabs.sendMessage(targetTabId, { action: "startScraping", config: config }, (res) => {
              if (chrome.runtime.lastError) {
                sendLog(`Warning: Scraper tab detached. Please restart.`);
              }
            });
          }, 2000);
        }).catch(err => {
          sendLog(`Injection Error: ${err.message}`);
          stopProcess();
        });
      }
    });
  });
}

function stopProcess() {
  isRunning = false;
  saveState();
  sendLog('Process paused by user.');
  chrome.runtime.sendMessage({ type: 'stopped' });
  if (targetTabId) {
    chrome.tabs.sendMessage(targetTabId, { action: "stopScraping" }, () => { });
  }
}

// ----------------------------------------------------
// AI Evaluation
// ----------------------------------------------------
async function evaluateCandidateWithAI(candidate, config) {
  const prompt = `
You are an expert, meticulous AI recruiter. Evaluate this candidate based strictly on the user criteria.
Job Title: ${config.role}
Job Requirements: ${config.requirements}
Target Country: ${config.country && config.country !== 'Anywhere' ? config.country : 'None'}
Target Cities: ${config.cities && config.cities.length > 0 ? config.cities.join(', ') : 'Any'}

Candidate Profile:
Name: ${candidate.name}
Headline: ${candidate.headline}
Location: ${candidate.location}
About: ${candidate.about}

CRITICAL INSTRUCTIONS:
1. MANDATORY VS OPTIONAL: Carefully read the Job Requirements. Distinguish between mandatory requirements (e.g., "must have", specific Target Companies requested, specific degrees requested, exact minimum years of experience) and optional preferences (e.g., "nice to have", "optional").
2. STRICT REQUIREMENT ENFORCEMENT: If a candidate MISSES a mandatory requirement (for example: they don't have the specific requested degree like 'BA in Accounting', or they don't work at the explicitly requested company, or they have less than the minimum years of experience), you MUST forcefully reject them (Score < 80). Do not hallucinate matches for missing companies or degrees.
3. OPTIONAL BONUSES: If a candidate meets optional requirements, increase their score (> 90). If they don't, they can still pass if they meet all mandatory requirements (Score 80-89).
4. LOCATION EXTRACTION & STRICTNESS: First, determine the candidate's actual city and country from their Profile. If specific "Target Cities" are listed (e.g. 'Dubai, Abu Dhabi'), you MUST forcefully reject (Score < 80) candidates residing in unlisted cities (e.g., 'Ajman', 'Sharjah'). If "Target Cities" is "Any", any city in the "Target Country" is perfectly acceptable.
5. FLEXIBLE ROLE MATCHING: Do not demand exact keyword matches for Job Titles if the core function matches, unless a highly specific role/company was demanded.
6. SPECIFIC COMPANY CHECK: If the user requires a specific company (e.g., 'World Eco Company'), you must explicitly search the 'About' section for this exact company. If it is missing, Score MUST be < 80.
7. SCORING: 
   - 90-100: Perfect fit. Meets all mandatory AND optional requirements.
   - 80-89: Good fit. Meets all explicit mandatory requirements (Location, Degree, Experience, Company), missing some optional.
   - Below 80: Clear mismatch. Missing ANY mandatory requirement, wrong location, wrong company, or irrelevant degree.
8. You must return ONLY a JSON object with this exact structure:
{
  "score": (0-100),
  "extracted_location": "candidate's actual city/country (extract this directly from the Location or Headline). Use 'Unknown' only if completely missing.",
  "decision": "Fit" or "No Fit",
  "reasoning": "1 concise sentence. DO NOT just say 'Title FIT!'. MUST explicitly state if they match or fail the mandatory requirements (like company and degree)."
}
`;

  try {
    const result = await callOpenAI(prompt, config.key);
    return result;
  } catch (err) {
    sendLog(`AI Connection Error: ${err.message}`);
    return { score: 0, decision: "Error", reasoning: err.message };
  }
}

async function answerJobQuestionWithAI(question, inputType, options, config) {
  const prompt = `
You are an AI assistant helping a candidate apply for a job.
You must answer a specific job application question based on the candidate's CV.

Candidate's CV/Resume:
${config.cvText || 'No CV provided. Answer generically.'}

Candidate's Specific Directives:
Expected Salary (If asked): ${config.expectedSalary || 'N/A'}
Has Driver's License (If asked): ${config.driverLicense ? 'Yes' : 'No'}

Question: "${question}"
Input Type: ${inputType}
Available Options: ${options && options.length > 0 ? options.join(', ') : 'None (Free text field)'}

CRITICAL RULES:
1. If the Input Type is 'select' or 'radio', you MUST pick exactly one of the Available Options. Your answer must exactly match the option string.
2. If it's a numeric field (like years of experience), return just the number inferred from the CV. E.g., "3".
3. If it's a free text field, write a concise, professional answer (1-2 sentences maximum).
4. If it asks about Visa sponsorship, assume "No, I do not need sponsorship" unless specified.
5. If it asks about Disability/Veteran, assume "Decline to identify" or "No".
6. Return ONLY a JSON object.

Structure:
{ "answer": "your exact answer here" }
`;

  try {
    const result = await callOpenAI(prompt, config.key);
    return result.answer || "";
  } catch (err) {
    sendLog(`AI Connection Error during Q&A: ${err.message}`);
    return "";
  }
}

async function callOpenAI(prompt, apiKey) {
  const url = `https://api.openai.com/v1/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  const textVal = data.choices[0].message.content;
  return JSON.parse(textVal);
}

// ----------------------------------------------------
// Data Handling & CSV Export
// ----------------------------------------------------
async function handleCandidate(candidate) {
  await loadState(); // Ensure we have latest if worker slept
  if (!isRunning) return;

  try {
    const assessment = await evaluateCandidateWithAI(candidate, config);
    sendLog(`[${assessment.score}/100] ${candidate.name} -> ${assessment.decision}`);

    candidate.score = assessment.score;
    candidate.decision = assessment.decision;
    candidate.reasoning = assessment.reasoning;

    collectedCandidates.push(candidate);
    saveState(); // Commit candidate instantly!
  } catch (e) {
    sendLog(`Failed to parse ${candidate.name}.`);
  }
}

function generateAndDownloadCsv() {
  if (collectedCandidates.length === 0) {
    sendLog("No prospects collected yet. Waiting for targets...");
    return;
  }

  const headers = ["Name", "Profile Link", "Headline", "Location", "AI Match Score", "AI Decision", "AI Reasoning"];
  const rows = collectedCandidates.map(c => [
    `"${c.name.replace(/"/g, '""')}"`,
    `"${c.link.replace(/"/g, '""')}"`,
    `"${c.headline.replace(/"/g, '""')}"`,
    `"${c.location.replace(/"/g, '""')}"`,
    c.score,
    `"${c.decision.replace(/"/g, '""')}"`,
    `"${c.reasoning.replace(/"/g, '""')}"`
  ]);

  const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const reader = new FileReader();

  reader.onload = function () {
    chrome.downloads.download({
      url: reader.result,
      filename: `PSI_AI_Target_${(config.role || 'Export').replace(/ /g, '_')}_${new Date().getTime()}.csv`,
      saveAs: true
    });
  };
  reader.readAsDataURL(blob);
}

function sendLog(text) {
  console.log(text);
  instanceLogs.push(text);
  if (instanceLogs.length > 50) instanceLogs.shift();
  saveState(); // Save logs so popup always has them
  chrome.runtime.sendMessage({ type: 'log', text });
}
