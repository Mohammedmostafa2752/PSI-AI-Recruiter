import markdown
from xhtml2pdf import pisa
import sys

# Complete source descriptions
content = """
# LinkedIn & Indeed AI Agent: Complete Source Explanation
This document explains the entire architecture of the AI candidate sourcing agent. It breaks down every file we created, and includes the actual source code with inline explanations next to the most important logic.

---

## 1. Extension Manifest (`manifest.json`)
Every Chrome extension requires a Manifest. This file tells Chrome what permissions the extension needs (like `storage` to save data, and `activeTab` to interact with pages), where the service worker is (`background.js`), and which domains the extension is allowed to communicate with.
```json
{
  "manifest_version": 3,
  "name": "LinkedIn AI Recruiter Agent",
  "version": "1.0",
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://www.linkedin.com/*", "https://*.indeed.com/*"],
      "js": ["content.js"]
    }
  ],
  "permissions": ["activeTab", "scripting", "storage", "downloads"],
  "host_permissions": ["https://www.linkedin.com/*", "https://*.indeed.com/*", "https://api.openai.com/*"]
}
```

---

## 2. The User Interface (`popup.html` & `popup.js`)
The **Popup** is the frontend configuration dashboard. 

### Why is this important?
The user inputs their job requirements here. We mapped out physical UI objects (like drop downs for 'Country' and checkboxes for 'Cities') that seamlessly dynamically update. Once the Start button is pressed, all of this configuration is packaged into a `payload` and sent through Chrome's background message system.

### Key Logic in Popup
```javascript
// Gathering all the user's constraints and formatting them into a neat payload object
function getPayload() {
    const role = roleInput.value === 'CustomRole' ? customRole.value.trim() : roleInput.value;
    const req = reqInput.value.trim();
    const platform = platformSelect.value;
    const model = aiModelSelect.value;
    const key = apiInput.value.trim();
    
    // We parse whether they want 'Anywhere' or a specific list of checkboxes
    let country = countrySelect.value === 'Anywhere' ? customCountry.value.trim() : countrySelect.value;
    let cities = getSelectedCities();

    return { role, requirements: req, model, key, country, cities, platform };
}

// Emitting the "startSearch" event to the background script
startBtn.addEventListener('click', () => {
    let p = getPayload();
    p.isResume = false; // "isResume" tells the agent if this is a fresh start or continuing an old search
    chrome.runtime.sendMessage({ action: 'startSearch', payload: p });
});
```

---

## 3. The Brain & API Manager (`background.js`)

This is a permanent, hidden script. It manages the fundamental state of the operation, holding variables like `collectedCandidates`, `currentPage`, and `isRunning`. 

### The Storage System
```javascript
// We frequently pull/push data from Chrome's permanent Local Storage.
// This prevents data loss if a user accidentally closes their browser.
async function loadState() {
  const data = await chrome.storage.local.get(['collectedCandidates', 'instanceLogs', 'currentPage', 'isRunning', 'config']);
  collectedCandidates = data.collectedCandidates || [];
  // ...
}
```

### Routing & Tab Creation
When we receive the Start command, the Brain computes the physical URL of the search platform. For LinkedIn, it uses Geographic URNs (like UAE = `104305776`).
```javascript
// We literally open a new Chrome tab, making it "active: true". 
// This forces it to the foreground so the user passes Cloudflare checks.
chrome.tabs.create({ url: searchUrl, active: true }, (tab) => {
    targetTabId = tab.id;
    // We then inject the 'content.js' logic strictly into this tab.
    chrome.scripting.executeScript({ target: { tabId: targetTabId }, files: ['content.js'] });
});
```

### The AI Evaluation Engine
This is the heart of the agent. The AI Prompt uses **Zero-Shot strict classification rules** based completely on what we learned about OpenAI's propensity to "hallucinate". It forces the AI to output JSON only.
```javascript
async function evaluateCandidateWithAI(candidate, config) {
  const prompt = `
You are an expert, meticulous AI recruiter. Evaluate this candidate based strictly on the user criteria.
...
CRITICAL INSTRUCTIONS:
1. MANDATORY VS OPTIONAL: Distinguish between mandatory requirements (e.g., "must have") vs preferences.
2. STRICT REQUIREMENT ENFORCEMENT: Forcefully reject (Score < 80) if they miss a specific requested degree like 'BA in Accounting' or exact company name. Do not hallucinate matches.
4. LOCATION EXTRACTION: Determine the candidate's actual city and country. If specific 'Target Cities' restrict it, you MUST forcefully reject (Score < 80) if they live outside of those cities.

8. Format JSON Object Output: 
{ "score": (0-100), "extracted_location": "...", "decision": "Fit" | "No Fit", "reasoning": "..." }
`;

  // We connect to OpenAI API using Fetch
  const response = await fetch('https://api.openai.com/v1/chat/completions', { ... });
  // ...
}
```

---

## 4. The DOM Scraper (`content.js`)
This script executes *inside* the layout of LinkedIn or Indeed. It behaves exactly like a human: waiting for elements, reading the visual text, scrolling down to lazy-load elements, and clicking the "Next Page" button.

### Visual Architecture Over HTML Class Reliance
LinkedIn randomizes HTML classes extensively to protect against scripts. Because of this, we ignore CSS class selectors entirely when interpreting candidate cards, and instead use string manipulation (finding where the name string is visually positioned, then grabbing the next strings underneath it for Headline and Location).
```javascript
// A totally class-agnostic visual hierarchy parser
let rawText = card.innerText || "";
let lines = rawText.split('\\n').map(l => l.trim()).filter(l => l.length > 0);

// Visual Law of LinkedIn Search Cards:
// Position 1 (After the name string) is ALWAYS the Headline.
// Position 2 is ALWAYS the Location.
// Position 3 is ALWAYS the Summary or Past/Current Role snippet.

if (validLines.length > 0) headline = validLines[0];
if (validLines.length > 1) location = validLines[1];
if (validLines.length > 2) about = validLines.slice(2, 4).join(' | ');

// Send candidate back up to background.js
candidates.push({ name, link: url, headline, location, about });
```

### Navigating Pagination and Anti-Bot Detectors
```javascript
// Before we attempt to click Next, evaluate Indeed cloudflare flags
if (document.body.innerText.includes('Verify you are human')) {
    chrome.runtime.sendMessage({ type: 'stopped' }); // EMERGENCY STOP
    return;
}

// Try grabbing 'Next' button
let nextBtn = document.querySelector('.artdeco-pagination__button--next, [aria-label="Next"]');

if (nextBtn && !nextBtn.disabled) {
    // We increment 'currentPage' in DB
    chrome.runtime.sendMessage({ action: 'fetchNextPage' }); 
    // Wait for the button visually, click it, and re-trigger Scrape Loop
    nextBtn.click();
    setTimeout(() => startScrapingLoop(), 6000); 
}
```

---

## Final Review
Because of this 3-tier structure, the AI Agent acts almost organically. The background script essentially watches over the tab like a supervisor, while the content script acts as the tireless worker dragging out the data, communicating back to the supervisor who then runs the analytics via OpenAI and builds a perfect CSV record list.
"""

html_template = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>LinkedIn Agent Documentation</title>
    <style>
        @page {{ margin: 1in; }}
        body {{ font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11pt; color: #333; line-height: 1.5; }}
        h1 {{ color: #2C3E50; font-size: 18pt; border-bottom: 2px solid #3498DB; padding-bottom: 5px; }}
        h2 {{ color: #2980B9; font-size: 14pt; margin-top: 20px; }}
        h3 {{ color: #16A085; font-size: 12pt; }}
        p {{ margin-bottom: 10px; }}
        code {{ background-color: #F8F9FA; border: 1px solid #E9ECEF; padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 10pt; color: #E83E8C; }}
        pre {{ background-color: #F8F9FA; border: 1px solid #E9ECEF; padding: 10px; border-radius: 5px; overflow-x: auto; }}
        pre code {{ background-color: transparent; border: none; padding: 0; color: #212529; font-size: 9pt; }}
        hr {{ border: 0; border-top: 1px solid #DDD; margin: 20px 0; }}
        .header {{ padding: 10px 0; border-bottom: 1px solid #DDD; display: flex; justify-content: space-between; }}
    </style>
</head>
<body>
    {markdown.markdown(content, extensions=['fenced_code'])}
</body>
</html>
"""

def create_pdf(html, dest):
    with open(dest, "w+b") as result_file:
        pisa_status = pisa.CreatePDF(html, dest=result_file)
    return pisa_status.err

if __name__ == "__main__":
    output_path = r"c:\Users\mohammed.mostafa\Anti Gravity\LinkedInAgent\LinkedIn_Agent_Complete_Documentation.pdf"
    error = create_pdf(html_template, output_path)
    if error:
        print("Error generating PDF!")
        sys.exit(1)
    else:
        print(f"PDF successfully generated at: {output_path}")
        sys.exit(0)
