document.addEventListener('DOMContentLoaded', () => {
  const roleSelect = document.getElementById('role');
  const customRole = document.getElementById('customRole');
  const countrySelect = document.getElementById('countrySelect');
  const customCountry = document.getElementById('customCountry');
  const cityCheckboxes = document.getElementById('cityCheckboxes');
  const customCity = document.getElementById('customCity');
  
  const cvDetailsInput = document.getElementById('cvDetails');
  const platformSelect = document.getElementById('platformSelect');
  const apiInput = document.getElementById('apiKey');

  const saveBtn = document.getElementById('saveSettingsBtn');
  const saveConfirm = document.getElementById('saveConfirm');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const downloadFitsBtn = document.getElementById('downloadFitsBtn');
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const logDiv = document.getElementById('log');



  const CITIES_DATA = {
    'UAE': ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah'],
    'KSA': ['Riyadh', 'Jeddah', 'Dammam', 'Mecca', 'Medina', 'Khobar'],
    'EGY': ['Cairo', 'Alexandria', 'Giza', 'Shubra El Kheima', 'Port Said'],
    'QAT': ['Doha', 'Al Rayyan', 'Al Wakrah'],
    'IND': ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Pune'],
    'USA': ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'San Francisco', 'Seattle'],
    'UK': ['London', 'Birmingham', 'Manchester', 'Glasgow', 'Edinburgh']
  };

  const ROLES_LIST = [
    "Software Engineer", "Frontend Developer", "Backend Developer", "Full Stack Developer",
    "DevOps Engineer", "Data Scientist", "Data Analyst", "Machine Learning Engineer",
    "Cloud Architect", "Network Engineer", "Systems Administrator", "Cyber Security Analyst",
    "Product Manager", "Project Manager", "Scrum Master", "Business Analyst",
    "UX/UI Designer", "Graphic Designer", "Marketing Manager", "SEO Specialist",
    "Content Writer", "Sales Manager", "Account Executive", "Business Development Manager",
    "HR Manager", "Talent Acquisition Specialist", "Recruiter", "Accountant",
    "Financial Analyst", "Operations Manager", "Supply Chain Manager", "Customer Success Manager",
    "Customer Support Representative", "Legal Counsel", "Real Estate Agent", "Sales Agent",
    "Sales Support", "CRM Analyst", "AI Operations", "Operation Coordinator", "Mechanical Engineer",
    "Electrical Engineer", "Civil Engineer", "Executive Assistant", "Medical Doctor", "Nurse",
    "CustomRole" // trigger
  ];

  // Populate Roles
  ROLES_LIST.forEach(r => {
    let opt = document.createElement('option');
    opt.value = r;
    opt.innerText = r === "CustomRole" ? "Other (Type Custom Role)..." : r;
    roleSelect.appendChild(opt);
  });

  function updateCityDropdown(countryVal, defaultCities = []) {
    cityCheckboxes.innerHTML = '';
    let list = CITIES_DATA[countryVal];
    if (countryVal === 'Anywhere' || !list) {
      customCity.style.display = 'block';
      if (defaultCities.length > 0) {
         customCity.value = defaultCities.join(', ');
      }
      return;
    }
    
    customCity.style.display = 'none';

    list.forEach(city => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = city;
      if (defaultCities.includes(city)) cb.checked = true;
      
      label.appendChild(cb);
      label.appendChild(document.createTextNode(city));
      cityCheckboxes.appendChild(label);
    });

    const otherLabel = document.createElement('label');
    const otherCb = document.createElement('input');
    otherCb.type = 'checkbox';
    otherCb.value = 'Other...';
    otherCb.addEventListener('change', () => {
      customCity.style.display = otherCb.checked ? 'block' : 'none';
      if (!otherCb.checked) customCity.value = '';
    });
    otherLabel.appendChild(otherCb);
    otherLabel.appendChild(document.createTextNode('Other...'));
    cityCheckboxes.appendChild(otherLabel);

    let customSaved = defaultCities.filter(c => !list.includes(c));
    if (customSaved.length > 0) {
       otherCb.checked = true;
       customCity.style.display = 'block';
       customCity.value = customSaved.join(', ');
    }
  }

  function getSelectedCities() {
     let selected = [];
     if (countrySelect.value === 'Anywhere') {
        let val = customCity.value.trim();
        if (val) selected = val.split(',').map(s=>s.trim()).filter(s=>s);
     } else {
        const cbs = cityCheckboxes.querySelectorAll('input[type="checkbox"]:checked');
        cbs.forEach(cb => {
           if (cb.value !== 'Other...') selected.push(cb.value);
        });
        const otherChecked = cityCheckboxes.querySelector('input[value="Other..."]')?.checked;
        if (otherChecked && customCity.value.trim() !== '') {
           let extras = customCity.value.trim().split(',').map(s=>s.trim()).filter(s=>s);
           selected.push(...extras);
        }
     }
     return selected;
  }

  countrySelect.addEventListener('change', () => {
    if (countrySelect.value === 'Anywhere') {
      customCountry.style.display = 'block';
    } else {
      customCountry.style.display = 'none';
      customCountry.value = '';
    }
    updateCityDropdown(countrySelect.value);
  });

  roleSelect.addEventListener('change', () => {
    if (roleSelect.value === 'CustomRole') {
      customRole.style.display = 'block';
    } else {
      customRole.style.display = 'none';
      customRole.value = '';
    }
  });

  chrome.storage.local.get(['config', 'apiKeys'], (data) => {
    if (data.config) {
      if (data.config.targetJob) {
        if (Array.from(roleSelect.options).find(o => o.value === data.config.targetJob)) {
          roleSelect.value = data.config.targetJob;
        } else {
          roleSelect.value = 'CustomRole';
          customRole.style.display = 'block';
          customRole.value = data.config.targetJob;
        }
      }
      if (data.config.country) {
        if (Array.from(countrySelect.options).find(o => o.value === data.config.country)) {
          countrySelect.value = data.config.country;
        } else {
          countrySelect.value = 'Anywhere';
          customCountry.style.display = 'block';
          customCountry.value = data.config.country;
        }
      }
      updateCityDropdown(countrySelect.value, data.config.cities || []);
      
      if (data.config.cvDetails) cvDetailsInput.value = data.config.cvDetails;
      if (data.config.expectedSalary) document.getElementById('expectedSalary').value = data.config.expectedSalary;
      if (data.config.driverLicense) document.getElementById('driverLicense').value = data.config.driverLicense;
      if (data.config.platform) platformSelect.value = data.config.platform;
    } else {
      updateCityDropdown(countrySelect.value);
    }

    if (data.apiKeys && data.apiKeys['openai']) {
      apiInput.value = data.apiKeys['openai'];
    }
  });

  saveBtn.addEventListener('click', () => {
    const p = getPayloadInputs();
    if (!p) return;
    
    chrome.storage.local.get(['apiKeys'], (data) => {
      let apiKeys = data.apiKeys || {};
      apiKeys['openai'] = p.key;
      chrome.storage.local.set({ config: p, apiKeys }, () => {
        saveConfirm.style.display = 'block';
        setTimeout(() => saveConfirm.style.display = 'none', 3000);
      });
    });
  });

  function getPayloadInputs() {
    const targetJob = roleSelect.value === 'CustomRole' ? customRole.value.trim() : roleSelect.value;
    let country = countrySelect.value === 'UAE' ? 'UAE' : (countrySelect.value === 'Anywhere' ? customCountry.value.trim() : countrySelect.value);
    let cities = getSelectedCities();
    
    const cvDetails = cvDetailsInput.value.trim();
    const expectedSalary = document.getElementById('expectedSalary').value.trim();
    const driverLicense = document.getElementById('driverLicense').value;
    const platform = platformSelect.value;
    const key = apiInput.value.trim();

    if (!targetJob || !country || !cvDetails || !key) {
      addLog('Error: Target Job, Country, CV Details, and API Key are mandatory.', true);
      return null;
    }
    return { targetJob, country, cities, cvDetails, expectedSalary, driverLicense, model: 'openai', key, platform };
  }

  function doStartSearch(isResume) {
    let p = getPayloadInputs();
    if (!p) return;
    p.isResume = isResume;
    setUIState(true);
    // Explicitly add UI log so the user knows it started right away!
    if(isResume) addLog("Resuming job search session...");
    else addLog(`Initiating job search for ${p.targetJob} in ${p.country}...`);
    
    chrome.runtime.sendMessage({ action: 'startSearch', payload: p });
  }

  startBtn.addEventListener('click', () => doStartSearch(false));
  document.getElementById('resumeBtn').addEventListener('click', () => doStartSearch(true));
  document.getElementById('restartBtn').addEventListener('click', () => doStartSearch(false));

  stopBtn.addEventListener('click', () => {
    setUIState(false);
    chrome.runtime.sendMessage({ action: 'stopSearch' });
  });

  clearLogsBtn.addEventListener('click', () => {
    logDiv.innerHTML = '';
    chrome.runtime.sendMessage({ action: 'clearLogs' });
  });

  downloadFitsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'downloadCsv', filter: 'fit' });
  });

  downloadAllBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'downloadCsv', filter: 'all' });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'log') {
      addLog(msg.text, true);
    } else if (msg.type === 'stopped') {
      setUIState(false);
    }
  });

  chrome.runtime.sendMessage({ action: 'getInitialState' }, (res) => {
    if (res) {
      if (res.logs && res.logs.length > 0) {
        res.logs.forEach(msg => addLog(msg, false));
      }
      setUIState(res.isRunning);
    }
  });

  function updateStartButtonsState() {
    chrome.storage.local.get(['lastConfig', 'currentPage', 'collectedJobs'], (data) => {
      let hasSavedSession = false;
      if (data.lastConfig && data.lastConfig.targetJob) {
        if (data.currentPage && data.currentPage > 1) hasSavedSession = true;
        if (data.collectedJobs && data.collectedJobs.length > 0) hasSavedSession = true;
      }

      const primaryContainer = document.getElementById('primaryStartBtnContainer');
      const resumeContainer = document.getElementById('resumeActions');
      
      if (hasSavedSession) {
        primaryContainer.style.display = 'none';
        resumeContainer.style.display = 'flex';
        let lbl = document.getElementById('lblPage');
        if(lbl) lbl.innerText = data.currentPage || 1;
      } else {
        primaryContainer.style.display = 'block';
        resumeContainer.style.display = 'none';
      }
    });
  }

  function setUIState(isRunning) {
    if (isRunning) {
      document.getElementById('primaryStartBtnContainer').style.display = 'none';
      document.getElementById('resumeActions').style.display = 'none';
      document.getElementById('saveSettingsBtn').style.display = 'none';
      stopBtn.style.display = 'block';
    } else {
      document.getElementById('saveSettingsBtn').style.display = 'block';
      stopBtn.style.display = 'none';
      updateStartButtonsState();
    }
  }

  function addLog(text, autoScroll = true) {
    const item = document.createElement('div');
    item.className = 'log-item';
    
    const dot = document.createElement('div');
    dot.className = 'log-dot';
    if (text.includes('Error') || text.includes('ERROR') || text.includes('paused') || text.includes('PASS')) {
      dot.style.backgroundColor = '#EF4444'; // Red for dismissals / errors
    } else if (text.includes('Starting AI') || text.includes('Found') || text.includes('MATCH') || text.includes('Initiating')) {
      dot.style.backgroundColor = '#10B981'; // Green for success
    } else {
      dot.style.backgroundColor = '#D4AF37'; // Gold for tracking
    }
    
    const p = document.createElement('div');
    p.className = 'log-text';
    p.textContent = text;
    
    item.appendChild(dot);
    item.appendChild(p);
    
    logDiv.appendChild(item);
    
    if (autoScroll) {
      logDiv.scrollTop = logDiv.scrollHeight;
    }
  }
});
