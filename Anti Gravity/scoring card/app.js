document.addEventListener('DOMContentLoaded', () => {
    // --- State & Config ---
    let currentAgent = 'sales';

    const config = {
        sales: {
            tags: ["Interested / Meeting Booked", "Needs Follow-up", "Not Interested", "Do Not Call (DNC)", "Wrong Person"],
            memory: [
                { field: "Client Name", expected: "" },
                { field: "Budget", expected: "" },
                { field: "Specific Interest", expected: "" }
            ]
        },
        listing: {
            tags: ["Interested to List (Exclusive)", "Interested to List (Open)", "Not Interested to List", "Already Listed with 3 Agencies", "Wrong Person"],
            memory: [
                { field: "Project Name", expected: "" },
                { field: "Unit Type", expected: "" },
                { field: "Number of Bedrooms", expected: "" },
                { field: "Size", expected: "" },
                { field: "Asking Price", expected: "" }
            ]
        }
    };

    // Mapping weights for Score Calculation
    // Multipliers are defined per-question in HTML. This assigns the raw value / max possible based on selection
    // Note: The HTML values are 100, 80, 50, 0. We will map them to points: 10, 8, 5, 0
    const weights = {
        // Tech
        q_delay: { multiplier: 1.0, cat: 'tech', vals: { good: 10, borderline: 5, high: 0 } },
        
        // Rules
        q_prompt: { multiplier: 1.5, cat: 'rules' }, // expects 100, 80, 50, 0
        q_inst: { multiplier: 1.5, cat: 'rules' },
        q_noise: { multiplier: 1.0, cat: 'rules' },
        
        // Rules (Listing only - but we define them here safely)
        q_madmoun: { multiplier: 1.5, cat: 'rules' },
        q_contact: { multiplier: 1.5, cat: 'rules' },
        
        // Rules (Detection - Common)
        q_intent: { multiplier: 1.5, cat: 'rules' },
        q_sentiment: { multiplier: 1.0, cat: 'rules' },
        q_interest: { multiplier: 1.5, cat: 'rules' },
        q_wrongperson: { multiplier: 1.0, cat: 'rules' },

        // Data 
        q_tags: { multiplier: 2.0, cat: 'data' },
        q_memory: { multiplier: 2.0, cat: 'data' },
        q_hallucination: { multiplier: 2.0, cat: 'data' },
        q_price: { multiplier: 2.0, cat: 'data' }
    };

    // --- DOM Elements ---
    const agentBtns = document.querySelectorAll('.agent-btn');
    const tagList = document.getElementById('tagList');
    const tagCycleTemplate = document.getElementById('tagCycleTemplate');
    const customTagInput = document.getElementById('customTagInput');
    const addCustomTagBtn = document.getElementById('addCustomTagBtn');
    
    const memoryTableBody = document.getElementById('memoryTableBody');
    const addMemoryFieldBtn = document.getElementById('addMemoryFieldBtn');

    const listingAgentSection = document.getElementById('listingAgentSection');
    
    // We get all radios dynamically during calculation to handle listing toggle properly
    
    // --- Initialization ---
    initAgentData(currentAgent);

    // --- Event Listeners ---
    
    // Agent Selection
    agentBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            agentBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentAgent = e.target.dataset.agent;
            initAgentData(currentAgent);
        });
    });

    // Custom Tag Addition
    addCustomTagBtn.addEventListener('click', () => {
        const val = customTagInput.value.trim();
        if (val) {
            createTagElement(val);
            customTagInput.value = '';
        }
    });

    // Memory Field Addition
    addMemoryFieldBtn.addEventListener('click', () => {
        createMemoryRow("", "");
    });

    // Bind scores to any existing and future radio clicks via delegation
    document.querySelector('.form-container').addEventListener('change', (e) => {
        if(e.target.type === 'radio') {
            calculateLiveScore();
        }
    });

    // --- Functions ---
    function initAgentData(agent) {
        // Toggle Listing section
        if (agent === 'listing') {
            listingAgentSection.style.display = 'block';
        } else {
            listingAgentSection.style.display = 'none';
        }

        // Render Tags
        tagList.innerHTML = '';
        config[agent].tags.forEach(t => createTagElement(t));

        // Render Memory Table
        memoryTableBody.innerHTML = '';
        config[agent].memory.forEach(m => createMemoryRow(m.field, m.expected));

        calculateLiveScore();
    }

    function createTagElement(tagName) {
        const clone = tagCycleTemplate.content.cloneNode(true);
        const btn = clone.querySelector('.tag-cycle-btn');
        btn.querySelector('.tag-name').textContent = tagName;
        
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            cycleTagState(btn);
        });

        tagList.appendChild(clone);
    }

    function cycleTagState(btn) {
        const states = ['unreviewed', 'correct', 'missed', 'hallucinated'];
        const icons = {
            'unreviewed': '<i class="fa-solid fa-circle-question"></i>',
            'correct': '<i class="fa-solid fa-check"></i>',
            'missed': '<i class="fa-solid fa-xmark"></i>',
            'hallucinated': '<i class="fa-solid fa-ghost"></i>'
        };

        let currentState = states.find(s => btn.classList.contains(s)) || 'unreviewed';
        let nextIndex = (states.indexOf(currentState) + 1) % states.length;
        let nextState = states[nextIndex];

        btn.classList.remove(currentState);
        btn.classList.add(nextState);
        btn.querySelector('.tag-state').innerHTML = icons[nextState];
    }

    function createMemoryRow(field, expected) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" value="${field}" placeholder="Field name"></td>
            <td><input type="text" value="${expected}" placeholder="Expected value"></td>
            <td><input type="text" placeholder="What agent extracted"></td>
            <td>
                <select>
                    <option value="unreviewed">Unreviewed</option>
                    <option value="match">Match</option>
                    <option value="mismatch">Mismatch</option>
                    <option value="missing">Missing</option>
                </select>
            </td>
        `;
        memoryTableBody.appendChild(tr);
    }

    function calculateLiveScore() {
        let scores = {
            total: { earned: 0, max: 0 },
            tech: { earned: 0, max: 0 },
            rules: { earned: 0, max: 0 },
            data: { earned: 0, max: 0 }
        };

        // Determine which questions to check based on active agent
        const activeQuestions = Object.keys(weights).filter(q => {
             // If it's a listing question, only include if agent is listing
             const listingQs = ['q_madmoun', 'q_contact'];
             if (listingQs.includes(q) && currentAgent !== 'listing') return false;
             return true;
        });

        activeQuestions.forEach(questionName => {
            const w = weights[questionName];
            const selectedRadio = document.querySelector(`input[name="${questionName}"]:checked`);
            
            if (selectedRadio) {
                const val = selectedRadio.value;
                
                // If na, we skip adding to max and earned
                if (val !== 'na') {
                    let pointsEarned = 0;
                    
                    if (w.vals) {
                        // Use static mappings (like q_delay)
                        pointsEarned = w.vals[val];
                    } else {
                        // Use dynamic 100/80/50/0 mappings
                        pointsEarned = (parseInt(val, 10) / 100) * 10;
                    }

                    const earned = pointsEarned * w.multiplier;
                    const max = 10 * w.multiplier;

                    scores[w.cat].earned += earned;
                    scores[w.cat].max += max;
                    scores.total.earned += earned;
                    scores.total.max += max;
                }
            }
        });

        const calcPercent = (earned, max) => max === 0 ? "—" : Math.round((earned / max) * 100) + "%";

        document.getElementById('scoreTech').textContent = calcPercent(scores.tech.earned, scores.tech.max);
        document.getElementById('scoreRules').textContent = calcPercent(scores.rules.earned, scores.rules.max);
        document.getElementById('scoreData').textContent = calcPercent(scores.data.earned, scores.data.max);
        
        const overallStr = calcPercent(scores.total.earned, scores.total.max);
        document.getElementById('scoreOverall').textContent = overallStr;

        updateGrade(scores.total.earned, scores.total.max);
    }

    function updateGrade(earned, max) {
        const gradeEl = document.getElementById('gradeValue');
        gradeEl.className = 'score-eval'; // reset
        
        if (max === 0) {
            gradeEl.textContent = "—";
            return;
        }

        const pct = (earned / max) * 100;
        if (pct >= 85) {
            gradeEl.textContent = "✓ Pass";
            gradeEl.classList.add('pass');
        } else if (pct >= 70) {
            gradeEl.textContent = "~ Needs review";
            gradeEl.classList.add('review');
        } else {
            gradeEl.textContent = "✕ Fail";
            gradeEl.classList.add('fail');
        }
    }

    // --- Google Sheets Integration Mock ---
    const submitBtn = document.getElementById('submitScorecardBtn');

    submitBtn.addEventListener('click', async () => {
        // Map of question keys to human-readable labels
        const questionLabels = {
            q_delay: "Response delay / latency",
            q_prompt: "Prompt adherence",
            q_inst: "Instructions following",
            q_noise: "Noise & Background Chatter",
            q_madmoun: "Madmoun law handling",
            q_contact: "No contact details solicited",
            q_intent: "Intent / entity detection",
            q_sentiment: "Sentiment / frustration reading",
            q_interest: "Interest level detection",
            q_wrongperson: "Wrong person handling",
            q_tags: "Outcome tag accuracy",
            q_memory: "Overall memory fields extraction",
            q_hallucination: "Hallucination severity",
            q_price: "Price invention"
        };

        // Collect Radio Selections as human-readable multiline string
        let formattedAnswers = "";
        document.querySelectorAll('input[type="radio"]:checked').forEach(radio => {
            const label = questionLabels[radio.name] || radio.name;
            formattedAnswers += `${label} : "${radio.parentElement.textContent.trim()}"\n`;
        });

        // Collect Tag Audits as formatted string (no JSON)
        let auditedTags = "";
        document.querySelectorAll('.tag-cycle-btn').forEach(btn => {
            const tagName = btn.querySelector('.tag-name').textContent;
            const status = Array.from(btn.classList).find(c => ['unreviewed', 'correct', 'missed', 'hallucinated'].includes(c)) || 'unreviewed';
            auditedTags += `${tagName} : ${status}\n`;
        });

        let payload = {
            timestamp: new Date().toISOString(),
            agentType: currentAgent,
            callId: document.getElementById('callId').value,
            callType: document.getElementById('callType').value,
            reviewerName: document.getElementById('reviewerName').value,
            scoreOverall: document.getElementById('scoreOverall').textContent,
            scoreTech: document.getElementById('scoreTech').textContent,
            scoreRules: document.getElementById('scoreRules').textContent,
            scoreData: document.getElementById('scoreData').textContent,
            grade: document.getElementById('gradeValue').textContent,
            
            questions: formattedAnswers.trim(),
            tags: auditedTags.trim(),

            techNotes: document.getElementById('techNotes').value,
            rulesNotes: document.getElementById('rulesNotes').value,
            tagNotes: document.getElementById('tagNotes').value,
            memoryNotes: document.getElementById('memoryNotes').value,
            hallucinationNotes: document.getElementById('hallucinationNotes').value,
            detectionNotes: document.getElementById('detectionNotes').value
        };

        const gscriptUrl = "https://script.google.com/macros/s/AKfycbyA7Qydg5tjQnra77p9T_R2xDLkboyMx1t4ZIzBdeC4AXpHyLqr4KYAW8FgOjZCFOXOag/exec";

        const originalText = submitBtn.textContent;
        submitBtn.textContent = "Submitting...";
        submitBtn.disabled = true;

        try {
            await fetch(gscriptUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            alert("Scorecard submitted successfully!");
        } catch (e) {
            console.error("Submission failed:", e);
            alert("Failed to submit scorecard. See console for details.");
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });
});
