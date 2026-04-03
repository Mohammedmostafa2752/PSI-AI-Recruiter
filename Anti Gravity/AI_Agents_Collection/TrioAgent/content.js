// TRIO AI Agent - Content Script for Job Tracking

let isScraping = false;
let scrapeConfig = null;

if (typeof window.hasJobScraper === 'undefined') {
  window.hasJobScraper = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startScraping") {
      isScraping = true;
      scrapeConfig = request.config;
      sendResponse({ status: "started" });
      
      if (window.location.hostname.includes('indeed.com')) {
        startIndeedScrapingLoop();
      } else {
        startLinkedInScrapingLoop();
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function autoScrollJobsList(listElement) {
  let prevCount = 0;
  let stagnantCount = 0;
  
  while (isScraping) {
    let cards = listElement 
      ? listElement.querySelectorAll('.job-card-container, .jobs-search-results__list-item')
      : document.querySelectorAll('.job-card-container, .jobs-search-results__list-item');
      
    let currentCount = cards.length;
    
    if (cards.length > 0) {
      cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    if (listElement) listElement.scrollBy(0, 400);
    else window.scrollBy(0, 400);

    await sleep(800);

    if (currentCount === prevCount) {
      stagnantCount++;
    } else {
      stagnantCount = 0; // Reset if DOM expanded
    }
    prevCount = currentCount;

    // LinkedIn usually loads exactly 25 jobs per page. Stagnant 5 times = 4 seconds of waiting at bottom without new DOM items.
    if (currentCount >= 25 || stagnantCount >= 5) {
      break;
    }
  }
  
  // Force massive bottom scroll to unhide the bottom pagination block
  if (listElement) {
    listElement.scrollTop = listElement.scrollHeight + 5000;
  } else {
    window.scrollTo(0, document.body.scrollHeight + 5000);
  }
  await sleep(1500);
}

// ----------------------------------------------------
// LINKEDIN JOBS
// ----------------------------------------------------
async function startLinkedInScrapingLoop() {
  if (!isScraping) return;

  sendLog("Waiting for LinkedIn jobs list to load...");
  await sleep(4000);

  const listContainer = document.querySelector('.jobs-search-results-list') || 
                        document.querySelector('.scaffold-layout__list');
  
  if (listContainer) {
    sendLog("Auto-scrolling job list to load all items...");
    await autoScrollJobsList(listContainer);
  } else {
    sendLog("Auto-scrolling page...");
    await autoScrollJobsList(null);
  }

  if (!isScraping) return;

  const jobCards = Array.from(document.querySelectorAll('.job-card-container, li.jobs-search-results__list-item'));
  sendLog(`Found ${jobCards.length} jobs on this page.`);

  if (jobCards.length === 0) {
    sendLog("ERROR: Could not fetch jobs. Stopping automation.");
    isScraping = false;
    chrome.runtime.sendMessage({ type: 'stopped' });
    return;
  }

  for (let i = 0; i < jobCards.length; i++) {
    if (!isScraping) break;
    
    let card = jobCards[i];
    
    // Click the card to open details pane
    let clickable = card.querySelector('a.job-card-list__title, a.job-card-container__link') || card;
    if (clickable) {
      clickable.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);
      clickable.click();
      
      // Wait for JD to load
      let jdLoaded = false;
      let detailsText = null;
      for (let w = 0; w < 10; w++) {
        await sleep(400);
        let titleInDetails = document.querySelector('.jobs-details__main-content h2, .job-details-jobs-unified-top-card__job-title, .job-details-jobs-unified-top-card__job-title-link');
        detailsText = document.querySelector('.jobs-description__content, #job-details, .job-view-layout, article');
        if (titleInDetails && detailsText && detailsText.innerText.length > 50) {
          jdLoaded = true;
          break;
        }
      }

      if (jdLoaded) {
          // Click "See more" to expand the truncated description
          const seeMoreBtn = document.querySelector('button[aria-label*="Click to see more description" i], .jobs-description__footer-button, .jobs-description__content button, button.artdeco-button--tertiary.artdeco-button--muted');
          if (seeMoreBtn && !seeMoreBtn.disabled) {
             seeMoreBtn.click();
             await sleep(500);
          }

          // Scroll the right pane heavily to force lazy loading of the Skills/Insights sections
          const rightPane = document.querySelector('.jobs-search__job-details--container, .job-view-layout, .jobs-details__main-content');
          if (rightPane) {
             rightPane.scrollBy(0, 1000);
             await sleep(400);
             rightPane.scrollBy(0, 1000);
             await sleep(500);
             rightPane.scrollTop = 0; // Reset scroll back to top for visual neatness
          }
      }

      if (!jdLoaded || !detailsText) {
        sendLog("Warning: Job description didn't load properly, trying deep fallback...");
        detailsText = document.querySelector('.jobs-search__job-details--container, .scaffold-layout__detail');
      }

      if (!detailsText || detailsText.innerText.length < 50) {
          sendLog("Error: Failed to grab description completely, skipping...");
          continue;
      }

      const jobDetails = extractLinkedInJob(card);
      if (jobDetails) {
        const aiAssessment = await new Promise(res => {
            chrome.runtime.sendMessage({ action: 'jobFound', job: jobDetails }, (r) => res(r));
        });
        
        if (aiAssessment && aiAssessment.decision === 'Fit' && aiAssessment.score >= 70) {
            sendLog(`⭐ Job is a MATCH! Triggering Easy Apply workflow...`);
            
            // Look for Easy Apply button exactly in the active right pane
            const applyBtns = Array.from(document.querySelectorAll('.jobs-apply-button--top-card button'));
            const easyApplyBtn = applyBtns.find(b => b.innerText.includes('Easy Apply'));

            if (!easyApplyBtn) {
              sendLog("Easy Apply button not found or already applied. Skipping application step...");
            } else {
              sendLog("Triggering 'Easy Apply' Modal!");
              easyApplyBtn.click();
              await sleep(2000);

              const success = await handleEasyApplyModal();
              if (success) {
                sendLog("✅ Automatically Applied to Job successfully!");
              } else {
                sendLog("⚠️ Failed to complete application. Dismissing...");
                const closeBtn = document.querySelector('.artdeco-modal__dismiss');
                if (closeBtn) {
                    closeBtn.click();
                    await sleep(1000);
                    const discard = document.querySelector('[data-control-name="discard_application_confirm_btn"]');
                    if (discard) discard.click();
                }
              }
            }
        }
        await sleep(1500); 
      }
    }
  }

  if (isScraping) {
    sendLog("Locating the 'Next' page pagination button...");
    
    // Restrict the search container strictly to the left-pane job list or pagination block to avoid right-pane job description buttons
    const leftPane = document.querySelector('.scaffold-layout__list, .jobs-search-results-list, .jobs-search-pagination, .artdeco-pagination');
    let nextBtn = null;
    
    if (leftPane) {
        nextBtn = leftPane.querySelector('button[aria-label*="next" i], button[aria-label*="Next" i], button.artdeco-pagination__button--next, li[data-test-pagination-page-btn="next"] button');
        
        if (!nextBtn) {
            // Fallback to searching button text directly within the left pane
            const allBtns = Array.from(leftPane.querySelectorAll('button'));
            nextBtn = allBtns.find(b => b.innerText.toLowerCase().includes('next') || (b.getAttribute('aria-label') || '').toLowerCase().includes('next'));
        }
    }

    if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('disabled')) {
      sendLog("Clicking 'Next' page...");
      chrome.runtime.sendMessage({ action: 'fetchNextPage' });
      nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(1000);
      nextBtn.click();
      
      setTimeout(startLinkedInScrapingLoop, 5000);
    } else {
      isScraping = false;
      sendLog("Finished! No 'Next' button found, or it is disabled. Search complete.");
      chrome.runtime.sendMessage({ type: 'stopped' });
    }
  }
}

function extractLinkedInJob(card) {
  try {
    const rightPane = document.querySelector('.job-details-jobs-unified-top-card__container, .job-view-layout, .jobs-search__job-details--container');
    
    // Title
    let titleAnchor = card.querySelector('a.job-card-list__title, a.job-card-container__link');
    let titleElement = rightPane ? rightPane.querySelector('.job-details-jobs-unified-top-card__job-title, h1, h2.t-24') : null;
    let title = "Unknown Title";
    if (titleElement) {
        // use childNodes[0] if there's a duplicate hidden span, or fallback to full text
        title = titleElement.childNodes[0] ? titleElement.childNodes[0].textContent.trim() : titleElement.innerText.trim();
        if(!title) title = titleElement.innerText.trim();
    } else if (titleAnchor) {
        title = titleAnchor.innerText.trim();
    }
    
    // Link
    let link = titleAnchor ? titleAnchor.href.split('?')[0] : window.location.href;
    
    // Company
    let companyPane = rightPane ? rightPane.querySelector('.job-details-jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__primary-description-container a, .jobs-unified-top-card__company-name') : null;
    let fallbackCompany = card.querySelector('.job-card-container__primary-description, .job-card-container__company-name');
    let company = companyPane ? companyPane.innerText.trim() : (fallbackCompany ? fallbackCompany.innerText.trim() : "Unknown Company");

    // Primary Text Meta Block: "Abu Dhabi, UAE · 7 hours ago · 21 people clicked apply"
    let primaryDesc = rightPane ? rightPane.querySelector('.job-details-jobs-unified-top-card__primary-description-container') : null;
    let location = "Unknown Location";
    let timePosted = "Unknown";
    let applicantCount = "Unknown";
    
    if (primaryDesc && primaryDesc.innerText) {
      // Split by literal dot '·' or bullet '•' or generic split layout
      const parts = primaryDesc.innerText.split(/·|•/);
      if (parts.length > 0) location = parts[0].trim();
      if (parts.length > 1) timePosted = parts[1].trim();
      if (parts.length > 2) applicantCount = parts[2].trim();
    } else {
      // Fallback to left card
      let locEl = card.querySelector('.job-card-container__metadata-item');
      if (locEl) location = locEl.innerText.trim();
    }

    let descEl = document.querySelector('.jobs-search__job-details--container, .job-view-layout, .scaffold-layout__detail, #job-details, .jobs-description__content');
    // Grab the entire container to ensure we capture the Description AND the Match Skills section natively appended at the bottom
    let description = descEl ? descEl.innerText.trim() : "";

    return { title, company, location, timePosted, applicantCount, link, description };
  } catch (err) {
    sendLog("Extraction error: " + err.message);
    return null;
  }
}


// ----------------------------------------------------
// INDEED JOBS
// ----------------------------------------------------
async function startIndeedScrapingLoop() {
  if (!isScraping) return;

  sendLog("Waiting for Indeed jobs list to load...");
  await sleep(4000);

  if (document.body.innerText.includes('Verify you are human')) {
    sendLog("CRITICAL ERROR: Indeed Cloudflare Anti-Bot wall detected! Manual CAPTCHA required.");
    isScraping = false;
    chrome.runtime.sendMessage({ type: 'stopped' });
    return;
  }

  const jobCards = Array.from(document.querySelectorAll('div.job_seen_beacon, td.resultContent, div.cardOutline'));
  sendLog(`Found ${jobCards.length} jobs on this Indeed page.`);

  if (jobCards.length === 0) {
    sendLog("ERROR: Could not fetch jobs on Indeed. Stopping automation.");
    isScraping = false;
    chrome.runtime.sendMessage({ type: 'stopped' });
    return;
  }

  for (let i = 0; i < jobCards.length; i++) {
    if (!isScraping) break;
    
    let card = jobCards[i];
    
    let clickableAnchor = card.querySelector('h2.jobTitle a, a.jcs-JobTitle');
    if (clickableAnchor) {
      clickableAnchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);
      clickableAnchor.click();
      
      let jdLoaded = false;
      for (let w = 0; w < 10; w++) {
        await sleep(400);
        let detailsText = document.querySelector('#jobDescriptionText, div.jobsearch-JobComponent-description');
        if (detailsText && detailsText.innerText.length > 50) {
          jdLoaded = true;
          break;
        }
      }

      if (!jdLoaded) {
        sendLog("Warning: Job description didn't load properly, skipping...");
        continue;
      }

      const jobDetails = extractIndeedJob(card);
      if (jobDetails) {
        // Also get the URL from the iframe/right pane if possible, or fallback
        chrome.runtime.sendMessage({ action: 'jobFound', job: jobDetails });
        await sleep(1500); 
      }
    }
  }

  if (isScraping) {
    sendLog("Locating 'Next' page button on Indeed...");
    const nextBtn = document.querySelector('[data-testid="pagination-page-next"], a[aria-label="Next Page"], a[aria-label="Next"]');

    if (nextBtn) {
      sendLog("Clicking 'Next' page...");
      chrome.runtime.sendMessage({ action: 'fetchNextPage' });
      nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(1000);
      nextBtn.click();
      
      setTimeout(startIndeedScrapingLoop, 6000);
    } else {
      isScraping = false;
      sendLog("Finished! No 'Next' button found on Indeed. Search complete.");
      chrome.runtime.sendMessage({ type: 'stopped' });
    }
  }
}

function extractIndeedJob(card) {
  try {
    let titleAnchor = card.querySelector('h2.jobTitle a, a.jcs-JobTitle');
    let title = titleAnchor ? titleAnchor.innerText.trim() : "Unknown Title";
    let link = titleAnchor ? titleAnchor.href.split('?')[0] : window.location.href;
    
    let companyEl = card.querySelector('span[data-testid="company-name"]');
    let company = companyEl ? companyEl.innerText.trim() : "Unknown Company";

    let locationEl = card.querySelector('div[data-testid="text-location"]');
    let location = locationEl ? locationEl.innerText.trim() : "Unknown Location";

    let descEl = document.querySelector('#jobDescriptionText, div.jobsearch-JobComponent-description');
    let description = descEl ? descEl.innerText.trim() : "";

    return { title, company, location, link, description };
  } catch (err) {
    sendLog("Indeed extraction error: " + err.message);
    return null;
  }
}

// ----------------------------------------------------
// LINKEDIN EASY APPLY AUTOMATION ENGINE
// ----------------------------------------------------
async function handleEasyApplyModal() {
  let attempts = 0;
  
  while (isScraping && attempts < 15) {
    attempts++;
    await sleep(2000); // Let modal form transition
    
    let modal = document.querySelector('.artdeco-modal');
    if (!modal) return false;

    // Check if we hit the final success screen
    if (modal.innerText.includes('Your application was sent to')) {
       const buttonsToDismiss = Array.from(modal.querySelectorAll('button'));
       const doneBtn = buttonsToDismiss.find(b => b.innerText.includes('Done') || b.innerText.includes('Not now'));
       
       if (doneBtn) {
           doneBtn.click();
       } else {
           const dismissCross = modal.querySelector('.artdeco-modal__dismiss');
           if (dismissCross) dismissCross.click();
       }
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
             const match = (scrapeConfig.cvDetails || '').match(phoneRegex);
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
             el.value = scrapeConfig.driverLicense === 'yes' ? 'Yes' : 'No';
             el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (el.tagName === 'FIELDSET') {
             const labels = Array.from(el.querySelectorAll('label'));
             const target = labels.find(l => l.innerText.includes(scrapeConfig.driverLicense === 'yes' ? 'Yes' : 'No'));
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
                     let finalAnswer = answer;
                     if (label.includes('how many') || label.includes('years') || label.includes('expected')) {
                         finalAnswer = finalAnswer.replace(/[^0-9]/g, '');
                         if (!finalAnswer) finalAnswer = "0";
                     }
                     el.value = finalAnswer;
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
    let actionBtn = buttons.find(b => b.innerText.includes('Submit application') || (b.getAttribute('aria-label') || '').includes('Submit'));
    
    if (!actionBtn) {
        actionBtn = buttons.find(b => b.innerText.includes('Submit'));
    }
    if (!actionBtn) {
        actionBtn = buttons.find(b => b.innerText.includes('Review'));
    }
    if (!actionBtn) {
        actionBtn = buttons.find(b => b.innerText.includes('Next') || b.innerText.includes('Continue'));
    }

    if (actionBtn && !actionBtn.disabled) {
        actionBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        actionBtn.click();
    } else {
        sendLog("Stuck! No enabled Next/Review/Submit button. Skipping job.");
        return false;
    }
  }
  return false;
}
