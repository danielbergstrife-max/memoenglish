// ==================== DATA LAYER ====================
const STORAGE_KEY = 'memoenglish_data_v2';

function getDefaultData() {
    return {
        lists: [],
        currentListId: null,
        totalReviews: 0,
        history: [], // { date: timestamp, correct: bool }
        streak: 0,
        lastReviewDate: null,
        settings: {
            expandContractions: true,
            slowAudio: false,
            darkMode: false
        }
    };
}

function migrateData(data) {
    let modified = false;
    data.lists.forEach(l => {
        l.phrases.forEach(p => {
            if (p.levels === undefined) {
                // Migrate old single level to the new structure
                const oldLevel = p.level || 0;
                p.levels = {
                    standard: oldLevel,
                    quiz: oldLevel,
                    write: 0,
                    pronounce: 0,
                    speak: 0
                };
                delete p.level;
                modified = true;
            }
        });
    });
    if (modified) saveData(data);
    return data;
}

function loadData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            const def = getDefaultData();
            // Merge defaults with loaded data to ensure all fields exist
            const merged = { ...def, ...data };
            return migrateData(merged);
        }
    } catch (e) { console.error('Erro ao carregar:', e); }
    return getDefaultData();
}

function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let appData = loadData();

// ==================== SRS ====================
const SRS_INTERVALS = [0, 10, 60, 240, 1440, 2880, 5760, 10080, 20160, 43200];

function isPhraseDue(p) {
    if (!p.nextReview) return true;
    return Date.now() >= p.nextReview;
}

// ==================== SESSION ====================
let session = {
    active: false,
    queue: [],
    originalCount: 0,
    current: null,
    mode: 'quiz',
    trainingMode: 'standard' // 'standard', 'quiz', 'write', 'pronounce', 'speak'
};

function getModeForLevel(phrase, trainingMode) {
    if (trainingMode !== 'standard') return trainingMode;

    // Standard mode follows the sequence based on the standard level
    const level = phrase.levels?.standard || 0;
    if (level === 0) return 'quiz';
    if (level === 1) return 'write';
    if (level === 2) return 'pronounce';
    if (level === 3) return 'speak';
    return level % 2 === 0 ? 'write' : 'speak';
}

const PHONETIC_MAP = {
    "the": "dâ", "is": "íz", "are": "ár", "you": "iú", "how": "ráu", "what": "uót",
    "of": "óv", "for": "fór", "were": "uêr", "their": "dér", "to": "tú",
    "my": "mái", "name": "nêim", "a": "êi", "an": "én", "and": "énd"
};

function getPhoneticGuide(text) {
    if (!text) return "";
    const words = text.toLowerCase().replace(/[.,!?;:]/g, '').split(/\s+/);

    return words.map(w => {
        // 1. Dictionary priority
        if (PHONETIC_MAP[w]) return PHONETIC_MAP[w];

        let p = w;

        // 2. Suffixes and Clusters (Order matters)
        p = p.replace(/tion\b/g, 'shun');
        p = p.replace(/sion\b/g, 'zhun');
        p = p.replace(/ture\b/g, 'tchur');
        p = p.replace(/ous\b/g, 'as');
        p = p.replace(/ight\b/g, 'áit');
        p = p.replace(/ing\b/g, 'in');

        // 3. Magic E (a_e, i_e, o_e, u_e)
        p = p.replace(/a([bcdfghjklmnpqrstvwxyz])e\b/g, 'êi$1');
        p = p.replace(/i([bcdfghjklmnpqrstvwxyz])e\b/g, 'ái$1');
        p = p.replace(/o([bcdfghjklmnpqrstvwxyz])e\b/g, 'ou$1');
        p = p.replace(/u([bcdfghjklmnpqrstvwxyz])e\b/g, 'iú$1');

        // 4. Consonants
        p = p.replace(/ph/g, 'f');
        p = p.replace(/\bth/g, 'd');
        p = p.replace(/th/g, 'd');
        p = p.replace(/\bh/g, 'r');
        p = p.replace(/sh/g, 'sh');
        p = p.replace(/ch/g, 'tch');
        p = p.replace(/kn/g, 'n');
        p = p.replace(/wr/g, 'r');
        p = p.replace(/ck/g, 'k');
        p = p.replace(/wh/g, 'u');

        // 5. Vowel Clusters
        p = p.replace(/ee/g, 'í');
        p = p.replace(/ea/g, 'í');
        p = p.replace(/oo/g, 'u');
        p = p.replace(/ai|ay/g, 'êi');
        p = p.replace(/oi|oy/g, 'ói');
        p = p.replace(/ou|ow/g, 'áu');
        p = p.replace(/oa/g, 'ou');

        // 6. Individual Vowels (Short/General)
        p = p.replace(/a/g, 'é');
        p = p.replace(/i/g, 'í');

        // Final e cleanup
        if (p.length > 2 && p.endsWith('e')) p = p.slice(0, -1);

        // 7. Cleanup & Softening
        p = p.replace(/c([eiíé])/g, 'ss$1');
        p = p.replace(/c/g, 'k');
        p = p.replace(/y\b/g, 'i');
        p = p.replace(/kk/g, 'k');
        p = p.replace(/ss/g, 's');

        return p;
    }).join(' ');
}

// ==================== UI ====================
function $(id) { return document.getElementById(id); }

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    $(viewId).style.display = 'block';

    // BUG FIX: Hide feedback bar when switching views
    $('feedbackBar').classList.remove('active');

    // Update Sidebar links
    document.querySelectorAll('.nav-link').forEach(l => {
        l.classList.toggle('active', l.dataset.view === viewId);
    });

    // Update Bottom Nav
    document.querySelectorAll('.mobile-nav-item').forEach(l => {
        l.classList.toggle('active', l.dataset.view === viewId);
    });

    if (viewId === 'listsView') renderLists();
    if (viewId === 'homeView') renderStats();
    if (viewId === 'metricsView') renderMetrics();
    if (viewId === 'settingsView') {
        populateSettings();
        updateStorageUsage();
    }
}

function populateSettings() {
    $('settingExpandContractions').checked = appData.settings.expandContractions;
    $('settingSlowAudio').checked = appData.settings.slowAudio;
    $('settingDarkMode').checked = appData.settings.darkMode;
}

function updateSetting(key, val) {
    if (!appData.settings) appData.settings = {};
    appData.settings[key] = val;
    saveData(appData);
    if (key === 'darkMode') applyDarkMode();
}

function applyDarkMode() {
    document.body.classList.toggle('dark-mode', appData.settings.darkMode);
}

function renderStats() {
    let total = 0, due = 0, memorized = 0;
    appData.lists.forEach(l => {
        total += l.phrases.length;
        l.phrases.forEach(p => {
            if (isPhraseDue(p)) due++;
            if (p.level >= 5) memorized++;
        });
    });

    $('statTotal').textContent = total;
    $('statDue').textContent = due;
    $('statMemorized').textContent = memorized;
    $('statReviewsSide').textContent = appData.totalReviews;
    $('dueText').textContent = due;

    // Word Counter (Unique words in Level >= 5 phrases)
    const masteredWords = new Set();
    appData.lists.forEach(l => {
        l.phrases.filter(p => p.level >= 5).forEach(p => {
            const words = normalizeText(p.english).split(' ');
            words.forEach(w => { if (w.length > 2) masteredWords.add(w); });
        });
    });
    $('statWords').textContent = masteredWords.size;

    // Daily Goal (20 reviews)
    const today = new Date().toDateString();
    const reviewsToday = appData.history.filter(h => new Date(h.date).toDateString() === today).length;
    const goal = 20;
    const pct = Math.min(Math.round((reviewsToday / goal) * 100), 100);

    $('goalPct').textContent = pct + '%';
    $('goalCircle').style.strokeDasharray = `${pct}, 100`;

    updateGlobalLevel();
}

function updateGlobalLevel() {
    // New XP Weights: Quiz=5, Write=10, Pronounce=15, Speak=20
    let totalXP = 0;
    appData.lists.forEach(l => {
        l.phrases.forEach(p => {
            if (p.levels) {
                totalXP += (p.levels.quiz || 0) * 5;
                totalXP += (p.levels.write || 0) * 10;
                totalXP += (p.levels.pronounce || 0) * 15;
                totalXP += (p.levels.speak || 0) * 20;
            }
        });
    });

    // Dynamic Leveling: Level 1->2 (50XP), 2->3 (60XP), 3->4 (70XP)...
    // Formula derived: XP_total = 5N^2 + 35N - 40
    // Solving for N: N = (-35 + sqrt(2025 + 20 * totalXP)) / 10
    const globalLevel = Math.floor((-35 + Math.sqrt(2025 + 20 * totalXP)) / 10);

    // XP needed to reach current level start
    const xpForThisLevelStart = 5 * Math.pow(globalLevel, 2) + 35 * globalLevel - 40;
    // XP step for current level (to reach next)
    const xpStep = 50 + (globalLevel - 1) * 10;

    const currentXPInLevel = totalXP - xpForThisLevelStart;
    const xpPct = Math.min((currentXPInLevel / xpStep) * 100, 100);

    // Update all instances of level UI
    document.querySelectorAll('.globalLevelValue').forEach(el => el.textContent = globalLevel);
    document.querySelectorAll('.currentXPValue').forEach(el => el.textContent = Math.floor(currentXPInLevel));
    document.querySelectorAll('.globalLevelBarFill').forEach(el => el.style.width = xpPct + '%');

    // Update labels for required XP
    document.querySelectorAll('.nextLevelXPGoal').forEach(el => el.textContent = xpStep);

    if ($('totalXP')) $('totalXP').textContent = Math.floor(totalXP);
}

function renderLists() {
    const container = $('listsContainer');
    if (appData.lists.length === 0) {
        container.innerHTML = '<div class="card" style="grid-column: 1/-1; text-align:center;">Você ainda não tem listas. Crie uma para começar!</div>';
        return;
    }

    container.innerHTML = ''; // Limpar antes de renderizar para evitar duplicação
    appData.lists.forEach(l => {
        const dueCount = l.phrases.filter(p => isPhraseDue(p)).length;
        $('listsContainer').innerHTML += `
            <div class="card" style="display: flex; flex-direction: column; gap: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <h3 style="cursor: pointer;" onclick="selectList('${l.id}')">${escapeHTML(l.name)}</h3>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-outline btn-sm" onclick="exportIndividualList('${l.id}')" title="Exportar Lista">📤</button>
                        <button class="btn btn-outline btn-sm" style="color: var(--danger); border-color: transparent;" onclick="deleteList('${l.id}')">🗑️</button>
                    </div>
                </div>
                <div style="color: var(--text-muted); font-size: 0.9rem;">${l.phrases.length} frases</div>
                <button class="btn btn-primary btn-sm" onclick="selectList('${l.id}')">Ver Frases</button>
            </div>
        `;
    });
}

function selectList(id) {
    appData.currentListId = id;
    saveData(appData);
    renderPhrases();
    showView('phrasesView');
}

function renderPhrases() {
    const list = appData.lists.find(l => l.id === appData.currentListId);
    if (!list) return;

    $('currentListTitle').textContent = list.name;
    const container = $('phrasesContainer');
    container.innerHTML = '';

    if (list.phrases.length === 0) {
        container.innerHTML = '<div class="card" style="text-align:center; color:var(--text-muted);">Nenhuma frase nesta lista ainda.</div>';
        return;
    }

    const now = Date.now();
    list.phrases.slice().reverse().forEach(p => {
        const diff = p.nextReview - now;
        const dueText = diff <= 0 ? 'Agora' : formatRelativeTime(diff);
        const dueClass = diff <= 0 ? 'color: var(--danger); font-weight: 800;' : 'color: var(--text-muted); font-size: 0.8rem;';

        $('phrasesContainer').innerHTML += `
            <div class="card" style="padding: 20px; display: flex; justify-content: space-between; align-items: center; gap: 16px;">
                <div style="flex: 1;">
                    <div style="font-weight: 700;">${escapeHTML(p.english)}</div>
                    <div style="color: var(--text-muted); font-size: 0.9rem;">${escapeHTML(p.portuguese)}</div>
                    <div style="${dueClass}">Revisão: ${dueText}</div>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <!-- Skill Level Grid -->
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; font-size: 0.65rem; font-weight: 800; background: var(--primary-soft); padding: 6px 10px; border-radius: 10px; min-width: 80px; text-align: center;">
                        <div style="color: var(--primary);" title="Quiz">Q: ${p.levels?.quiz || 0}</div>
                        <div style="color: var(--success);" title="Escrita">W: ${p.levels?.write || 0}</div>
                        <div style="color: #f59e0b;" title="Pronúncia">P: ${p.levels?.pronounce || 0}</div>
                        <div style="color: var(--danger);" title="Fala">S: ${p.levels?.speak || 0}</div>
                    </div>
                    
                    <button class="btn btn-outline btn-sm" onclick="playAudio('${escapeJS(p.english)}')">🔊</button>
                    <button class="btn btn-outline btn-sm" style="color: var(--danger); border-color: transparent;" onclick="deletePhrase('${p.id}')">🗑️</button>
                </div>
            </div>
        `;
    });
}

function formatRelativeTime(ms) {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `em ${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `em ${min}min`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `em ${hours}h`;
    const days = Math.floor(hours / 24);
    return `em ${days}d`;
}

// ==================== METRICS ====================
function renderMetrics() {
    let allPhrases = [];
    appData.lists.forEach(l => allPhrases = allPhrases.concat(l.phrases));

    const skill = $('metricsSkillSelector')?.value || 'standard';
    const getLvl = (p, s) => p.levels?.[s || skill] || 0;

    // 1. TOP SUMMARY
    const totalHistory = appData.history.length;
    const correctHistory = appData.history.filter(h => h.correct).length;
    const accuracy = totalHistory === 0 ? 0 : Math.round((correctHistory / totalHistory) * 100);
    $('statAccuracy').textContent = accuracy + '%';
    $('statStreak').textContent = appData.streak;

    let totalPoints = 0;
    allPhrases.forEach(p => {
        if (p.levels) {
            totalPoints += (p.levels.quiz || 0) + (p.levels.write || 0) + (p.levels.pronounce || 0) + (p.levels.speak || 0);
        }
    });
    $('statTotalPoints').textContent = totalPoints;

    // 2. SKILL BREAKDOWN
    const skillData = [
        { id: 'quiz', name: 'Quiz', icon: '🧩', color: 'var(--primary)' },
        { id: 'write', name: 'Escrita', icon: '✍️', color: 'var(--success)' },
        { id: 'pronounce', name: 'Pronúncia', icon: '🗣️', color: '#f59e0b' },
        { id: 'speak', name: 'Fala', icon: '🎙️', color: 'var(--danger)' }
    ];

    $('skillBreakdownContainer').innerHTML = skillData.map(s => {
        const avg = allPhrases.length ? (allPhrases.reduce((acc, p) => acc + getLvl(p, s.id), 0) / allPhrases.length).toFixed(1) : 0;
        const pct = Math.min((avg / 5) * 100, 100);
        return `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-weight: 700; font-size: 0.9rem;">${s.icon} ${s.name}</span>
                    <span style="font-weight: 800; color: ${s.color}; font-size: 0.8rem;">Média Lvl ${avg}</span>
                </div>
                <div style="height: 8px; background: var(--border); border-radius: 4px; overflow: hidden;">
                    <div style="height: 100%; width: ${pct}%; background: ${s.color}; border-radius: 4px; transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);"></div>
                </div>
            </div>
        `;
    }).join('');

    // 3. LEARNING DISTRIBUTION
    const counts = { new: 0, learning: 0, mastered: 0 };
    allPhrases.forEach(p => {
        const lvl = getLvl(p);
        if (lvl === 0) counts.new++;
        else if (lvl < 5) counts.learning++;
        else counts.mastered++;
    });

    const total = Math.max(allPhrases.length, 1);
    const pNew = (counts.new / total) * 100;
    const pLearning = (counts.learning / total) * 100;
    const pMastered = (counts.mastered / total) * 100;

    $('levelDistribution').innerHTML = `
        <div style="width: ${pNew}%; background: #94a3b8; height: 100%; transition: width 0.8s;" title="Novas: ${counts.new}"></div>
        <div style="width: ${pLearning}%; background: var(--primary); height: 100%; transition: width 0.8s;" title="Aprendendo: ${counts.learning}"></div>
        <div style="width: ${pMastered}%; background: var(--success); height: 100%; transition: width 0.8s;" title="Dominadas: ${counts.mastered}"></div>
    `;

    const legends = $('levelLegend').children;
    if (legends.length >= 3) {
        legends[0].textContent = `⚪ Novas (${counts.new})`;
        legends[1].textContent = `🔵 Aprendendo (${counts.learning})`;
        legends[2].textContent = `🟢 Dominadas (${counts.mastered})`;
    }

    // 4. MASTERED PHRASES GRID
    const mastered = allPhrases.filter(p => getLvl(p) >= 5).sort((a, b) => getLvl(b) - getLvl(a)).slice(0, 12);
    const container = $('masteredPhrasesContainer');

    if (mastered.length === 0) {
        container.innerHTML = '<div class="card" style="grid-column: 1/-1; text-align:center; color:var(--text-muted);">Ainda não há frases dominadas nesta categoria.</div>';
    } else {
        container.innerHTML = mastered.map(p => `
            <div class="card" style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-left: 4px solid var(--success); animation: fadeIn 0.5s ease;">
                <div style="overflow: hidden;">
                    <div style="font-weight:700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(p.english)}</div>
                    <div style="color:var(--text-muted); font-size:0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(p.portuguese)}</div>
                </div>
                <div style="background: var(--success-soft); color: var(--success); padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 800; margin-left: 12px;">Lvl ${getLvl(p)}</div>
            </div>
        `).join('');
    }
}

// ==================== ACTIONS ====================
function startReview(mode = 'standard') {
    // Reset session state
    session.active = false;
    session.queue = [];
    session.current = null;
    session.mode = null;

    let allDue = [];
    appData.lists.forEach(l => {
        if (!l.phrases) return;
        allDue = allDue.concat(l.phrases.filter(p => isPhraseDue(p)));
    });

    if (allDue.length === 0) {
        alert("Nenhuma frase para revisar no momento!");
        return;
    }

    session.active = true;
    session.trainingMode = mode;

    // Ensure all phrases have levels object to avoid errors
    allDue.forEach(p => {
        if (!p.levels) {
            const lvl = p.level || 0;
            p.levels = { standard: lvl, quiz: lvl, write: lvl, pronounce: lvl, speak: lvl };
        }
    });

    const getLvl = (p) => (p.levels && p.levels[mode] !== undefined) ? p.levels[mode] : 0;

    const reviewPhrases = allDue.filter(p => getLvl(p) > 0).sort(() => Math.random() - 0.5);
    const newPhrases = allDue.filter(p => getLvl(p) === 0).sort(() => Math.random() - 0.5);

    session.queue = [...reviewPhrases, ...newPhrases];
    session.originalCount = session.queue.length;

    if (session.queue.length > 0) {
        showView('reviewView');
        nextPhrase();
    } else {
        session.active = false;
        alert("Ocorreu um erro ao preparar a sessão.");
    }
}


function nextPhrase() {
    if (session.queue.length === 0) {
        endSession();
        return;
    }

    session.current = session.queue.shift();
    session.mode = getModeForLevel(session.current, session.trainingMode);

    renderExercise();
    updateProgress();
}

function renderExercise() {
    const p = session.current;
    const modeLvl = p.levels?.[session.trainingMode === 'standard' ? 'standard' : session.trainingMode] || 0;

    $('phrasePt').textContent = p.portuguese;
    $('modeLabel').innerHTML = `
        <span style="background: var(--primary-soft); color: var(--primary); padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 800;">
            ${session.mode.toUpperCase()} - LV ${modeLvl}
        </span>
    `;

    $('quizArea').style.display = 'none';
    $('writeArea').style.display = 'none';
    $('speakArea').style.display = 'none';
    $('pronounceArea').style.display = 'none';

    // Initialize progress for speech modes
    session.matchedIndices = new Set();
    session.wordStatus = {}; // Tracks 'correct' or 'imprecise' for each word index
    const { status, statusCorrection } = { 
        status: $('micStatus'), 
        statusPronounce: $('micStatusPronounce'),
        statusCorrection: $('correctionVoiceHint')
    };
    if ($('micStatus')) {
        $('micStatus').textContent = "⚪ Microfone Desligado";
        $('micStatus').style.color = "var(--text-muted)";
    }
    if ($('micStatusPronounce')) {
        $('micStatusPronounce').textContent = "⚪ Microfone Desligado";
        $('micStatusPronounce').style.color = "var(--text-muted)";
    }
    if ($('correctionVoiceHint')) {
        $('correctionVoiceHint').textContent = "Aguardando...";
    }

    if (session.mode === 'quiz') {
        $('quizArea').style.display = 'grid';
        const options = generateQuizOptions(p);
        $('quizArea').innerHTML = options.map((opt, index) => `
            <button class="quiz-btn" style="animation: slideUp ${0.3 + index * 0.1}s ease-out;" data-shortcut="${index + 1}" onclick="checkQuizAnswer('${escapeJS(opt)}')">${escapeHTML(opt)}</button>
        `).join('');
    } else if (session.mode === 'write') {
        $('writeArea').style.display = 'block';
        $('writeInput').value = '';
        $('writeInputMirror').innerHTML = '';
        setTimeout(() => $('writeInput').focus(), 100);
    } else if (session.mode === 'pronounce') {
        $('pronounceArea').style.display = 'block';
        $('pronounceIntegrated').style.display = 'none';
        renderSpeechInitialState();
        playAudio(p.english);
    } else if (session.mode === 'speak') {
        $('speakArea').style.display = 'block';
        renderSpeechInitialState();
    }
}

function renderSpeechInitialState() {
    const target = session.current.english;
    const words = target.split(/\s+/);
    const { hint } = getActiveMicElements();
    if (!hint) return;

    const isPronounce = session.mode === 'pronounce';
    const isSpeak = session.mode === 'speak';

    let html = "";
    words.forEach(w => {
        const phon = getPhoneticGuide(w);
        if (isSpeak) {
            html += `<span style="color: var(--border); letter-spacing: 2px;">___</span> `;
        } else {
            html += `
                <div style="display: inline-block; text-align: center; margin: 5px; opacity: 0.4">
                    <div style="font-weight: 800; font-size: 1.2rem; color: var(--text-muted);">${w}</div>
                    <div style="font-size: 0.75rem; color: var(--primary);">${phon}</div>
                </div>
            `;
        }
    });

    hint.innerHTML = html;
}

function generateQuizOptions(correct) {
    let all = [];
    appData.lists.forEach(l => all = all.concat(l.phrases));
    const pool = all.filter(p => p.id !== correct.id).sort(() => Math.random() - 0.5);
    const options = [correct.english];
    for (let i = 0; i < 3 && i < pool.length; i++) options.push(pool[i].english);
    while (options.length < 4) options.push("Variation " + options.length);
    session.lastOptions = options.sort(() => Math.random() - 0.5);
    return session.lastOptions;
}

function checkQuizAnswer(selected) {
    const isCorrect = selected === session.current.english;
    const btns = document.querySelectorAll('.quiz-btn');
    btns.forEach(b => {
        if (b.textContent === session.current.english) b.classList.add('correct');
        else if (b.textContent === selected) b.classList.add('incorrect');
    });
    processAnswer(isCorrect, selected);
}

function checkWriteAnswer() {
    const val = $('writeInput').value.trim();
    const isCorrect = normalizeText(val) === normalizeText(session.current.english);
    processAnswer(isCorrect, val);
}

function updateWriteMirror() {
    const text = $('writeInput').value;
    if (text === '') {
        $('writeInputMirror').innerHTML = '';
        return;
    }

    const target = session.current.english;
    const targetNorm = normalizeText(target);
    const targetWordsNorm = targetNorm.split(' ');

    // Track word availability in target
    const wordCounts = {};
    targetWordsNorm.forEach(w => wordCounts[w] = (wordCounts[w] || 0) + 1);

    const tokens = text.match(/\S+|\s+/g) || [];
    let html = '';
    let cumulativeInput = '';

    // First pass: Pre-calculate Green matches to consume word counts
    const analyzedTokens = [];
    tokens.forEach((token, i) => {
        if (/\s+/.test(token)) {
            analyzedTokens.push({ type: 'space', content: token });
            cumulativeInput += token;
            return;
        }

        const isBeingTyped = (i === tokens.length - 1) && !text.endsWith(' ');
        const normU = normalizeText(token);
        const normUWords = normU.split(' ').filter(w => w);

        // Find how many words we've already matched in the target
        const wordsMatchedSoFar = analyzedTokens.reduce((acc, t) => {
            if (t.type === 'space') return acc;
            return acc + (t.normWords ? t.normWords.length : 0);
        }, 0);

        // Check if these words match the target words starting at wordsMatchedSoFar
        let isSequenceMatch = false;
        if (normUWords.length > 0) {
            const relevantTargetWords = targetWordsNorm.slice(wordsMatchedSoFar, wordsMatchedSoFar + normUWords.length);

            if (relevantTargetWords.length === normUWords.length) {
                const allMatch = normUWords.every((w, idx) => w === relevantTargetWords[idx]);
                if (allMatch) {
                    isSequenceMatch = true;
                } else if (isBeingTyped) {
                    // Check for prefix match on the last word of the normalized token
                    const lastWordMatch = relevantTargetWords[normUWords.length - 1].startsWith(normUWords[normUWords.length - 1]);
                    const previousWordsMatch = normUWords.slice(0, -1).every((w, idx) => w === relevantTargetWords[idx]);
                    if (lastWordMatch && previousWordsMatch) isSequenceMatch = true;
                }
            }
        } else if (normU === '' && token.length > 0) {
            // Handle case where token is just punctuation or something that normalizes to empty
            // Treat it as correct if it's in the right place? For now, just ignore it.
        }

        if (isSequenceMatch) {
            normUWords.forEach(w => { if (wordCounts[w] > 0) wordCounts[w]--; });
            analyzedTokens.push({ type: 'correct', content: token, normWords: normUWords, isBeingTyped });
        } else {
            analyzedTokens.push({ type: 'pending', content: token, normWords: normUWords, isBeingTyped });
        }


    });

    // Second pass: Generate HTML with correct colors
    analyzedTokens.forEach((tokenObj) => {
        if (tokenObj.type === 'space') {
            html += tokenObj.content;
            return;
        }

        let color = 'var(--danger)';
        const normWords = tokenObj.normWords || [];

        if (tokenObj.type === 'correct') {
            color = 'var(--success)';
        } else if (normWords.length > 0) {
            // Check for Yellow: Words exist in target and still have available counts
            const allWordsAvailable = normWords.every(w => wordCounts[w] > 0);
            if (allWordsAvailable) {
                color = 'var(--warning)';
                normWords.forEach(w => wordCounts[w]--);
            } else if (tokenObj.isBeingTyped) {
                // For "being typed", allow prefix match from the pool
                const canBePrefix = targetWordsNorm.some(w => wordCounts[w] > 0 && w.startsWith(normWords[normWords.length - 1]));
                const previousWordsMatch = normWords.slice(0, -1).every(w => wordCounts[w] > 0);
                if (canBePrefix && (normWords.length === 1 || previousWordsMatch)) {
                    color = 'var(--warning)';
                }
            }
        }


        html += `<span style="color: ${color}">${tokenObj.content}</span>`;
    });

    $('writeInputMirror').innerHTML = html;
}

// Initializing the input listener
setTimeout(() => {
    if ($('writeInput')) {
        $('writeInput').addEventListener('input', updateWriteMirror);
    }
}, 1000);

function calculateAccuracy(user, target) {
    const uWords = normalizeText(user).split(' ').filter(w => w);
    const tWords = normalizeText(target).split(' ').filter(w => w);
    if (tWords.length === 0) return 0;

    let correct = 0;
    tWords.forEach((word, i) => {
        if (uWords[i] === word) correct++;
    });

    return Math.round((correct / tWords.length) * 100);
}

function processAnswer(isCorrect, userVal) {
    const bar = $('feedbackBar');
    const info = $('feedbackInfo');
    const title = $('feedbackTitle');
    const text = $('feedbackText');

    bar.classList.add('active');
    info.className = `feedback-info ${isCorrect ? 'correct' : 'incorrect'}`;

    // Ensure levels object exists
    if (!session.current.levels) {
        session.current.levels = { standard: 0, quiz: 0, write: 0, pronounce: 0, speak: 0 };
    }
    const mode = session.trainingMode;

    if (isCorrect) {
        title.textContent = "Excelente! 🎉";
        text.innerHTML = `Resposta correta: <b>${escapeHTML(session.current.english)}</b>`;

        // Update level for the specific mode
        session.current.levels[mode]++;

        $('correctionArea').style.display = 'none';
        $('voiceCorrectionArea').style.display = 'none';
        $('btnContinue').style.display = 'block';

        // Play correct sound
        $('soundCorrect').play().catch(() => { });
    } else {
        const accuracy = calculateAccuracy(userVal, session.current.english);
        title.textContent = `${accuracy}% de acerto`;

        // HIGHLIGHT DIFFERENCES
        const highlight = highlightDifferences(userVal, session.current.english);
        text.innerHTML = `Você disse: <del>${escapeHTML(userVal)}</del><br>${highlight}`;

        session.current.levels[mode] = Math.max(0, session.current.levels[mode] - 1);

        // Also sync the standard level (optional, but keeps it somewhat in line)
        if (session.current.levels.standard !== undefined) {
            session.current.levels.standard = Math.max(0, session.current.levels.standard - 1);
        }


        // Always speak the correct answer on error
        playAudio(session.current.english);

        // Mandatory Correction
        if (session.mode === 'speak' || session.mode === 'pronounce') {
            $('voiceCorrectionArea').style.display = 'block';
            $('correctionArea').style.display = 'none';
            $('btnContinue').style.display = 'none';
            $('correctionVoiceHint').textContent = "Aperte o microfone e repita corretamente...";
        } else {
            $('correctionArea').style.display = 'block';
            $('voiceCorrectionArea').style.display = 'none';
            $('btnContinue').style.display = 'none';
            $('correctionInput').value = '';
            $('correctionInput').style.color = 'var(--text)';
            $('correctionInput').style.borderColor = 'var(--border)';
            $('correctionHint').textContent = "REESCREVA PARA CONTINUAR:";
            $('correctionHint').style.color = 'var(--danger)';
            $('correctionInput').focus();

            $('correctionInput').oninput = () => {
                if (normalizeText($('correctionInput').value) === normalizeText(session.current.english)) {
                    $('btnContinue').style.display = 'block';
                    $('correctionInput').style.color = 'var(--success)';
                    $('correctionInput').style.borderColor = 'var(--success)';
                    $('correctionHint').textContent = "PERFEITO! AGORA PODE CONTINUAR:";
                    $('correctionHint').style.color = 'var(--success)';
                } else {
                    $('btnContinue').style.display = 'none';
                    $('correctionInput').style.color = 'var(--text)';
                    $('correctionInput').style.borderColor = 'var(--border)';
                    $('correctionHint').textContent = "REESCREVA PARA CONTINUAR:";
                    $('correctionHint').style.color = 'var(--danger)';
                }
            };
        }
    }

    // Play Audio only if correct (on error it's already handled above)
    if (isCorrect) playAudio(session.current.english);

    // Update Stats
    appData.history.push({ date: Date.now(), correct: isCorrect });
    updateStreak();

    // SRS multipliers based on mode difficulty (Quiz < Write < Pronounce < Speak)
    const multipliers = {
        quiz: 1.0,
        write: 1.5,
        pronounce: 2.0,
        speak: 2.5
    };
    const multiplier = multipliers[session.mode] || 1.0;

    // SRS interval based on the level of the training mode performed and the mode multiplier
    const modeForLevel = session.trainingMode;
    const currentLvl = session.current.levels[modeForLevel] || 0;

    const baseInterval = SRS_INTERVALS[Math.min(currentLvl, 9)] * 60 * 1000;
    const interval = baseInterval * multiplier;

    session.current.nextReview = Date.now() + interval;

    // If it was correct, also update the standard level to progress the overall sequence
    if (isCorrect && mode !== 'standard') {
        session.current.levels.standard = Math.max(session.current.levels.standard || 0, session.current.levels[mode]);
    }

    appData.totalReviews++;
    if (currentRecognition) {
        currentRecognition.onend = null;
        currentRecognition.stop();
        currentRecognition = null;
    }

    saveData(appData);
    updateGlobalLevel();
}

function updateStreak() {
    const now = new Date();
    const today = now.toDateString();

    if (appData.lastReviewDate === today) return;

    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);

    if (appData.lastReviewDate === yesterday.toDateString()) {
        appData.streak++;
    } else if (!appData.lastReviewDate || appData.lastReviewDate !== today) {
        appData.streak = 1;
    }

    appData.lastReviewDate = today;
}

function continueSession() {
    $('feedbackBar').classList.remove('active');
    nextPhrase();
}

function endSession() {
    session.active = false;
    showView('homeView');

    const total = session.originalCount;
    const correct = appData.history.slice(-total).filter(h => h.correct).length;
    const pct = Math.round((correct / total) * 100);

    if (pct >= 70) {
        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#6366f1', '#ec4899', '#10b981']
        });
        $('soundFinish').play().catch(() => { });
    }

    setTimeout(() => {
        alert(`Sessão finalizada! 🎉\n\nVocê acertou ${correct} de ${total} frases (${pct}% de precisão).\nContinue assim!`);
    }, 500);
}

function updateProgress() {
    const pct = ((session.originalCount - session.queue.length - 1) / session.originalCount) * 100;
    $('progressFill').style.width = pct + '%';
}

function loadSamples() {
    const sample = {
        id: 'l_sample_' + Date.now(),
        name: 'Frases Básicas',
        phrases: [
            { id: 'p1_' + Date.now(), english: 'Hello, how are you?', portuguese: 'Olá, como vai você?', level: 0, nextReview: null },
            { id: 'p2_' + Date.now(), english: 'I like to learn English', portuguese: 'Eu gosto de aprender inglês', level: 0, nextReview: null },
            { id: 'p3_' + Date.now(), english: 'Where is the library?', portuguese: 'Onde fica a biblioteca?', level: 0, nextReview: null },
            { id: 'p4_' + Date.now(), english: 'See you later', portuguese: 'Até mais tarde', level: 0, nextReview: null },
            { id: 'p5_' + Date.now(), english: 'Good morning', portuguese: 'Bom dia', level: 0, nextReview: null }
        ]
    };
    appData.lists.push(sample);
    saveData(appData);
    renderStats();
    renderLists();
    alert("Frases de exemplo carregadas!");
}

// ==================== HELPERS ====================
const CONTRACTIONS = {
    "ain't": "am not", "aren't": "are not", "can't": "cannot", "could've": "could have",
    "couldn't": "could not", "didn't": "did not", "doesn't": "does not", "don't": "do not",
    "hadn't": "had not", "hasn't": "has not", "haven't": "have not", "he'd": "he would",
    "he'll": "he will", "he's": "he is", "how'd": "how did", "how'll": "how will",
    "how's": "how is", "i'd": "i would", "i'll": "i will", "i'm": "i am",
    "i've": "i have", "isn't": "is not", "it'd": "it would", "it'll": "it will",
    "it's": "it is", "might've": "might have", "mightn't": "might not", "must've": "must have",
    "mustn't": "must not", "shan't": "shall not", "she'd": "she would", "she'll": "she will",
    "she's": "she is", "should've": "should have", "shouldn't": "should not", "that'd": "that would",
    "that's": "that is", "there'd": "there would", "there's": "there is", "they'd": "they would",
    "they'll": "they will", "they're": "they are", "they've": "they have", "wasn't": "was not",
    "we'd": "we would", "we'll": "we will", "we're": "we are", "we've": "we have",
    "weren't": "were not", "what'll": "what will", "what're": "what are", "what's": "what is",
    "what've": "what have", "where'd": "where did", "where's": "where is", "who'd": "who would",
    "who'll": "who will", "who're": "who are", "who's": "who is", "who've": "who have",
    "won't": "will not", "would've": "would have", "wouldn't": "would not", "you'd": "you would",
    "you'll": "you will", "you're": "you are", "you've": "you have",
    "daren't": "dare not", "needn't": "need not", "oughtn't": "ought not",
    "y'all": "you all", "ma'am": "madam", "o'clock": "of the clock", "ne'er": "never", "o'er": "over",
    "let's": "let us", "someone's": "someone is", "somebody's": "somebody is", "everyone's": "everyone is",
    "everybody's": "everybody is", "everything's": "everything is", "nothing's": "nothing is",
    "anyone's": "anyone is", "anybody's": "anybody is", "here's": "here is", "there's": "there is",
    "where's": "where is", "when's": "when is", "why's": "why is", "how's": "how is"
};

let audioUnlocked = false;
function unlockAudio() {
    if (audioUnlocked) return;
    if (!('speechSynthesis' in window)) return;

    const silent = new SpeechSynthesisUtterance("");
    silent.volume = 0;
    window.speechSynthesis.speak(silent);
    audioUnlocked = true;
    console.log("Audio unlocked for mobile");
}

function expandContractions(text) {
    let lower = text.toLowerCase();
    // Replace different types of quotes with standard apostrophe first
    lower = lower.replace(/[’‘`]/g, "'");

    for (const [key, val] of Object.entries(CONTRACTIONS)) {
        const regex = new RegExp(`\\b${key}\\b`, 'g');
        lower = lower.replace(regex, val);
    }
    return lower;
}

function normalizeText(t) {
    if (!t) return '';
    let text = t.toLowerCase().trim();

    // Always expand contractions for comparison (ignores the setting for internal logic)
    text = expandContractions(text);

    // Remove punctuation but keep spaces. Replace hyphens with spaces.
    return text.replace(/[.,!?;:"()\[\]{}—–]/g, '').replace(/-/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
}

function getSimilarity(s1, s2) {
    let longer = s1;
    let shorter = s2;
    if (s1.length < s2.length) {
        longer = s2;
        shorter = s1;
    }
    let longerLength = longer.length;
    if (longerLength == 0) return 1.0;
    return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
}

function editDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();
    let costs = new Array();
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i == 0) costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) != s2.charAt(j - 1))
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

function escapeHTML(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escapeJS(s) { return s.replace(/'/g, "\\'"); }

function playAudio(t) {
    if (!t || !('speechSynthesis' in window)) return;

    unlockAudio(); // Ensure unlocked
    window.speechSynthesis.cancel();

    // Sync mic: Stop if active
    const wasListening = isRecognitionActive;
    if (wasListening) stopListening();

    const u = new SpeechSynthesisUtterance(t);
    
    // Sync mic: Restart after audio ends
    u.onend = () => {
        if (wasListening && session.active && (session.mode === 'speak' || session.mode === 'pronounce')) {
            startListening();
        }
    };

    const speak = () => {
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v =>
            v.lang.startsWith('en') &&
            (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Daniel'))
        ) || voices.find(v => v.lang.startsWith('en'));

        if (preferredVoice) u.voice = preferredVoice;
        u.lang = 'en-US';
        u.rate = appData.settings ? (appData.settings.slowAudio ? 0.6 : 0.9) : 0.9;

        window.speechSynthesis.speak(u);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.onvoiceschanged = null;
            speak();
        };
    } else {
        setTimeout(speak, 50);
    }
}

function addPhrase() {
    const eng = $('phraseEngInput').value.trim();
    const pt = $('phrasePtInput').value.trim();
    if (!eng || !pt) return;
    const list = appData.lists.find(l => l.id === appData.currentListId);
    list.phrases.push({
        id: 'ph_' + Date.now(),
        english: eng,
        portuguese: pt,
        levels: { standard: 0, quiz: 0, write: 0, pronounce: 0, speak: 0 },
        nextReview: null
    });
    saveData(appData);
    renderPhrases();
    renderStats();
    $('phraseEngInput').value = ''; $('phrasePtInput').value = ''; $('phraseEngInput').focus();
}


function highlightDifferences(user, correct) {
    const userWords = normalizeText(user).split(' ');
    const correctWords = correct.split(' '); // Original words for display
    const normCorrectWords = correctWords.map(w => normalizeText(w));

    let html = 'Resultado: ';

    userWords.forEach((uWord, i) => {
        if (!uWord) return;

        if (uWord === normCorrectWords[i]) {
            // Correct word, correct position
            html += `<span style="color: var(--success); font-weight: 700;">${uWord}</span> `;
        } else if (normCorrectWords.includes(uWord)) {
            // Correct word, WRONG position
            html += `<span style="color: var(--warning); font-weight: 700; text-decoration: underline;">${uWord}</span> `;
        } else {
            // Incorrect word
            html += `<span style="color: var(--danger); font-weight: 800;">${uWord}</span> `;
        }
    });

    html += `<br><br><span style="font-size: 0.9rem; color: var(--text-muted);">Frase esperada: <b>${correct}</b></span>`;
    html += `<br><span style="font-size: 0.9rem; color: var(--primary); font-weight: 700;">Dica de pronúncia: <span style="font-family: monospace;">[ ${getPhoneticGuide(correct)} ]</span></span>`;
    return html;
}

// ==================== SYSTEM DIALOGS ====================
window.alert = function (msg, title = "Aviso", icon = "ℹ️") {
    // Hide other modals
    $('newListModal').style.display = 'none';
    $('bulkAddModal').style.display = 'none';
    $('autoListModal').style.display = 'none';

    $('dialogTitle').textContent = title;
    $('dialogMessage').textContent = msg;
    $('dialogIcon').textContent = icon;
    $('dialogCancel').style.display = 'none';
    $('dialogConfirm').onclick = () => { $('systemDialog').style.display = 'none'; $('modalBg').style.display = 'none'; };
    $('modalBg').style.display = 'flex';
    $('systemDialog').style.display = 'block';
};

window.confirm = function (msg, onConfirm) {
    // Hide other modals
    $('newListModal').style.display = 'none';
    $('bulkAddModal').style.display = 'none';
    $('autoListModal').style.display = 'none';

    $('dialogTitle').textContent = "Confirmação";
    $('dialogMessage').textContent = msg;
    $('dialogIcon').textContent = "❓";
    $('dialogCancel').style.display = 'block';
    $('dialogCancel').onclick = () => { $('systemDialog').style.display = 'none'; $('modalBg').style.display = 'none'; };
    $('dialogConfirm').onclick = () => {
        $('systemDialog').style.display = 'none';
        $('modalBg').style.display = 'none';
        if (onConfirm) onConfirm();
    };
    $('modalBg').style.display = 'flex';
    $('systemDialog').style.display = 'block';
};


function closeDialog() {
    $('systemDialog').style.display = 'none';
    $('modalBg').style.display = 'none';
}

// ==================== DATA PORTABILITY ====================
function exportData() {
    const dataStr = JSON.stringify(appData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memoenglish_full_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function exportIndividualList(id) {
    const list = appData.lists.find(l => l.id === id);
    if (!list) return;
    const dataStr = JSON.stringify(list, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lista_${list.name.toLowerCase().replace(/\s+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importIndividualList(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.phrases && Array.isArray(data.phrases)) {
                // It's an individual list
                data.id = 'list_' + Date.now(); // New ID to avoid collision
                appData.lists.push(data);
                saveData(appData);
                renderLists();
                alert("Lista importada com sucesso!");
            } else {
                alert("Este arquivo não parece ser uma lista individual válida.");
            }
        } catch (err) {
            alert("Erro ao ler o arquivo!");
        }
    };
    reader.readAsText(file);
    input.value = '';
}

function importData(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.lists && Array.isArray(data.lists)) {
                confirm("Isso irá substituir todos os seus dados atuais. Deseja continuar?", () => {
                    appData = data;
                    saveData(appData);
                    location.reload();
                });
            } else {
                alert("Arquivo de backup inválido!");
            }
        } catch (err) {
            alert("Erro ao ler o arquivo!");
        }
    };
    reader.readAsText(file);
    input.value = '';
}

function deletePhrase(id) {
    const list = appData.lists.find(l => l.id === appData.currentListId);
    list.phrases = list.phrases.filter(p => p.id !== id);
    saveData(appData);
    renderPhrases();
}

function showAddListModal() {
    $('modalBg').style.display = 'flex';
    $('newListModal').style.display = 'block';
    $('bulkAddModal').style.display = 'none';
}
function closeModal() { $('modalBg').style.display = 'none'; }
function createList() {
    const n = $('newListName').value.trim();
    if (!n) return;
    appData.lists.push({ id: 'l_' + Date.now(), name: n, phrases: [] });
    saveData(appData);
    renderLists();
    closeModal();
    $('newListName').value = '';
}

// ==================== TRANSLATION & BULK ====================
async function translateText(text, sl, tl) {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        const data = await response.json();

        // Google returns an array of segments if there are multiple sentences
        let translatedText = "";
        if (data[0] && Array.isArray(data[0])) {
            translatedText = data[0].map(s => s[0]).join("");
        }

        return {
            translated: translatedText,
            detected: data[2] // Detected language
        };
    } catch (e) {
        console.error('Erro na tradução:', e);
        return null;
    }
}


async function translateField(sourceId, targetId, sl, tl) {
    const text = $(sourceId).value.trim();
    if (!text) return;

    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = '⏳';
    btn.disabled = true;

    const res = await translateText(text, sl, tl);
    if (res && res.translated) {
        $(targetId).value = res.translated;
    }

    btn.textContent = originalText;
    btn.disabled = false;
}

function showBulkModal() {
    $('modalBg').style.display = 'flex';
    $('newListModal').style.display = 'none';
    $('bulkAddModal').style.display = 'block';
}

async function processBulkAdd() {
    const rawInput = $('bulkInput').value.trim();
    if (!rawInput) return;

    const autoTranslate = $('autoTranslateBulk').checked;
    const list = appData.lists.find(l => l.id === appData.currentListId);

    const btn = $('btnProcessBulk');
    btn.disabled = true;
    btn.textContent = 'Processando...';

    // 1. Quebrar em linhas
    let lines = rawInput.split('\n').map(l => l.trim()).filter(l => l);

    // 2. Se não houver pontos e vírgulas e NÃO for auto-tradução, tentar detectar pares
    const hasSemicolon = rawInput.includes(';');

    if (!hasSemicolon && lines.length >= 2 && !autoTranslate) {

        // Tentar parear linhas: 1 com 2, 3 com 4...
        for (let i = 0; i < lines.length; i += 2) {
            const eng = lines[i];
            const pt = lines[i + 1];
            if (eng && pt) {
                list.phrases.push({
                    id: 'ph_' + Date.now() + Math.random(),
                    english: eng,
                    portuguese: pt,
                    levels: { standard: 0, quiz: 0, write: 0, pronounce: 0, speak: 0 },
                    nextReview: null
                });
            }
        }
    } else {
        // Lógica original baseada em ponto e vírgula
        for (let line of lines) {
            let [part1, part2] = line.split(';').map(s => s ? s.trim() : '');
            let eng = '', pt = '';

            if (part1 && part2) {
                eng = part1; pt = part2;
            } else if (part1 && !part2 && autoTranslate) {
                const res = await translateText(part1, 'auto', 'pt');
                if (res) {
                    if (res.detected === 'pt') {
                        const resEng = await translateText(part1, 'pt', 'en');
                        eng = resEng ? resEng.translated : '';
                        pt = part1;
                    } else {
                        eng = part1;
                        pt = res.translated;
                    }
                }
            } else if (part1 && !part2) {
                // Se só tem uma parte e não é auto-translate, ignora ou adiciona como eng (mas precisa de PT)
                continue;
            }

            if (eng && pt) {
                list.phrases.push({
                    id: 'ph_' + Date.now() + Math.random(),
                    english: eng,
                    portuguese: pt,
                    levels: { standard: 0, quiz: 0, write: 0, pronounce: 0, speak: 0 },
                    nextReview: null
                });
            }
        }
    }

    saveData(appData);
    renderPhrases();
    renderStats();

    closeModal();
    $('bulkInput').value = '';
    btn.disabled = false;
    btn.textContent = 'Adicionar Frases';
}


// ==================== START ====================
window.onload = () => {
    document.querySelectorAll('.nav-link, .mobile-nav-item').forEach(el => {
        el.addEventListener('click', () => {
            unlockAudio();
            showView(el.dataset.view);
        });
    });

    document.addEventListener('click', unlockAudio, { once: false });
    document.addEventListener('touchstart', unlockAudio, { once: false });

    document.onkeydown = (e) => {
        const isModalOpen = $('modalBg').style.display === 'flex';
        if (isModalOpen && e.key === 'Enter') return; // Let the modal handle Enter

        if (e.key === 'Enter') {
            if ($('feedbackBar').classList.contains('active')) {
                continueSession();
            } else if (session.active && session.mode === 'write') {
                // Only trigger if the user is actually typing in the write input or its wrapper
                if (document.activeElement === $('writeInput') || document.activeElement === $('correctionInput')) {
                    e.preventDefault();
                    if (document.activeElement === $('writeInput')) checkWriteAnswer();
                    // continueSession is already handled by the first if
                }
            }
        }

        // Quiz shortcuts - only if no modal is open and not typing in an input
        if (session.active && session.mode === 'quiz' && !$('feedbackBar').classList.contains('active') && !isModalOpen) {
            if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                if (['1', '2', '3', '4'].includes(e.key)) {
                    const index = parseInt(e.key) - 1;
                    if (session.lastOptions && session.lastOptions[index]) {
                        checkQuizAnswer(session.lastOptions[index]);
                    }
                }
            }
        }
    };


    // Load voices early
    if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
    }

    applyDarkMode();
    showView('homeView');
};

let currentRecognition = null;
let isRecognitionActive = false;

function getActiveMicElements() {
    const isPronounce = session.mode === 'pronounce';
    return {
        btn: $(isPronounce ? 'micBtnPronounce' : 'micBtn'),
        hint: $(isPronounce ? 'micHintPronounce' : 'micHint'),
        status: $(isPronounce ? 'micStatusPronounce' : 'micStatus')
    };
}

function toggleListening() {
    if (isRecognitionActive) {
        stopListening();
    } else {
        startListening();
    }
}

function stopListening() {
    if (currentRecognition) {
        currentRecognition.onend = null;
        currentRecognition.stop();
        currentRecognition = null;
    }
    isRecognitionActive = false;
    const { btn, status } = getActiveMicElements();
    if (btn) btn.classList.remove('listening');
    if (status) {
        status.textContent = "⚪ Microfone Desligado";
        status.style.color = "var(--text-muted)";
    }
}

function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert("Navegador sem suporte a voz.");

    if (currentRecognition) currentRecognition.stop();

    const rec = new SR();
    currentRecognition = rec;
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;

    const { btn, status, hint } = getActiveMicElements();

    isRecognitionActive = true;
    if (btn) btn.classList.add('listening');
    if (status) {
        status.textContent = "🎙️ Microfone Ativo (Gravando...)";
        status.style.color = "var(--danger)";
    }

    let success = false;

    rec.onresult = (e) => {
        let fullTranscript = '';
        let interimTranscript = '';

        for (let i = 0; i < e.results.length; ++i) {
            const res = e.results[i][0];
            if (e.results[i].isFinal) fullTranscript += res.transcript + ' ';
            else interimTranscript += res.transcript;
        }

        const t = (fullTranscript + interimTranscript).trim();
        const heard = normalizeText(t);
        const heardWords = heard.split(' ').filter(w => w.length > 0);
        const targetWords = session.current.english.split(' ');
        const normTargetWords = targetWords.map(w => normalizeText(w));

        // Use session.matchedIndices to preserve progress across restarts
        if (!session.matchedIndices) session.matchedIndices = new Set();

        normTargetWords.forEach((ntw, targetIdx) => {
            // If already perfectly matched, skip
            if (session.wordStatus[targetIdx] === 'correct') return;

            // 1. Check for Perfect Match (Direct Regex)
            const regex = new RegExp(`\\b${ntw}\\b`, 'i');
            if (regex.test(heard)) {
                session.wordStatus[targetIdx] = 'correct';
                session.matchedIndices.add(targetIdx);
                return;
            }

            // 2. Fuzzy Match and Word-by-Word logic
            for (let hw of heardWords) {
                const sim = getSimilarity(hw, ntw);
                if (sim > 0.85) {
                    session.wordStatus[targetIdx] = 'correct';
                    session.matchedIndices.add(targetIdx);
                    break;
                } else if (sim > 0.45) {
                    // Imprecise match (Yellow) - counts for completion but marked for improvement
                    session.wordStatus[targetIdx] = 'imprecise';
                    session.matchedIndices.add(targetIdx);
                }
            }
        });

        const isFullMatch = session.matchedIndices.size === normTargetWords.length;

        // Build UI feedback
        let displayedHTML = "";
        const isPronounceMode = session.mode === 'pronounce';
        const isSpeakMode = session.mode === 'speak';

        normTargetWords.forEach((ntw, idx) => {
            const status = session.wordStatus[idx];
            const foundMatch = status !== undefined;
            const isImprecise = status === 'imprecise';
            
            const color = status === 'correct' ? 'var(--success)' : (isImprecise ? 'var(--warning)' : 'var(--text-muted)');
            const opacity = foundMatch ? '1' : '0.4';
            const phon = getPhoneticGuide(targetWords[idx]);

            if (isSpeakMode) {
                if (foundMatch) {
                    displayedHTML += `<span style="color: ${color}; font-weight: 800; animation: scaleIn 0.3s ease;">${targetWords[idx]}</span> `;
                } else {
                    displayedHTML += `<span style="color: var(--border); letter-spacing: 2px;">___</span> `;
                }
            } else if (isPronounceMode) {
                displayedHTML += `
                    <div style="display: inline-block; text-align: center; margin: 5px; opacity: ${opacity}">
                        <div style="font-weight: 800; font-size: 1.2rem; color: ${color};">${targetWords[idx]}</div>
                        <div style="font-size: 0.75rem; color: var(--primary);">${phon}</div>
                    </div>
                `;
            } else {
                displayedHTML += `<span style="color: ${color}; font-weight: 700; opacity: ${opacity}">${targetWords[idx]}</span> `;
            }
        });

        const statusHTML = `<div style="margin-top: 12px; font-size: 0.8rem; color: var(--success); font-weight: 800;">● CAPTURANDO...</div>`;
        const displayHeard = heardWords.length > 12 ? '...' + heardWords.slice(-12).join(' ') : t;
        const rawHTML = t ? `<div style="font-size: 0.9rem; color: var(--text-muted); font-style: italic; margin-bottom: 12px;">Ouvi: "${displayHeard}"</div>` : '';

        if (isFullMatch) {
            success = true;
            rec.onend = null; // Prevent restart on success
            rec.stop();
            if (btn) btn.classList.remove('listening');
            if (status) {
                status.textContent = "✅ Concluído!";
                status.style.color = "var(--success)";
            }

            const impreciseWords = targetWords.filter((_, idx) => session.wordStatus[idx] === 'imprecise');
            let feedback = `<span style="color: var(--success); font-size: 1.5rem; font-weight: 800;">Perfeito! ✨</span>`;
            
            if (impreciseWords.length > 0) {
                feedback = `<span style="color: var(--warning); font-size: 1.2rem; font-weight: 800;">Quase lá! ⚠️</span><br>
                            <span style="font-size: 0.8rem; color: var(--text-muted);">Melhore a pronúncia de: <b>${impreciseWords.join(', ')}</b></span>`;
            }

            if (hint) hint.innerHTML = `${feedback}<br>${displayedHTML}`;
            setTimeout(() => processAnswer(true, session.current.english), impreciseWords.length > 0 ? 1500 : 800);
        } else {
            if (hint) hint.innerHTML = `${rawHTML}${displayedHTML || "Ouvindo..."}${statusHTML}`;
        }
    };

    rec.onerror = (e) => {
        if (e.error === 'no-speech') return;
        console.error('Speech error:', e.error);
    };

    rec.onend = () => {
        // Only restart if not successful AND still intended to be listening AND session is active
        const isCorrectMode = session.mode === 'speak' || session.mode === 'pronounce';
        if (!success && isRecognitionActive && session.active && isCorrectMode) {
            // Reduced delay for faster restart, aiming for "always on" feel
            setTimeout(() => {
                try { 
                    if (isRecognitionActive && !success) rec.start(); 
                } catch (err) { console.error("Erro ao reiniciar:", err); }
            }, 100);
        } else {
            stopListening();
        }
    };

    rec.start();
}

function startListeningCorrection() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert("Navegador sem suporte a voz.");

    if (currentRecognition) currentRecognition.stop();

    const recognition = new SR();
    currentRecognition = recognition;
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;

    let success = false;
    let finalTranscript = '';

    recognition.onstart = () => {
        $('micBtnCorrection').classList.add('listening');
        $('correctionVoiceHint').textContent = "Ouvindo...";
    };

    recognition.onresult = (event) => {
        let fullTranscript = '';
        let interimTranscript = '';
        let latestConfidence = 0;

        for (let i = 0; i < event.results.length; ++i) {
            const res = event.results[i][0];
            if (event.results[i].isFinal) fullTranscript += res.transcript + ' ';
            else interimTranscript += res.transcript;
            if (i === event.results.length - 1) latestConfidence = res.confidence;
        }

        const t = (fullTranscript + interimTranscript).trim();
        const heard = normalizeText(t);
        const heardWords = heard.split(' ');
        const target = normalizeText(session.current.english);
        const targetWords = session.current.english.split(' ');
        const normTargetWords = targetWords.map(w => normalizeText(w));

        let anyImpreciseMatch = false;
        for (let i = 0; i < event.results.length; i++) {
            const res = event.results[i][0];
            const resText = normalizeText(res.transcript);
            let isTargetPart = false;
            normTargetWords.forEach(ntw => { if (resText.includes(ntw)) isTargetPart = true; });

            if (isTargetPart && res.confidence < 0.88 && event.results[i].isFinal) {
                if (recentAttempt.includes(resText) || target.includes(resText)) {
                    anyImpreciseMatch = true;
                }
            }
        }

        const isFullMatch = heard === target ||
            heard.endsWith(" " + target) ||
            heard.startsWith(target + " ") ||
            heard.includes(" " + target + " ");

        let displayedHTML = "";
        let lastFirstWordIdx = -1;
        for (let i = heardWords.length - 1; i >= 0; i--) {
            if (heardWords[i] === normTargetWords[0]) {
                lastFirstWordIdx = i;
                break;
            }
        }

        const recentAttempt = lastFirstWordIdx !== -1 ? heardWords.slice(lastFirstWordIdx) : [];

        normTargetWords.forEach((ntw, idx) => {
            if (isFullMatch) {
                displayedHTML += `<span style="color: var(--success); font-weight: 700;">${targetWords[idx]}</span> `;
            } else if (recentAttempt[idx] === ntw) {
                displayedHTML += `<span style="color: var(--success); font-weight: 700;">${targetWords[idx]}</span> `;
            } else if (heardWords.includes(ntw)) {
                displayedHTML += `<span style="color: var(--warning); font-weight: 700;">${targetWords[idx]}</span> `;
            }
        });

        if (isFullMatch) {
            if (!anyImpreciseMatch && latestConfidence >= 0.88) {
                success = true;
                recognition.stop();
                $('correctionVoiceHint').innerHTML = `<span style="color: var(--success); font-weight: 800;">Pronúncia correta! 🎉</span>`;
                setTimeout(() => {
                    $('btnContinue').style.display = 'block';
                    $('voiceCorrectionArea').style.display = 'none';
                    $('feedbackTitle').textContent = "Agora sim! 🎉";
                    playAudio(session.current.english);
                }, 800);
            } else {
                $('correctionVoiceHint').innerHTML = `<span style="color: var(--warning); font-weight: 800;">Pronúncia imprecisa! Repita a frase.</span>`;
            }
        } else if (displayedHTML !== "") {
            $('correctionVoiceHint').innerHTML = `Ouvi: "${displayedHTML}"`;
        } else {
            $('correctionVoiceHint').textContent = "Ouvindo...";
        }
    };

    recognition.onend = () => {
        if (!success && session.active && currentRecognition === recognition) {
            setTimeout(() => {
                try { recognition.start(); } catch (e) { }
            }, 300);
        } else {
            $('micBtnCorrection').classList.remove('listening');
            $('correctionVoiceHint').textContent = "⚪ Microfone Desligado";
        }
    };

    recognition.start();
}

function deletePhrase(id) {
    confirm("Deseja apagar esta frase?", () => {
        appData.lists.forEach(l => {
            l.phrases = l.phrases.filter(p => p.id !== id);
        });
        saveData(appData);
        renderPhrases();
        renderStats();
    });
}

function deleteList(id) {
    confirm("Tem certeza que deseja apagar esta lista e todas as suas frases?", () => {
        appData.lists = appData.lists.filter(l => l.id !== id);
        saveData(appData);
        renderLists();
        renderStats();
    });
}

// ==================== SMART LIST GENERATOR ====================

const SENTENCE_POOL = [
    // DAILY
    { eng: "I need to buy some milk at the store.", pt: "Eu preciso comprar leite na loja.", topic: "daily" },
    { eng: "The weather is very cold today.", pt: "O tempo está muito frio hoje.", topic: "daily" },
    { eng: "What time do you usually wake up?", pt: "A que horas você costuma acordar?", topic: "daily" },
    { eng: "I am going to cook dinner tonight.", pt: "Eu vou cozinhar o jantar hoje à noite.", topic: "daily" },
    { eng: "Can you turn on the lights, please?", pt: "Você pode ligar as luzes, por favor?", topic: "daily" },
    { eng: "I forgot my keys at home.", pt: "Eu esqueci minhas chaves em casa.", topic: "daily" },
    { eng: "She is talking on the phone right now.", pt: "Ela está falando ao telefone agora.", topic: "daily" },
    { eng: "The children are playing in the park.", pt: "As crianças estão brincando no parque.", topic: "daily" },
    { eng: "I like to listen to music while working.", pt: "Eu gosto de ouvir música enquanto trabalho.", topic: "daily" },
    { eng: "He is drinking a glass of water.", pt: "Ele está bebendo um copo de água.", topic: "daily" },
    
    // BUSINESS
    { eng: "We need to schedule a meeting for next week.", pt: "Precisamos agendar uma reunião para a próxima semana.", topic: "business" },
    { eng: "Could you send me the report by email?", pt: "Você poderia me enviar o relatório por e-mail?", topic: "business" },
    { eng: "Our company is growing very fast.", pt: "Nossa empresa está crescendo muito rápido.", topic: "business" },
    { eng: "I have a lot of work to do today.", pt: "Eu tenho muito trabalho para fazer hoje.", topic: "business" },
    { eng: "The manager is happy with the results.", pt: "O gerente está feliz com os resultados.", topic: "business" },
    { eng: "Please let me know if you have any questions.", pt: "Por favor, me avise se tiver alguma dúvida.", topic: "business" },
    { eng: "We are looking for a new office.", pt: "Estamos procurando por um novo escritório.", topic: "business" },
    { eng: "The deadline is tomorrow afternoon.", pt: "O prazo é amanhã à tarde.", topic: "business" },
    { eng: "I am responsible for the marketing department.", pt: "Eu sou responsável pelo departamento de marketing.", topic: "business" },
    { eng: "Let's discuss this further in the next call.", pt: "Vamos discutir isso melhor na próxima chamada.", topic: "business" },

    // TRAVEL
    { eng: "Where is the nearest subway station?", pt: "Onde fica a estação de metrô mais próxima?", topic: "travel" },
    { eng: "I would like to check in, please.", pt: "Eu gostaria de fazer o check-in, por favor.", topic: "travel" },
    { eng: "How much is a ticket to the museum?", pt: "Quanto custa um ingresso para o museu?", topic: "travel" },
    { eng: "Is there a pharmacy near the hotel?", pt: "Tem uma farmácia perto do hotel?", topic: "travel" },
    { eng: "The flight was delayed for two hours.", pt: "O voo foi atrasado por duas horas.", topic: "travel" },
    { eng: "Can I have a map of the city?", pt: "Pode me dar um mapa da cidade?", topic: "travel" },
    { eng: "I need to exchange some money.", pt: "Eu preciso trocar um pouco de dinheiro.", topic: "travel" },
    { eng: "The view from the top is amazing.", pt: "A vista do topo é incrível.", topic: "travel" },
    { eng: "Is breakfast included in the price?", pt: "O café da manhã está incluído no preço?", topic: "travel" },
    { eng: "I am looking for the departure gate.", pt: "Estou procurando o portão de embarque.", topic: "travel" },

    // GENERAL
    { eng: "It is important to study every day.", pt: "É importante estudar todos os dias.", topic: "general" },
    { eng: "I believe that anything is possible.", pt: "Eu acredito que qualquer coisa é possível.", topic: "general" },
    { eng: "The world is full of beautiful places.", pt: "O mundo está cheio de lugares bonitos.", topic: "general" },
    { eng: "Knowledge is power.", pt: "Conhecimento é poder.", topic: "general" },
    { eng: "Don't give up on your dreams.", pt: "Não desista dos seus sonhos.", topic: "general" },
    { eng: "Life is a journey, not a destination.", pt: "A vida é uma jornada, não um destino.", topic: "general" },
    { eng: "Success depends on hard work.", pt: "O sucesso depende de trabalho duro.", topic: "general" },
    { eng: "Kindness is always free.", pt: "Gentileza é sempre de graça.", topic: "general" },
    { eng: "Everything happens for a reason.", pt: "Tudo acontece por uma razão.", topic: "general" },
    { eng: "The best is yet to come.", pt: "O melhor ainda está por vir.", topic: "general" }
];

function showAutoListModal() {
    $('modalBg').style.display = 'flex';
    $('autoListModal').style.display = 'block';
    $('newListModal').style.display = 'none';
    $('bulkAddModal').style.display = 'none';
    $('systemDialog').style.display = 'none';
}

function getMasteredWords() {
    const masteredWords = new Set();
    appData.lists.forEach(l => {
        l.phrases.forEach(p => {
            const lvl = p.levels?.standard || p.level || 0;
            if (lvl >= 3) {
                const words = normalizeText(p.english).split(' ');
                words.forEach(w => { if (w.length > 2) masteredWords.add(w); });
            }
        });
    });
    return masteredWords;
}

async function generateSmartList() {
    const count = parseInt($('autoListCount').value);
    const topic = $('autoListTopic').value;
    const masteredWords = getMasteredWords();
    
    const btn = $('btnGenerateAuto');
    btn.disabled = true;
    btn.textContent = '🤖 Analisando seu progresso...';

    // Simular processamento para dar um ar premium
    await new Promise(r => setTimeout(r, 1500));

    // Filter pool by topic
    let pool = SENTENCE_POOL;
    if (topic !== 'general') {
        pool = pool.filter(s => s.topic === topic);
    }

    // Smart Ranking Logic
    let scoredPool = pool.map(s => {
        const words = normalizeText(s.eng).split(' ');
        const knownCount = words.filter(w => masteredWords.has(w)).length;
        const totalWords = words.length;
        const knownRatio = knownCount / totalWords;
        
        // Scoring formula:
        // Ideal is 30% to 70% known words (Comprehensible Input)
        let score = 0;
        if (knownRatio > 0.2 && knownRatio < 0.8) score = 20;
        else if (knownRatio > 0) score = 10;
        else score = 5; // All new words is a backup

        return { ...s, score: score + Math.random() * 10 };
    });

    scoredPool.sort((a, b) => b.score - a.score);
    const selected = scoredPool.slice(0, count);

    if (selected.length === 0) {
        alert("Não encontrei frases suficientes para este tópico. Tente o modo Geral!");
        btn.disabled = false;
        btn.textContent = '✨ Gerar Lista';
        return;
    }

    saveGeneratedList(selected, topic);
}

function saveGeneratedList(phrases, topic) {
    const topicsMap = {
        'general': 'Geral',
        'daily': 'Vida Diária',
        'business': 'Trabalho/Business',
        'travel': 'Viagens'
    };
    
    const listName = `✨ IA: ${topicsMap[topic]} (${new Date().toLocaleDateString()})`;
    const newList = {
        id: 'l_auto_' + Date.now(),
        name: listName,
        phrases: phrases.map(p => ({
            id: 'ph_auto_' + Date.now() + Math.random(),
            english: p.eng,
            portuguese: p.pt,
            levels: { standard: 0, quiz: 0, write: 0, pronounce: 0, speak: 0 },
            nextReview: null
        }))
    };

    appData.lists.push(newList);
    saveData(appData);
    
    // UI Cleanup
    closeModal();
    const btn = $('btnGenerateAuto');
    btn.disabled = false;
    btn.textContent = '✨ Gerar Lista';
    
    renderLists();
    renderStats();
    
    // Success feedback
    confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
    });

    alert(`Lista "${listName}" gerada com sucesso! Ela combina palavras que você já conhece com novos termos úteis.`);
}

function updateStorageUsage() {
    const raw = localStorage.getItem(STORAGE_KEY) || "";
    const size = raw.length; // Approximate bytes for UTF-16 characters
    const limit = 5 * 1024 * 1024; // 5MB standard limit
    const pct = Math.min(((size / limit) * 100), 100).toFixed(2);
    
    if ($('storageUsageText')) $('storageUsageText').textContent = `${pct}% utilizado (${(size / 1024).toFixed(1)} KB / 5MB)`;
    if ($('storageUsageFill')) $('storageUsageFill').style.width = pct + '%';
}
