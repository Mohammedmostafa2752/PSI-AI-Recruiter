// LinkedIn AI Recruiter - Content Script

let isScraping = false;
let scrapeConfig = null;

if (typeof window.hasLinkedInScraper === 'undefined') {
  window.hasLinkedInScraper = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startScraping") {
      isScraping = true;
      scrapeConfig = request.config;
      sendResponse({ status: "started" });
      
      if (window.location.hostname.includes('indeed.com')) {
        startIndeedScrapingLoop();
      } else if (scrapeConfig.platform === 'linkedin_jobs') {
        startJobsScrapingLoop();
      } else {
        startScrapingLoop();
      }
    } else if (request.action === "stopScraping") {
      isScraping = false;
      sendResponse({ status: "stopped" });
    }
    return true;
  });
}

function sendLog(text) {
  chrome.runtime.sendMessage({ action: 'log_from_content', text: text });
}

async function startScrapingLoop() {
  if (!isScraping) return;

  sendLog("Waiting 5 seconds for page load...");
  for (let i = 0; i < 5; i++) {
    if (!isScraping) return;
    await sleep(1000);
  }

  sendLog("Checking DOM for true search results...");
  let foundRealResults = false;
  for (let i = 0; i < 20; i++) {
    if (!isScraping) return;
    
    // Check if the skeleton loading animation is gone
    const isSkeleton = document.querySelector('.scaffold-layout__list-skeleton, .search-results__skeleton');
    
    // Look for actual candidate card wrappers
    const hasCard = document.querySelector('.reusable-search__result-container, .entity-result__item, .search-result__wrapper, .search-entity');
    const emptyState = document.querySelector('.search-reusable-search-no-results, .artdeco-empty-state[class*="no-results"], h2.artdeco-empty-state__headline, img.artdeco-empty-state__image');
    
    if (!isSkeleton && (hasCard || emptyState)) {
      foundRealResults = true;
      break;
    }
    
    await sleep(1000);
  }
  
  if (!isScraping) return;
  
  if (!foundRealResults) {
    sendLog("Warning: Search results took longer than 20 seconds to load, or the page structure is severely broken. Attempting extraction anyway...");
  }

  sendLog("Auto-scrolling to load all results...");
  await autoScroll();
  if (!isScraping) return;
  
  // Verify if LinkedIn actually threw a 0 results empty state page
  const emptyState = document.querySelector('.search-reusable-search-no-results, .artdeco-empty-state[class*="no-results"], h2.artdeco-empty-state__headline, img.artdeco-empty-state__image');
  if (emptyState) {
    sendLog("ERROR: LinkedIn returned exactly 0 results for this specific search combination! Try modifying your Job Role text.");
    isScraping = false;
    chrome.runtime.sendMessage({ type: 'stopped' });
    return;
  }
  
  sendLog("Parsing dynamic DOM tree for candidates...");
  const profiles = extractProfiles();
  sendLog(`=> Found ${profiles.length} unique candidates on this page.`);

  if (profiles.length === 0) {
    sendLog("ERROR: Could not fetch candidate data. Even the pure DOM traversal failed. Stopping automation.");
    isScraping = false;
    chrome.runtime.sendMessage({ type: 'stopped' });
    return;
  }

  for (const profile of profiles) {
    if (!isScraping) break; 
    
    chrome.runtime.sendMessage({ action: 'candidateFound', candidate: profile });
    
    for (let w = 0; w < 4; w++) { // Wait 2s total, checking interrupt every 500ms
      if (!isScraping) break;
      await sleep(500);
    }
  }

  if (isScraping) {
    sendLog("Locating the 'Next' page button...");
    
    let nextBtn = document.querySelector('.artdeco-pagination__button--next, [aria-label="Next"], [aria-label="Next page"]');
    
    if (!nextBtn) {
      const buttons = Array.from(document.querySelectorAll('button, a'));
      nextBtn = buttons.find(b => b.innerText && b.innerText.trim().startsWith('Next'));
    }

    if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('disabled')) {
      sendLog("Clicking 'Next' page...");
      chrome.runtime.sendMessage({ action: 'fetchNextPage' });
      nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      for (let w = 0; w < 3; w++) {
        if (!isScraping) return;
        await sleep(500);
      }
      if (!isScraping) return;
      nextBtn.click();
      
      let timerWait = 6000;
      let ticks = 0;
      let waitInterval = setInterval(() => {
        if (!isScraping) clearInterval(waitInterval);
        ticks += 500;
        if (ticks >= timerWait && isScraping) {
          clearInterval(waitInterval);
          startScrapingLoop();
        }
      }, 500);
    } else {
      isScraping = false;
      sendLog("Finished! No 'Next' button found, or it is disabled. Search complete.");
      chrome.runtime.sendMessage({ type: 'stopped' });
    }
  }
}

function extractProfiles() {
  const candidates = [];
  try {
    // Prioritize the actual search results list container first!
    const main = document.querySelector('ul.reusable-search__entity-result-list') || document.querySelector('.search-results-container') || document.querySelector('main, #main, .scaffold-layout__main') || document.body;
    
    // Only grab valid profile links within the targeted container
    const profileLinks = Array.from(main.querySelectorAll('a[href*="/in/"]'));
    if (profileLinks.length === 0) {
       sendLog("No links containing '/in/' were found in the main content area.");
       return [];
    }

    const uniqueUrls = [...new Set(profileLinks.map(a => a.href.split('?')[0]))];
    
    for (const url of uniqueUrls) {
      if (url.toLowerCase().includes('/in/linkedin') || url.endsWith('/in/')) continue;
      
      const anchorsForUrl = profileLinks.filter(a => a.href.split('?')[0] === url);
      
      let nameAnchor = anchorsForUrl.find(a => a.innerText.trim().length > 2 && !a.querySelector('img')) 
                       || anchorsForUrl.find(a => a.innerText.trim().length > 2);
      
      if (!nameAnchor) continue;
      
      let name = nameAnchor.innerText.trim();
      if (name.includes('\n')) name = name.split('\n')[0]; 
      
      const hiddenSpan = nameAnchor.querySelector('span[aria-hidden="true"]');
      if (hiddenSpan && hiddenSpan.innerText.trim().length > 2) {
        let cleanName = hiddenSpan.innerText.trim();
        if (!cleanName.toLowerCase().includes("view ") && !cleanName.toLowerCase().includes("profile")) {
          name = cleanName;
        }
      }
      
      if (name.toLowerCase() === "linkedin member" || name.length === 0) continue;

      let card = nameAnchor.closest('.reusable-search__result-container, .entity-result__item, .search-result__wrapper, .search-entity, li');
      
      if (!card) {
        let domNode = nameAnchor;
        for (let i = 0; i < 10; i++) {
          if (domNode.parentElement) {
            domNode = domNode.parentElement;
            if (domNode.querySelector('.entity-result__primary-subtitle') && domNode.querySelector('.entity-result__secondary-subtitle')) {
              card = domNode;
              break;
            } else if (domNode.tagName === 'LI' || domNode.classList.contains('reusable-search__result-container')) {
              card = domNode;
              break;
            }
          }
        }
      }
      
      if (!card) {
        card = nameAnchor.parentElement.parentElement.parentElement;
      }
      
      let headline = "Headline Not Found";
      let location = "Unknown Location";
      let about = "";
      
      if (card) {
        // LinkedIn randomly changes CSS classes or fully removes them during A/B split testing (e.g. your account).
        // Solution: A 100% Class-Agnostic Visual Hierarchy Parser based entirely on visual position!
        
        let rawText = card.innerText || "";
        let lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        // Find which line visually contains the person's name
        let nameIndex = lines.findIndex(l => l.includes(name) || name.includes(l.split(' ')[0]));
        if (nameIndex === -1) nameIndex = 0; // fallback to very top
        
        // Filter out all the junk buttons and generic LinkedIn metadata 
        let validLines = lines.slice(nameIndex + 1).filter(l => 
          !l.includes('•') && 
          !l.toLowerCase().includes('degree connection') && 
          !l.toLowerCase().startsWith('view ') && 
          !l.match(/^(1st|2nd|3rd\+)$/i) &&
          !l.match(/^(Connect|Follow|Message|Save|Send|Pending)$/i) &&
          !l.toLowerCase().includes('mutual connection') &&
          !l.toLowerCase().includes(' followers') &&
          !l.toLowerCase().includes(' premium') &&
          !l.toLowerCase().includes(' shared connection')
        );

        // Visual Law of LinkedIn Search Cards:
        // Position 1 (validLines[0]) is ALWAYS the Headline.
        // Position 2 (validLines[1]) is ALWAYS the Location.
        // Position 3 (validLines[2]) is ALWAYS the Summary or Past/Current Role snippet.

        if (validLines.length > 0) headline = validLines[0].replace(/\n+/g, ' | ');
        if (validLines.length > 1) location = validLines[1].replace(/\n+/g, ', ');
        if (validLines.length > 2) about = validLines.slice(2, 4).join(' | ').replace(/\n+/g, ' | ');
      }
      
      candidates.push({ name, link: url, headline, location, about });
    }
  } catch (err) {
    sendLog("Exception during extraction: " + err.message);
  }
  
  return candidates;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function autoScroll() {
  await new Promise((resolve) => {
    let totalHeight = 0;
    const distance = 250;
    const timer = setInterval(() => {
      if (!isScraping) {
        clearInterval(timer);
        resolve();
        return;
      }
      const scrollHeight = document.body.scrollHeight;
      window.scrollBy(0, distance);
      totalHeight += distance;

      if (totalHeight >= scrollHeight - window.innerHeight || totalHeight > 8000) {
        clearInterval(timer);
        resolve();
      }
    }, 200);
  });
}

// ----------------------------------------------------
// INDEED SCRAPER FUNCTIONS
// ----------------------------------------------------
async function startIndeedScrapingLoop() {
  if (!isScraping) return;

  sendLog("Waiting 5 seconds for Indeed page load...");
  for (let i = 0; i < 5; i++) {
    if (!isScraping) return;
    await sleep(1000);
  }

  // Once-per-search filter applying based on requirements
  if (!window.indeedFiltersApplied) {
    window.indeedFiltersApplied = true;
    try {
      let reqText = scrapeConfig.requirements || scrapeConfig.req || "";
      let didFilter = applyFilters(reqText);
      if (didFilter) {
        sendLog("Applied filters, waiting for results to refresh...");
        await sleep(4000);
      }
    } catch (e) {
      sendLog("Filter parsing error: " + e.message);
    }
  }

  sendLog("Parsing Indeed DOM tree for candidates...");
  
  if (document.querySelector('div[id*="cloudflare"], iframe[src*="cloudflare"], #challenge-form') || document.body.innerText.includes('Verify you are human')) {
    sendLog("CRITICAL ERROR: Indeed Cloudflare Anti-Bot wall detected! Please complete the CAPTCHA manually on the page and hit Start Search again.");
    isScraping = false;
    chrome.runtime.sendMessage({ type: 'stopped' });
    return;
  }

  if (document.body.innerText.includes('Sign in') || document.body.innerText.includes('Create an account')) {
    if (document.body.innerText.includes('Employer') || document.body.innerText.includes('Resume')) {
      sendLog("CRITICAL ERROR: Indeed is actively blocking you with a Login Wall! You MUST manually log into your Indeed Employer account on this tab before the bot can search resumes.");
      isScraping = false;
      chrome.runtime.sendMessage({ type: 'stopped' });
      return;
    }
  }

  const profiles = extractIndeedProfiles();
  sendLog(`=> Found ${profiles.length} unique candidates on this Indeed page.`);

  if (profiles.length === 0) {
    sendLog("ERROR: Could not fetch candidate data on Indeed. Stopping automation.");
    isScraping = false;
    chrome.runtime.sendMessage({ type: 'stopped' });
    return;
  }

  for (const profile of profiles) {
    if (!isScraping) break; 
    
    chrome.runtime.sendMessage({ action: 'candidateFound', candidate: profile });
    
    for (let w = 0; w < 4; w++) {
      if (!isScraping) break;
      await sleep(500);
    }
  }

  if (isScraping) {
    sendLog("Locating the 'Next' page button on Indeed...");
    
    let nextBtn = null;
    const paginationLinks = Array.from(document.querySelectorAll('nav[aria-label="pagination"] a, button, a'));
    nextBtn = paginationLinks.find(b => {
      const text = (b.innerText || '').trim();
      const aria = (b.getAttribute('aria-label') || '').trim();
      const title = (b.getAttribute('title') || '').trim();
      const dataTest = (b.getAttribute('data-testid') || '').trim();
      
      if (aria === 'Next' || aria === 'Next Page' || title === 'Next' || text === 'Next' || dataTest === 'pagination-next-button') {
          return true;
      }
      return false;
    });
    
    // Check if it's visually disabled (Indeed sometimes uses disabled attribute or a specific class)
    const isDisabled = nextBtn ? (nextBtn.hasAttribute('disabled') || nextBtn.classList.contains('disabled') || nextBtn.getAttribute('aria-disabled') === 'true') : true;

    if (nextBtn && !isDisabled) {
      sendLog("Clicking 'Next' page...");
      chrome.runtime.sendMessage({ action: 'fetchNextPage' });
      nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      for (let w = 0; w < 3; w++) {
        if (!isScraping) return;
        await sleep(500);
      }
      if (!isScraping) return;
      nextBtn.click();
      
      let timerWait = 6000;
      let ticks = 0;
      let waitInterval = setInterval(() => {
        if (!isScraping) clearInterval(waitInterval);
        ticks += 500;
        if (ticks >= timerWait && isScraping) {
          clearInterval(waitInterval);
          startIndeedScrapingLoop();
        }
      }, 500);
    } else {
      isScraping = false;
      sendLog("Finished! No 'Next' button found on Indeed. Search complete.");
      chrome.runtime.sendMessage({ type: 'stopped' });
    }
  }
}

function extractIndeedProfiles() {
  const candidates = [];
  try {
    // Rely on visual anchors based on provided screenshot (e.g., "Message" buttons)
    let msgBtns = Array.from(document.querySelectorAll('button, a')).filter(b => b.innerText && b.innerText.trim() === 'Message');
    
    if (msgBtns.length === 0) {
        return extractIndeedProfilesGeneric();
    }
    
    let actualCards = msgBtns.map(b => {
      let card = b.closest('li, div[class*="card"], div[class*="result"]');
      if (!card) {
        // Fallback traverse up 3-4 levels
        let p = b.parentElement;
        for(let i=0; i<4; i++) {
          if (p && p.parentElement) p = p.parentElement;
        }
        card = p;
      }
      return card;
    }).filter(c => c);

    for (const card of actualCards) {
      let name = "Indeed Candidate"; // Indeed hides names on this screen
      
      const links = Array.from(card.querySelectorAll('a')).filter(a => a.innerText.trim().length > 0 && a.innerText.trim() !== 'Message');
      const linkAnchor = links[0];
      const url = linkAnchor ? linkAnchor.href.split('?')[0] : `https://resumes.indeed.com/candidate_${Math.random().toString(36).substr(2, 9)}`;
      
      const lines = card.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      let headline = "Headline Not Found";
      let location = "Unknown Location";
      
      if (linkAnchor && linkAnchor.innerText) {
        let anchorText = linkAnchor.innerText.trim();
        // Only split by explicit bullet points to avoid splitting dates like '2023 - Present'
        const parts = anchorText.split(/[•·]/).map(p => p.trim());
        headline = parts[0];
        if (parts.length > 1 && parts[1].length > 0) {
            location = parts.slice(1).join(', ');
        }
      } else if (lines.length > 0) {
        headline = lines[0];
        let potentialLocation = lines[1] === lines[0] ? lines[2] : lines[1];
        if (potentialLocation && potentialLocation.length < 40 && !potentialLocation.includes('-')) {
            location = potentialLocation;
        }
      }
      
      // Fallback selector specifically built to catch Indeed's hidden locations
      let locationEl = card.querySelector('[data-testid*="location"], [class*="location"]');
      if (locationEl && locationEl.innerText && locationEl.innerText.trim().length > 0) {
          location = locationEl.innerText.trim();
      }
      
      let anchorTextToSkip = linkAnchor ? linkAnchor.innerText.trim() : "";
      const aboutLines = lines.filter(l => l !== anchorTextToSkip && !l.includes('Message') && l !== 'Education');
      const about = aboutLines.join(' | ');
      
      candidates.push({ name, link: url, headline, location, about });
    }
  } catch (err) {
    sendLog("Exception during Indeed extraction: " + err.message);
  }
  
  // Deduplicate unique profiles
  const uniqueUrls = new Set();
  return candidates.filter(c => {
    if (uniqueUrls.has(c.link)) return false;
    uniqueUrls.add(c.link);
    return true;
  });
}

function extractIndeedProfilesGeneric() {
  const candidates = [];
  const links = Array.from(document.querySelectorAll('a[href*="/resumes/"], a[href*="/viewresume"], a[href*="/r/"]'));
  for (const a of links) {
    if (a.innerText.trim().length === 0) continue;
    let url = a.href.split('?')[0];
    let card = a.closest('li, div[class*="card"], div[class*="result"]');
    if (!card) card = a.parentElement.parentElement;
    if (!card) continue;
    let headline = a.innerText.trim().replace(/\n+/g, ' | ');
    let lines = card.innerText.trim().split('\n').filter(l => l.trim().length > 0);
    
    let name = "Indeed Candidate";
    let location = lines.length > 1 ? lines[1] : "Unknown";
    let about = lines.length > 2 ? lines.slice(2, 5).join(' | ') : "";
    
    candidates.push({ name, link: url, headline, location, about });
  }
  const unique = [];
  const handled = new Set();
  for(let c of candidates) {
    if(!handled.has(c.link)) {
        unique.push(c);
        handled.add(c.link);
    }
  }
  return unique;
}

// ----------------------------------------------------
// UI AUTOMATION UTILS
// ----------------------------------------------------
function applyFilters(req) {
  let expToClick = null;
  const lReq = req.toLowerCase();
  
  // Very forgiving RegEx and substring mapping to simulate Indeed's radio buttons
  if (lReq.includes('less than 1') || lReq.includes('0 years') || lReq.includes('entry level')) expToClick = 'Less than 1 year';
  else if (lReq.includes('1 year') || lReq.includes('2 year') || lReq.includes('1-2 year') || lReq.includes('1 - 2 year')) expToClick = '1-2 years';
  else if (lReq.includes('3 year') || lReq.includes('4 year') || lReq.includes('5 year') || lReq.includes('3-5 year') || lReq.includes('3 - 5 year')) expToClick = '3-5 years';
  else if (lReq.includes('6 year') || lReq.includes('7 year') || lReq.includes('8 year') || lReq.includes('9 year') || lReq.includes('10 year')) expToClick = '6-10 years';
  else if (lReq.includes('more than 10') || lReq.includes('11 year') || lReq.includes('10+ year')) expToClick = 'More than 10 years';
  else if (lReq.match(/([1-9]|10)\s*\+?\s*years?/)) {
     const num = parseInt(lReq.match(/([1-9]|10)\s*\+?\s*years?/)[1]);
     if (num === 1 || num === 2) expToClick = '1-2 years';
     if (num >= 3 && num <= 5) expToClick = '3-5 years';
     if (num >= 6 && num <= 10) expToClick = '6-10 years';
     if (num > 10) expToClick = 'More than 10 years';
  }
  
  if (expToClick) {
    const labels = Array.from(document.querySelectorAll('label'));
    const target = labels.find(l => l.innerText && l.innerText.includes(expToClick));
    if (target) {
       sendLog("Auto-Applying Indeed Experience Filter: " + expToClick);
       target.click();
       return true;
    }
  }
  return false;
}

// ----------------------------------------------------
// LINKEDIN JOBS EASY APPLY AUTOMATION
// ----------------------------------------------------
async function startJobsScrapingLoop() {
  if (!isScraping) return;

  sendLog("Waiting 5 seconds for jobs page load...");
  for (let i = 0; i < 5; i++) {
    if (!isScraping) return;
    await sleep(1000);
  }

  sendLog("Scanning for Job Cards...");
  let jobCards = Array.from(document.querySelectorAll('.job-card-container, .scaffold-layout__list-item'));
  
  if (jobCards.length === 0) {
    sendLog("No job cards found! Ensure you are logged into LinkedIn correctly.");
    isScraping = false;
    chrome.runtime.sendMessage({ type: 'stopped' });
    return;
  }

  for (const card of jobCards) {
    if (!isScraping) break;
    
    // Scroll to card
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(1000);
    card.click();
    
    sendLog("Clicked job card. Waiting for right pane to load...");
    await sleep(3000); // Wait for details pane

    // Look for Easy Apply button
    const applyBtns = Array.from(document.querySelectorAll('.jobs-apply-button--top-card button'));
    const easyApplyBtn = applyBtns.find(b => b.innerText.includes('Easy Apply'));

    if (!easyApplyBtn) {
      sendLog("Skill/Easy Apply button not found or already applied. Skipping...");
      continue;
    }

    sendLog("Triggering 'Easy Apply' Modal!");
    easyApplyBtn.click();
    await sleep(2000);

    const success = await handleEasyApplyModal();
    if (success) {
      sendLog("✅ Automatically Applied to Job successfully!");
    } else {
      sendLog("⚠️ Skipped or failed to complete this application. Proceeding to next.");
      // Ensure modal is dismissed if stuck
      const closeBtn = document.querySelector('.artdeco-modal__dismiss');
      if (closeBtn) {
          closeBtn.click();
          await sleep(1000);
          const discard = document.querySelector('[data-control-name="discard_application_confirm_btn"]');
          if (discard) discard.click();
      }
    }
    
    await sleep(2000);
  }

  if (isScraping) {
    // Check for next page of jobs
    const pagination = document.querySelectorAll('.artdeco-pagination__pages li');
    let nextLi = null;
    let foundCurrent = false;
    for (let li of pagination) {
       if (li.classList.contains('active')) {
           foundCurrent = true;
       } else if (foundCurrent) {
           nextLi = li;
           break;
       }
    }

    if (nextLi) {
       const btn = nextLi.querySelector('button');
       if (btn) {
           sendLog("Moving to next page of jobs...");
           btn.click();
           await sleep(5000);
           startJobsScrapingLoop();
           return;
       }
    }

    sendLog("Finished all available jobs pages!");
    isScraping = false;
    chrome.runtime.sendMessage({ type: 'stopped' });
  }
}

async function handleEasyApplyModal() {
  let attempts = 0;
  
  while (isScraping && attempts < 15) {
    attempts++;
    await sleep(2000); // Let modal form transition
    
    let modal = document.querySelector('.artdeco-modal');
    if (!modal) return false;

    // Check if we hit the final success screen
    if (modal.innerText.includes('Your application was sent to')) {
       const doneBtn = Array.from(modal.querySelectorAll('button')).find(b => b.innerText.includes('Done'));
       if (doneBtn) doneBtn.click();
       return true;
    }

    // Try filling simple inputs
    const inputs = Array.from(modal.querySelectorAll('input[type="text"], input[type="number"], select, fieldset, textarea'));
    
    for (let el of inputs) {
       // Look for label
       let id = el.id || '';
       let labelEl = modal.querySelector(`label[for="${id}"]`) || el.closest('fieldset')?.querySelector('legend');
       let label = labelEl ? labelEl.innerText.toLowerCase() : '';

       if (!label) continue;

       // Basic Fields
       if (label.includes('mobile') || label.includes('phone')) {
          if (!el.value || el.value.length < 5) {
             const phoneRegex = /\+?\d{1,4}[-.\s]?\(?\d{1,3}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/;
             const match = (scrapeConfig.cvText || '').match(phoneRegex);
             if (match) {
                 el.value = match[0];
                 el.dispatchEvent(new Event('input', { bubbles: true }));
             }
          }
       } else if (label.includes('salary') || label.includes('expected') || label.includes('compensation')) {
          if (el.tagName === 'INPUT' && !el.value) {
              const numVal = (scrapeConfig.expectedSalary || "0").replace(/[^0-9]/g, '');
              el.value = numVal || '0';
              el.dispatchEvent(new Event('input', { bubbles: true }));
          }
       } else if (label.includes('driver') || label.includes('license') || label.includes('driving')) {
          if (el.tagName === 'SELECT') {
             el.value = scrapeConfig.driverLicense ? 'Yes' : 'No';
             el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (el.tagName === 'FIELDSET') {
             const labels = Array.from(el.querySelectorAll('label'));
             const target = labels.find(l => l.innerText.includes(scrapeConfig.driverLicense ? 'Yes' : 'No'));
             if (target) target.click();
          }
       } else {
             // Ask AI for the answer
             let options = [];
             let inputType = 'text';
             
             if (el.tagName === 'SELECT') {
                 inputType = 'select';
                 options = Array.from(el.querySelectorAll('option')).map(o => o.innerText.trim()).filter(o => o && o !== 'Select an option');
             } else if (el.tagName === 'FIELDSET') {
                 inputType = 'radio';
                 options = Array.from(el.querySelectorAll('label')).map(o => o.innerText.trim());
             }

             if (el.tagName === 'INPUT' && el.value) continue; // Already filled natively
             if (el.tagName === 'SELECT' && el.value && el.value !== 'Select an option') continue;

             sendLog(`Asking AI to answer: "${label}"...`);
             const answer = await new Promise((resolve) => {
                 chrome.runtime.sendMessage({
                     action: 'answerJobQuestion',
                     question: label,
                     inputType: inputType,
                     options: options
                 }, response => resolve(response?.answer || ''));
             });

             if (answer) {
                 if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                     el.value = answer;
                     el.dispatchEvent(new Event('input', { bubbles: true }));
                 } else if (el.tagName === 'SELECT') {
                     const opt = Array.from(el.querySelectorAll('option')).find(o => o.innerText.trim().toLowerCase() === answer.toLowerCase());
                     if (opt) {
                         el.value = opt.value;
                         el.dispatchEvent(new Event('change', { bubbles: true }));
                     }
                 } else if (el.tagName === 'FIELDSET') {
                     const radioLabel = Array.from(el.querySelectorAll('label')).find(l => l.innerText.trim().toLowerCase() === answer.toLowerCase());
                     if (radioLabel) radioLabel.click();
                 }
             }
       }
    }

    // Determine the next action button
    const buttons = Array.from(modal.querySelectorAll('button'));
    let actionBtn = buttons.find(b => b.innerText.includes('Submit application'));
    
    if (!actionBtn) {
        actionBtn = buttons.find(b => b.innerText.includes('Review'));
    }
    if (!actionBtn) {
        actionBtn = buttons.find(b => b.innerText.includes('Next') || b.innerText.includes('Continue'));
    }

    if (actionBtn && !actionBtn.disabled) {
        actionBtn.click();
    } else {
        sendLog("Stuck! No enabled Next/Review/Submit button. Skipping job.");
        return false;
    }
  }
  return false;
}
