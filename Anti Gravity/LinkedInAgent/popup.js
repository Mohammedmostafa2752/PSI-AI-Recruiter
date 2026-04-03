document.addEventListener('DOMContentLoaded', () => {
  const roleInput = document.getElementById('role');
  const customRole = document.getElementById('customRole');
  const reqInput = document.getElementById('requirements');
  const platformSelect = document.getElementById('platformSelect');
  const aiModelSelect = document.getElementById('aiModel');
  const apiInput = document.getElementById('apiKey');
  const countrySelect = document.getElementById('countrySelect');
  const customCountry = document.getElementById('customCountry');
  const cityCheckboxes = document.getElementById('cityCheckboxes');
  const customCity = document.getElementById('customCity');
  
  const citiesData = {
    'UAE': ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah'],
    'KSA': ['Riyadh', 'Jeddah', 'Dammam', 'Mecca', 'Medina', 'Khobar'],
    'EGY': ['Cairo', 'Alexandria', 'Giza', 'Shubra El Kheima', 'Port Said'],
    'QAT': ['Doha', 'Al Rayyan', 'Al Wakrah'],
    'IND': ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai'],
    'USA': ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix'],
    'UK': ['London', 'Birmingham', 'Manchester', 'Glasgow']
  };

  function updateCityDropdown(countryVal, defaultCities = []) {
    cityCheckboxes.innerHTML = '';
    let list = citiesData[countryVal];
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
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.gap = '4px';
      label.style.fontSize = '12px';
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = city;
      if (defaultCities.includes(city)) cb.checked = true;
      
      label.appendChild(cb);
      label.appendChild(document.createTextNode(city));
      cityCheckboxes.appendChild(label);
    });

    const otherLabel = document.createElement('label');
    otherLabel.style.display = 'flex';
    otherLabel.style.alignItems = 'center';
    otherLabel.style.gap = '4px';
    otherLabel.style.fontSize = '12px';
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

  const saveBtn = document.getElementById('saveSettingsBtn');
  const saveConfirm = document.getElementById('saveConfirm');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const logDiv = document.getElementById('log');

  countrySelect.addEventListener('change', () => {
    if (countrySelect.value === 'Anywhere') {
      customCountry.style.display = 'block';
    } else {
      customCountry.style.display = 'none';
      customCountry.value = '';
    }
    updateCityDropdown(countrySelect.value);
  });

  // Initialize initial city dropdown once DOM is ready
  updateCityDropdown(countrySelect.value);

  platformSelect.addEventListener('change', () => {
    if (platformSelect.value === 'linkedin_jobs') {
      document.getElementById('jobAppSettings').style.display = 'block';
    } else {
      document.getElementById('jobAppSettings').style.display = 'none';
    }
  });

  roleInput.addEventListener('change', () => {
    if (roleInput.value === 'CustomRole') {
      customRole.style.display = 'block';
    } else {
      customRole.style.display = 'none';
      customRole.value = '';
    }
  });

  chrome.storage.local.get(['config', 'apiKeys'], (data) => {
    if (data.config) {
      if (data.config.role) {
        if (Array.from(roleInput.options).find(o => o.value === data.config.role)) {
          roleInput.value = data.config.role;
        } else {
          roleInput.value = 'CustomRole';
          customRole.style.display = 'block';
          customRole.value = data.config.role;
        }
      }
      if (data.config.requirements) reqInput.value = data.config.requirements;
      if (data.config.platform) {
        platformSelect.value = data.config.platform;
        if (data.config.platform === 'linkedin_jobs') document.getElementById('jobAppSettings').style.display = 'block';
      }
      if (data.config.model) aiModelSelect.value = data.config.model;
      if (data.config.expectedSalary) document.getElementById('expectedSalary').value = data.config.expectedSalary;
      if (data.config.driverLicense) document.getElementById('driverLicense').checked = data.config.driverLicense;
      if (data.config.cvText) document.getElementById('cvText').value = data.config.cvText;
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
    }
    const model = aiModelSelect.value;
    if (data.apiKeys && data.apiKeys[model]) {
      apiInput.value = data.apiKeys[model];
    }
  });

  aiModelSelect.addEventListener('change', () => {
    const model = aiModelSelect.value;
    chrome.storage.local.get(['apiKeys'], (data) => {
      apiInput.value = data.apiKeys[model] || '';
    });
  });

  saveBtn.addEventListener('click', () => {
    const role = roleInput.value === 'CustomRole' ? customRole.value.trim() : roleInput.value;
    const req = reqInput.value.trim();
    const platform = platformSelect.value;
    const model = aiModelSelect.value;
    const key = apiInput.value.trim();
    let country = countrySelect.value === 'UAE' ? 'UAE' : (countrySelect.value === 'Anywhere' ? customCountry.value.trim() : countrySelect.value);
    let cities = getSelectedCities();
    
    // Easy Apply attributes
    let expectedSalary = document.getElementById('expectedSalary').value.trim();
    let driverLicense = document.getElementById('driverLicense').checked;
    let cvText = document.getElementById('cvText').value.trim();

    if (!role || !req || !key) {
      addLog('Error: Job Role, Job Requirements, and API Key are mandatory constraints.', true);
      return;
    }

    const newConfig = { role, requirements: req, model, country, cities, platform, expectedSalary, driverLicense, cvText };
    
    chrome.storage.local.get(['apiKeys'], (data) => {
      let apiKeys = data.apiKeys || {};
      apiKeys[model] = key;
      chrome.storage.local.set({ config: newConfig, apiKeys }, () => {
        saveConfirm.style.display = 'block';
        setTimeout(() => saveConfirm.style.display = 'none', 3000);
      });
    });
  });

  function getPayload() {
    const role = roleInput.value === 'CustomRole' ? customRole.value.trim() : roleInput.value;
    const req = reqInput.value.trim();
    const platform = platformSelect.value;
    const model = aiModelSelect.value;
    const key = apiInput.value.trim();
    let country = countrySelect.value === 'Anywhere' ? customCountry.value.trim() : countrySelect.value;
    let cities = getSelectedCities();
    
    // Easy Apply attributes
    let expectedSalary = document.getElementById('expectedSalary').value.trim();
    let driverLicense = document.getElementById('driverLicense').checked;
    let cvText = document.getElementById('cvText').value.trim();

    if (!role || !req || !key) {
      addLog('Error: Job Role, Job Requirements, and API Key are mandatory constraints.', true);
      return null;
    }
    return { role, requirements: req, model, key, country, cities, platform, expectedSalary, driverLicense, cvText };
  }

  startBtn.addEventListener('click', () => {
    let p = getPayload();
    if (!p) return;
    p.isResume = false;
    setUIState(true);
    chrome.runtime.sendMessage({ action: 'startSearch', payload: p });
  });

  document.getElementById('resumeBtn').addEventListener('click', () => {
    let p = getPayload();
    if (!p) return;
    p.isResume = true;
    setUIState(true);
    chrome.runtime.sendMessage({ action: 'startSearch', payload: p });
  });

  document.getElementById('restartBtn').addEventListener('click', () => {
    let p = getPayload();
    if (!p) return;
    p.isResume = false;
    setUIState(true);
    chrome.runtime.sendMessage({ action: 'startSearch', payload: p });
  });

  stopBtn.addEventListener('click', () => {
    setUIState(false);
    chrome.runtime.sendMessage({ action: 'stopSearch' });
  });

  clearLogsBtn.addEventListener('click', () => {
    logDiv.innerHTML = '';
    chrome.runtime.sendMessage({ action: 'clearLogs' });
  });

  downloadBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'downloadCsv' }, (res) => {
      if (res && res.count !== undefined) {
        addLog(`Requested CSV package (${res.count} prospect profiles).`, true);
      }
    });
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
    chrome.storage.local.get(['lastConfig', 'currentPage', 'collectedCandidates'], (data) => {
      let hasSavedSession = false;
      if (data.lastConfig && data.lastConfig.role) {
        if (data.currentPage && data.currentPage > 1) hasSavedSession = true;
        if (data.collectedCandidates && data.collectedCandidates.length > 0) hasSavedSession = true;
      }

      const primaryContainer = document.getElementById('primaryStartBtnContainer');
      const resumeContainer = document.getElementById('resumeActions');
      
      if (hasSavedSession) {
        primaryContainer.style.display = 'none';
        resumeContainer.style.display = 'flex';
        document.getElementById('lblPage').innerText = data.currentPage || 1;
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
    if (text.includes('Error') || text.includes('ERROR') || text.includes('Process paused')) {
      dot.style.backgroundColor = 'var(--psi-vermilion)';
    } else if (text.includes('Starting AI Search') || text.includes('Found Candidate')) {
      dot.style.backgroundColor = '#10B981';
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
