// TRIO AI Agent - Background Script for Job Matching

let isRunning = false;
let config = {};
let targetTabId = null;

// Persistent State arrays
let collectedJobs = [];
let instanceLogs = [];
let lastConfig = null;
let currentPage = 1;
let totalProcessedCount = 0;

// Load state from Chrome Storage
async function loadState() {
  const data = await chrome.storage.local.get(['collectedJobs', 'instanceLogs', 'lastConfig', 'currentPage', 'isRunning', 'config', 'totalProcessedCount']);
  collectedJobs = data.collectedJobs || [];
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
    collectedJobs,
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
    (async () => {
      await loadState();
      sendResponse({ 
        isRunning, 
        logs: instanceLogs,
        count: collectedJobs.length 
      });
    })();
    return true; 
  } else if (request.action === 'startSearch') {
    startProcess(request.payload);
    sendResponse({ status: 'started' });
  } else if (request.action === 'stopSearch') {
    stopProcess();
    sendResponse({ status: 'stopped' });
  } else if (request.action === 'jobFound') {
    (async () => {
      totalProcessedCount++;
      
      let jobLabel = request.job.title + ' @ ' + request.job.company;
      sendLog(`[AI] Evaluating #${totalProcessedCount}: ${jobLabel}...`);
      
      const result = await evaluateJobWithAI(request.job, config);
      if (result) {
        request.job.score = result.score;
        request.job.decision = result.decision;
        request.job.reasoning = result.reasoning;
        
        // Save all jobs to array, not just Fits
        collectedJobs.push(request.job);
        saveState();

        if (result.decision === 'Fit' && result.score >= 70) {
          sendLog(`⭐ MATCH! [Score ${result.score}/100]: ${jobLabel} FIT!`);
        } else {
          sendLog(`❌ PASS [Score ${result.score}/100]: ${result.reasoning}`);
        }
        sendResponse(result);
      } else {
        sendResponse(null);
      }
    })();
    return true;
  } else if (request.action === 'fetchNextPage') {
    (async () => {
      await loadState();
      currentPage++;
      saveState();
      sendLog(`Moving to job page ${currentPage}...`);
    })();
  } else if (request.action === 'downloadCsv') {
    (async () => {
      await loadState();
      generateAndDownloadCsv(request.filter);
      sendResponse({ status: 'done' });
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
    collectedJobs = [];
    instanceLogs = [];
    currentPage = 1;
    totalProcessedCount = 0;
    lastConfig = { targetJob: payload.targetJob, cvDetails: payload.cvDetails, country: payload.country };
  }
  
  config = payload;
  isRunning = true;
  saveState(); 
  
  if (isResume && currentPage > 1) {
    sendLog(`Resuming Job Match exactly from Page ${currentPage}...`);
  } else {
    sendLog(`Starting AI Job Search for: ${config.targetJob}`);
  }

  let searchUrl = '';

  if (config.platform === 'indeed') {
    let exactRole = config.targetJob.trim();
    let loc = config.country !== 'Anywhere' ? config.country : '';
    let cityStr = (config.cities && config.cities.length > 0) ? config.cities.join(', ') : '';
    let searchLoc = cityStr ? cityStr : loc;
    
    // Map country to Indeed domain
    let domain = 'www.indeed.com'; // Default
    if (config.country === 'UAE') domain = 'ae.indeed.com';
    else if (config.country === 'KSA') domain = 'sa.indeed.com';
    else if (config.country === 'EGY') domain = 'eg.indeed.com';
    else if (config.country === 'QAT') domain = 'qa.indeed.com';
    else if (config.country === 'IND') domain = 'in.indeed.com';
    else if (config.country === 'UK') domain = 'uk.indeed.com';
    else if (config.country === 'USA') domain = 'www.indeed.com';

    // &fromage=1 means last 24 hours on Indeed
    searchUrl = `https://${domain}/jobs?q=${encodeURIComponent(exactRole)}&l=${encodeURIComponent(searchLoc)}&fromage=1`;
    if (currentPage > 1) {
      searchUrl += `&start=${(currentPage - 1) * 10}`; // Indeed often paginates by 10
    }
  } else {
    // LinkedIn Job Search URL
    let exactRole = config.targetJob.trim();
    let loc = config.country !== 'Anywhere' ? config.country : 'Worldwide';
    let cityStr = (config.cities && config.cities.length > 0) ? config.cities.join(', ') : '';
    let searchLoc = cityStr ? `${cityStr}, ${loc}` : loc;
    
    // f_TPR=r86400 is Past 24 hours, f_AL=true forces Easy Apply, distance=100 forces 160km max radius
    searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(exactRole)}&location=${encodeURIComponent(searchLoc)}&distance=100&f_AL=true&f_TPR=r86400`;
    if (currentPage > 1) {
      searchUrl += `&start=${(currentPage - 1) * 25}`; // LinkedIn paginates by 25
    }
  }

  chrome.tabs.create({ url: searchUrl, active: true }, (tab) => {
    targetTabId = tab.id;
    
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === targetTabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        sendLog("Target job page attached. Injecting extraction protocols...");
        
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
    chrome.tabs.sendMessage(targetTabId, { action: "stopScraping" }, () => {});
  }
}

// ----------------------------------------------------
// AI Evaluation
// ----------------------------------------------------
async function evaluateJobWithAI(job, config) {
  const prompt = `
You are an expert, meticulous AI career advisor. Evaluate this Job Description based strictly on the candidate's CV and skills.

Candidate Profile:
Target Role: ${config.targetJob}
Location Preference: ${config.country} ${config.cities && config.cities.length > 0 ? config.cities.join(', ') : ''}
CV / Skills / Tools: ${config.cvDetails}

Job Being Evaluated:
Job Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Job Description:
${job.description}

CRITICAL INSTRUCTIONS:
1. REQUIRED SKILLS vs PROVIDED SKILLS: Deeply and comprehensively scan the entire CV for ANY mention of the Job's required skills.
2. SEMANTIC & FLEXIBLE MATCHING (VERY IMPORTANT): Do NOT require exact keyword matches. If a candidate lists an equivalent technology, general concept, or implies knowledge (e.g., "GCP" counts for "AWS", "Java" implies "OOP"), count it as a MATCH. You must be highly generous in linking related skills.
3. BENEVOLENT DATE PARSING: Candidates often paste messy CVs with contradictory "years of experience" (e.g. saying "3 years" at the top but "8 years" at the bottom). ALWAYS give the candidate the benefit of the doubt. If a specific required technology or timeframe is mentioned anywhere in their text, assume they meet the requirement. Do NOT aggressively disqualify based on strict year counting.
4. SCORING RULES:
   - LOCATION MATCH RULE: If the job is in a completely different continent/country from their preference, deduct points.
   - FATAL MISMATCH: Only score BELOW 70 if the profile is fundamentally a different career (e.g., Job wants a Nurse, Candidate is a C++ Coder).
   - SUCCESS MATCH: If the candidate possesses a reasonable cluster of the core technologies, concepts, or equivalent skills required by the JD, SCORE HIGH (70-100). Default to passing (>=70) if there is decent overlap.
5. Provide the evaluation in the specific JSON format requested below.

Output ONLY a valid JSON object exactly like this:
{
  "score": (0-100),
  "decision": "Fit" or "No Fit",
  "reasoning": "1 concise sentence. Explicitly state the overlap or missing skills."
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
You must answer a specific job application question based on the candidate's CV and configuration.

Candidate's CV/Resume:
${config.cvDetails || 'No CV provided. Answer generically based on the target role.'}

Candidate's Specific Directives:
Expected Salary (If asked): ${config.expectedSalary || 'N/A'}
Has Driver's License (If asked): ${config.driverLicense ? 'Yes' : 'No'}

Question: "${question}"
Input Type: ${inputType}
Available Options: ${options && options.length > 0 ? options.join(', ') : 'None (Free text field)'}

CRITICAL RULES:
1. If the Input Type is 'select' or 'radio', you MUST pick exactly one of the Available Options. Your answer must exactly match the option string.
2. EXTREMELY IMPORTANT: If the Question asks "How many years", "How many", or anything quantitative, YOU MUST RETURN ONLY DIGITS. DO NOT WRITE SENTENCES. Return "3" instead of "I have 3 years".
3. If it's a free text field, write a concise, professional answer (1-2 sentences maximum). If the question is obviously asking for a number, follow rule 2.
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
function generateAndDownloadCsv(filterType) {
  let listToExport = collectedJobs;
  if (filterType === 'fit') {
    listToExport = collectedJobs.filter(j => j.decision === 'Fit' && j.score >= 70);
  }

  if (listToExport.length === 0) {
    sendLog(`No jobs available for the selected export (${filterType}).`);
    return;
  }

  const headers = ["Job Title", "Company", "Location", "Time Posted", "Applicant Count", "AI Match Score", "AI Decision", "AI Reasoning", "Job Link"];
  const rows = listToExport.map(j => [
    `"${(j.title || '').replace(/"/g, '""')}"`,
    `"${(j.company || '').replace(/"/g, '""')}"`,
    `"${(j.location || '').replace(/"/g, '""')}"`,
    `"${(j.timePosted || '').replace(/"/g, '""')}"`,
    `"${(j.applicantCount || '').replace(/"/g, '""')}"`,
    j.score,
    `"${(j.decision || '').replace(/"/g, '""')}"`,
    `"${(j.reasoning || '').replace(/"/g, '""')}"`,
    `"${(j.link || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const reader = new FileReader();

  reader.onload = function() {
    let prefix = filterType === 'fit' ? 'TRIO_Matches' : 'TRIO_All_Jobs';
    chrome.downloads.download({
      url: reader.result,
      filename: `${prefix}_${(config.targetJob || 'Export').replace(/ /g, '_')}_${new Date().getTime()}.csv`,
      saveAs: true
    });
  };
  reader.readAsDataURL(blob);
}

function sendLog(text) {
  console.log(text);
  instanceLogs.push(text);
  if (instanceLogs.length > 50) instanceLogs.shift();
  saveState(); 
  chrome.runtime.sendMessage({ type: 'log', text });
}
