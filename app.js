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

function loadData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            const def = getDefaultData();
            // Merge defaults with loaded data to ensure all fields exist
            return { ...def, ...data };
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
    mode: 'quiz'
};

function getModeForLevel(level) {
    if (level === 0) return 'quiz';
    return level % 2 === 0 ? 'speak' : 'write';
}

// ==================== UI ====================
function $(id) { return document.getElementById(id); }

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    $(viewId).style.display = 'block';

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
    if (viewId === 'settingsView') populateSettings();
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
            <div class="card" style="padding: 20px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: 700;">${escapeHTML(p.english)}</div>
                    <div style="color: var(--text-muted); font-size: 0.9rem;">${escapeHTML(p.portuguese)}</div>
                    <div style="${dueClass}">Revisão: ${dueText}</div>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <div style="background: var(--primary-soft); color: var(--primary); padding: 4px 10px; border-radius: 8px; font-size: 0.8rem; font-weight: 800;">Lvl ${p.level}</div>
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

    // Level Distribution
    const counts = { new: 0, learning: 0, mastered: 0 };
    allPhrases.forEach(p => {
        if (p.level === 0) counts.new++;
        else if (p.level < 5) counts.learning++;
        else counts.mastered++;
    });

    const total = Math.max(allPhrases.length, 1);
    const pNew = (counts.new / total) * 100;
    const pLearning = (counts.learning / total) * 100;
    const pMastered = (counts.mastered / total) * 100;

    $('levelDistribution').innerHTML = `
        <div style="width: ${pNew}%; background: #94a3b8; height: 100%; transition: width 0.5s;" title="Novas: ${counts.new}"></div>
        <div style="width: ${pLearning}%; background: var(--primary); height: 100%; transition: width 0.5s;" title="Aprendendo: ${counts.learning}"></div>
        <div style="width: ${pMastered}%; background: var(--success); height: 100%; transition: width 0.5s;" title="Dominadas: ${counts.mastered}"></div>
    `;

    // Legend with counts
    const legends = $('levelLegend').children;
    if (legends.length >= 3) {
        legends[0].textContent = `⚪ Novas (${counts.new})`;
        legends[1].textContent = `🔵 Aprendendo (${counts.learning})`;
        legends[2].textContent = `🟢 Dominadas (${counts.mastered})`;
    }

    // Accuracy
    const totalHistory = appData.history.length;
    const correctHistory = appData.history.filter(h => h.correct).length;
    const accuracy = totalHistory === 0 ? 0 : Math.round((correctHistory / totalHistory) * 100);
    $('statAccuracy').textContent = accuracy + '%';

    // Streak
    $('statStreak').textContent = appData.streak;

    // Mastered Phrases
    const mastered = allPhrases.filter(p => p.level >= 5).sort((a, b) => b.level - a.level).slice(0, 10);
    const container = $('masteredPhrasesContainer');

    if (mastered.length === 0) {
        container.innerHTML = '<div class="card" style="text-align:center; color:var(--text-muted);">Você ainda não dominou nenhuma frase. Continue praticando!</div>';
    } else {
        container.innerHTML = mastered.map(p => `
            <div class="card" style="display:flex; justify-content:space-between; align-items:center; padding:12px 20px; border-left: 4px solid var(--success);">
                <div>
                    <div style="font-weight:700;">${escapeHTML(p.english)}</div>
                    <div style="color:var(--text-muted); font-size:0.9rem;">${escapeHTML(p.portuguese)}</div>
                </div>
                <span class="stat-label">Lvl ${p.level}</span>
            </div>
        `).join('');
    }
}

// ==================== ACTIONS ====================
function startReview() {
    let allDue = [];
    appData.lists.forEach(l => {
        allDue = allDue.concat(l.phrases.filter(p => isPhraseDue(p)));
    });

    if (allDue.length === 0) {
        alert("Nenhuma frase para revisar no momento!");
        return;
    }

    session.active = true;

    // PRIORITY: Level > 0 (Review) first, then Level == 0 (New)
    // Within each group, we still shuffle randomly
    const reviewPhrases = allDue.filter(p => p.level > 0).sort(() => Math.random() - 0.5);
    const newPhrases = allDue.filter(p => p.level === 0).sort(() => Math.random() - 0.5);

    session.queue = [...reviewPhrases, ...newPhrases];
    session.originalCount = session.queue.length;

    showView('reviewView');
    nextPhrase();
}

function nextPhrase() {
    if (session.queue.length === 0) {
        endSession();
        return;
    }

    session.current = session.queue.shift();
    session.mode = getModeForLevel(session.current.level);

    renderExercise();
    updateProgress();
}

function renderExercise() {
    const p = session.current;
    $('phrasePt').textContent = p.portuguese;
    $('modeLabel').textContent = `Modo: ${session.mode === 'quiz' ? 'Quiz' : session.mode === 'write' ? 'Escrita' : 'Fala'}`;

    $('quizArea').style.display = 'none';
    $('writeArea').style.display = 'none';
    $('speakArea').style.display = 'none';

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
    } else if (session.mode === 'speak') {
        $('speakArea').style.display = 'block';
        $('micHint').textContent = "Toque no microfone e fale em inglês";
    }
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
    const targetWords = target.split(/\s+/);
    const normTargetWords = targetWords.map(w => normalizeText(w));
    
    // Split by non-spaces and spaces to preserve character positions
    const tokens = text.match(/\S+|\s+/g) || [];
    let wordIdx = 0;
    let html = '';
    
    tokens.forEach((token, i) => {
        if (/\s+/.test(token)) {
            html += token;
            return;
        }
        
        const normU = normalizeText(token);
        const normT = normTargetWords[wordIdx];
        const isBeingTyped = (i === tokens.length - 1) && !text.endsWith(' ');
        
        let color = 'var(--danger)';
        
        if (normU === normT) {
            color = 'var(--success)';
        } else if (isBeingTyped && normT && normT.startsWith(normU)) {
            color = 'var(--success)';
        } else if (isBeingTyped && normTargetWords.some(ntw => ntw.startsWith(normU))) {
            color = 'var(--warning)';
        } else if (normTargetWords.includes(normU)) {
            color = 'var(--warning)';
        }
        
        html += `<span style="color: ${color}">${token}</span>`;
        wordIdx++;
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

    if (isCorrect) {
        title.textContent = "Excelente! 🎉";
        text.innerHTML = `Resposta correta: <b>${escapeHTML(session.current.english)}</b>`;
        session.current.level++;
        $('correctionArea').style.display = 'none';
        $('voiceCorrectionArea').style.display = 'none';
        $('btnContinue').style.display = 'block';

        // Play correct sound
        $('soundCorrect').play().catch(() => {});
    } else {
        const accuracy = calculateAccuracy(userVal, session.current.english);
        title.textContent = `Ops, quase lá. (${accuracy}% de acerto)`;
        
        // HIGHLIGHT DIFFERENCES
        const highlight = highlightDifferences(userVal, session.current.english);
        text.innerHTML = `Você disse: <del>${escapeHTML(userVal)}</del><br>${highlight}`;
        
        session.current.level = Math.max(0, session.current.level - 1);

        // Always speak the correct answer on error
        playAudio(session.current.english);

        // Mandatory Correction
        if (session.mode === 'speak') {
            $('voiceCorrectionArea').style.display = 'block';
            $('correctionArea').style.display = 'none';
            $('btnContinue').style.display = 'none';
            $('correctionVoiceHint').textContent = "Aperte o microfone e fale...";
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

    const interval = SRS_INTERVALS[Math.min(session.current.level, 9)] * 60 * 1000;
    session.current.nextReview = Date.now() + interval;
    appData.totalReviews++;
    if (currentRecognition) {
        currentRecognition.onend = null;
        currentRecognition.stop();
        currentRecognition = null;
    }

    saveData(appData);
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
        $('soundFinish').play().catch(() => {});
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
    
    // Always expand contractions if enabled
    if (appData.settings && appData.settings.expandContractions) {
        text = expandContractions(text);
    } else {
        // Even if disabled, we should at least standardize quotes
        text = text.replace(/[’‘`]/g, "'");
    }

    // Remove punctuation but keep spaces
    // We remove apostrophes that didn't match any contraction to handle things like "dont"
    return text.replace(/[.,!?;:"()\[\]{}—–-]/g, '').replace(/'/g, '').replace(/\s+/g, ' ').trim();
}

function escapeHTML(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escapeJS(s) { return s.replace(/'/g, "\\'"); }

function playAudio(t) {
    if (!t || !('speechSynthesis' in window)) return;

    unlockAudio(); // Ensure unlocked

    window.speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(t);
    
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
    list.phrases.push({ id: 'ph_' + Date.now(), english: eng, portuguese: pt, level: 0, nextReview: null });
    saveData(appData);
    renderPhrases();
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
    return html;
}

// ==================== SYSTEM DIALOGS ====================
window.alert = function (msg, title = "Aviso", icon = "ℹ️") {
    $('dialogTitle').textContent = title;
    $('dialogMessage').textContent = msg;
    $('dialogIcon').textContent = icon;
    $('dialogCancel').style.display = 'none';
    $('dialogConfirm').onclick = () => { $('systemDialog').style.display = 'none'; $('modalBg').style.display = 'none'; };
    $('modalBg').style.display = 'flex';
    $('systemDialog').style.display = 'block';
};

window.confirm = function (msg, onConfirm) {
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
        return {
            translated: data[0][0][0],
            detected: data[2] // Idioma detectado
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

    // 1. Decidir se é lista (;) ou texto corrido
    let lines = [];
    if (!rawInput.includes(';') && rawInput.length > 50) {
        // Texto corrido: quebrar por sentenças (. ! ?)
        lines = rawInput.match(/[^.!?]+[.!?]+/g) || [rawInput];
    } else {
        // Lista por linhas
        lines = rawInput.split('\n');
    }

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        let [part1, part2] = line.split(';').map(s => s ? s.trim() : '');
        let eng = '', pt = '';

        if (part1 && part2) {
            // Formato explícito Eng; Pt
            eng = part1; pt = part2;
        } else if (part1 && !part2) {
            // Apenas uma parte -> Detectar e Traduzir
            if (autoTranslate) {
                const res = await translateText(part1, 'auto', 'pt');
                if (res) {
                    if (res.detected === 'pt') {
                        // Era português, traduzir para inglês
                        const resEng = await translateText(part1, 'pt', 'en');
                        eng = resEng ? resEng.translated : '';
                        pt = part1;
                    } else {
                        // Era inglês (ou outro), traduzir para português
                        eng = part1;
                        pt = res.translated;
                    }
                }
            } else {
                // Sem auto-translate, assume que o usuário vai preencher depois? 
                // Melhor não adicionar ou adicionar como inglês.
                eng = part1;
            }
        }

        if (eng && pt) {
            list.phrases.push({
                id: 'ph_' + Date.now() + Math.random(),
                english: eng,
                portuguese: pt,
                level: 0,
                nextReview: null
            });
        }
    }

    saveData(appData);
    renderPhrases();
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
        if (e.key === 'Enter') {
            if ($('feedbackBar').classList.contains('active')) continueSession();
            else if (session.active && session.mode === 'write') {
                e.preventDefault();
                checkWriteAnswer();
            }
        }

        // Quiz shortcuts
        if (session.active && session.mode === 'quiz' && !$('feedbackBar').classList.contains('active')) {
            if (['1', '2', '3', '4'].includes(e.key)) {
                const index = parseInt(e.key) - 1;
                if (session.lastOptions && session.lastOptions[index]) {
                    checkQuizAnswer(session.lastOptions[index]);
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

function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert("Navegador sem suporte a voz.");
    
    if (currentRecognition) currentRecognition.stop();
    
    const rec = new SR();
    currentRecognition = rec;
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;
    
    $('micBtn').classList.add('listening');
    $('micHint').textContent = "Ouvindo...";
    
    let success = false;

    rec.onresult = (e) => {
        let fullTranscript = '';
        let interimTranscript = '';
        let anyImprecise = false;
        let latestConfidence = 0;

        for (let i = 0; i < e.results.length; ++i) {
            const res = e.results[i][0];
            if (e.results[i].isFinal) {
                fullTranscript += res.transcript + ' ';
                if (res.confidence < 0.88) anyImprecise = true;
            } else {
                interimTranscript += res.transcript;
            }
            if (i === e.results.length - 1) latestConfidence = res.confidence;
        }
        
        const t = (fullTranscript + interimTranscript).trim();
        const heard = normalizeText(t);
        const heardWords = heard.split(' ');
        const target = normalizeText(session.current.english);
        const targetWords = session.current.english.split(' ');
        const normTargetWords = targetWords.map(w => normalizeText(w));
        
        let anyImpreciseMatch = false;
        for (let i = 0; i < e.results.length; i++) {
            const res = e.results[i][0];
            const resText = normalizeText(res.transcript);
            let isTargetPart = false;
            normTargetWords.forEach(ntw => { if (resText.includes(ntw)) isTargetPart = true; });
            
            // Only count as imprecise if it's part of the target AND in our most recent attempt
            if (isTargetPart && res.confidence < 0.88 && e.results[i].isFinal) {
                if (recentAttempt.includes(resText) || target.includes(resText)) {
                    anyImpreciseMatch = true;
                }
            }
        }

        const isFullMatch = heard === target || 
                           heard.endsWith(" " + target) || 
                           heard.startsWith(target + " ") || 
                           heard.includes(" " + target + " ");
        
        // Build displayed words with color coding and "restart" support
        let displayedHTML = "";
        
        // Find the last index of the first word to identify the most recent attempt
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
                // Word is in the correct position in the most recent attempt
                displayedHTML += `<span style="color: var(--success); font-weight: 700;">${targetWords[idx]}</span> `;
            } else if (heardWords.includes(ntw)) {
                // Word was spoken but is currently misplaced
                displayedHTML += `<span style="color: var(--warning); font-weight: 700;">${targetWords[idx]}</span> `;
            }
        });

        if (isFullMatch) {
            if (!anyImpreciseMatch && latestConfidence >= 0.88) {
                success = true;
                rec.stop();
                $('micBtn').classList.remove('listening');
                $('micHint').innerHTML = `<span style="color: var(--success); font-size: 1.5rem; font-weight: 800;">Perfeito! ✨</span><br>${displayedHTML}`;
                setTimeout(() => processAnswer(true, session.current.english), 1000);
            } else {
                $('micHint').innerHTML = `${displayedHTML}<br><span style="color: var(--warning); font-weight: 800;">Pronúncia imprecisa! 🎙️</span><br><small style="color: var(--text-muted);">Tente repetir de forma mais nítida.</small>`;
            }
        } else {
            $('micHint').innerHTML = displayedHTML || "Ouvindo...";
            if (anyImpreciseMatch) $('micHint').innerHTML += '<br><small style="color:var(--warning)">Pronúncia ruim detectada!</small>';
        }
    };

    rec.onerror = (e) => {
        if (e.error === 'no-speech') return; // Ignore silence
        console.error('Speech error:', e.error);
        //$('micHint').textContent = "Erro ao ouvir. Tente de novo.";
    };

    rec.onend = () => {
        if (!success && session.active && session.mode === 'speak' && currentRecognition === rec) {
            // Auto-restart for "infinite" experience if not successful yet
            try { rec.start(); } catch(e) {}
        } else {
            $('micBtn').classList.remove('listening');
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
            try { recognition.start(); } catch(e) {}
        } else {
            $('micBtnCorrection').classList.remove('listening');
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
