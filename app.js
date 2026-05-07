// ==================== PWA INSTALLATION ====================
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    // Evita o mini-infobar padrão no mobile
    e.preventDefault();
    // Salva o evento para acionar depois
    deferredPrompt = e;
    // Mostra o botão na tela de configurações
    const installCard = document.getElementById('installAppCard');
    if (installCard) {
        installCard.style.display = 'block';
    }
});

function installPWA() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            document.getElementById('installAppCard').style.display = 'none';
            // Register background sync for periodic checks
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then(reg => {
                    if ('sync' in reg) {
                        reg.sync.register('background-check');
                    }
                });
            }
        }
        deferredPrompt = null;
    });
}

// ==================== DATA LAYER ====================
const STORAGE_KEY = 'memoenglish_data_v2';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxO5PcEJnB3M88trJRn96ae8UN40PfFgdOt8RZo5zQzVCzunuPidnP5zX-8m7ToK8K7/exec';

function getDefaultData() {
    return {
        lists: [],
        currentListId: null,
        totalReviews: 0,
        history: [], // { date: timestamp, correct: bool }
        streak: 0,
        lastReviewDate: null,
        phoneticCache: {},
        settings: {
            expandContractions: true,
            slowAudio: false,
            darkMode: false,
            notifications: true
        },
        definitionCache: {},
        translationCache: {},
        auth: {
            isLoggedIn: false,
            username: "",
            password: "",
            lastSync: null
        },
        syncSettings: {
            gasUrl: ""
        }
    };
}

function migrateData(data) {
    let modified = false;
    data.lists.forEach(l => {
        l.phrases.forEach(p => {
            if (!p.levels) {
                p.levels = { standard: 0, quiz: 0, write: 0, listen: 0, pronounce: 0, speak: 0 };
                modified = true;
            } else {
                // Ensure all keys exist even if object exists
                ['standard', 'quiz', 'write', 'listen', 'pronounce', 'speak'].forEach(k => {
                    if (p.levels[k] === undefined) {
                        p.levels[k] = 0;
                        modified = true;
                    }
                });
            }
            if (p.level !== undefined) {
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
    // Trigger background sync if possible
    if (data.auth && data.auth.isLoggedIn && navigator.onLine) {
        syncWithCloud(false);
    }
}

let appData = loadData();

// ==================== NOTIFICATIONS & COUNTDOWN ====================
let globalMinNextReview = null;
let notificationSent = false;
let swRegistration = null;

function displayNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') displayNotification(title, body);
        });
        return;
    }
    if (Notification.permission !== 'granted') return;

    const options = {
        body,
        icon: './assets/logo.png',
        badge: './assets/logo.png',
        tag: 'memoenglish-review-ready',
        renotify: true,
        requireInteraction: true,
        data: { url: window.location.origin }
    };

    const show = (reg) => {
        if (reg && reg.showNotification) {
            reg.showNotification(title, options).catch(() => {
                new Notification(title, options);
            });
        } else {
            new Notification(title, options);
        }
    };

    if (swRegistration) {
        show(swRegistration);
    } else if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(show).catch(() => {
            new Notification(title, options);
        });
    } else {
        new Notification(title, options);
    }
}

function startCountdownInterval() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
            swRegistration = reg;
        }).catch(() => {
            swRegistration = null;
        });
    }

    setInterval(() => {
        // Se temos um tempo futuro e ele acabou de ser atingido
        if (globalMinNextReview && Date.now() >= globalMinNextReview) {
            if (appData.settings.notifications !== false && !notificationSent && 'Notification' in window) {
                displayNotification("MemoEnglish", "Uma nova frase está pronta para revisão!");
                notificationSent = true;
            }
            // Atualiza a tela para mostrar que há frases devidas e recalcula o próximo tempo
            renderStats();
        }

        const container = $('countdownContainer');
        const countSpan = $('nextReviewCountdown');

        if (globalMinNextReview && Date.now() < globalMinNextReview) {
            const dueCount = parseInt($('dueText') ? $('dueText').textContent : '0');
            if (dueCount === 0) {
                if (container) container.style.display = 'block';
            } else {
                if (container) container.style.display = 'none';
            }
            const diff = globalMinNextReview - Date.now();
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            if (countSpan) countSpan.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        } else {
            if (container) container.style.display = 'none';
        }
    }, 1000);
}

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
    trainingMode: 'standard' // 'standard', 'quiz', 'write', 'listen', 'pronounce', 'speak'
};

function getModeForLevel(phrase, trainingMode) {
    if (trainingMode !== 'standard') return trainingMode;

    // Standard mode follows the sequence based on the standard level
    const level = phrase.levels?.standard || 0;
    if (level === 0) return 'quiz';
    if (level === 1) return 'write';
    if (level === 2) return 'listen';
    if (level === 3) return 'pronounce';
    return 'speak'; // Level 4 onwards: just speak, no more alternating
}

const PHONETIC_MAP = {
    "the": "dâ", "is": "íz", "are": "ár", "you": "iú", "how": "ráu", "what": "uót",
    "of": "óv", "for": "fór", "were": "uêr", "their": "dér", "to": "tú",
    "my": "mái", "name": "nêim", "a": "êi", "an": "én", "and": "énd"
};

let studiedWordsList = [];

function getPhoneticGuide(text) {
    if (!text) return "";
    const words = text.toLowerCase().replace(/[.,!?;:]/g, '').split(/\s+/);

    return words.map(w => {
        // 0. Dynamic Cached API Results
        if (appData.phoneticCache && appData.phoneticCache[w]) return appData.phoneticCache[w];

        // 1. Extended DB (CMUdict-based) - highest priority
        if (typeof PHONETICS_DB !== 'undefined' && PHONETICS_DB[w]) return PHONETICS_DB[w];

        // 2. Fallback small dictionary
        if (PHONETIC_MAP[w]) return PHONETIC_MAP[w];

        let p = w;

        // 3. Suffixes and Clusters (Order matters)
        p = p.replace(/tion\b/g, 'shun');
        p = p.replace(/sion\b/g, 'zhun');
        p = p.replace(/ture\b/g, 'tchur');
        p = p.replace(/ous\b/g, 'as');
        p = p.replace(/ight\b/g, 'áit');
        p = p.replace(/ing\b/g, 'in');

        // 4. Magic E (a_e, i_e, o_e, u_e)
        p = p.replace(/a([bcdfghjklmnpqrstvwxyz])e\b/g, 'êi$1');
        p = p.replace(/i([bcdfghjklmnpqrstvwxyz])e\b/g, 'ái$1');
        p = p.replace(/o([bcdfghjklmnpqrstvwxyz])e\b/g, 'ou$1');
        p = p.replace(/u([bcdfghjklmnpqrstvwxyz])e\b/g, 'iú$1');

        // 5. Consonants
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

        // 6. Vowel Clusters
        p = p.replace(/ee/g, 'í');
        p = p.replace(/ea/g, 'í');
        p = p.replace(/oo/g, 'u');
        p = p.replace(/ai|ay/g, 'êi');
        p = p.replace(/oi|oy/g, 'ói');
        p = p.replace(/ou|ow/g, 'áu');
        p = p.replace(/oa/g, 'ou');

        // 7. Individual Vowels (Short/General)
        p = p.replace(/a/g, 'é');
        p = p.replace(/i/g, 'í');

        // Final e cleanup
        if (p.length > 2 && p.endsWith('e')) p = p.slice(0, -1);

        // 8. Cleanup & Softening
        p = p.replace(/c([eiíé])/g, 'ss$1');
        p = p.replace(/c/g, 'k');
        p = p.replace(/y\b/g, 'i');
        p = p.replace(/kk/g, 'k');
        p = p.replace(/ss/g, 's');

        return p;
    }).join(' ');
}

// ==================== DYNAMIC PHONETICS API ====================
const ARPABET_MAP = {
    // Vowels
    'AA': 'a', 'AE': 'é', 'AH': 'a', 'AO': 'o', 'AW': 'áu', 'AY': 'ái',
    'EH': 'ê', 'ER': 'êr', 'EY': 'êi', 'IH': 'i', 'IY': 'í',
    'OW': 'ou', 'OY': 'ói', 'UH': 'u', 'UW': 'ú',
    // Consonants
    'B': 'b', 'CH': 'tch', 'D': 'd', 'DH': 'd', 'F': 'f', 'G': 'gu',
    'HH': 'r', 'JH': 'dj', 'K': 'k', 'L': 'l', 'M': 'm', 'N': 'n',
    'NG': 'n', 'P': 'p', 'R': 'r', 'S': 's', 'SH': 'sh', 'T': 't',
    'TH': 'd', 'V': 'v', 'W': 'u', 'Y': 'i', 'Z': 'z', 'ZH': 'zh'
};

function convertARPAbetToPT(arpaString) {
    if (!arpaString) return "";
    const tokens = arpaString.split(' ');
    let ptPhonetics = '';

    tokens.forEach(token => {
        const pureToken = token.replace(/[0-9]/g, '');
        if (ARPABET_MAP[pureToken]) {
            ptPhonetics += ARPABET_MAP[pureToken];
        } else if (pureToken) {
            ptPhonetics += pureToken.toLowerCase();
        }
    });

    return ptPhonetics.replace(/kk/g, 'k').replace(/ss/g, 's');
}

async function prefetchMissingPhonetics() {
    if (!appData.phoneticCache) appData.phoneticCache = {};

    const uniqueWords = new Set();
    appData.lists.forEach(l => {
        l.phrases.forEach(p => {
            const text = (p.english || "").toLowerCase().replace(/[.,!?;:]/g, '');
            const words = text.split(/\s+/).filter(w => w.length > 0);
            words.forEach(w => uniqueWords.add(w));
        });
    });

    let modified = false;

    for (let word of uniqueWords) {
        if (typeof PHONETICS_DB !== 'undefined' && PHONETICS_DB[word]) continue;
        if (PHONETIC_MAP[word]) continue;
        if (appData.phoneticCache[word] !== undefined) continue; // Already fetched or marked as empty

        try {
            const res = await fetch(`https://api.datamuse.com/words?sp=${word}&md=r&max=1`);
            const data = await res.json();
            if (data && data.length > 0 && data[0].tags) {
                const pronTag = data[0].tags.find(t => t.startsWith('pron:'));
                if (pronTag) {
                    const arpa = pronTag.split(':')[1].trim();
                    const ptPron = convertARPAbetToPT(arpa);
                    if (ptPron) {
                        appData.phoneticCache[word] = ptPron;
                        modified = true;
                        continue;
                    }
                }
            }
            // Mark as empty to avoid re-fetching
            appData.phoneticCache[word] = "";
            modified = true;
        } catch (e) {
            console.error("Erro ao buscar fonética para", word, e);
        }
    }

    if (modified) {
        saveData(appData);
        // If user is currently studying, refresh UI implicitly by next word rendering.
    }
}


// ==================== SYNC LAYER ====================

function calculateTotalProgress(data) {
    if (!data || !data.lists) return 0;
    let totalXP = 0;
    data.lists.forEach(l => {
        l.phrases.forEach(p => {
            if (p.levels) {
                const lq = p.levels.quiz || 0;
                totalXP += (5 * lq) + (1 * (lq * (lq + 1) / 2));
                const lw = p.levels.write || 0;
                totalXP += (10 * lw) + (2 * (lw * (lw + 1) / 2));
                const ll = p.levels.listen || 0;
                totalXP += (12 * ll) + (2.5 * (ll * (ll + 1) / 2));
                const lp = p.levels.pronounce || 0;
                totalXP += (15 * lp) + (3 * (lp * (lp + 1) / 2));
                const ls = p.levels.speak || 0;
                totalXP += (20 * ls) + (4 * (ls * (ls + 1) / 2));
            }
        });
    });
    return totalXP;
}

async function syncWithCloud(isManual = false) {
    if (!appData.auth.isLoggedIn) {
        if (isManual) alert("Por favor, faça login primeiro.");
        return;
    }

    const statusIndicator = $('syncStatusIndicator');
    const actionArea = $('syncActionArea');
    if (statusIndicator) statusIndicator.style.display = 'flex';
    if (actionArea) actionArea.style.display = 'flex';

    try {
        const remoteData = await callGas({
            action: 'load',
            username: appData.auth.username,
            password: appData.auth.password
        });

        if (remoteData && remoteData.success) {
            const remotePayload = remoteData.payload;

            if (!remotePayload) {
                // Cloud is empty, push local
                await pushToCloud();
            } else {
                const localXP = calculateTotalProgress(appData);
                const remoteXP = calculateTotalProgress(remotePayload);

                if (remoteXP > localXP) {
                    // Remote has more progress
                    const updateLocal = () => {
                        appData = { ...remotePayload, auth: appData.auth, syncSettings: appData.syncSettings };
                        appData.auth.lastSync = Date.now();
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
                        location.reload(); // Refresh to apply changes
                    };

                    if (isManual) {
                        confirm("Dados na nuvem têm mais progresso. Deseja atualizar o local com os dados da nuvem?", updateLocal);
                    } else {
                        // Silent update in background if remote is ahead? 
                        // User request: "sincronize... levando sempre em consideração qual está com o maior progresso"
                        // If remote is ahead, we should probably update.
                        updateLocal();
                    }
                } else if (localXP > remoteXP) {
                    // Local has more progress
                    await pushToCloud();
                } else {
                    // Equal progress, just update lastSync
                    appData.auth.lastSync = Date.now();
                }
            }
        }
    } catch (e) {
        console.error("Erro na sincronização:", e);
        if (isManual) alert("Erro ao sincronizar. Verifique sua conexão e a URL do script.");
    } finally {
        if (statusIndicator) statusIndicator.style.display = 'none';
        renderSyncStatus();
    }
}

async function pushToCloud() {
    const res = await callGas({
        action: 'save',
        username: appData.auth.username,
        password: appData.auth.password,
        payload: appData
    });
    if (res && res.success) {
        appData.auth.lastSync = Date.now();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    }
}

async function callGas(data) {
    try {
        const res = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify(data)
        });
        return await res.json();
    } catch (e) {
        console.error("GAS Call Error:", e);
        return { success: false, error: e.toString() };
    }
}

let currentCaptchaResult = null;

function generateCaptcha() {
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    currentCaptchaResult = num1 + num2;
    $('captchaText').textContent = `${num1} + ${num2} = ?`;
    $('loginCaptcha').value = '';
}

function showLoginModal() {
    openModal('loginModal');
    $('loginError').style.display = 'none';
    $('loginLoading').style.display = 'none';
    $('loginActionButtons').style.display = 'grid';
    $('loginModalHint').style.display = 'block';
    generateCaptcha();
}

async function handleLoginSubmit(mode) {
    const user = $('loginUser').value.trim();
    const pass = $('loginPass').value.trim();
    const captchaInput = parseInt($('loginCaptcha').value);
    const errorEl = $('loginError');
    const loadingEl = $('loginLoading');
    const actionsEl = $('loginActionButtons');
    const hintEl = $('loginModalHint');
    const captchaContainer = $('captchaContainer');

    if (!user || !pass) {
        errorEl.textContent = "Preencha todos os campos.";
        errorEl.style.display = 'block';
        return;
    }

    if (captchaInput !== currentCaptchaResult) {
        errorEl.textContent = "Verificação humana incorreta.";
        errorEl.style.display = 'block';
        generateCaptcha();
        return;
    }

    errorEl.style.display = 'none';
    loadingEl.style.display = 'block';
    actionsEl.style.display = 'none';
    hintEl.style.display = 'none';
    captchaContainer.style.display = 'none';

    try {
        const res = await callGas({
            action: mode, // 'login' or 'signup'
            username: user,
            password: pass
        });

        if (res && res.success) {
            appData.auth.isLoggedIn = true;
            appData.auth.username = user;
            appData.auth.password = pass;
            appData.auth.lastSync = Date.now();
            saveData(appData);

            // IMPORTANTE: Só fecha o modal após a sincronização inicial terminar
            // syncWithCloud(true) pode disparar um location.reload() se os dados da nuvem forem mais recentes
            await syncWithCloud(true);

            // Se não recarregou a página, fecha o modal normalmente
            closeModal();
            renderSyncStatus();
        } else {
            loadingEl.style.display = 'none';
            actionsEl.style.display = 'grid';
            hintEl.style.display = 'block';
            captchaContainer.style.display = 'block';
            generateCaptcha();
            errorEl.textContent = res.error || (mode === 'signup' ? "Usuário já existe." : "Usuário ou senha incorretos.");
            errorEl.style.display = 'block';
        }
    } catch (e) {
        loadingEl.style.display = 'none';
        actionsEl.style.display = 'grid';
        hintEl.style.display = 'block';
        captchaContainer.style.display = 'block';
        generateCaptcha();
        errorEl.textContent = "Erro de conexão.";
        errorEl.style.display = 'block';
    }
}

function handleLogout() {
    if (window.confirm) {
        window.confirm("Deseja realmente sair? Os dados locais permanecerão, mas a sincronização será desativada.", () => {
            appData.auth.isLoggedIn = false;
            appData.auth.username = "";
            appData.auth.password = "";
            saveData(appData);
            renderSyncStatus();
        });
    } else {
        // Fallback for native confirm if custom one fails to load
        if (confirm("Deseja realmente sair?")) {
            appData.auth.isLoggedIn = false;
            appData.auth.username = "";
            appData.auth.password = "";
            saveData(appData);
            renderSyncStatus();
        }
    }
}

function updateSyncUrl(url) {
    appData.syncSettings.gasUrl = url.trim();
    saveData(appData);
}

function manualSync() {
    syncWithCloud(true);
}

function renderSyncStatus() {
    const userInfo = $('syncUserInfo');
    const loggedOutView = $('syncLoggedOutView');
    const userDisplay = $('syncUserDisplay');
    const lastSync = $('syncLastTime');
    const actionArea = $('syncActionArea');
    const displayPass = $('displayPassword');

    if (appData.auth.isLoggedIn) {
        if (loggedOutView) loggedOutView.style.display = 'none';
        if (userInfo) userInfo.style.display = 'block';
        if (actionArea) actionArea.style.display = 'flex';
        if (userDisplay) userDisplay.textContent = `Usuário: ${appData.auth.username}`;
        if (displayPass) displayPass.value = appData.auth.password;
        if (lastSync) {
            const time = appData.auth.lastSync ? new Date(appData.auth.lastSync).toLocaleString() : "Nunca";
            lastSync.textContent = `Última sincronização: ${time}`;
        }
    } else {
        if (loggedOutView) loggedOutView.style.display = 'block';
        if (userInfo) userInfo.style.display = 'none';
        if (actionArea) actionArea.style.display = 'none';
    }
}

function togglePasswordVisibility(inputId) {
    const passInput = $(inputId || 'displayPassword');
    if (!passInput) return;

    if (passInput.type === 'password') {
        passInput.type = 'text';
    } else {
        passInput.type = 'password';
    }
}

window.addEventListener('online', () => {
    if (appData.auth.isLoggedIn) syncWithCloud(false);
});

// ==================== UI ====================
function $(id) { return document.getElementById(id); }

function showView(viewId) {
    // Stop any active recognition when switching views
    stopListening();

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
    $('settingNotifications').checked = appData.settings.notifications !== false;
}

function updateSetting(key, val) {
    if (!appData.settings) appData.settings = {};
    appData.settings[key] = val;
    saveData(appData);
    if (key === 'darkMode') applyDarkMode();
    if (key === 'notifications' && val && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function applyDarkMode() {
    document.body.classList.toggle('dark-mode', appData.settings.darkMode);
}

function renderStats() {
    let total = 0, due = 0, memorized = 0;
    let minTime = Infinity;

    appData.lists.forEach(l => {
        total += l.phrases.length;
        l.phrases.forEach(p => {
            if (isPhraseDue(p)) {
                due++;
            } else if (p.nextReview && p.nextReview < minTime) {
                minTime = p.nextReview;
            }
            if (p.level >= 5) memorized++;
        });
    });

    globalMinNextReview = minTime === Infinity ? null : minTime;

    // Reseta a notificação se não houver mais frases atrasadas, 
    // ou seja, o usuário limpou a fila e estamos aguardando a próxima.
    if (due === 0) {
        notificationSent = false;
    }

    $('statTotal').textContent = total;
    $('statDue').textContent = due;
    $('statMemorized').textContent = memorized;
    $('statReviewsSide').textContent = appData.totalReviews;
    $('dueText').textContent = due;

    // Calculate stats based on specific levels (Write, Pronounce, Speak)
    let totalStudiedWords = 0;
    let memorizedCount = 0;
    const studiedWordsSet = new Set();

    appData.lists.forEach(l => {
        l.phrases.forEach(p => {
            const lv = p.levels || {};
            const isStudied = (lv.quiz > 0 || lv.write > 0 || lv.listen > 0 || lv.pronounce > 0 || lv.speak > 0);
            const isMemorized = (lv.quiz >= 5 || lv.write >= 5 || lv.listen >= 5 || lv.pronounce >= 5 || lv.speak >= 5);

            if (isStudied) {
                const words = normalizeText(p.english).split(/\s+/).filter(w => w.length > 1);
                words.forEach(w => studiedWordsSet.add(w));
            }
            if (isMemorized) {
                memorizedCount++;
            }
        });
    });

    $('statWords').textContent = studiedWordsSet.size;
    $('statMemorized').textContent = memorizedCount;

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
    // New XP Weights: Quiz=5, Write=10, Listen=12, Pronounce=15, Speak=20
    let totalXP = 0;
    appData.lists.forEach(l => {
        l.phrases.forEach(p => {
            if (p.levels) {
                // Formula: Sum of (Base + Mult*i) for i from 1 to L
                // Sum = Base*L + Mult * (L*(L+1)/2)

                const lq = p.levels.quiz || 0;
                totalXP += (5 * lq) + (1 * (lq * (lq + 1) / 2));

                const lw = p.levels.write || 0;
                totalXP += (10 * lw) + (2 * (lw * (lw + 1) / 2));

                const ll = p.levels.listen || 0;
                totalXP += (12 * ll) + (2.5 * (ll * (ll + 1) / 2));

                const lp = p.levels.pronounce || 0;
                totalXP += (15 * lp) + (3 * (lp * (lp + 1) / 2));

                const ls = p.levels.speak || 0;
                totalXP += (20 * ls) + (4 * (ls * (ls + 1) / 2));
            }
        });
    });

    // Dynamic Leveling: Level 1->2 (50XP), 2->3 (100XP), 3->4 (150XP)...
    // Total XP required to REACH level L: 25 * (L^2 - L)
    // Solving for L: L = (1 + sqrt(1 + 4 * totalXP / 25)) / 2
    const baseL = (1 + Math.sqrt(1 + 4 * totalXP / 25)) / 2;
    const globalLevel = Math.floor(baseL);

    // XP needed to reach current level start
    const xpForThisLevelStart = 25 * (Math.pow(globalLevel, 2) - globalLevel);
    // XP step for current level (to reach next)
    const xpStep = globalLevel * 50;

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

    container.innerHTML = '';
    appData.lists.forEach(l => {
        const dueCount = l.phrases.filter(p => isPhraseDue(p)).length;
        $('listsContainer').innerHTML += `
            <div class="card" style="display: flex; flex-direction: column; gap: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                    <div style="flex: 1; min-width: 0;">
                        <h3 style="cursor: pointer; margin-bottom: 4px; overflow-wrap: break-word; line-height: 1.3;" onclick="selectList('${l.id}')">${escapeHTML(l.name)}</h3>
                        <div style="color: var(--text-muted); font-size: 0.85rem; font-weight: 600;">${l.phrases.length} frases • <span style="color: var(--danger)">${dueCount} revisões</span></div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;">
                        <button class="btn btn-outline btn-sm" onclick="showEditListModal('${l.id}')" title="Renomear Lista">✏️</button>
                        <button class="btn btn-outline btn-sm" onclick="exportIndividualList('${l.id}')" title="Exportar Lista">📤</button>
                        <button class="btn btn-outline btn-sm" style="color: var(--danger); border-color: transparent;" onclick="deleteList('${l.id}')">🗑️</button>
                    </div>
                </div>
                <button class="btn btn-primary btn-sm" onclick="selectList('${l.id}')">Abrir Lista</button>
            </div>
        `;
    });
}

function selectList(id) {
    appData.currentListId = id;
    saveData(appData);
    if ($('phraseSearchInput')) $('phraseSearchInput').value = '';
    renderPhrases();
    showView('phrasesView');
}

function renderPhrases(filter = "") {
    const list = appData.lists.find(l => l.id === appData.currentListId);
    if (!list) return;

    $('currentListTitle').textContent = list.name;
    const container = $('phrasesContainer');
    container.innerHTML = '';

    const query = filter.toLowerCase().trim();
    let phrasesToRender = list.phrases.filter(p =>
        p.english.toLowerCase().includes(query) ||
        p.portuguese.toLowerCase().includes(query)
    );

    if (phrasesToRender.length === 0) {
        container.innerHTML = `<div class="card" style="text-align:center; color:var(--text-muted);">${query ? 'Nenhuma frase encontrada para esta busca.' : 'Nenhuma frase nesta lista ainda.'}</div>`;
        return;
    }

    // Apply Sorting
    const sortMode = $('phraseSortSelector')?.value || 'newest';
    if (sortMode === 'due') {
        phrasesToRender.sort((a, b) => {
            const nextA = a.nextReview || 0;
            const nextB = b.nextReview || 0;
            return nextA - nextB;
        });
    } else if (sortMode === 'due_far') {
        phrasesToRender.sort((a, b) => {
            const nextA = a.nextReview || 0;
            const nextB = b.nextReview || 0;
            return nextB - nextA;
        });
    } else if (sortMode === 'oldest') {
        // Default is oldest first in appData.lists[i].phrases
    } else {
        // newest (default)
        phrasesToRender = phrasesToRender.slice().reverse();
    }

    const now = Date.now();
    phrasesToRender.forEach(p => {
        const diff = (p.nextReview || 0) - now;
        const dueText = diff <= 0 ? 'Agora' : formatRelativeTime(diff);
        const dueClass = diff <= 0 ? 'color: var(--danger); font-weight: 800;' : 'color: var(--text-muted); font-size: 0.8rem;';

        container.innerHTML += `
            <div class="card phrase-card" id="phrase-${p.id}">
                <div class="phrase-content">
                    <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 4px;">${escapeHTML(p.english)}</div>
                    <div style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 8px;">${escapeHTML(p.portuguese)}</div>
                    <div style="${dueClass}">Revisão: ${dueText}</div>
                </div>
                
                <div class="phrase-meta">
                    <!-- Skill Level Grid -->
                    <div class="skill-grid-mini">
                        <div style="color: var(--primary);" title="Quiz">Q: ${p.levels?.quiz || 0}</div>
                        <div style="color: var(--success);" title="Escrita">W: ${p.levels?.write || 0}</div>
                        <div style="color: #06b6d4;" title="Escuta">L: ${p.levels?.listen || 0}</div>
                        <div style="color: #f59e0b;" title="Pronúncia">P: ${p.levels?.pronounce || 0}</div>
                        <div style="color: var(--danger);" title="Fala">S: ${p.levels?.speak || 0}</div>
                    </div>
                    
                    <div class="phrase-actions">
                        <button class="btn btn-outline btn-sm" onclick="playAudio('${escapeJS(p.english)}')" title="Ouvir">🔊</button>
                        <button class="btn btn-outline btn-sm" onclick="showMovePhraseModal('${p.id}')" title="Mover">📁</button>
                        <button class="btn btn-outline btn-sm" style="color: var(--danger); border-color: transparent;" onclick="deletePhrase('${p.id}')">🗑️</button>
                    </div>
                </div>
            </div>
        `;
    });
}

function handleGlobalSearch(query) {
    const q = query.toLowerCase().trim();
    const resultsContainer = $('searchResultsContainer');
    const resultsList = $('searchResultsList');
    const clearBtn = $('clearGlobalSearch');

    if (!q) {
        resultsContainer.style.display = 'none';
        clearBtn.style.display = 'none';
        renderLists(); // Refresh lists to show all
        return;
    }

    clearBtn.style.display = 'block';
    resultsContainer.style.display = 'block';
    resultsList.innerHTML = '';

    let foundAny = false;
    const now = Date.now();

    // Search phrases in all lists
    appData.lists.forEach(l => {
        const matches = l.phrases.filter(p =>
            p.english.toLowerCase().includes(q) ||
            p.portuguese.toLowerCase().includes(q)
        );

        matches.forEach(p => {
            foundAny = true;
            const diff = (p.nextReview || 0) - now;
            const dueText = diff <= 0 ? 'Agora' : formatRelativeTime(diff);
            const dueClass = diff <= 0 ? 'color: var(--danger); font-weight: 800;' : 'color: var(--text-muted); font-size: 0.8rem;';

            resultsList.innerHTML += `
                <div class="card phrase-card" style="border-left: 4px solid var(--primary);">
                    <div class="phrase-content">
                        <div style="font-size: 0.7rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 4px;">LISTA: ${escapeHTML(l.name)}</div>
                        <div style="font-weight: 700; font-size: 1rem; margin-bottom: 4px;">${escapeHTML(p.english)}</div>
                        <div style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 8px;">${escapeHTML(p.portuguese)}</div>
                        <div style="${dueClass}">Revisão: ${dueText}</div>
                    </div>
                    <div class="phrase-actions">
                        <button class="btn btn-primary btn-sm" onclick="selectListAndScroll('${l.id}', '${p.id}')">Ir para Lista</button>
                    </div>
                </div>
            `;
        });
    });

    if (!foundAny) {
        resultsList.innerHTML = '<div class="card" style="text-align:center; color:var(--text-muted);">Nenhuma frase encontrada em nenhuma lista.</div>';
    }

    // Also filter lists by name
    const listCards = $('listsContainer').children;
    Array.from(listCards).forEach(card => {
        const title = card.querySelector('h3')?.textContent.toLowerCase() || '';
        if (title.includes(q)) {
            card.style.display = 'flex';
        } else if (foundAny) {
            // If we found phrases, we might want to hide lists that don't match the name to focus on results
            card.style.display = 'none';
        } else {
            card.style.display = 'flex';
        }
    });
}

function selectListAndScroll(listId, phraseId) {
    selectList(listId);
    setTimeout(() => {
        const el = $(`phrase-${phraseId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.style.border = '2px solid var(--primary)';
            el.style.boxShadow = '0 0 30px var(--primary-soft)';
            setTimeout(() => {
                el.style.border = '';
                el.style.boxShadow = '';
            }, 3000);
        }
    }, 400);
}

function clearGlobalSearch() {
    $('globalSearchInput').value = '';
    handleGlobalSearch('');
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
            totalPoints += (p.levels.quiz || 0) + (p.levels.write || 0) + (p.levels.listen || 0) + (p.levels.pronounce || 0) + (p.levels.speak || 0);
        }
    });
    $('statTotalPoints').textContent = totalPoints;

    // 2. SKILL BREAKDOWN
    const skillData = [
        { id: 'quiz', name: 'Quiz', icon: '🧩', color: 'var(--primary)' },
        { id: 'write', name: 'Escrita', icon: '✍️', color: 'var(--success)' },
        { id: 'listen', name: 'Escuta', icon: '👂', color: '#06b6d4' },
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
        let lvl;
        if (skill === 'standard') {
            // New rule: Mastery if any skill >= 5
            const isMastered = (p.levels?.quiz >= 5 || p.levels?.write >= 5 || p.levels?.listen >= 5 || p.levels?.pronounce >= 5 || p.levels?.speak >= 5);
            if (isMastered) {
                counts.mastered++;
            } else {
                lvl = getLvl(p); // Standard level
                if (lvl === 0) counts.new++;
                else counts.learning++;
            }
        } else {
            lvl = getLvl(p);
            if (lvl === 0) counts.new++;
            else if (lvl < 5) counts.learning++;
            else counts.mastered++;
        }
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

    // 4. MASTERED PHRASES GRID (Moved to Modal, but still keeping helper for updates)
    renderMasteredPhrases();
}

function showMasteredModal() {
    renderMasteredPhrases();
    openModal('masteredModal');
}

function showStudiedWordsModal() {
    openModal('studiedWordsModal');
    renderStudiedWordsModal();
}

async function getWordDefinition(word) {
    if (!word) return { definition: '' };
    const normalized = word.toLowerCase().trim();
    appData.definitionCache = appData.definitionCache || {};
    if (appData.definitionCache[normalized]) return appData.definitionCache[normalized];

    try {
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalized)}`);
        if (!res.ok) throw new Error('not-found');
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            const entry = data[0];
            const meaning = entry.meanings?.find(m => Array.isArray(m.definitions) && m.definitions.length > 0);
            const definitionText = meaning?.definitions?.[0]?.definition || entry.meanings?.[0]?.definitions?.[0]?.definition || '';
            const label = meaning?.partOfSpeech ? `${meaning.partOfSpeech}: ` : '';
            const definition = definitionText ? `${label}${definitionText}` : '';
            appData.definitionCache[normalized] = { definition };
            saveData(appData);
            return appData.definitionCache[normalized];
        }
    } catch (e) {
        console.error('Erro ao buscar definição para', word, e);
    }

    appData.definitionCache[normalized] = { definition: '' };
    saveData(appData);
    return appData.definitionCache[normalized];
}

async function translateTextToPortuguese(text) {
    if (!text) return '';
    appData.translationCache = appData.translationCache || {};
    if (appData.translationCache[text]) return appData.translationCache[text];

    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|pt-BR`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            const translated = data?.responseData?.translatedText;
            if (translated) {
                appData.translationCache[text] = translated;
                saveData(appData);
                return translated;
            }
        }
    } catch (e) {
        console.error('Erro ao traduzir texto', text, e);
    }

    appData.translationCache[text] = text;
    saveData(appData);
    return text;
}

async function getStudiedWordInfo(word) {
    const defObj = await getWordDefinition(word);
    const pt = defObj.definition ? await translateTextToPortuguese(defObj.definition) : '';
    return {
        word,
        definition: defObj.definition || 'Definição não encontrada',
        definitionPt: pt || 'Tradução não disponível'
    };
}

async function renderStudiedWordsModal() {
    const wordListContainer = $('studiedWordsList');
    if (!wordListContainer) return;

    const studiedWords = new Set();
    appData.lists.forEach(l => l.phrases.forEach(p => {
        const lv = p.levels || {};
        const studied = lv.quiz > 0 || lv.write > 0 || lv.listen > 0 || lv.pronounce > 0 || lv.speak > 0;
        if (studied) {
            normalizeText(p.english).split(/\s+/).filter(w => w.length > 1).forEach(w => studiedWords.add(w));
        }
    }));

    if (studiedWords.size === 0) {
        wordListContainer.innerHTML = '<div class="card" style="text-align:center; color:var(--text-muted); padding: 40px;">Você ainda não estudou nenhuma palavra nas frases. Complete algumas revisões para ver a lista aqui.</div>';
        return;
    }

    studiedWordsList = Array.from(studiedWords).sort((a, b) => a.localeCompare(b, 'en'));
    $('studiedWordsSearch').value = '';
    renderStudiedWordsList(studiedWordsList);
}

function renderStudiedWordsList(words) {
    const wordListContainer = $('studiedWordsList');
    if (!wordListContainer) return;

    if (words.length === 0) {
        wordListContainer.innerHTML = '<div class="card" style="text-align:center; color:var(--text-muted); padding: 40px;">Nenhuma palavra corresponde à busca.</div>';
        return;
    }

    wordListContainer.innerHTML = words.map((word, index) => `
        <div class="card" style="padding: 12px 16px; border-left: 4px solid var(--primary); background: var(--surface);">
            <button type="button" class="studied-word-item" data-index="${index}" data-word="${escapeHTML(word)}" style="text-align:left; width:100%; border:none; background:none; padding: 0; cursor: pointer;">
                <div style="font-weight: 800; font-size: 1rem;">${escapeHTML(word)}</div>
            </button>
            <div id="studiedWordDetail-${index}" class="studied-word-detail" style="display:none; color: var(--text-muted); font-size: 0.95rem; line-height: 1.6; margin-top: 12px;"></div>
        </div>
    `).join('');

    wordListContainer.querySelectorAll('.studied-word-item').forEach(button => {
        button.addEventListener('click', async () => {
            const index = button.dataset.index;
            const word = button.dataset.word;
            if (!word || typeof index === 'undefined') return;
            await showStudiedWordMeaning(word, index, button);
        });
    });
}

function filterStudiedWords() {
    const search = normalizeText($('studiedWordsSearch')?.value || '');
    const filtered = studiedWordsList.filter(word => normalizeText(word).includes(search));
    renderStudiedWordsList(filtered);
}

async function showStudiedWordMeaning(word, index, button) {
    const detailEl = $(`studiedWordDetail-${index}`);
    if (!detailEl) return;

    // If this word's detail is already visible, hide it (toggle off)
    if (detailEl.style.display === 'block') {
        detailEl.style.display = 'none';
        button.classList.remove('active-word-item');
        return;
    }

    // Hide all other details and remove active class
    document.querySelectorAll('.studied-word-item').forEach(btn => btn.classList.remove('active-word-item'));
    document.querySelectorAll('.studied-word-detail').forEach(el => el.style.display = 'none');

    // Show this one
    button.classList.add('active-word-item');
    detailEl.style.display = 'block';

    // Load if not already loaded
    if (detailEl.dataset.loaded !== 'true') {
        detailEl.textContent = 'Carregando significado...';
        const info = await getStudiedWordInfo(word);
        detailEl.innerHTML = `
            <div style="margin-bottom: 10px;"><strong>Significado (EN):</strong> ${escapeHTML(info.definition)}</div>
            <div><strong>Significado em PT:</strong> ${escapeHTML(info.definitionPt)}</div>
        `;
        detailEl.dataset.loaded = 'true';
    }
}

function renderMasteredPhrases() {
    const container = $('masteredModalList');
    if (!container) return;

    let allPhrases = [];
    appData.lists.forEach(l => allPhrases = allPhrases.concat(l.phrases));

    const skill = $('masteredSkillSelector')?.value || 'standard';
    const getLvl = (p, s) => p.levels?.[s || skill] || 0;

    const isMasteredGeneral = (p) => (p.levels?.quiz >= 5 || p.levels?.write >= 5 || p.levels?.listen >= 5 || p.levels?.pronounce >= 5 || p.levels?.speak >= 5);
    const mastered = allPhrases.filter(p => skill === 'standard' ? isMasteredGeneral(p) : getLvl(p) >= 5)
        .sort((a, b) => getLvl(b) - getLvl(a));

    if (mastered.length === 0) {
        container.innerHTML = '<div class="card" style="grid-column: 1/-1; text-align:center; color:var(--text-muted); padding: 40px;">Ainda não há frases dominadas nesta categoria. Continue praticando!</div>';
    } else {
        container.innerHTML = mastered.map(p => {
            const displayLvl = skill === 'standard' ? Math.max(p.levels?.quiz || 0, p.levels?.write || 0, p.levels?.listen || 0, p.levels?.pronounce || 0, p.levels?.speak || 0) : getLvl(p);
            return `
                <div class="card" style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-left: 4px solid var(--success); animation: fadeIn 0.5s ease;">
                    <div style="overflow: hidden; flex: 1;">
                        <div style="font-weight:700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHTML(p.english)}">${escapeHTML(p.english)}</div>
                        <div style="color:var(--text-muted); font-size:0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHTML(p.portuguese)}">${escapeHTML(p.portuguese)}</div>
                    </div>
                    <div style="background: var(--success-soft); color: var(--success); padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 800; margin-left: 12px; flex-shrink: 0;">Lvl ${displayLvl}</div>
                </div>
            `;
        }).join('');
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
            p.levels = { standard: lvl, quiz: lvl, write: lvl, listen: lvl, pronounce: lvl, speak: lvl };
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
    // Reset mic state for the new phrase to avoid auto-starting
    isRecognitionActive = false;
    stopListening();

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
    const modeLvl = p.levels?.[session.mode] || 0;

    if (session.mode === 'listen') {
        $('phrasePt').textContent = '';
    } else {
        $('phrasePt').textContent = p.portuguese;
    }
    $('modeLabel').innerHTML = `
        <span style="background: var(--primary-soft); color: var(--primary); padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 800;">
            ${session.mode.toUpperCase()} - LV ${modeLvl}
        </span>
    `;

    $('quizArea').style.display = 'none';
    $('writeArea').style.display = 'none';
    $('listenArea').style.display = 'none';
    $('speakArea').style.display = 'none';
    $('pronounceArea').style.display = 'none';

    // Initialize progress for speech modes
    session.matchedIndices = new Set();
    session.wordStatus = {}; // Tracks 'correct' or 'imprecise' for each word index
    session.lastTranscript = '';
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
    } else if (session.mode === 'listen') {
        $('listenArea').style.display = 'block';
        $('listenInput').value = '';
        $('listenInputMirror').innerHTML = '';
        setTimeout(() => playAudio(p.english), 500); // Play audio automatically
        setTimeout(() => $('listenInput').focus(), 1000);
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
    if ($('feedbackBar').classList.contains('active')) return;
    const isCorrect = selected === session.current.english;
    const btns = document.querySelectorAll('.quiz-btn');
    btns.forEach(b => {
        if (b.textContent === session.current.english) b.classList.add('correct');
        else if (b.textContent === selected) b.classList.add('incorrect');
    });
    processAnswer(isCorrect, selected);
}

function checkWriteAnswer() {
    if ($('feedbackBar').classList.contains('active')) return;
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
        let normUWords = normU.split(' ').filter(w => w);

        // Find how many words we've already matched in the target
        const wordsMatchedSoFar = analyzedTokens.reduce((acc, t) => {
            if (t.type === 'space') return acc;
            return acc + (t.normWords ? t.normWords.length : 0);
        }, 0);

        // Check if these words match the target words starting at wordsMatchedSoFar
        let isSequenceMatch = false;
        const relevantTargetWords = targetWordsNorm.slice(wordsMatchedSoFar, wordsMatchedSoFar + normUWords.length);
        const matchedTargetWord = (relevantTargetWords.length === 1 ? targetWordsNorm[wordsMatchedSoFar] : null);

        if (normUWords.length > 0) {
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
        }

        // Special handling for contractions being typed (like "o'clock" -> "of the clock")
        if (!isSequenceMatch && isBeingTyped && token.includes("'")) {
            const expandedWords = getContractionExpansionPrefix(token);
            if (expandedWords && expandedWords.length > 0) {
                const relevantTargetWords = targetWordsNorm.slice(wordsMatchedSoFar, wordsMatchedSoFar + expandedWords.length);
                if (relevantTargetWords.length === expandedWords.length) {
                    const allMatch = expandedWords.every((w, idx) => w === relevantTargetWords[idx]);
                    if (allMatch) {
                        isSequenceMatch = true;
                        normUWords = expandedWords;
                    }
                }
            }
        }

        if (isSequenceMatch) {
            normUWords.forEach(w => { if (wordCounts[w] > 0) wordCounts[w]--; });
            analyzedTokens.push({ type: 'correct', content: token, normWords: normUWords, isBeingTyped, targetWord: matchedTargetWord });
        } else {
            analyzedTokens.push({ type: 'pending', content: token, normWords: normUWords, isBeingTyped, targetWord: matchedTargetWord });
        }
    });

    const usage = { correct: false, error: false, misplacedChar: false, misplacedWord: false };

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
            usage.correct = true;
            html += `<span style="color: ${color}">${tokenObj.content}</span>`;
            return;
        }

        if (tokenObj.isBeingTyped && tokenObj.targetWord) {
            const normalizedToken = normalizeText(tokenObj.content);
            const normalizedTargetWord = normalizeText(tokenObj.targetWord);
            const similarity = getSimilarity(normalizedToken, normalizedTargetWord);
            const hasMisplacedLetter = normalizedToken.split('').some((ch, idx) => ch !== normalizedTargetWord[idx] && normalizedTargetWord.includes(ch));
            if ((normalizedTargetWord.startsWith(normalizedToken) || (similarity >= 0.45 && hasMisplacedLetter)) && normalizedToken.length > 0) {
                html += colorizeTypedWordChars(tokenObj.content, tokenObj.targetWord, usage);
                return;
            }
        }

        if (normWords.length > 0) {
            // Check for Yellow: Words exist in target and still have available counts
            const allWordsAvailable = normWords.every(w => wordCounts[w] > 0);
            if (allWordsAvailable) {
                color = 'var(--warning)';
                usage.misplacedWord = true;
                normWords.forEach(w => wordCounts[w]--);
            } else if (tokenObj.isBeingTyped) {
                // For "being typed", allow prefix match from the pool
                const canBePrefix = targetWordsNorm.some(w => wordCounts[w] > 0 && w.startsWith(normWords[normWords.length - 1]));
                const previousWordsMatch = normWords.slice(0, -1).every(w => wordCounts[w] > 0);
                if (canBePrefix && (normWords.length === 1 || previousWordsMatch)) {
                    color = 'var(--warning)';
                    usage.misplacedWord = true;
                } else if (tokenObj.content.includes("'")) {
                    // Special handling for contractions being typed (yellow for out-of-order)
                    const expandedWords = getContractionExpansionPrefix(tokenObj.content);
                    if (expandedWords && expandedWords.length > 0) {
                        const allExpandedAvailable = expandedWords.every(w => wordCounts[w] > 0);
                        if (allExpandedAvailable) {
                            color = 'var(--warning)';
                            usage.misplacedWord = true;
                            expandedWords.forEach(w => wordCounts[w]--);
                        }
                    }
                }
            }
        }

        if (color === 'var(--danger)') usage.error = true;
        html += `<span style="color: ${color}">${tokenObj.content}</span>`;
    });

    $('writeInputMirror').innerHTML = html;

    // Update Legends (One at a time, by priority)
    let activeId = null;
    if (usage.error) activeId = 'writeLegendError';
    else if (usage.misplacedWord) activeId = 'writeLegendMisplacedWord';
    else if (usage.misplacedChar) activeId = 'writeLegendMisplacedChar';
    else if (usage.correct) activeId = 'writeLegendCorrect';

    ['writeLegendCorrect', 'writeLegendError', 'writeLegendMisplacedChar', 'writeLegendMisplacedWord'].forEach(id => {
        const el = $(id);
        if (el) el.style.display = (id === activeId) ? 'inline-flex' : 'none';
    });
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

function updateListenMirror() {
    const text = $('listenInput').value;
    if (text === '') {
        $('listenInputMirror').innerHTML = '';
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
        let normUWords = normU.split(' ').filter(w => w);

        // Find how many words we've already matched in the target
        const wordsMatchedSoFar = analyzedTokens.reduce((acc, t) => {
            if (t.type === 'space') return acc;
            return acc + (t.normWords ? t.normWords.length : 0);
        }, 0);

        // Check if these words match the target words starting at wordsMatchedSoFar
        let isSequenceMatch = false;
        const relevantTargetWords = targetWordsNorm.slice(wordsMatchedSoFar, wordsMatchedSoFar + normUWords.length);
        const matchedTargetWord = (relevantTargetWords.length === 1 ? targetWordsNorm[wordsMatchedSoFar] : null);

        if (normUWords.length > 0) {
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
        }

        // Special handling for contractions being typed (like "o'clock" -> "of the clock")
        if (!isSequenceMatch && isBeingTyped && token.includes("'")) {
            const expandedWords = getContractionExpansionPrefix(token);
            if (expandedWords && expandedWords.length > 0) {
                const relevantTargetWords = targetWordsNorm.slice(wordsMatchedSoFar, wordsMatchedSoFar + expandedWords.length);
                if (relevantTargetWords.length === expandedWords.length) {
                    const allMatch = expandedWords.every((w, idx) => w === relevantTargetWords[idx]);
                    if (allMatch) {
                        isSequenceMatch = true;
                        normUWords = expandedWords;
                    }
                }
            }
        }

        if (isSequenceMatch) {
            normUWords.forEach(w => { if (wordCounts[w] > 0) wordCounts[w]--; });
            analyzedTokens.push({ type: 'correct', content: token, normWords: normUWords, isBeingTyped, targetWord: matchedTargetWord });
        } else {
            analyzedTokens.push({ type: 'pending', content: token, normWords: normUWords, isBeingTyped, targetWord: matchedTargetWord });
        }
    });

    const usage = { correct: false, error: false, misplacedChar: false, misplacedWord: false };

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
            usage.correct = true;
            html += `<span style="color: ${color}">${tokenObj.content}</span>`;
            return;
        }

        if (tokenObj.isBeingTyped && tokenObj.targetWord) {
            const normalizedToken = normalizeText(tokenObj.content);
            const normalizedTargetWord = normalizeText(tokenObj.targetWord);
            const similarity = getSimilarity(normalizedToken, normalizedTargetWord);
            const hasMisplacedLetter = normalizedToken.split('').some((ch, idx) => ch !== normalizedTargetWord[idx] && normalizedTargetWord.includes(ch));
            if ((normalizedTargetWord.startsWith(normalizedToken) || (similarity >= 0.45 && hasMisplacedLetter)) && normalizedToken.length > 0) {
                html += colorizeTypedWordChars(tokenObj.content, tokenObj.targetWord, usage);
                return;
            }
        }

        if (normWords.length > 0) {
            // Check for Yellow: Words exist in target and still have available counts
            const allWordsAvailable = normWords.every(w => wordCounts[w] > 0);
            if (allWordsAvailable) {
                color = 'var(--warning)';
                usage.misplacedWord = true;
                normWords.forEach(w => wordCounts[w]--);
            } else if (tokenObj.isBeingTyped) {
                // For "being typed", allow prefix match from the pool
                const canBePrefix = targetWordsNorm.some(w => wordCounts[w] > 0 && w.startsWith(normWords[normWords.length - 1]));
                const previousWordsMatch = normWords.slice(0, -1).every(w => wordCounts[w] > 0);
                if (canBePrefix && (normWords.length === 1 || previousWordsMatch)) {
                    color = 'var(--warning)';
                    usage.misplacedWord = true;
                } else if (tokenObj.content.includes("'")) {
                    // Special handling for contractions being typed (yellow for out-of-order)
                    const expandedWords = getContractionExpansionPrefix(tokenObj.content);
                    if (expandedWords && expandedWords.length > 0) {
                        const allExpandedAvailable = expandedWords.every(w => wordCounts[w] > 0);
                        if (allExpandedAvailable) {
                            color = 'var(--warning)';
                            usage.misplacedWord = true;
                            expandedWords.forEach(w => wordCounts[w]--);
                        }
                    }
                }
            }
        }

        if (color === 'var(--danger)') usage.error = true;
        html += `<span style="color: ${color}">${tokenObj.content}</span>`;
    });

    $('listenInputMirror').innerHTML = html;

    // Update Legends (One at a time, by priority)
    let activeId = null;
    if (usage.error) activeId = 'listenLegendError';
    else if (usage.misplacedWord) activeId = 'listenLegendMisplacedWord';
    else if (usage.misplacedChar) activeId = 'listenLegendMisplacedChar';
    else if (usage.correct) activeId = 'listenLegendCorrect';

    ['listenLegendCorrect', 'listenLegendError', 'listenLegendMisplacedChar', 'listenLegendMisplacedWord'].forEach(id => {
        const el = $(id);
        if (el) el.style.display = (id === activeId) ? 'inline-flex' : 'none';
    });
}

function checkListenAnswer() {
    if ($('feedbackBar').classList.contains('active')) return;
    const val = $('listenInput').value.trim();
    const isCorrect = normalizeText(val) === normalizeText(session.current.english);
    processAnswer(isCorrect, val);
}

// Initializing the input listeners for write and listen modes
setTimeout(() => {
    if ($('listenInput')) {
        $('listenInput').addEventListener('input', updateListenMirror);
    }
}, 1000);

function processAnswer(isCorrect, userVal) {
    // SECURITY LOCK: Prevent double processing
    if ($('feedbackBar').classList.contains('active')) return;

    const bar = $('feedbackBar');
    const info = $('feedbackInfo');
    const title = $('feedbackTitle');
    const text = $('feedbackText');

    bar.classList.add('active');
    info.className = `feedback-info ${isCorrect ? 'correct' : 'incorrect'}`;

    // Ensure levels object exists
    if (!session.current.levels) {
        session.current.levels = { standard: 0, quiz: 0, write: 0, listen: 0, pronounce: 0, speak: 0 };
    }
    const mode = session.trainingMode;

    if (isCorrect) {
        title.textContent = "Excelente! 🎉";

        // Handle yellow/imprecise words feedback for voice modes
        const impreciseWords = (session.mode === 'speak' || session.mode === 'pronounce') ?
            session.current.english.split(' ').filter((_, idx) => session.wordStatus[idx] === 'imprecise') : [];

        if (impreciseWords.length > 0) {
            title.innerHTML = "Quase lá! ⚠️";
            text.innerHTML = `<span style="color: var(--warning); font-weight: 800; font-size: 0.9rem;">Você acertou, mas tente melhorar a pronúncia de:</span><br>
                              <b style="color: var(--text);">${impreciseWords.join(', ')}</b><br><br>
                              Resposta: <b>${escapeHTML(session.current.english)}</b>`;
        } else {
            text.innerHTML = `Resposta correta: <b>${escapeHTML(session.current.english)}</b>`;
        }

        // Update level for the specific mode
        session.current.levels[mode]++;

        // If in standard mode, also update the specific sub-mode performed to ensure XP is gained
        if (mode === 'standard') {
            const subMode = session.mode; // e.g., 'quiz', 'write', 'speak'
            if (session.current.levels[subMode] !== undefined) {
                session.current.levels[subMode]++;
            }
            // Cap standard level at 4 so it possa ir de 0 a 4
            session.current.levels.standard = Math.min(4, session.current.levels.standard);
        }

        // Hide any correction UI leftover from previous wrong answers
        $('correctionArea').style.display = 'none';
        $('voiceCorrectionArea').style.display = 'none';
        $('btnContinue').style.display = 'block';

        // Play correct sound
        $('soundCorrect').play().catch(() => { });
    } else {
        let accuracy;
        if (session.mode === 'speak' || session.mode === 'pronounce') {
            const targetWords = session.current.english.split(' ');
            const correctCount = Object.values(session.wordStatus || {}).filter(v => v === 'correct' || v === 'imprecise').length;
            accuracy = Math.round((correctCount / targetWords.length) * 100);
        } else {
            accuracy = calculateAccuracy(userVal, session.current.english);
        }

        title.textContent = `${accuracy}% de acerto`;

        // HIGHLIGHT DIFFERENCES
        if (session.mode === 'speak' || session.mode === 'pronounce') {
            const targetWords = session.current.english.split(' ');
            let highlightHTML = 'Resultado: ';

            targetWords.forEach((w, idx) => {
                const status = session.wordStatus[idx];
                const color = status === 'correct' ? 'var(--success)' : (status === 'imprecise' ? 'var(--warning)' : 'var(--text-muted)');
                const weight = status ? '800' : '400';
                const opacity = status ? '1' : '0.5';
                highlightHTML += `<span style="color: ${color}; font-weight: ${weight}; opacity: ${opacity}">${w}</span> `;
            });

            highlightHTML += `<br><br><span style="font-size: 0.9rem; color: var(--text-muted);">Frase esperada: <b>${session.current.english}</b></span>`;
            highlightHTML += `<br><span style="font-size: 0.9rem; color: var(--primary); font-weight: 700;">Dica de pronúncia: <span style="font-family: monospace;">[ ${getPhoneticGuide(session.current.english)} ]</span></span>`;

            text.innerHTML = `Você disse: <del>${escapeHTML(userVal || '...')}</del><br>${highlightHTML}`;
        } else {
            const highlight = highlightDifferences(userVal, session.current.english);
            text.innerHTML = `Você disse: <del>${escapeHTML(userVal)}</del><br>${highlight}`;
        }

        // Penalties are handled further down in the specialized penalty section (line 971+)
        // This avoids double decrement.

        // Always speak the correct answer on error
        playAudio(session.current.english);

        // Optional Correction - Hide mic and instructions as requested
        if (session.mode === 'speak' || session.mode === 'pronounce') {
            $('voiceCorrectionArea').style.display = 'none'; // Hide correction mic area
            $('correctionArea').style.display = 'none';
            $('btnContinue').style.display = 'block';
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

    // Play Audio only if correct AND not already played in pronounce mode
    if (isCorrect && session.mode !== 'pronounce') playAudio(session.current.english);

    // Update Stats
    appData.history.push({ date: Date.now(), correct: isCorrect });
    updateStreak();

    // ------------------- LEVEL & SRS UPDATES -------------------
    let forceImmediateReview = false;
    const subMode = session.mode;

    if (isCorrect) {
        // Acerto: Puxa o standard para cima no modo focado
        if (mode !== 'standard') {
            session.current.levels.standard = Math.min(4, Math.max(session.current.levels.standard || 0, session.current.levels[mode]));
        }

        // Checar se teve palavras amarelas no Speak
        const impreciseWords = (session.mode === 'speak' || session.mode === 'pronounce') ?
            session.current.english.split(' ').filter((_, idx) => session.wordStatus[idx] === 'imprecise') : [];

        if (session.mode === 'speak' && impreciseWords.length > 0) {
            session.current.levels.standard = 3; // Volta para Pronúncia
            forceImmediateReview = true;
        }
    } else {
        const trainingMode = session.trainingMode;

        // 1. Reduzir nível da HABILIDADE ESPECÍFICA (Quiz, Escrita, etc.)
        const specificSkill = (trainingMode === 'standard') ? subMode : trainingMode;
        if (session.current.levels && session.current.levels[specificSkill] !== undefined) {
            session.current.levels[specificSkill] = Math.max(0, session.current.levels[specificSkill] - 1);
        }

        // 2. Reduzir nível STANDARD (Sequência do Modo Geral) e forçar revisão
        if (subMode === 'write') {
            session.current.levels.standard = 0; // Volta para o Quiz
            forceImmediateReview = true;
        }
        else if (subMode === 'listen') {
            session.current.levels.standard = 1; // Volta para a Escrita no modo geral
            forceImmediateReview = true;
        }
        else if (subMode === 'speak' || subMode === 'pronounce') {
            session.current.levels.standard = 1; // Volta para a Escrita
            forceImmediateReview = true;
        }
        else {
            session.current.levels.standard = Math.max(0, (session.current.levels.standard || 0) - 1);
        }
    }

    // Calcular SRS baseado no nível ATUALIZADO da habilidade
    const multipliers = {
        quiz: 1.0,
        write: 1.5,
        listen: 1.5,
        pronounce: 2.0,
        speak: 2.5
    };
    const multiplier = multipliers[session.mode] || 1.0;
    const modeForLevel = session.trainingMode === 'standard' ? session.mode : session.trainingMode;
    const currentLvl = session.current.levels[modeForLevel] || 0;

    let interval = SRS_INTERVALS[Math.min(currentLvl, 9)] * 60 * 1000 * multiplier;

    if (forceImmediateReview) {
        interval = 0; // Disponível imediatamente
    }

    session.current.nextReview = Date.now() + interval;

    appData.totalReviews++;

    // EXPLICITLY ensure mic is stopped and WON'T restart
    isRecognitionActive = false;
    stopListening();

    saveData(appData);
    updateGlobalLevel();
}

function handleSpeakDontRemember() {
    if (!session.current) return;
    stopListening(); // Stop mic before processing
    processAnswer(false, 'Não lembro');
}

function handlePronounceCantPronounce() {
    if (!session.current) return;
    stopListening(); // Stop mic before processing
    processAnswer(false, 'Não consigo pronunciar');
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

function getContractionExpansionPrefix(token) {
    if (!token) return null;
    const normalized = token.toLowerCase().replace(/[’‘`]/g, "'");
    for (const [key, val] of Object.entries(CONTRACTIONS)) {
        if (key.startsWith(normalized)) {
            return normalizeText(val).split(' ').filter(w => w);
        }
    }
    return null;
}

function normalizeText(t) {
    if (!t) return '';
    let text = t.toLowerCase().trim();

    // Always expand contractions for comparison (ignores the setting for internal logic)
    text = expandContractions(text);

    // Convert times (H:MM or HH:MM) to words first
    text = text.replace(/(\d{1,2}):(\d{2})/g, (match, hours, minutes) => {
        const hourWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
            'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
            'twenty one', 'twenty two', 'twenty three'];
        const minWords = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
        const h = parseInt(hours);
        const m = parseInt(minutes);
        let result = hourWords[h] || hours;
        if (m > 0) {
            if (m < 10 && m !== 0) result += ' o ' + minWords[m];
            else if (m === 30) result += ' thirty';
            else if (m === 15) result += ' fifteen';
            else if (m === 45) result += ' forty five';
            else result += ' ' + (minWords[Math.floor(m / 10)] || '') + (m % 10 > 0 ? ' ' + minWords[m % 10] : '');
        }
        return result;
    });

    // Convert digits to words for better matching (e.g., "10" -> "ten")
    const numMap = {
        '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
        '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten',
        '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen', '15': 'fifteen',
        '16': 'sixteen', '17': 'seventeen', '18': 'eighteen', '19': 'nineteen', '20': 'twenty'
    };
    text = text.replace(/\b(\d+)\b/g, (m) => numMap[m] || m);

    // Remove punctuation but keep spaces. Replace hyphens with spaces.
    return text.replace(/[.,!?;:"()\[\]{}—–]/g, '').replace(/-/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
}

function colorizeTypedWordChars(token, targetWord, usageTracker = {}) {
    const normalizedToken = normalizeText(token);
    const normalizedTarget = normalizeText(targetWord);
    const normTokenChars = normalizedToken.split('');
    const tokenChars = token.split('');
    const unmatchedTarget = {};

    normTokenChars.forEach((ch, idx) => {
        if (normalizedTarget[idx] !== ch) {
            unmatchedTarget[normalizedTarget[idx]] = (unmatchedTarget[normalizedTarget[idx]] || 0) + 1;
        }
    });
    for (let i = normTokenChars.length; i < normalizedTarget.length; i++) {
        const ch = normalizedTarget[i];
        unmatchedTarget[ch] = (unmatchedTarget[ch] || 0) + 1;
    }

    let normIndex = 0;
    let html = '';
    tokenChars.forEach((char) => {
        const isLetter = /[a-z0-9]/i.test(char);
        if (!isLetter) {
            html += char;
            return;
        }
        const normCh = normTokenChars[normIndex];
        let color = 'var(--danger)';
        if (normCh === normalizedTarget[normIndex]) {
            color = 'var(--success)';
            usageTracker.correct = true;
        } else if (normalizedTarget.includes(normCh) && unmatchedTarget[normCh] > 0) {
            color = 'var(--primary)';
            unmatchedTarget[normCh]--;
            usageTracker.misplacedChar = true;
        } else {
            usageTracker.error = true;
        }
        html += `<span style="color: ${color}">${char}</span>`;
        normIndex++;
    });
    return html;
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
        // Don't restart if we are showing results or if session ended
        const isResultVisible = $('feedbackBar').classList.contains('active');
        if (wasListening && session.active && !isResultVisible && (session.mode === 'speak' || session.mode === 'pronounce')) {
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

function isPhraseDuplicate(english) {
    const norm = normalizeText(english);
    for (const list of appData.lists) {
        if (list.phrases.some(p => normalizeText(p.english) === norm)) return true;
    }
    return false;
}

function addPhrase() {
    const eng = $('phraseEngInput').value.trim();
    const pt = $('phrasePtInput').value.trim();
    if (!eng || !pt) return;

    if (isPhraseDuplicate(eng)) {
        alert("Esta frase já existe em uma de suas listas!", "Frase Duplicada", "⚠️");
        return;
    }

    const list = appData.lists.find(l => l.id === appData.currentListId);
    list.phrases.push({
        id: 'ph_' + Date.now(),
        english: eng,
        portuguese: pt,
        levels: { standard: 0, quiz: 0, write: 0, listen: 0, pronounce: 0, speak: 0 },
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

// Centralized Modal Management
function openModal(modalId) {
    // Hide all children of modalBg
    const modals = $('modalBg').children;
    for (let m of modals) {
        m.style.display = 'none';
    }
    // Show background and the specific modal
    $('modalBg').style.display = 'flex';
    $(modalId).style.display = 'block';

    // Scroll Lock
    document.body.classList.add('modal-open');
}

function closeModal() {
    $('modalBg').style.display = 'none';
    document.body.classList.remove('modal-open');
}

// Override default alert/confirm with premium system dialog
window.alert = function (msg, title = "Aviso", icon = "ℹ️") {
    $('dialogTitle').textContent = title;
    $('dialogMessage').textContent = msg;
    $('dialogIcon').textContent = icon;
    $('dialogCancel').style.display = 'none';
    $('dialogConfirm').onclick = closeDialog;

    openModal('systemDialog');
};

window.confirm = function (msg, onConfirm, title = "Confirmação") {
    $('dialogTitle').textContent = title;
    $('dialogMessage').textContent = msg;
    $('dialogIcon').textContent = "❓";
    $('dialogCancel').style.display = 'block';
    $('dialogCancel').onclick = closeDialog;
    $('dialogConfirm').onclick = () => {
        if (onConfirm) onConfirm();
        closeDialog();
    };

    openModal('systemDialog');
};

function closeDialog() { closeModal(); }
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

                // Filtra duplicatas globais na lista importada
                const originalCount = data.phrases.length;
                data.phrases = data.phrases.filter(p => !isPhraseDuplicate(p.english));
                const filteredCount = data.phrases.length;
                const removed = originalCount - filteredCount;

                appData.lists.push(data);
                saveData(appData);
                renderLists();

                let msg = "Lista importada com sucesso!";
                if (removed > 0) msg += `\n(${removed} frases duplicadas foram removidas)`;
                alert(msg);
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

    confirm("Isso substituirá TODOS os seus dados atuais pelo backup. Tem certeza?", () => {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                if (data.lists && Array.isArray(data.lists)) {
                    appData = migrateData(data);
                    saveData(appData);
                    renderLists();
                    renderStats();
                    alert("Backup restaurado com sucesso!");
                } else {
                    alert("Arquivo de backup inválido!");
                }
            } catch (err) {
                alert("Erro ao ler o arquivo!");
            }
        };
        reader.readAsText(file);
    });
    input.value = '';
}


function showAddListModal() {
    openModal('newListModal');
}
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

        // Extract detected language code correctly
        let detectedLang = null;
        if (data[2]) {
            detectedLang = Array.isArray(data[2]) ? data[2][0] : data[2];
        } else if (data[8] && Array.isArray(data[8]) && data[8][0]) {
            detectedLang = Array.isArray(data[8][0]) ? data[8][0][0] : data[8][0];
        }

        return {
            translated: translatedText,
            detected: detectedLang
        };
    } catch (e) {
        console.error('Erro na tradução:', e);
        return null;
    }
}

function isProbablyPortuguese(text) {
    return /[áàãâéêíóôúçÁÀÃÂÉÊÍÓÔÚÇ]|\b(?:da|de|do|das|dos|uma|um|e|com|por|para|não|mais|sobre|pessoas|população|equivalente|abriga|correspondente|km|km²)\b/i.test(text);
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
    openModal('bulkAddModal');
}

async function processBulkAdd() {
    const rawInput = $('bulkInput').value.trim();
    if (!rawInput) return;

    const autoTranslate = $('autoTranslateBulk').checked;
    const list = appData.lists.find(l => l.id === appData.currentListId);

    const btn = $('btnProcessBulk');
    btn.disabled = true;
    btn.textContent = 'Processando...';

    let addedCount = 0;
    let duplicateCount = 0;

    if (autoTranslate) {
        // MODO AUTO-TRADUÇÃO: apenas . separa frases, ignora ; completamente
        let lines = rawInput.split('\n').map(l => l.trim()).filter(l => l);
        let phrases = [];

        for (let line of lines) {
            let parts = line.split(/\.(?!\d)/).map(s => s.trim()).filter(s => s);
            phrases.push(...parts);
        }

        // Traduzir cada frase automaticamente
        for (let phrase of phrases) {
            const res = await translateText(phrase, 'auto', 'pt');
            if (res) {
                let eng = '', pt = '';
                const likelyPt = res.detected === 'pt' || isProbablyPortuguese(phrase) || (res.translated === phrase && /[áàãâéêíóôúçÁÀÃÂÉÊÍÓÔÚÇ]/.test(phrase));

                if (likelyPt) {
                    const resEng = await translateText(phrase, 'pt', 'en');
                    eng = resEng ? resEng.translated : '';
                    pt = phrase;
                } else {
                    eng = phrase;
                    pt = res.translated;
                }

                if (eng && pt) {
                    if (isPhraseDuplicate(eng)) {
                        duplicateCount++;
                        continue;
                    }
                    list.phrases.push({
                        id: 'ph_' + Date.now() + Math.random(),
                        english: eng,
                        portuguese: pt,
                        levels: { standard: 0, quiz: 0, write: 0, listen: 0, pronounce: 0, speak: 0 },
                        nextReview: null
                    });
                    addedCount++;
                }
            }
        }
    } else {
        // MODO MANUAL: ; para tradução manual, . para separar frases
        let lines = rawInput.split('\n').map(l => l.trim()).filter(l => l);
        let entries = [];

        for (let line of lines) {
            // Split por . para separar múltiplas frases em uma linha
            let phrases = line.split(/\.(?!\d)/).map(s => s.trim()).filter(s => s);
            entries.push(...phrases);
        }

        // Verificar se há traduções manuais com ;
        const hasSemicolon = entries.some(e => e.includes(';'));

        if (hasSemicolon) {
            // Modo pares manuais: parte1; parte2
            for (let entry of entries) {
                let [part1, part2] = entry.split(';').map(s => s ? s.trim() : '');

                if (part1 && part2) {
                    if (isPhraseDuplicate(part1)) {
                        duplicateCount++;
                        continue;
                    }
                    list.phrases.push({
                        id: 'ph_' + Date.now() + Math.random(),
                        english: part1,
                        portuguese: part2,
                        levels: { standard: 0, quiz: 0, write: 0, listen: 0, pronounce: 0, speak: 0 },
                        nextReview: null
                    });
                    addedCount++;
                }
            }
        } else if (entries.length >= 2) {
            // Pareamento automático de linhas: linha 1 = eng, linha 2 = pt, etc
            for (let i = 0; i < entries.length; i += 2) {
                const eng = entries[i];
                const pt = entries[i + 1];
                if (eng && pt) {
                    if (isPhraseDuplicate(eng)) {
                        duplicateCount++;
                        continue;
                    }
                    list.phrases.push({
                        id: 'ph_' + Date.now() + Math.random(),
                        english: eng,
                        portuguese: pt,
                        levels: { standard: 0, quiz: 0, write: 0, listen: 0, pronounce: 0, speak: 0 },
                        nextReview: null
                    });
                    addedCount++;
                }
            }
        }
    }

    saveData(appData);
    prefetchMissingPhonetics(); // Fetch phonetics for new phrases
    renderPhrases();
    renderStats();

    closeModal();
    $('bulkInput').value = '';
    btn.disabled = false;
    btn.textContent = 'Adicionar Frases';

    let msg = `Sucesso! Foram adicionadas ${addedCount} frases.`;
    if (duplicateCount > 0) msg += `\n(${duplicateCount} frases duplicadas foram ignoradas)`;
    alert(msg);
}


// ==================== START ====================
window.onload = () => {
    document.querySelectorAll('.nav-link, .mobile-nav-item').forEach(el => {
        el.addEventListener('click', () => {
            unlockAudio();
            showView(el.dataset.view);
        });
    });

    $('modalBg').addEventListener('click', (e) => {
        if (e.target === $('modalBg')) closeModal();
    });

    document.addEventListener('click', unlockAudio, { once: false });
    document.addEventListener('touchstart', unlockAudio, { once: false });

    document.onkeydown = (e) => {
        const isModalOpen = $('modalBg').style.display === 'flex';
        if (isModalOpen && e.key === 'Enter') return; // Let the modal handle Enter

        if (e.key === 'Enter') {
            if ($('feedbackBar').classList.contains('active')) {
                continueSession();
            } else if (session.active && (session.mode === 'write' || session.mode === 'listen')) {
                // Only trigger if the user is actually typing in the write/listen input or its wrapper
                if (document.activeElement === $('writeInput') || document.activeElement === $('listenInput') || document.activeElement === $('correctionInput')) {
                    e.preventDefault();
                    if (document.activeElement === $('writeInput')) checkWriteAnswer();
                    if (document.activeElement === $('listenInput')) checkListenAnswer();
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

    // Request notification permission if not asked yet
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    startCountdownInterval();
    prefetchMissingPhonetics();

    applyDarkMode();
    showView('homeView');

    // Stop mic if user leaves the tab
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopListening();
    });
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
        session.lastTranscript = t;
        const heard = normalizeText(t);
        const heardWords = heard.split(' ').filter(w => w.length > 0);
        const targetWords = session.current.english.split(' ');
        const normTargetWords = targetWords.map(w => normalizeText(w));

        // Ensure wordStatus is initialized
        if (!session.wordStatus) session.wordStatus = {};

        normTargetWords.forEach((ntw, targetIdx) => {
            // If already perfectly matched, skip
            if (session.wordStatus[targetIdx] === 'correct') return;

            // 1. Check for Perfect Match (Direct Regex)
            const regex = new RegExp(`\\b${ntw}\\b`, 'i');
            if (regex.test(heard)) {
                session.wordStatus[targetIdx] = 'correct';
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
                }
            }
        });

        const isFullMatch = normTargetWords.every((_, idx) => session.wordStatus[idx] !== undefined);

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
            // Security: Nullify onresult and onend to prevent multiple triggers
            rec.onresult = null;
            rec.onend = null;
            rec.stop();

            if (btn) btn.classList.remove('listening');
            if (status) {
                status.textContent = "✅ Concluído!";
                status.style.color = "var(--success)";
            }
            // Update the UI one last time
            if (hint) hint.innerHTML = `${rawHTML}${displayedHTML || "Perfeito!"}${statusHTML}`;

            setTimeout(() => processAnswer(true, session.current.english), 800);
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
        if (!success && isRecognitionActive && session.active && isCorrectMode && currentRecognition === rec) {
            // Reduced delay for faster restart, aiming for "always on" feel
            setTimeout(() => {
                try {
                    if (!success && isRecognitionActive && session.active) rec.start();
                } catch (err) { console.error("Erro ao reiniciar:", err); }
            }, 100);
        } else {
            // Ensure visual state is updated if we stop
            if (currentRecognition === rec) stopListening();
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
        session.lastTranscript = t;
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

        // Safety check: if deleted list was the active one, reset it
        if (appData.currentListId === id) {
            appData.currentListId = null;
            showView('homeView');
        }

        saveData(appData);
        renderLists();
        renderStats();
    });
}

// ==================== SMART LIST GENERATOR ====================

const SENTENCE_POOL = [
    // DAILY LIFE
    { eng: "What time do you usually wake up?", pt: "A que horas você costuma acordar?", topic: "daily" },
    { eng: "I need to go to the supermarket later.", pt: "Eu preciso ir ao supermercado mais tarde.", topic: "daily" },
    { eng: "Would you like some coffee or tea?", pt: "Você gostaria de um pouco de café ou chá?", topic: "daily" },
    { eng: "I am feeling a bit tired today.", pt: "Estou me sentindo um pouco cansado hoje.", topic: "daily" },
    { eng: "The weather is beautiful this morning.", pt: "O tempo está lindo esta manhã.", topic: "daily" },
    { eng: "Could you please pass me the salt?", pt: "Você poderia por favor me passar o sal?", topic: "daily" },
    { eng: "I have to finish my homework tonight.", pt: "Eu tenho que terminar minha lição de casa hoje à noite.", topic: "daily" },
    { eng: "What are your plans for the weekend?", pt: "Quais são os seus planos para o fim de semana?", topic: "daily" },
    { eng: "I really enjoy reading books in my free time.", pt: "Eu gosto muito de ler livros no meu tempo livre.", topic: "daily" },
    { eng: "She is one of my best friends.", pt: "Ela é uma das minhas melhores amigas.", topic: "daily" },
    { eng: "It's getting late, I should go home.", pt: "Está ficando tarde, eu deveria ir para casa.", topic: "daily" },
    { eng: "Have you seen my car keys anywhere?", pt: "Você viu as chaves do meu carro em algum lugar?", topic: "daily" },
    { eng: "I'm going to take a shower and get ready.", pt: "Vou tomar um banho e me arrumar.", topic: "daily" },
    { eng: "We should order pizza for dinner.", pt: "Deveríamos pedir pizza para o jantar.", topic: "daily" },
    { eng: "The children are playing in the park.", pt: "As crianças estão brincando no parque.", topic: "daily" },
    { eng: "I like to listen to music while working.", pt: "Eu gosto de ouvir música enquanto trabalho.", topic: "daily" },
    { eng: "He is drinking a glass of water.", pt: "Ele está bebendo um copo de água.", topic: "daily" },
    { eng: "I forgot to turn off the lights.", pt: "Eu esqueci de apagar as luzes.", topic: "daily" },
    { eng: "Can you help me with these bags?", pt: "Você pode me ajudar com estas sacolas?", topic: "daily" },
    { eng: "I'm looking forward to the party.", pt: "Estou ansioso pela festa.", topic: "daily" },
    { eng: "What's your favorite type of food?", pt: "Qual é o seu tipo de comida favorito?", topic: "daily" },
    { eng: "I need to do the laundry this afternoon.", pt: "Preciso lavar a roupa esta tarde.", topic: "daily" },
    { eng: "He works from Monday to Friday.", pt: "Ele trabalha de segunda a sexta.", topic: "daily" },
    { eng: "My brother lives in another city.", pt: "Meu irmão mora em outra cidade.", topic: "daily" },
    { eng: "I have a doctor's appointment tomorrow.", pt: "Tenho uma consulta médica amanhã.", topic: "daily" },
    { eng: "Do you have any pets?", pt: "Você tem algum animal de estimação?", topic: "daily" },
    { eng: "I need to buy a new pair of shoes.", pt: "Preciso comprar um par de sapatos novos.", topic: "daily" },
    { eng: "The movie starts at eight o'clock.", pt: "O filme começa às oito horas.", topic: "daily" },
    { eng: "It's a pleasure to meet you.", pt: "É um prazer conhecê-lo.", topic: "daily" },
    { eng: "How was your day at school?", pt: "Como foi o seu dia na escola?", topic: "daily" },

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
    { eng: "We need to find a way to reduce costs.", pt: "Precisamos encontrar uma maneira de reduzir custos.", topic: "business" },
    { eng: "The presentation was very professional.", pt: "A apresentação foi muito profissional.", topic: "business" },
    { eng: "I will get back to you as soon as possible.", pt: "Eu retorno para você o mais rápido possível.", topic: "business" },
    { eng: "We are reaching out to potential investors.", pt: "Estamos entrando em contato com investidores em potencial.", topic: "business" },
    { eng: "Is everyone available for the conference call?", pt: "Todos estão disponíveis para a teleconferência?", topic: "business" },
    { eng: "We should focus on the target audience.", pt: "Devemos focar no público-alvo.", topic: "business" },
    { eng: "The project is slightly behind schedule.", pt: "O projeto está um pouco atrasado em relação ao cronograma.", topic: "business" },
    { eng: "Could you please take minutes of the meeting?", pt: "Você poderia por favor fazer a ata da reunião?", topic: "business" },
    { eng: "I'd like to propose a new strategy.", pt: "Eu gostaria de propor uma nova estratégia.", topic: "business" },
    { eng: "We need to approve the budget by Friday.", pt: "Precisamos aprovar o orçamento até sexta-feira.", topic: "business" },
    { eng: "The feedback from the client was positive.", pt: "O feedback do cliente foi positivo.", topic: "business" },
    { eng: "I am currently out of the office.", pt: "Estou fora do escritório no momento.", topic: "business" },
    { eng: "We are expanding our business to Europe.", pt: "Estamos expandindo nossos negócios para a Europa.", topic: "business" },
    { eng: "The quarterly results were better than expected.", pt: "Os resultados trimestrais foram melhores que o esperado.", topic: "business" },
    { eng: "Please keep me updated on the progress.", pt: "Por favor, mantenha-me atualizado sobre o progresso.", topic: "business" },
    { eng: "I will send the meeting invitation shortly.", pt: "Enviarei o convite da reunião em breve.", topic: "business" },
    { eng: "We need to sign the contract by noon.", pt: "Precisamos assinar o contrato até o meio-dia.", topic: "business" },
    { eng: "The team is working hard on the new update.", pt: "A equipe está trabalhando duro na nova atualização.", topic: "business" },
    { eng: "Could you explain the main points again?", pt: "Você poderia explicar os pontos principais novamente?", topic: "business" },
    { eng: "I'm looking for a more challenging role.", pt: "Estou procurando por um cargo mais desafiador.", topic: "business" },

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
    { eng: "What time does the train leave?", pt: "A que horas o trem parte?", topic: "travel" },
    { eng: "I'd like a window seat, please.", pt: "Eu gostaria de um assento na janela, por favor.", topic: "travel" },
    { eng: "Could you recommend a good local restaurant?", pt: "Você poderia recomendar um bom restaurante local?", topic: "travel" },
    { eng: "My luggage has been lost.", pt: "Minha bagagem foi perdida.", topic: "travel" },
    { eng: "I'm here for a business trip.", pt: "Estou aqui para uma viagem de negócios.", topic: "travel" },
    { eng: "Is it safe to walk here at night?", pt: "É seguro caminhar aqui à noite?", topic: "travel" },
    { eng: "How do I get to the city center?", pt: "Como faço para chegar ao centro da cidade?", topic: "travel" },
    { eng: "I need to rent a car for three days.", pt: "Preciso alugar um carro por três dias.", topic: "travel" },
    { eng: "Can I pay with a credit card?", pt: "Posso pagar com cartão de crédito?", topic: "travel" },
    { eng: "Where can I find a taxi stand?", pt: "Onde posso encontrar um ponto de táxi?", topic: "travel" },
    { eng: "Is the tap water safe to drink?", pt: "A água da torneira é segura para beber?", topic: "travel" },
    { eng: "I'd like to book a tour for tomorrow.", pt: "Eu gostaria de reservar um passeio para amanhã.", topic: "travel" },
    { eng: "How long is the waiting list?", pt: "Qual é o tamanho da lista de espera?", topic: "travel" },
    { eng: "I've lost my passport, what should I do?", pt: "Perdi meu passaporte, o que devo fazer?", topic: "travel" },
    { eng: "Can you take a picture of us, please?", pt: "Você pode tirar uma foto nossa, por favor?", topic: "travel" },
    { eng: "What's the best way to get around the city?", pt: "Qual é a melhor maneira de se locomover pela cidade?", topic: "travel" },
    { eng: "I need a receipt for my records.", pt: "Preciso de um recibo para meus registros.", topic: "travel" },
    { eng: "Is there free Wi-Fi in the lobby?", pt: "Tem Wi-Fi gratuito no saguão?", topic: "travel" },
    { eng: "We would like a table for four.", pt: "Gostaríamos de uma mesa para quatro.", topic: "travel" },
    { eng: "I'm just browsing, thank you.", pt: "Estou só dando uma olhadinha, obrigado.", topic: "travel" },

    // GENERAL / IDIOMS
    { eng: "It is important to study every day.", pt: "É importante estudar todos os dias.", topic: "general" },
    { eng: "I believe that anything is possible.", pt: "Eu acredito que qualquer coisa é possível.", topic: "general" },
    { eng: "The world is full of beautiful places.", pt: "O mundo está cheio de lugares bonitos.", topic: "general" },
    { eng: "Knowledge is power.", pt: "Conhecimento é poder.", topic: "general" },
    { eng: "Don't give up on your dreams.", pt: "Não desista dos seus sonhos.", topic: "general" },
    { eng: "Life is a journey, not a destination.", pt: "A vida é uma jornada, não um destino.", topic: "general" },
    { eng: "Success depends on hard work.", pt: "O sucesso depende de trabalho duro.", topic: "general" },
    { eng: "Kindness is always free.", pt: "Gentileza é sempre de graça.", topic: "general" },
    { eng: "Everything happens for a reason.", pt: "Tudo acontece por uma razão.", topic: "general" },
    { eng: "The best is yet to come.", pt: "O melhor ainda está por vir.", topic: "general" },
    { eng: "It's raining cats and dogs.", pt: "Está chovendo canivetes.", topic: "general" },
    { eng: "Break a leg for your performance!", pt: "Boa sorte na sua apresentação!", topic: "general" },
    { eng: "That's a piece of cake.", pt: "Isso é mamão com açúcar.", topic: "general" },
    { eng: "Better late than never.", pt: "Antes tarde do que nunca.", topic: "general" },
    { eng: "Actions speak louder than words.", pt: "Ações valem mais que palavras.", topic: "general" },
    { eng: "Once in a blue moon.", pt: "Raramente.", topic: "general" },
    { eng: "Costs an arm and a leg.", pt: "Custa os olhos da cara.", topic: "general" },
    { eng: "Don't judge a book by its cover.", pt: "Não julgue o livro pela capa.", topic: "general" },
    { eng: "Every cloud has a silver lining.", pt: "Há males que vêm para o bem.", topic: "general" },
    { eng: "Kill two birds with one stone.", pt: "Matar dois coelhos com uma cajadada só.", topic: "general" },
    { eng: "The early bird catches the worm.", pt: "Deus ajuda quem cedo madruga.", topic: "general" },
    { eng: "Time flies when you're having fun.", pt: "O tempo voa quando você se diverte.", topic: "general" },
    { eng: "Under the weather.", pt: "Sentindo-se mal / indisposto.", topic: "general" },
    { eng: "To make a long story short.", pt: "Resumindo a história.", topic: "general" },
    { eng: "Think outside the box.", pt: "Pense fora da caixa.", topic: "general" },
    { eng: "Beat around the bush.", pt: "Ficar enrolando.", topic: "general" },
    { eng: "By the way, have you called him?", pt: "A propósito, você ligou para ele?", topic: "general" },
    { eng: "I'll keep my fingers crossed for you.", pt: "Vou ficar na torcida por você.", topic: "general" },
    { eng: "So far, so good.", pt: "Até aqui, tudo bem.", topic: "general" },
    { eng: "Take it easy.", pt: "Vá com calma.", topic: "general" },
    { eng: "Make yourself at home.", pt: "Sinta-se em casa.", topic: "general" },
    { eng: "I'm in a hurry.", pt: "Estou com pressa.", topic: "general" },
    { eng: "It depends on the situation.", pt: "Depende da situação.", topic: "general" },
    { eng: "As far as I know.", pt: "Até onde eu sei.", topic: "general" },
    { eng: "I changed my mind.", pt: "Eu mudei de ideia.", topic: "general" }
];

function showAutoListModal() {
    // Populate target selector
    const targetSelect = $('autoListTarget');
    targetSelect.innerHTML = '<option value="new">✨ Criar Nova Lista</option>';
    appData.lists.forEach(l => {
        targetSelect.innerHTML += `<option value="${l.id}">📁 Adicionar em: ${escapeHTML(l.name)}</option>`;
    });

    openModal('autoListModal');
}

function getMasteredWords() {
    const masteredWords = new Set();
    appData.lists.forEach(l => {
        l.phrases.forEach(p => {
            // New Rule: Mastery if ANY core skill (Write, Pronounce, Speak) is >= 5
            const isMastered = (p.levels?.quiz >= 5 || p.levels?.write >= 5 || p.levels?.listen >= 5 || p.levels?.pronounce >= 5 || p.levels?.speak >= 5);
            if (isMastered) {
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

    // FILTRO ANTECIPADO: Remove frases que já existem antes de selecionar a quantidade final
    const filteredPool = scoredPool.filter(s => !isPhraseDuplicate(s.eng));
    const selected = filteredPool.slice(0, count);

    if (selected.length === 0) {
        alert("Você já domina todas as frases deste tópico no nosso banco de dados! Tente outro foco.");
        btn.disabled = false;
        btn.textContent = '✨ Gerar Lista';
        return;
    }

    if (selected.length < count) {
        alert(`Consegui encontrar apenas ${selected.length} frases inéditas para este tópico.`);
    }

    saveGeneratedList(selected, topic);
}

function saveGeneratedList(phrases, topic) {
    const targetId = $('autoListTarget').value;
    const topicsMap = {
        'general': 'Geral',
        'daily': 'Vida Diária',
        'business': 'Trabalho/Business',
        'travel': 'Viagens'
    };

    if (targetId === 'new') {
        const listName = `✨ IA: ${topicsMap[topic]} (${new Date().toLocaleDateString()})`;
        const newList = {
            id: 'l_auto_' + Date.now(),
            name: listName,
            phrases: phrases.map(p => ({
                id: 'ph_auto_' + Date.now() + Math.random(),
                english: p.eng,
                portuguese: p.pt,
                levels: { standard: 0, quiz: 0, write: 0, listen: 0, pronounce: 0, speak: 0 },
                nextReview: null
            }))
        };
        appData.lists.push(newList);
    } else {
        const targetList = appData.lists.find(l => l.id === targetId);
        if (targetList) {
            phrases.forEach(p => {
                targetList.phrases.push({
                    id: 'ph_auto_' + Date.now() + Math.random(),
                    english: p.eng,
                    portuguese: p.pt,
                    levels: { standard: 0, quiz: 0, write: 0, listen: 0, pronounce: 0, speak: 0 },
                    nextReview: null
                });
            });
        }
    }

    saveData(appData);

    // UI Cleanup
    closeModal();
    const btn = $('btnGenerateAuto');
    btn.disabled = false;
    btn.textContent = '✨ Gerar Lista';

    renderLists();
    renderPhrases();
    renderStats();

    // Success feedback
    confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
    });

    alert(`Sucesso! Foram adicionadas ${phrases.length} frases novas.`);
}

function showEditListModal(id) {
    const list = appData.lists.find(l => l.id === id);
    if (!list) return;

    $('editListName').value = list.name;
    $('btnSaveListName').onclick = () => {
        const newName = $('editListName').value.trim();
        if (newName) {
            list.name = newName;
            saveData(appData);
            renderLists();
            if (appData.currentListId === id) $('currentListTitle').textContent = newName;
            closeModal();
        }
    };

    openModal('editListModal');
}

function showMovePhraseModal(phraseId) {
    const container = $('moveTargetList');
    container.innerHTML = '';

    // Encontrar lista atual
    let currentList = appData.lists.find(l => l.phrases.some(p => p.id === phraseId));

    appData.lists.forEach(l => {
        if (l.id === currentList.id) return; // Não mostrar lista atual

        const btn = document.createElement('button');
        btn.className = 'btn btn-outline';
        btn.style.textAlign = 'left';
        btn.style.justifyContent = 'flex-start';
        btn.innerHTML = `📁 <b>${escapeHTML(l.name)}</b> <span style="margin-left: auto; font-size: 0.7rem; opacity: 0.6;">${l.phrases.length} frases</span>`;
        btn.onclick = () => executeMove(phraseId, currentList.id, l.id);
        container.appendChild(btn);
    });

    if (appData.lists.length <= 1) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Você precisa ter outras listas para mover frases.</p>';
    }

    openModal('movePhraseModal');
}

function executeMove(phraseId, fromId, toId) {
    const fromList = appData.lists.find(l => l.id === fromId);
    const toList = appData.lists.find(l => l.id === toId);

    if (!fromList || !toList) return;

    const phraseIdx = fromList.phrases.findIndex(p => p.id === phraseId);
    if (phraseIdx === -1) return;

    const phrase = fromList.phrases.splice(phraseIdx, 1)[0];
    toList.phrases.push(phrase);

    saveData(appData);
    closeModal();
    renderPhrases();
    renderStats();
}

function updateStorageUsage() {
    const raw = localStorage.getItem(STORAGE_KEY) || "";
    const size = raw.length; // Approximate bytes for UTF-16 characters
    const limit = 5 * 1024 * 1024; // 5MB standard limit
    const pct = Math.min(((size / limit) * 100), 100).toFixed(2);

    if ($('storageUsageText')) $('storageUsageText').textContent = `${pct}% utilizado (${(size / 1024).toFixed(1)} KB / 5MB)`;
    if ($('storageUsageFill')) $('storageUsageFill').style.width = pct + '%';
}

// Initial UI and Sync checks
renderSyncStatus();
if (appData.auth && appData.auth.isLoggedIn) {
    syncWithCloud(false);
}
