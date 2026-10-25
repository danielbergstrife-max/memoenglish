const APP_VERSION = '5.0.0';
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

async function forceAppUpdate() {
    const btn = typeof event !== 'undefined' && event && event.target ? event.target.closest('button') : null;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="sync-spinner" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle; margin-right: 6px;"></span> Atualizando aplicativo...';
    }

    try {
        // 1. Apaga todos os caches do CacheStorage
        if ('caches' in window) {
            const keys = await caches.keys();
            for (const k of keys) {
                await caches.delete(k);
            }
        }
        // 2. Atualiza e desregistra os Service Workers existentes
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const r of regs) {
                try { await r.update(); } catch (e) {}
                try { await r.unregister(); } catch (e) {}
            }
        }
    } catch (e) {
        console.error('Erro ao forçar atualização:', e);
    }

    // 3. Força o recarregamento com timestamp para anular qualquer cache do navegador (mesmo que a versão seja igual)
    const cleanUrl = window.location.origin + window.location.pathname;
    window.location.replace(`${cleanUrl}?force_update=${Date.now()}`);
}

async function checkVersionAndUpdateAutomatically() {
    if (!navigator.onLine) return;
    try {
        const res = await fetch(`./sw.js?check=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
            const text = await res.text();
            const match = text.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
            if (match && match[1]) {
                const serverCacheName = match[1];
                const localCacheName = `memoenglish-v${APP_VERSION}`;
                if (serverCacheName !== localCacheName) {
                    console.log(`Nova versão disponível no servidor: ${serverCacheName}. Atualizando app automaticamente...`);
                    if ('caches' in window) {
                        const keys = await caches.keys();
                        for (const k of keys) {
                            if (k !== serverCacheName) await caches.delete(k);
                        }
                    }
                    if ('serviceWorker' in navigator) {
                        const reg = await navigator.serviceWorker.getRegistration();
                        if (reg) await reg.update();
                    }
                    window.location.reload();
                }
            }
        }
    } catch (e) {
        // Silencioso se estiver offline ou em caso de falha de conexão
    }
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
        speedRunHighScore: 0,
        speedRunXP: 0,
        streakFreezes: 1, // Proteção contra perda de sequência
        lastStreakFreezeRewardDate: null,
        lastReviewDate: null,
        phoneticCache: {},
        settings: {
            expandContractions: true,
            slowAudio: false,
            autoAdvanceSpeech: false,
            darkMode: false,
            notifications: true,
            dailyGoal: 20,
            tutorialCompleted: false
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
        },
        lastUpdated: 0
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
    if (data.speedRunHighScore === undefined) {
        data.speedRunHighScore = 0;
        modified = true;
    }
    if (data.speedRunXP === undefined) {
        data.speedRunXP = 0;
        modified = true;
    }
    if (data.streakFreezes === undefined) {
        data.streakFreezes = 1;
        modified = true;
    }
    if (data.settings && data.settings.dailyGoal === undefined) {
        data.settings.dailyGoal = 20;
        modified = true;
    }
    // Limpeza de caches vazios ou invlidos para forar nova busca
    if (data.definitionCache) {
        for (const k in data.definitionCache) {
            if (!data.definitionCache[k] || !data.definitionCache[k].definition) {
                delete data.definitionCache[k];
                modified = true;
            }
        }
    }
    if (data.translationCache) {
        for (const k in data.translationCache) {
            const v = data.translationCache[k];
            if (!v || v === k || (typeof v === 'string' && v.startsWith('MYMEMORY WARNING'))) {
                delete data.translationCache[k];
                modified = true;
            }
        }
    }
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
            merged.settings = { ...def.settings, ...(data.settings || {}) };
            return migrateData(merged);
        }
    } catch (e) { console.error('Erro ao carregar:', e); }
    return getDefaultData();
}

function saveData(data) {
    data.lastUpdated = Date.now();
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

function getLowestSkillInfo(phrase) {
    const lv = phrase?.levels || {};
    const skills = isSpeechRecognitionSupported()
        ? ['quiz', 'write', 'listen', 'pronounce', 'speak']
        : ['quiz', 'write', 'listen'];

    let lowestSkill = skills[0];
    let minLvl = lv[lowestSkill] || 0;
    let maxLvl = Math.max(
        lv.quiz || 0,
        lv.write || 0,
        lv.listen || 0,
        lv.pronounce || 0,
        lv.speak || 0
    );

    for (let i = 1; i < skills.length; i++) {
        const s = skills[i];
        const val = lv[s] || 0;
        if (val < minLvl) {
            minLvl = val;
            lowestSkill = s;
        }
    }

    return { lowestSkill, minLvl, maxLvl };
}

function getModeForLevel(phrase, trainingMode) {
    if (trainingMode === 'troublesome') {
        return getLowestSkillInfo(phrase).lowestSkill;
    }
    if (trainingMode === 'multi' && Array.isArray(session.selectedModes) && session.selectedModes.length > 0) {
        const lv = phrase?.levels || {};
        const modes = session.selectedModes;
        let minLvl = Infinity;
        modes.forEach(m => {
            const val = lv[m] || 0;
            if (val < minLvl) minLvl = val;
        });
        const lowestModes = modes.filter(m => (lv[m] || 0) === minLvl);
        const idx = (session.multiModeIndex || 0) % lowestModes.length;
        session.multiModeIndex = (session.multiModeIndex || 0) + 1;
        return lowestModes[idx];
    }
    if (trainingMode !== 'standard') return trainingMode;

    // Standard mode follows the sequence based on the standard level
    const level = phrase.levels?.standard || 0;
    if (level === 0) return 'quiz';
    if (level === 1) return 'write';
    if (level === 2) return 'listen';
    if (!isSpeechRecognitionSupported()) {
        return level % 2 === 1 ? 'write' : 'listen';
    }
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
        (l.phrases || []).forEach(p => {
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

// Avalia de forma robusta o nível de progresso real contido em um dataset
function calculateDataScore(data) {
    if (!data) return 0;
    const phrasesCount = (data.lists || []).reduce((acc, l) => acc + (l.phrases ? l.phrases.length : 0), 0);
    const reviewsCount = data.totalReviews || 0;
    const historyCount = (data.history || []).length;
    const xp = calculateTotalProgress(data) + (data.speedRunXP || 0);
    return (phrasesCount * 100) + (reviewsCount * 10) + (historyCount * 5) + xp;
}

// Converte com segurança payloads da nuvem (sejam JSON ou string serializada)
function parseRemotePayload(remotePayload) {
    if (!remotePayload) return null;
    if (typeof remotePayload === 'string') {
        try {
            return JSON.parse(remotePayload);
        } catch (e) {
            console.error("Falha ao analisar payload da nuvem:", e);
            return null;
        }
    }
    if (typeof remotePayload === 'object') {
        return remotePayload;
    }
    return null;
}

// Mesclagem Inteligente: NUNCA perde o progresso da nuvem e preserva novidades locais
function mergeAppData(local, remote) {
    if (!remote || !remote.lists || remote.lists.length === 0) return local;
    if (!local || !local.lists || local.lists.length === 0) return remote;

    // A nuvem é a base primária do progresso do usuário
    const merged = { ...remote };
    merged.lists = JSON.parse(JSON.stringify(remote.lists || []));

    // Mapeamento das frases da nuvem para evitar duplicatas
    const remotePhraseMap = new Map();
    merged.lists.forEach(l => {
        (l.phrases || []).forEach(p => {
            const key = normalizeText(p.english || '');
            if (key) remotePhraseMap.set(key, p);
        });
    });

    // Se houver frases ou listas criadas localmente no novo dispositivo, preserva-as
    (local.lists || []).forEach(localList => {
        let targetList = merged.lists.find(rl => rl.id === localList.id || rl.name === localList.name);

        (localList.phrases || []).forEach(lp => {
            const normKey = normalizeText(lp.english || '');
            if (!normKey) return;

            const existingRemotePhrase = remotePhraseMap.get(normKey);
            if (existingRemotePhrase) {
                // Se a frase já existe em ambos, preserva o maior nível de memorização
                const remoteLvlSum = Object.values(existingRemotePhrase.levels || {}).reduce((a, b) => a + b, 0);
                const localLvlSum = Object.values(lp.levels || {}).reduce((a, b) => a + b, 0);
                if (localLvlSum > remoteLvlSum) {
                    existingRemotePhrase.levels = { ...(existingRemotePhrase.levels || {}), ...(lp.levels || {}) };
                    if (lp.nextReview) existingRemotePhrase.nextReview = lp.nextReview;
                }
            } else {
                // Frase inédita do dispositivo local: incorpora na lista
                if (!targetList) {
                    targetList = {
                        id: localList.id || ('list_' + Date.now()),
                        name: localList.name || 'Nova Lista',
                        phrases: []
                    };
                    merged.lists.push(targetList);
                }
                targetList.phrases.push(lp);
                remotePhraseMap.set(normKey, lp);
            }
        });
    });

    // Garante que métricas e recordes sempre fiquem com o maior valor atingido
    merged.totalReviews = Math.max(remote.totalReviews || 0, local.totalReviews || 0);
    merged.streak = Math.max(remote.streak || 0, local.streak || 0);
    merged.speedRunHighScore = Math.max(remote.speedRunHighScore || 0, local.speedRunHighScore || 0);
    merged.speedRunXP = Math.max(remote.speedRunXP || 0, local.speedRunXP || 0);
    merged.streakFreezes = Math.max(remote.streakFreezes || 0, local.streakFreezes || 0);

    // Mesclagem de histórico de revisões sem duplicatas
    const historyMap = new Map();
    (remote.history || []).forEach(h => { if (h && h.date) historyMap.set(h.date, h); });
    (local.history || []).forEach(h => { if (h && h.date && !historyMap.has(h.date)) historyMap.set(h.date, h); });
    merged.history = Array.from(historyMap.values()).sort((a, b) => a.date - b.date);

    // Mescla caches auxiliares
    merged.phoneticCache = { ...(remote.phoneticCache || {}), ...(local.phoneticCache || {}) };
    merged.translationCache = { ...(remote.translationCache || {}), ...(local.translationCache || {}) };
    merged.definitionCache = { ...(remote.definitionCache || {}), ...(local.definitionCache || {}) };

    merged.lastUpdated = Math.max(remote.lastUpdated || 0, local.lastUpdated || 0, Date.now());
    return merged;
}

function refreshMainUI() {
    renderSyncStatus();
    renderStats();
    renderLists();
    if (appData.currentListId) renderPhrases();
    renderMetrics();
}

let isSyncInProgress = false;

async function syncWithCloud(isManual = false, isInitialSync = false, pullOnly = false) {
    if (!appData.auth || !appData.auth.isLoggedIn) {
        if (isManual) alert("Por favor, faça login primeiro.");
        return;
    }

    if (isSyncInProgress) {
        return;
    }
    isSyncInProgress = true;

    const statusIndicator = $('syncStatusIndicator');
    const actionArea = $('syncActionArea');
    const loadingStatus = $('loadingStatus');

    if (statusIndicator) statusIndicator.style.display = 'flex';
    if (actionArea) actionArea.style.display = 'flex';
    if (isInitialSync && loadingStatus) loadingStatus.textContent = "Sincronizando com a nuvem...";

    try {
        if (pullOnly) {
            // MODO PULL-ONLY: Baixar exclusivamente os dados da nuvem
            const remoteData = await callGas({
                action: 'load',
                username: appData.auth.username,
                password: appData.auth.password
            });

            if (remoteData && remoteData.success) {
                const remotePayload = parseRemotePayload(remoteData.payload);
                if (remotePayload && remotePayload.lists && remotePayload.lists.length > 0) {
                    if (isInitialSync && loadingStatus) loadingStatus.textContent = "Baixando dados da nuvem...";
                    const savedAuth = { ...appData.auth, lastSync: Date.now() };
                    const savedSyncSettings = appData.syncSettings;

                    // Proteção de mesclagem se o dispositivo local tiver frases
                    const localPhrasesCount = (appData.lists || []).reduce((acc, l) => acc + (l.phrases ? l.phrases.length : 0), 0);
                    if (localPhrasesCount > 0) {
                        appData = mergeAppData(appData, remotePayload);
                    } else {
                        appData = { ...remotePayload };
                    }

                    appData.auth = savedAuth;
                    appData.syncSettings = savedSyncSettings;
                    appData = migrateData(appData);
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
                    refreshMainUI();
                } else {
                    appData.auth.lastSync = Date.now();
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
                }
            }
            if (isInitialSync && loadingStatus) loadingStatus.textContent = "Sincronização concluída!";
        } else if (isInitialSync || isManual) {
            // SINCRONIZAÇÃO INTELIGENTE COM PROTEÇÃO DE PROGRESSO:
            const remoteData = await callGas({
                action: 'load',
                username: appData.auth.username,
                password: appData.auth.password
            });

            if (remoteData && remoteData.success) {
                const remotePayload = parseRemotePayload(remoteData.payload);

                if (remotePayload && remotePayload.lists && remotePayload.lists.length > 0) {
                    const cloudScore = calculateDataScore(remotePayload);
                    const localScore = calculateDataScore(appData);

                    // SE A NUVEM TEM MAIS PROGRESSO: Nunca sobrescreve! Sempre adota/mescla da nuvem!
                    if (cloudScore > localScore) {
                        const savedAuth = { ...appData.auth, lastSync: Date.now() };
                        appData = mergeAppData(appData, remotePayload);
                        appData.auth = savedAuth;
                        appData = migrateData(appData);
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
                        refreshMainUI();
                        if (isManual) alert("Seu progresso da nuvem foi carregado com sucesso!");
                    } else if (localScore > cloudScore) {
                        // Dispositivo local tem progresso novo: mescla e envia para a nuvem
                        const savedAuth = { ...appData.auth, lastSync: Date.now() };
                        appData = mergeAppData(appData, remotePayload);
                        appData.auth = savedAuth;
                        appData = migrateData(appData);

                        const res = await callGas({
                            action: 'save',
                            username: appData.auth.username,
                            password: appData.auth.password,
                            payload: appData
                        });
                        if (res && res.success) {
                            localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
                            if (isManual) alert("Novo progresso enviado para a nuvem com sucesso!");
                        }
                    } else {
                        // Empate: apenas sincroniza timestamp
                        appData.auth.lastSync = Date.now();
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
                        if (isManual) alert("Seus dados já estão sincronizados!");
                    }
                } else {
                    // Nuvem ainda vazia: envia dados locais
                    const res = await callGas({
                        action: 'save',
                        username: appData.auth.username,
                        password: appData.auth.password,
                        payload: appData
                    });
                    if (res && res.success) {
                        appData.auth.lastSync = Date.now();
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
                        if (isManual) alert("Dados enviados para a nuvem com sucesso!");
                    }
                }
            }
        } else {
            // MODO SEGURO: Apenas envia alterações se o dispositivo tiver progresso válido
            const localPhrasesCount = (appData.lists || []).reduce((acc, l) => acc + (l.phrases ? l.phrases.length : 0), 0);
            if (localPhrasesCount > 0 || (appData.history && appData.history.length > 0)) {
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
        }
    } catch (e) {
        console.error("Erro na sincronização:", e);
        if (isManual) alert("Erro ao sincronizar. Verifique sua conexão.");
        if (isInitialSync && loadingStatus) loadingStatus.textContent = "Erro na sincronização (Offline)";
    } finally {
        isSyncInProgress = false;
        if (statusIndicator) statusIndicator.style.display = 'none';
        renderSyncStatus();
    }
}

async function callGas(data) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const res = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify(data),
            redirect: 'follow',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            return { success: false, error: `Servidor retornou status ${res.status}` };
        }

        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch (jsonErr) {
            console.warn("Resposta do servidor não é JSON:", text);
            return { success: false, error: "Resposta inesperada do servidor." };
        }
    } catch (e) {
        console.error("GAS Call Error:", e);
        if (e.name === 'AbortError') {
            return { success: false, error: "Tempo limite de conexão esgotado (timeout)." };
        }
        return { success: false, error: e.toString() };
    }
}

// ==================== BOT VERIFICATION (CAPTCHA) ====================
let currentCaptchaResult = null;

function generateCaptcha() {
    let num1, num2;
    const prevResult = currentCaptchaResult;
    let attempts = 0;
    // Garante que o desafio mude a cada geração
    do {
        num1 = Math.floor(Math.random() * 9) + 1; // 1 a 9
        num2 = Math.floor(Math.random() * 9) + 1; // 1 a 9
        attempts++;
    } while (num1 + num2 === prevResult && attempts < 10);

    currentCaptchaResult = num1 + num2;
    const captchaTextEl = $('captchaText');
    const loginCaptchaEl = $('loginCaptcha');
    if (captchaTextEl) {
        captchaTextEl.textContent = `${num1} + ${num2} = ?`;
    }
    if (loginCaptchaEl) {
        loginCaptchaEl.value = '';
    }
    return currentCaptchaResult;
}

function showLoginModal() {
    openModal('loginModal');
    if ($('loginError')) $('loginError').style.display = 'none';
    if ($('loginLoading')) $('loginLoading').style.display = 'none';
    if ($('loginActionButtons')) $('loginActionButtons').style.display = 'grid';
    if ($('loginModalHint')) $('loginModalHint').style.display = 'block';
    if ($('captchaContainer')) $('captchaContainer').style.display = 'block';
    if ($('loginConsent')) $('loginConsent').checked = false;
    if ($('loginUser')) $('loginUser').value = '';
    if ($('loginPass')) $('loginPass').value = '';
    generateCaptcha();
    setTimeout(() => {
        const userEl = $('loginUser');
        if (userEl) userEl.focus();
    }, 150);
}

async function handleLoginSubmit(mode) {
    const userEl = $('loginUser');
    const passEl = $('loginPass');
    const captchaEl = $('loginCaptcha');
    const consentEl = $('loginConsent');
    const errorEl = $('loginError');
    const loadingEl = $('loginLoading');
    const actionsEl = $('loginActionButtons');
    const hintEl = $('loginModalHint');
    const captchaContainer = $('captchaContainer');

    const user = userEl ? userEl.value.trim() : '';
    const pass = passEl ? passEl.value.trim() : '';
    const captchaInput = captchaEl ? parseInt(captchaEl.value.trim(), 10) : NaN;

    if (mode === 'signup' && consentEl && !consentEl.checked) {
        if (errorEl) {
            errorEl.textContent = "Você deve aceitar os termos de uso para criar uma conta.";
            errorEl.style.display = 'block';
        }
        return;
    }

    if (!user || !pass) {
        if (errorEl) {
            errorEl.textContent = "Preencha todos os campos.";
            errorEl.style.display = 'block';
        }
        return;
    }

    if (user.length < 3) {
        if (errorEl) {
            errorEl.textContent = "O nome de usuário deve ter pelo menos 3 caracteres.";
            errorEl.style.display = 'block';
        }
        return;
    }

    if (pass.length < 4) {
        if (errorEl) {
            errorEl.textContent = "A senha deve ter pelo menos 4 caracteres.";
            errorEl.style.display = 'block';
        }
        return;
    }

    if (isNaN(captchaInput) || currentCaptchaResult === null || captchaInput !== currentCaptchaResult) {
        if (errorEl) {
            errorEl.textContent = "Verificação humana incorreta.";
            errorEl.style.display = 'block';
        }
        generateCaptcha();
        if (captchaEl) {
            captchaEl.value = '';
            captchaEl.focus();
        }
        return;
    }

    if (errorEl) errorEl.style.display = 'none';
    if (loadingEl) {
        loadingEl.innerHTML = `<span class="sync-spinner" style="margin-bottom: 8px;"></span><br>${mode === 'signup' ? 'Criando sua conta na nuvem...' : 'Aguarde um momento, estamos sincronizando seus dados...'}`;
        loadingEl.style.display = 'block';
    }
    if (actionsEl) actionsEl.style.display = 'none';
    if (hintEl) hintEl.style.display = 'none';
    if (captchaContainer) captchaContainer.style.display = 'none';

    try {
        const res = await callGas({
            action: mode, // 'login' or 'signup'
            username: user,
            password: pass
        });

        if (res && res.success) {
            if (mode === 'signup') {
                // CADASTRO: Nova conta criada. Associa as credenciais e salva o progresso local inicial na nuvem.
                appData.auth.isLoggedIn = true;
                appData.auth.username = user;
                appData.auth.password = pass;
                appData.auth.lastSync = Date.now();
                saveData(appData);

                // Envia os dados locais iniciais para a nuvem
                await callGas({
                    action: 'save',
                    username: user,
                    password: pass,
                    payload: appData
                });

                closeModal();
                renderSyncStatus();
                alert(`Conta criada com sucesso! Bem-vindo(a), ${user}!`, "Conta Criada", "🎉");
            } else {
                // LOGIN: PROTEÇÃO TOTAL CONTRA PERDA DE DADOS!
                // Primeiro baixa os dados da nuvem. Se falhar, NUNCA marca o login para não sobrescrever a nuvem com dados vazios!
                if (loadingEl) {
                    loadingEl.innerHTML = '<span class="sync-spinner" style="margin-bottom: 8px;"></span><br>Carregando seus dados salvos na nuvem...';
                }

                const remoteData = await callGas({
                    action: 'load',
                    username: user,
                    password: pass
                });

                if (!remoteData || !remoteData.success) {
                    if (loadingEl) loadingEl.style.display = 'none';
                    if (actionsEl) actionsEl.style.display = 'grid';
                    if (hintEl) hintEl.style.display = 'block';
                    if (captchaContainer) captchaContainer.style.display = 'block';
                    generateCaptcha();
                    if (errorEl) {
                        errorEl.textContent = "Não foi possível carregar os dados salvos da nuvem. Sua conta não foi alterada para proteger seu progresso. Verifique sua conexão e tente novamente.";
                        errorEl.style.display = 'block';
                    }
                    return;
                }

                const remotePayload = parseRemotePayload(remoteData.payload);
                const authInfo = {
                    isLoggedIn: true,
                    username: user,
                    password: pass,
                    lastSync: Date.now()
                };

                let phrasesRestored = 0;

                if (remotePayload && remotePayload.lists && remotePayload.lists.length > 0) {
                    phrasesRestored = remotePayload.lists.reduce((acc, l) => acc + (l.phrases ? l.phrases.length : 0), 0);
                    const localPhrasesCount = (appData.lists || []).reduce((acc, l) => acc + (l.phrases ? l.phrases.length : 0), 0);

                    if (localPhrasesCount > 0) {
                        // Dispositivo local tinha algumas frases criadas antes do login: mescla com segurança
                        appData = mergeAppData(appData, remotePayload);
                    } else {
                        // Dispositivo novo sem frases: adota 100% o progresso da nuvem
                        appData = { ...remotePayload };
                    }
                } else if (remotePayload) {
                    appData = { ...remotePayload, ...(appData.lists?.length ? { lists: appData.lists } : {}) };
                }

                appData.auth = authInfo;
                appData = migrateData(appData);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
                refreshMainUI();

                // Atualiza a nuvem com a versão consolidada
                await callGas({
                    action: 'save',
                    username: user,
                    password: pass,
                    payload: appData
                });

                closeModal();
                renderSyncStatus();
                alert(`Bem-vindo(a) de volta, ${user}! Seu progresso foi restaurado com sucesso (${phrasesRestored} frases carregadas).`, "Login Concluído", "☁️");
            }
        } else {
            if (loadingEl) loadingEl.style.display = 'none';
            if (actionsEl) actionsEl.style.display = 'grid';
            if (hintEl) hintEl.style.display = 'block';
            if (captchaContainer) captchaContainer.style.display = 'block';
            generateCaptcha();
            if (errorEl) {
                errorEl.textContent = (res && res.error) || (mode === 'signup' ? "Usuário já existe." : "Usuário ou senha incorretos.");
                errorEl.style.display = 'block';
            }
        }
    } catch (e) {
        console.error("handleLoginSubmit error:", e);
        if (loadingEl) loadingEl.style.display = 'none';
        if (actionsEl) actionsEl.style.display = 'grid';
        if (hintEl) hintEl.style.display = 'block';
        if (captchaContainer) captchaContainer.style.display = 'block';
        generateCaptcha();
        if (errorEl) {
            errorEl.textContent = "Erro de conexão ao acessar o servidor.";
            errorEl.style.display = 'block';
        }
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

async function deleteAccountCloud() {
    confirm("⚠️ ATENÇÃO: Esta ação apagará permanentemente todos os seus dados sincronizados na nuvem. Os dados locais não serão afetados. Deseja prosseguir?", async () => {
        const loadingStatus = $('syncStatusIndicator');
        if (loadingStatus) loadingStatus.style.display = 'flex';

        try {
            const res = await callGas({
                action: 'delete',
                username: appData.auth.username,
                password: appData.auth.password
            });

            if (res && res.success) {
                appData.auth.isLoggedIn = false;
                appData.auth.username = "";
                appData.auth.password = "";
                saveData(appData);
                renderSyncStatus();
                alert("Sua conta e dados na nuvem foram excluídos com sucesso.", "Conta Excluída", "🗑️");
            } else {
                alert("Erro ao excluir conta: " + (res.error || "Servidor não respondeu adequadamente."), "Erro");
            }
        } catch (e) {
            console.error("Erro ao excluir conta:", e);
            alert("Erro de conexão ao tentar excluir a conta.", "Erro");
        } finally {
            if (loadingStatus) loadingStatus.style.display = 'none';
        }
    }, "Confirmar Exclusão");
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

// Sincronização automática ao ficar online foi removida conforme especificação
// Os dados são sincronizados APENAS em: login (pull-only) e após testes/edições (push)

// ==================== UI ====================
function $(id) { return document.getElementById(id); }

function showView(viewId) {
    // Stop any active recognition, audio, and timer when switching views
    stopListening();
    if (typeof stopAllAudio === 'function') stopAllAudio();
    if (typeof clearExerciseTimer === 'function') clearExerciseTimer();
    if (typeof clearAutoAdvanceTimer === 'function') clearAutoAdvanceTimer();

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

function syncAutoAdvanceToggles() {
    const enabled = !!(appData.settings && appData.settings.autoAdvanceSpeech);
    if ($('settingAutoAdvanceSpeech')) $('settingAutoAdvanceSpeech').checked = enabled;
    document.querySelectorAll('.autoAdvanceSpeechToggle').forEach(el => {
        el.checked = enabled;
    });
}

function populateSettings() {
    $('settingExpandContractions').checked = appData.settings.expandContractions;
    $('settingSlowAudio').checked = appData.settings.slowAudio;
    syncAutoAdvanceToggles();
    $('settingDarkMode').checked = appData.settings.darkMode;
    $('settingNotifications').checked = appData.settings.notifications !== false;
}

function updateSetting(key, val) {
    if (!appData.settings) appData.settings = {};
    appData.settings[key] = val;
    saveData(appData);
    if (key === 'darkMode') applyDarkMode();
    if (key === 'autoAdvanceSpeech') syncAutoAdvanceToggles();
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

    const welcomeTitle = $('homeWelcomeTitle');
    if (welcomeTitle) {
        const hour = new Date().getHours();
        let greeting = "Bom dia";
        if (hour >= 12 && hour < 18) greeting = "Boa tarde";
        else if (hour >= 18 || hour < 5) greeting = "Boa noite";

        const name = (appData.auth && appData.auth.isLoggedIn && appData.auth.username) ? `, ${appData.auth.username}` : "";
        welcomeTitle.textContent = `${greeting}${name}! 👋`;
    }

    $('statTotal').textContent = total;
    $('statDue').textContent = due;
    $('statMemorized').textContent = memorized;
    if ($('statReviewsSide')) $('statReviewsSide').textContent = appData.totalReviews;
    $('dueText').textContent = due;

    // Atualiza o texto do botão de início principal
    const btnMainStart = $('btnMainStart');
    if (btnMainStart) {
        if (due === 0) {
            btnMainStart.innerHTML = "✨ Criar frases e iniciar";
            btnMainStart.style.fontSize = "1rem"; // Ajuste pequeno para caber o texto maior
        } else {
            btnMainStart.innerHTML = "⚡ Iniciar";
            btnMainStart.style.fontSize = "1.1rem";
        }
    }

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

    // Daily Goal & Gamification
    const today = new Date().toDateString();
    const reviewsToday = appData.history.filter(h => new Date(h.date).toDateString() === today).length;
    const goal = (appData.settings && appData.settings.dailyGoal) ? parseInt(appData.settings.dailyGoal) : 20;
    const pct = Math.min(Math.round((reviewsToday / goal) * 100), 100);

    if ($('goalPct')) $('goalPct').textContent = pct + '%';
    if ($('goalCircle')) $('goalCircle').style.strokeDasharray = `${pct}, 100`;
    if ($('goalTargetText')) $('goalTargetText').textContent = goal;
    if ($('settingDailyGoal')) $('settingDailyGoal').value = goal.toString();

    // Streak Freeze display
    const freezes = appData.streakFreezes !== undefined ? appData.streakFreezes : 1;
    if ($('freezeCountSpan')) $('freezeCountSpan').textContent = freezes;
    if ($('freezeCountSpanSettings')) $('freezeCountSpanSettings').textContent = freezes;

    // Daily Goal Reward: bater a meta concede 1 Streak Freeze (máx 2)
    if (reviewsToday >= goal && appData.lastStreakFreezeRewardDate !== today && freezes < 2) {
        appData.streakFreezes = freezes + 1;
        appData.lastStreakFreezeRewardDate = today;
        saveData(appData);
        if ($('freezeCountSpan')) $('freezeCountSpan').textContent = appData.streakFreezes;
        if ($('freezeCountSpanSettings')) $('freezeCountSpanSettings').textContent = appData.streakFreezes;
    }

    // Troublesome phrases count
    updateTroublesomeCount();

    updateGlobalLevel();

    // Heatmap & Speed Run Record
    renderHeatmap();
    if ($('speedRunRecordBadge')) {
        $('speedRunRecordBadge').textContent = `Recorde: ${appData.speedRunHighScore || 0} pts`;
    }
}

function updateDailyGoalSetting(val) {
    if (!appData.settings) appData.settings = {};
    appData.settings.dailyGoal = parseInt(val) || 20;
    saveData(appData);
    updateUI();
}

function getTroublesomePhrases() {
    const troublesome = [];
    appData.lists.forEach(l => {
        if (!l.phrases) return;
        l.phrases.forEach(p => {
            const { minLvl, maxLvl } = getLowestSkillInfo(p);
            const isStudied = maxLvl > 0;

            // Frase já iniciada onde o menor nível ainda não foi dominado (< 5) e está baixo (<= 1) ou atrás dos demais (< maxLvl)
            if (isStudied && minLvl < 5 && (minLvl <= 1 || minLvl < maxLvl)) {
                troublesome.push(p);
            }
        });
    });
    return troublesome;
}

function updateTroublesomeCount() {
    const count = getTroublesomePhrases().length;
    const el = $('troublesomeCount');
    if (el) el.textContent = count;
}

function startTroublesomeReview() {
    const phrases = getTroublesomePhrases();
    if (phrases.length === 0) {
        alert("🎉 Parabéns! Você não tem nenhuma frase com dificuldade pendente no momento!");
        return;
    }

    session.active = false;
    session.queue = [];
    session.current = null;
    session.mode = null;

    session.active = true;
    session.trainingMode = 'troublesome';
    session.queue = [...phrases].sort((a, b) => {
        const infoA = getLowestSkillInfo(a);
        const infoB = getLowestSkillInfo(b);
        if (infoA.minLvl !== infoB.minLvl) return infoA.minLvl - infoB.minLvl;
        const gapA = infoA.maxLvl - infoA.minLvl;
        const gapB = infoB.maxLvl - infoB.minLvl;
        if (gapB !== gapA) return gapB - gapA;
        return Math.random() - 0.5;
    });
    session.originalCount = session.queue.length;

    showView('reviewView');
    nextPhrase();
}

function updateGlobalLevel() {
    // New XP Weights: Quiz=5, Write=10, Listen=12, Pronounce=15, Speak=20 + Speed Run XP
    let totalXP = (appData.speedRunXP || 0);
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

async function lookupWord(rawWord) {
    if (!rawWord) return;
    const cleanWord = rawWord.replace(/[^a-zA-Z'\-]/g, '').trim();
    if (!cleanWord || cleanWord.length < 2) return;

    if ($('lookupWordTitle')) $('lookupWordTitle').textContent = cleanWord;
    if ($('lookupWordPhonetic')) $('lookupWordPhonetic').textContent = `[ ${getPhoneticGuide(cleanWord)} ]`;
    if ($('lookupWordTranslation')) $('lookupWordTranslation').textContent = 'Traduzindo...';
    if ($('lookupWordExamples')) $('lookupWordExamples').innerHTML = '';

    // Buscar frases do usuário que contêm essa palavra
    const wordNorm = normalizeText(cleanWord);
    const examples = [];
    for (const list of appData.lists) {
        for (const p of list.phrases) {
            const pNorm = normalizeText(p.english);
            if (pNorm.split(' ').includes(wordNorm)) {
                examples.push(p);
                if (examples.length >= 3) break;
            }
        }
        if (examples.length >= 3) break;
    }

    if (examples.length > 0 && $('lookupWordExamples')) {
        $('lookupWordExamples').innerHTML = examples.map(ex => `
            <div style="background: var(--surface); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border);">
                <div style="font-weight: 700; color: var(--text);">${escapeHTML(ex.english)}</div>
                <div style="color: var(--text-muted); font-size: 0.8rem;">${escapeHTML(ex.portuguese)}</div>
            </div>
        `).join('');
    } else if ($('lookupWordExamples')) {
        $('lookupWordExamples').innerHTML = '<div style="font-style: italic;">Nenhum outro exemplo cadastrado.</div>';
    }

    openModal('wordDetailModal');

    // Tradução com cache
    if (appData.translationCache && appData.translationCache[cleanWord.toLowerCase()]) {
        if ($('lookupWordTranslation')) $('lookupWordTranslation').textContent = appData.translationCache[cleanWord.toLowerCase()];
    } else {
        const res = await translateText(cleanWord, 'en', 'pt');
        if (res && res.translated) {
            if ($('lookupWordTranslation')) $('lookupWordTranslation').textContent = res.translated;
            if (!appData.translationCache) appData.translationCache = {};
            appData.translationCache[cleanWord.toLowerCase()] = res.translated;
            saveData(appData);
        } else {
            if ($('lookupWordTranslation')) $('lookupWordTranslation').textContent = 'Tradução indisponível';
        }
    }
}

function closeWordModal() {
    closeModal();
}

function makeWordsClickable(sentence) {
    if (!sentence) return '';
    return sentence.split(/(\s+)/).map(token => {
        if (/^\s+$/.test(token)) return token;
        const clean = token.replace(/[^a-zA-Z'\-]/g, '');
        if (clean.length > 1) {
            return `<span class="clickable-word" onclick="lookupWord('${escapeJS(clean)}')" title="Clique para ver tradução e fonética">${escapeHTML(token)}</span>`;
        }
        return escapeHTML(token);
    }).join('');
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
                    <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 4px;">${makeWordsClickable(p.english)}</div>
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
    
    // Retorna cache somente se houver definio vlida
    if (appData.definitionCache[normalized] && appData.definitionCache[normalized].definition) {
        return appData.definitionCache[normalized];
    }

    // 1. Datamuse API (muito rpida, estvel e sem limites dirios rgidos)
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(normalized)}&md=d&max=1`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0].defs) && data[0].defs.length > 0) {
                const defParts = data[0].defs[0].split('\t');
                const pos = defParts.length > 1 ? defParts[0] : '';
                const defText = (defParts.length > 1 ? defParts[1] : defParts[0]).trim();
                const posMap = { n: 'noun', v: 'verb', adj: 'adj', adv: 'adverb', u: '' };
                const posLabel = posMap[pos] || pos;
                const definition = posLabel ? `(${posLabel}) ${defText}` : defText;
                
                appData.definitionCache[normalized] = { definition };
                saveData(appData);
                return appData.definitionCache[normalized];
            }
        }
    } catch (e) {
        console.warn('Datamuse lookup falhou para', normalized, e);
    }

    // 2. Fallback para Free Dictionary API com timeout
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalized)}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                const entry = data[0];
                const meaning = entry.meanings?.find(m => Array.isArray(m.definitions) && m.definitions.length > 0);
                const definitionText = meaning?.definitions?.[0]?.definition || entry.meanings?.[0]?.definitions?.[0]?.definition || '';
                const label = meaning?.partOfSpeech ? `(${meaning.partOfSpeech}) ` : '';
                const definition = definitionText ? `${label}${definitionText}` : '';
                if (definition) {
                    appData.definitionCache[normalized] = { definition };
                    saveData(appData);
                    return appData.definitionCache[normalized];
                }
            }
        }
    } catch (e) {
        console.warn('DictionaryAPI falhou para', normalized, e);
    }

    // No cachear definio vazia para permitir tentar novamente
    return { definition: '' };
}

async function translateTextToPortuguese(text) {
    if (!text) return '';
    const cleanText = text.trim();
    if (!cleanText) return '';

    appData.translationCache = appData.translationCache || {};
    if (appData.translationCache[cleanText]) return appData.translationCache[cleanText];

    // 1. Google Translate via translateText integrado
    try {
        const res = await translateText(cleanText, 'en', 'pt');
        if (res && res.translated && res.translated.trim()) {
            const tr = res.translated.trim();
            appData.translationCache[cleanText] = tr;
            saveData(appData);
            return tr;
        }
    } catch (e) {
        console.warn('Google Translate falhou, tentando MyMemory:', e);
    }

    // 2. MyMemory API com timeout
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanText)}&langpair=en|pt-BR`;
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            const data = await res.json();
            const translated = data?.responseData?.translatedText;
            if (translated && !translated.startsWith('MYMEMORY WARNING') && translated.trim()) {
                const tr = translated.trim();
                appData.translationCache[cleanText] = tr;
                saveData(appData);
                return tr;
            }
        }
    } catch (e) {
        console.warn('MyMemory falhou:', e);
    }

    // 3. Fallback: procurar nas frases cadastradas pelo usurio
    const wordNorm = normalizeText(cleanText);
    for (const list of appData.lists || []) {
        for (const p of list.phrases || []) {
            if (normalizeText(p.english) === wordNorm && p.portuguese) {
                appData.translationCache[cleanText] = p.portuguese;
                saveData(appData);
                return p.portuguese;
            }
        }
    }

    return '';
}

async function getStudiedWordInfo(word) {
    const cleanWord = word.trim();
    const phonetic = getPhoneticGuide(cleanWord);

    // Traduo direta da prpria palavra
    let directPt = '';
    if (appData.translationCache && appData.translationCache[cleanWord.toLowerCase()]) {
        directPt = appData.translationCache[cleanWord.toLowerCase()];
    } else {
        directPt = await translateTextToPortuguese(cleanWord);
        if (directPt && (!appData.translationCache || !appData.translationCache[cleanWord.toLowerCase()])) {
            appData.translationCache = appData.translationCache || {};
            appData.translationCache[cleanWord.toLowerCase()] = directPt;
            saveData(appData);
        }
    }

    // Definio em ingls
    const defObj = await getWordDefinition(cleanWord);
    const definition = defObj.definition || '';

    // Traduo da definio em portugus
    let definitionPt = '';
    if (definition) {
        definitionPt = await translateTextToPortuguese(definition);
    }

    return {
        word: cleanWord,
        phonetic,
        directPt: directPt || 'Tradução não disponível',
        definition: definition || 'Definição não encontrada',
        definitionPt: definitionPt || (directPt ? `(Tradução direta: ${directPt})` : 'Tradução não disponível')
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
        <div class="card" style="padding: 12px 16px; border-left: 4px solid var(--primary); background: var(--surface); margin-bottom: 8px;">
            <button type="button" class="studied-word-item" data-index="${index}" data-word="${escapeHTML(word)}" style="text-align:left; width:100%; border:none; background:none; padding: 0; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                <div style="font-weight: 800; font-size: 1.05rem; color: var(--text);">${escapeHTML(word)}</div>
                <div style="font-size: 0.85rem; color: var(--text-muted);">▶</div>
            </button>
            <div id="studiedWordDetail-${index}" class="studied-word-detail" style="display:none; color: var(--text-muted); font-size: 0.95rem; line-height: 1.6; margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px;"></div>
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

    // Se j estiver visvel, oculta (toggle)
    if (detailEl.style.display === 'block') {
        detailEl.style.display = 'none';
        button.classList.remove('active-word-item');
        const arrow = button.querySelector('div:last-child');
        if (arrow) arrow.textContent = '▶';
        return;
    }

    // Esconde os demais detalhes
    document.querySelectorAll('.studied-word-item').forEach(btn => {
        btn.classList.remove('active-word-item');
        const arr = btn.querySelector('div:last-child');
        if (arr) arr.textContent = '▶';
    });
    document.querySelectorAll('.studied-word-detail').forEach(el => el.style.display = 'none');

    // Abre este item
    button.classList.add('active-word-item');
    const arrow = button.querySelector('div:last-child');
    if (arrow) arrow.textContent = '▼';
    detailEl.style.display = 'block';

    // Carrega caso ainda no tenha sido carregado
    if (detailEl.dataset.loaded !== 'true') {
        detailEl.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">Carregando informações da palavra...</div>';
        const info = await getStudiedWordInfo(word);
        
        detailEl.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
                <span style="font-family: monospace; font-size: 0.95rem; color: var(--primary); font-weight: 700; background: rgba(59, 130, 246, 0.1); padding: 3px 8px; border-radius: 6px;">[ ${escapeHTML(info.phonetic)} ]</span>
                <button type="button" class="btn btn-outline" style="padding: 3px 10px; font-size: 0.8rem; border-radius: 6px;" onclick="event.stopPropagation(); playAudio('${escapeJS(word)}');">
                    🔊 Ouvir pronúncia
                </button>
            </div>
            <div style="margin-bottom: 6px; font-size: 0.95rem; color: var(--text);">
                <strong style="color: var(--primary);">Tradução:</strong> <span style="font-weight: 600;">${escapeHTML(info.directPt)}</span>
            </div>
            <div style="margin-bottom: 6px;">
                <strong>Significado (EN):</strong> ${escapeHTML(info.definition)}
            </div>
            <div>
                <strong>Significado em PT:</strong> ${escapeHTML(info.definitionPt)}
            </div>
        `;
        if (info.definition !== 'Definição não encontrada' || info.directPt !== 'Tradução não disponível') {
            detailEl.dataset.loaded = 'true';
        }
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

function isSpeechRecognitionSupported() {
    return ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window);
}

// ==================== MULTI-MODE SELECTION ====================
let isMultiModeSelectActive = false;
let selectedMultiModes = [];

const MODE_LABELS_PT = {
    quiz: '🧩 Quiz',
    write: '✍️ Escrita',
    listen: '👂 Escuta',
    pronounce: '🗣️ Pronúncia',
    speak: '🎙️ Fala'
};

function handleModeCardClick(mode) {
    if (isMultiModeSelectActive || selectedMultiModes.length > 0) {
        toggleModeInMulti(mode);
    } else {
        startReview(mode);
    }
}

function toggleMultiModeSelect() {
    isMultiModeSelectActive = !isMultiModeSelectActive;
    if (!isMultiModeSelectActive) {
        selectedMultiModes = [];
    }
    updateMultiModeUI();
}

function toggleModeInMulti(mode) {
    const idx = selectedMultiModes.indexOf(mode);
    if (idx >= 0) {
        selectedMultiModes.splice(idx, 1);
    } else {
        selectedMultiModes.push(mode);
    }
    isMultiModeSelectActive = selectedMultiModes.length > 0 || isMultiModeSelectActive;
    updateMultiModeUI();
}

function clearMultiModeSelection() {
    isMultiModeSelectActive = false;
    selectedMultiModes = [];
    updateMultiModeUI();
}

function updateMultiModeUI() {
    const bar = $('multiModeBar');
    const toggleBtn = $('btnToggleMultiMode');
    const statusText = $('multiModeStatusText');
    const startBtn = $('btnStartMultiMode');

    document.querySelectorAll('.mode-card[data-mode]').forEach(card => {
        const m = card.getAttribute('data-mode');
        card.classList.toggle('selected-mode', selectedMultiModes.includes(m));
    });

    const showBar = isMultiModeSelectActive || selectedMultiModes.length > 0;
    if (bar) bar.style.display = showBar ? 'flex' : 'none';
    if (toggleBtn) {
        toggleBtn.innerHTML = showBar ? '✕ Fechar Seleção' : '☑️ Combinar Modos';
        toggleBtn.style.borderColor = showBar ? 'var(--primary)' : '';
        toggleBtn.style.color = showBar ? 'var(--primary)' : '';
    }

    if (statusText) {
        if (selectedMultiModes.length === 0) {
            statusText.textContent = 'Toque nos modos abaixo para combiná-los na mesma sessão';
        } else {
            const names = selectedMultiModes.map(m => MODE_LABELS_PT[m] || m).join(' + ');
            statusText.innerHTML = `Combinando: <span style="color: var(--primary);">${names}</span>`;
        }
    }

    if (startBtn) {
        startBtn.disabled = selectedMultiModes.length === 0;
        startBtn.textContent = `🚀 Iniciar Combinado (${selectedMultiModes.length})`;
    }
}

function startMultiModeReview() {
    if (selectedMultiModes.length === 0) return;
    if (selectedMultiModes.length === 1) {
        startReview(selectedMultiModes[0]);
        return;
    }

    const needsSpeech = selectedMultiModes.includes('pronounce') || selectedMultiModes.includes('speak');
    if (needsSpeech && !isSpeechRecognitionSupported()) {
        alert("⚠️ Reconhecimento de voz não suportado pelo seu navegador atual (comum no Safari do iOS).\n\nPara incluir Fala ou Pronúncia no treino combinado, utilize o Google Chrome no Android, Windows ou Mac.");
        return;
    }

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
        window.confirm(
            "Você não tem frases para revisar no momento. Deseja que eu crie 10 frases gerais automaticamente para você praticar nos modos selecionados?",
            () => {
                generateAutomaticPhrases(10, 'multi');
            },
            "Nenhuma frase para revisar"
        );
        return;
    }

    session.active = true;
    session.trainingMode = 'multi';
    session.selectedModes = [...selectedMultiModes];
    session.multiModeIndex = 0;

    allDue.forEach(p => {
        if (!p.levels) {
            const lvl = p.level || 0;
            p.levels = { standard: lvl, quiz: lvl, write: lvl, listen: lvl, pronounce: lvl, speak: lvl };
        }
    });

    const getMinSelectedLvl = (p) => {
        return Math.min(...session.selectedModes.map(m => (p.levels && p.levels[m] !== undefined) ? p.levels[m] : 0));
    };

    const reviewPhrases = allDue.filter(p => getMinSelectedLvl(p) > 0).sort(() => Math.random() - 0.5);
    const newPhrases = allDue.filter(p => getMinSelectedLvl(p) === 0).sort(() => Math.random() - 0.5);

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

// ==================== ACTIONS ====================
function startReview(mode = 'standard') {
    if (mode === 'handsfree') {
        startHandsFreeMode();
        return;
    }

    if ((mode === 'pronounce' || mode === 'speak') && !isSpeechRecognitionSupported()) {
        alert("⚠️ Reconhecimento de voz não suportado pelo seu navegador atual (comum no Safari do iOS).\n\nPara praticar fala e pronúncia com microfone, utilize o Google Chrome no Android, Windows ou Mac.");
        return;
    }

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
        if (mode === 'standard') {
            // No modo padrão (Iniciar), cria as frases automaticamente sem perguntar
            generateAutomaticPhrases(10, mode);
        } else {
            // Em outros modos (Quiz, Escrita, etc), pergunta antes de criar
            window.confirm(
                "Você não tem frases para revisar neste modo no momento. Deseja que eu crie 10 frases gerais automaticamente para você praticar?",
                () => {
                    generateAutomaticPhrases(10, mode);
                },
                "Nenhuma frase para revisar"
            );
        }
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


let exerciseTimerInterval = null;
let exerciseTimeRemaining = 0;
let exerciseTotalTime = 0;
let autoAdvanceTimeout = null;

function clearAutoAdvanceTimer() {
    if (autoAdvanceTimeout) {
        clearTimeout(autoAdvanceTimeout);
        autoAdvanceTimeout = null;
    }
}

function scheduleAutoAdvance(delayMs = 1500) {
    clearAutoAdvanceTimer();
    if (!appData.settings || !appData.settings.autoAdvanceSpeech) return;
    if (session.mode !== 'speak' && session.mode !== 'pronounce') return;

    if ($('btnContinue')) {
        $('btnContinue').textContent = 'Continuar → (Avançando...)';
    }

    autoAdvanceTimeout = setTimeout(() => {
        autoAdvanceTimeout = null;
        if (session.active && $('feedbackBar')?.classList.contains('active') && (session.mode === 'speak' || session.mode === 'pronounce')) {
            continueSession();
        }
    }, delayMs);
}

function clearExerciseTimer() {
    if (exerciseTimerInterval) {
        clearInterval(exerciseTimerInterval);
        exerciseTimerInterval = null;
    }
}

function updateExerciseTimerUI() {
    const container = $('exerciseTimerContainer');
    const textEl = $('exerciseTimerText');
    const fillEl = $('exerciseTimerFill');
    if (!container || !textEl || !fillEl) return;

    textEl.textContent = `⏱️ ${exerciseTimeRemaining}s`;
    const pct = exerciseTotalTime > 0 ? Math.max(0, (exerciseTimeRemaining / exerciseTotalTime) * 100) : 0;
    fillEl.style.width = `${pct}%`;

    const isUrgent = exerciseTimeRemaining <= 4;
    const isWarning = exerciseTimeRemaining <= Math.ceil(exerciseTotalTime * 0.35);

    fillEl.classList.remove('warning', 'urgent');
    textEl.classList.remove('warning', 'urgent');

    if (isUrgent) {
        fillEl.classList.add('urgent');
        textEl.classList.add('urgent');
    } else if (isWarning) {
        fillEl.classList.add('warning');
        textEl.classList.add('warning');
    }
}

function startExerciseTimer(seconds) {
    clearExerciseTimer();
    exerciseTotalTime = seconds;
    exerciseTimeRemaining = seconds;

    const container = $('exerciseTimerContainer');
    const fillEl = $('exerciseTimerFill');
    if (container) container.style.display = 'block';
    if (fillEl) {
        fillEl.style.transition = 'none';
        fillEl.style.width = '100%';
        void fillEl.offsetWidth;
        fillEl.style.transition = 'width 1s linear, background-color 0.3s ease';
    }
    updateExerciseTimerUI();

    exerciseTimerInterval = setInterval(() => {
        if (!session.active || $('feedbackBar')?.classList.contains('active')) {
            clearExerciseTimer();
            return;
        }

        exerciseTimeRemaining--;
        updateExerciseTimerUI();

        if (exerciseTimeRemaining <= 0) {
            clearExerciseTimer();
            handleExerciseTimeout();
        }
    }, 1000);
}

function handleExerciseTimeout() {
    if (!session.active || $('feedbackBar')?.classList.contains('active')) return;

    if (session.mode === 'write') {
        const val = $('writeInput')?.value.trim() || '';
        const isCorrect = val.length > 0 && normalizeText(val) === normalizeText(session.current.english);
        processAnswer(isCorrect, val || `⏰ Tempo esgotado (${exerciseTotalTime}s)`);
    } else if (session.mode === 'listen') {
        const val = $('listenInput')?.value.trim() || '';
        const isCorrect = val.length > 0 && normalizeText(val) === normalizeText(session.current.english);
        processAnswer(isCorrect, val || `⏰ Tempo esgotado (${exerciseTotalTime}s)`);
    } else if (session.mode === 'pronounce' || session.mode === 'speak') {
        stopListening();
        processAnswer(false, session.lastTranscript || `⏰ Tempo esgotado (${exerciseTotalTime}s)`);
    }
}

function nextPhrase() {
    // Reset mic state, audio, and timers for the new phrase
    isRecognitionActive = false;
    stopListening();
    stopAllAudio();
    clearExerciseTimer();
    clearAutoAdvanceTimer();

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

    clearExerciseTimer();
    clearAutoAdvanceTimer();
    syncAutoAdvanceToggles();
    if ($('btnContinue')) {
        $('btnContinue').textContent = 'Continuar →';
    }
    if ($('exerciseTimerContainer')) {
        $('exerciseTimerContainer').style.display = 'none';
    }

    if (session.mode === 'listen') {
        $('phrasePt').textContent = '🎧 Ouça com atenção e digite em inglês...';
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
        startExerciseTimer(30);
        setTimeout(() => {
            $('writeInput').value = '';
            $('writeInput').focus();
        }, 100);
    } else if (session.mode === 'listen') {
        $('listenArea').style.display = 'block';
        $('listenInput').value = '';
        $('listenInputMirror').innerHTML = '';
        startExerciseTimer(30);
        setTimeout(() => playAudio(p.english), 500); // Play audio automatically
        setTimeout(() => {
            $('listenInput').value = '';
            $('listenInput').focus();
        }, 1000);
    } else if (session.mode === 'pronounce') {
        $('pronounceArea').style.display = 'block';
        $('pronounceIntegrated').style.display = 'none';
        renderSpeechInitialState();
        if ($('micStatusPronounce')) {
            $('micStatusPronounce').textContent = "🔊 Ouvindo pronúncia...";
            $('micStatusPronounce').style.color = "var(--primary)";
        }
        const currentPhrase = p;
        playAudio(p.english, 'en-US', () => {
            const isResultVisible = $('feedbackBar')?.classList.contains('active');
            if (session.active && session.current === currentPhrase && session.mode === 'pronounce' && !isResultVisible) {
                if (!exerciseTimerInterval) startExerciseTimer(20);
                if (!isRecognitionActive) startListening();
            }
        });
    } else if (session.mode === 'speak') {
        $('speakArea').style.display = 'block';
        renderSpeechInitialState();
        startExerciseTimer(20);
        startListening();
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
    
    // Frases naturais de fallback caso o usuário ainda tenha menos de 4 frases cadastradas
    const naturalFallbacks = [
        "I need some more time",
        "How are you doing today?",
        "Thank you very much for your help",
        "Where is the nearest station?",
        "Could you please repeat that?",
        "Nice to meet you",
        "Have a wonderful day ahead",
        "What do you think about this?"
    ].sort(() => Math.random() - 0.5);

    for (const fallback of naturalFallbacks) {
        if (options.length >= 4) break;
        if (!options.includes(fallback) && fallback !== correct.english) {
            options.push(fallback);
        }
    }

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
    if ($('writeInput').value.includes('\n') || $('writeInput').value.includes('\r')) {
        $('writeInput').value = $('writeInput').value.replace(/[\r\n]+/g, '');
    }
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
    if (uWords.length === 0) return 0;

    // Subsequência comum máxima (LCS) para cálculo justo sem penalizar deslocamento por 1 palavra omitida
    const m = uWords.length;
    const n = tWords.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (uWords[i - 1] === tWords[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    const matches = dp[m][n];
    return Math.round((matches / Math.max(m, n)) * 100);
}

function updateListenMirror() {
    if ($('listenInput').value.includes('\n') || $('listenInput').value.includes('\r')) {
        $('listenInput').value = $('listenInput').value.replace(/[\r\n]+/g, '');
    }
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

    clearExerciseTimer();
    stopListening();

    const bar = $('feedbackBar');
    const info = $('feedbackInfo');
    const title = $('feedbackTitle');
    const text = $('feedbackText');

    bar.classList.add('active');
    info.className = `feedback-info ${isCorrect ? 'correct' : 'incorrect'}`;

    // Auto-scroll para feedback no mobile
    setTimeout(() => {
        bar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);

    // Ensure levels object exists
    if (!session.current.levels) {
        session.current.levels = { standard: 0, quiz: 0, write: 0, listen: 0, pronounce: 0, speak: 0 };
    }
    const mode = session.trainingMode;

    if (isCorrect) {
        title.textContent = "🎉 Excelente!";

        // Handle yellow/imprecise words feedback for voice modes
        const impreciseWords = (session.mode === 'speak' || session.mode === 'pronounce') ?
            session.current.english.split(' ').filter((_, idx) => session.wordStatus[idx] === 'imprecise') : [];

        if (impreciseWords.length > 0) {
            title.innerHTML = "⚠️ Quase perfeito!";
            text.innerHTML = `
                <div class="feedback-answer-card">
                    <div class="feedback-answer-label">Resposta correta</div>
                    <div class="feedback-answer-main">${makeWordsClickable(session.current.english)}</div>
                    <div style="margin-top: 8px; font-size: 0.85rem; color: var(--warning); font-weight: 700;">
                        Melhore a pronúncia de: <strong style="color: var(--text);">${impreciseWords.join(', ')}</strong>
                    </div>
                </div>
            `;
        } else {
            text.innerHTML = `
                <div class="feedback-answer-card">
                    <div class="feedback-answer-label">Resposta correta</div>
                    <div class="feedback-answer-main">${makeWordsClickable(session.current.english)}</div>
                </div>
            `;
        }

        if (mode === 'troublesome' || mode === 'multi') {
            const subMode = session.mode;
            if (session.current.levels[subMode] !== undefined) {
                session.current.levels[subMode]++;
            }
        } else {
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
        }

        // Hide any correction UI leftover from previous wrong answers
        $('correctionArea').style.display = 'none';
        $('voiceCorrectionArea').style.display = 'none';
        $('btnContinue').style.display = 'block';

        // Play correct sound
        $('soundCorrect').play().catch(() => { });
    } else {
        const isTimeout = typeof userVal === 'string' && userVal.startsWith('⏰');
        const isSkipped = userVal === 'Não lembro' || userVal === 'Não consigo pronunciar';
        const isVoiceMode = session.mode === 'speak' || session.mode === 'pronounce';

        let accuracy = 0;
        if (isVoiceMode) {
            const targetWords = session.current.english.split(' ');
            const correctCount = Object.values(session.wordStatus || {}).filter(v => v === 'correct' || v === 'imprecise').length;
            accuracy = Math.round((correctCount / targetWords.length) * 100);
        } else if (!isTimeout && !isSkipped) {
            accuracy = calculateAccuracy(userVal, session.current.english);
        }

        if (isTimeout) {
            title.textContent = "⏰ Tempo Esgotado";
        } else if (isSkipped) {
            title.textContent = "💡 Veja a Resposta";
        } else if (isVoiceMode) {
            title.textContent = `❌ Quase lá (${accuracy}% capturado)`;
        } else {
            title.textContent = "❌ Resposta Incorreta";
        }

        let attemptHTML = '';
        if (isVoiceMode) {
            const targetWords = session.current.english.split(' ');
            const hasAnySpoken = Object.keys(session.wordStatus || {}).length > 0;
            if (hasAnySpoken) {
                const wordsColored = targetWords.map((w, idx) => {
                    const status = session.wordStatus[idx];
                    const color = status === 'correct' ? 'var(--success)' : (status === 'imprecise' ? 'var(--warning)' : 'var(--text-muted)');
                    const weight = status ? '800' : '500';
                    const opacity = status ? '1' : '0.45';
                    return `<span style="color: ${color}; font-weight: ${weight}; opacity: ${opacity}">${escapeHTML(w)}</span>`;
                }).join(' ');
                attemptHTML = `
                    <div class="feedback-attempt-row">
                        <span class="feedback-attempt-label">Palavras captadas:</span>
                        <span>${wordsColored}</span>
                    </div>
                `;
            }
        } else if (!isTimeout && !isSkipped && userVal && userVal.trim().length > 0) {
            if (session.mode === 'quiz') {
                attemptHTML = `
                    <div class="feedback-attempt-row">
                        <span class="feedback-attempt-label">Sua escolha:</span>
                        <del style="color: var(--danger); font-weight: 600;">${escapeHTML(userVal)}</del>
                    </div>
                `;
            } else {
                const diffWords = highlightDifferences(userVal, session.current.english);
                attemptHTML = `
                    <div class="feedback-attempt-row">
                        <span class="feedback-attempt-label">Você digitou:</span>
                        <span>${diffWords}</span>
                    </div>
                `;
            }
        }

        const phoneticHTML = isVoiceMode
            ? `<div class="feedback-phonetic-pill">🗣️ [ ${getPhoneticGuide(session.current.english)} ]</div>`
            : '';

        text.innerHTML = `
            <div class="feedback-answer-card">
                <div class="feedback-answer-label">Resposta Correta</div>
                <div class="feedback-answer-main">${makeWordsClickable(session.current.english)}</div>
                ${phoneticHTML}
            </div>
            ${attemptHTML}
        `;

        // Always speak the correct answer on error
        const shouldAutoAdvance = isVoiceMode && appData.settings && appData.settings.autoAdvanceSpeech;
        if (shouldAutoAdvance) {
            scheduleAutoAdvance(3200);
            playAudio(session.current.english, 'en-US', () => {
                scheduleAutoAdvance(900);
            });
        } else {
            playAudio(session.current.english);
        }

        // Optional Correction - Hide mic and instructions as requested
        if (isVoiceMode) {
            $('voiceCorrectionArea').style.display = 'none';
            $('correctionArea').style.display = 'none';
            $('btnContinue').style.display = 'block';
        } else {
            $('correctionArea').style.display = 'block';
            $('voiceCorrectionArea').style.display = 'none';
            $('btnContinue').style.display = 'none';
            $('correctionInput').value = '';
            $('correctionInput').style.color = 'var(--text)';
            $('correctionInput').style.borderColor = 'rgba(239, 68, 68, 0.5)';
            $('correctionHint').textContent = "✍️ Digite a resposta correta para fixar:";
            $('correctionHint').style.color = 'var(--danger)';
            $('correctionInput').focus();

            $('correctionInput').oninput = () => {
                if (normalizeText($('correctionInput').value) === normalizeText(session.current.english)) {
                    $('btnContinue').style.display = 'block';
                    $('correctionInput').style.color = 'var(--success)';
                    $('correctionInput').style.borderColor = 'var(--success)';
                    $('correctionHint').textContent = "✅ Perfeito! Pode avançar:";
                    $('correctionHint').style.color = 'var(--success)';
                } else {
                    $('btnContinue').style.display = 'none';
                    $('correctionInput').style.color = 'var(--text)';
                    $('correctionInput').style.borderColor = 'rgba(239, 68, 68, 0.5)';
                    $('correctionHint').textContent = "✍️ Digite a resposta correta para fixar:";
                    $('correctionHint').style.color = 'var(--danger)';
                }
            };
        }
    }

    // Play Audio only if correct AND not already played in pronounce mode
    if (isCorrect) {
        const isVoiceMode = session.mode === 'speak' || session.mode === 'pronounce';
        const shouldAutoAdvance = isVoiceMode && appData.settings && appData.settings.autoAdvanceSpeech;

        if (session.mode !== 'pronounce') {
            if (shouldAutoAdvance) {
                scheduleAutoAdvance(3000);
                playAudio(session.current.english, 'en-US', () => {
                    scheduleAutoAdvance(800);
                });
            } else {
                playAudio(session.current.english);
            }
        } else if (shouldAutoAdvance) {
            scheduleAutoAdvance(1300);
        }
    }

    // Update Stats
    appData.history.push({ date: Date.now(), correct: isCorrect });
    updateStreak();

    // ------------------- LEVEL & SRS UPDATES -------------------
    let forceImmediateReview = false;
    const subMode = session.mode;

    if (isCorrect) {
        // Acerto: Puxa o standard para cima no modo focado (exceto no Treinar Dificuldades)
        if (mode !== 'standard' && mode !== 'troublesome') {
            const targetSkill = mode === 'multi' ? subMode : mode;
            session.current.levels.standard = Math.min(4, Math.max(session.current.levels.standard || 0, session.current.levels[targetSkill] || 0));
        }

        // Checar se teve palavras amarelas no Speak
        const impreciseWords = (session.mode === 'speak' || session.mode === 'pronounce') ?
            session.current.english.split(' ').filter((_, idx) => session.wordStatus[idx] === 'imprecise') : [];

        if (session.mode === 'speak' && impreciseWords.length > 0 && mode !== 'troublesome') {
            session.current.levels.standard = 3; // Volta para Pronúncia
            forceImmediateReview = true;
        }
    } else {
        const trainingMode = session.trainingMode;

        // 1. Reduzir nível da HABILIDADE ESPECÍFICA (Quiz, Escrita, etc.)
        const specificSkill = (trainingMode === 'standard' || trainingMode === 'troublesome' || trainingMode === 'multi') ? subMode : trainingMode;
        if (session.current.levels && session.current.levels[specificSkill] !== undefined) {
            session.current.levels[specificSkill] = Math.max(0, session.current.levels[specificSkill] - 1);
        }

        // 2. Reduzir nível STANDARD (Sequência do Modo Geral) e forçar revisão (exceto no Treinar Dificuldades)
        if (trainingMode !== 'troublesome') {
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
    }

    // Calcular SRS baseado no nível ATUALIZADO da habilidade (não agenda próximo teste no modo Treinar Dificuldades)
    if (session.trainingMode !== 'troublesome') {
        const multipliers = {
            quiz: 1.0,
            write: 1.5,
            listen: 1.5,
            pronounce: 2.0,
            speak: 2.5
        };
        const multiplier = multipliers[session.mode] || 1.0;
        const modeForLevel = (session.trainingMode === 'standard' || session.trainingMode === 'multi') ? session.mode : session.trainingMode;
        const currentLvl = session.current.levels[modeForLevel] || 0;

        let interval = SRS_INTERVALS[Math.min(currentLvl, 9)] * 60 * 1000 * multiplier;

        if (forceImmediateReview) {
            interval = 0; // Disponível imediatamente
        }

        session.current.nextReview = Date.now() + interval;
    }

    appData.totalReviews++;

    // EXPLICITLY ensure mic is stopped and WON'T restart
    isRecognitionActive = false;
    stopListening();

    saveData(appData);
    updateGlobalLevel();
    updateTroublesomeCount();
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
    const yesterdayStr = yesterday.toDateString();

    if (appData.lastReviewDate === yesterdayStr) {
        appData.streak++;
    } else if (appData.lastReviewDate && appData.lastReviewDate !== today) {
        // Pulou pelo menos 1 dia
        if (appData.streakFreezes && appData.streakFreezes > 0) {
            appData.streakFreezes--;
            saveData(appData);
            if ($('freezeCountSpan')) $('freezeCountSpan').textContent = appData.streakFreezes;
            if ($('freezeCountSpanSettings')) $('freezeCountSpanSettings').textContent = appData.streakFreezes;
            setTimeout(() => {
                alert("🧊 Ufa! Seu Gelo Protetor (Streak Freeze) foi utilizado para proteger sua sequência de dias de estudo!");
            }, 600);
        } else {
            appData.streak = 1;
        }
    } else {
        appData.streak = 1;
    }

    appData.lastReviewDate = today;
}

function continueSession() {
    clearAutoAdvanceTimer();
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

let currentUtterance = null;
let playAudioTimer = null;

function stopAllAudio() {
    if (playAudioTimer) {
        clearTimeout(playAudioTimer);
        playAudioTimer = null;
    }
    if (currentUtterance) {
        currentUtterance.onend = null;
        currentUtterance.onerror = null;
        currentUtterance = null;
    }
    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = null;
        window.speechSynthesis.cancel();
    }
}

function playAudio(t, lang = 'en-US', onComplete = null) {
    if (!t || !('speechSynthesis' in window)) {
        if (onComplete) onComplete();
        return;
    }

    // Sync mic: Check if active before stopping
    const wasListening = isRecognitionActive;
    if (wasListening) stopListening();

    // Stop any previous audio and clear its callbacks before starting new audio
    stopAllAudio();
    unlockAudio(); // Ensure unlocked

    const u = new SpeechSynthesisUtterance(t);
    currentUtterance = u;

    // Sync mic / callback: Restart after audio ends
    u.onend = () => {
        if (currentUtterance === u) currentUtterance = null;
        if (onComplete) onComplete();
        // Don't restart if we are showing results or if session ended
        const isResultVisible = $('feedbackBar')?.classList.contains('active');
        if (session.active && !isResultVisible && (wasListening || session.mode === 'pronounce') && (session.mode === 'speak' || session.mode === 'pronounce')) {
            if (!exerciseTimerInterval) startExerciseTimer(20);
            if (!isRecognitionActive) startListening();
        }
    };

    u.onerror = () => {
        if (currentUtterance === u) currentUtterance = null;
        if (onComplete) onComplete();
    };

    const speak = () => {
        if (currentUtterance !== u) return;
        const voices = window.speechSynthesis.getVoices();
        let preferredVoice = null;

        if (lang.startsWith('pt')) {
            preferredVoice = voices.find(v =>
                v.lang.startsWith('pt') && (v.name.includes('Google') || v.name.includes('Luciana') || v.name.includes('Maria') || v.name.includes('Daniel'))
            ) || voices.find(v => v.lang.startsWith('pt'));
            u.lang = 'pt-BR';
        } else {
            preferredVoice = voices.find(v =>
                v.lang.startsWith('en') &&
                (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Daniel'))
            ) || voices.find(v => v.lang.startsWith('en'));
            u.lang = 'en-US';
        }

        if (preferredVoice) u.voice = preferredVoice;
        u.rate = appData.settings ? (appData.settings.slowAudio ? 0.6 : 0.9) : 0.9;
        if (typeof handsFreeSession !== 'undefined' && handsFreeSession.active && handsFreeSession.speed) {
            u.rate = handsFreeSession.speed;
        }

        window.speechSynthesis.speak(u);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.onvoiceschanged = null;
            speak();
        };
    } else {
        playAudioTimer = setTimeout(() => {
            playAudioTimer = null;
            speak();
        }, 50);
    }
}

// ==================== HANDS-FREE MODE (ÁUDIO PASSIVO) ====================
let handsFreeSession = {
    active: false,
    queue: [],
    currentIndex: 0,
    paused: false,
    timer: null,
    speed: 1.0,
    current: null
};

function startHandsFreeMode() {
    let phrases = [];
    appData.lists.forEach(l => {
        if (!l.phrases) return;
        phrases = phrases.concat(l.phrases);
    });

    if (phrases.length === 0) {
        alert("Você ainda não tem frases cadastradas para o modo Hands-Free. Crie algumas frases primeiro!");
        return;
    }

    handsFreeSession.active = true;
    handsFreeSession.queue = [...phrases].sort(() => Math.random() - 0.5);
    handsFreeSession.currentIndex = 0;
    handsFreeSession.paused = false;
    handsFreeSession.speed = 1.0;

    showView('handsFreeView');
    playHandsFreeStep();
}

function exitHandsFree() {
    handsFreeSession.active = false;
    if (handsFreeSession.timer) clearTimeout(handsFreeSession.timer);
    window.speechSynthesis.cancel();
    showView('homeView');
}

function playHandsFreeStep() {
    if (!handsFreeSession.active || handsFreeSession.paused) return;

    if (handsFreeSession.currentIndex >= handsFreeSession.queue.length) {
        alert("🎉 Você ouviu todas as frases desta sessão Hands-Free! Parabéns!");
        exitHandsFree();
        return;
    }

    const current = handsFreeSession.queue[handsFreeSession.currentIndex];
    handsFreeSession.current = current;

    if ($('hfCounter')) $('hfCounter').textContent = `Frase ${handsFreeSession.currentIndex + 1} de ${handsFreeSession.queue.length}`;
    if ($('hfPhraseEng')) $('hfPhraseEng').innerHTML = makeWordsClickable(current.english);
    if ($('hfPhonetic')) $('hfPhonetic').textContent = `[ ${getPhoneticGuide(current.english)} ]`;
    if ($('hfPhrasePt')) $('hfPhrasePt').textContent = "• • •";
    if ($('hfProgressFill')) $('hfProgressFill').style.width = '20%';

    if ($('hfStatusText')) $('hfStatusText').textContent = "🔊 Reproduzindo em Inglês...";
    if ($('hfStatusDot')) $('hfStatusDot').style.background = "var(--primary)";

    playAudio(current.english, 'en-US', () => {
        if (!handsFreeSession.active || handsFreeSession.paused) return;

        if ($('hfStatusText')) $('hfStatusText').textContent = "⏳ Pense na tradução...";
        if ($('hfStatusDot')) $('hfStatusDot').style.background = "var(--warning)";
        if ($('hfProgressFill')) $('hfProgressFill').style.width = '60%';

        handsFreeSession.timer = setTimeout(() => {
            if (!handsFreeSession.active || handsFreeSession.paused) return;

            if ($('hfPhrasePt')) $('hfPhrasePt').textContent = current.portuguese;
            if ($('hfStatusText')) $('hfStatusText').textContent = "🗣️ Tradução em Português";
            if ($('hfStatusDot')) $('hfStatusDot').style.background = "var(--success)";
            if ($('hfProgressFill')) $('hfProgressFill').style.width = '90%';

            playAudio(current.portuguese, 'pt-BR', () => {
                if (!handsFreeSession.active || handsFreeSession.paused) return;

                if ($('hfProgressFill')) $('hfProgressFill').style.width = '100%';
                handsFreeSession.timer = setTimeout(() => {
                    handsFreeSession.currentIndex++;
                    playHandsFreeStep();
                }, 2000);
            });
        }, 2500);
    });
}

function hfTogglePlay() {
    handsFreeSession.paused = !handsFreeSession.paused;
    const btn = $('hfPlayPauseBtn');
    if (handsFreeSession.paused) {
        if (handsFreeSession.timer) clearTimeout(handsFreeSession.timer);
        window.speechSynthesis.cancel();
        if (btn) btn.textContent = '▶️';
        if ($('hfStatusText')) $('hfStatusText').textContent = "Pausado";
        if ($('hfStatusDot')) $('hfStatusDot').style.background = "var(--text-muted)";
    } else {
        if (btn) btn.textContent = '⏸️';
        playHandsFreeStep();
    }
}

function hfNext() {
    if (handsFreeSession.timer) clearTimeout(handsFreeSession.timer);
    window.speechSynthesis.cancel();
    if (handsFreeSession.currentIndex < handsFreeSession.queue.length - 1) {
        handsFreeSession.currentIndex++;
    }
    handsFreeSession.paused = false;
    if ($('hfPlayPauseBtn')) $('hfPlayPauseBtn').textContent = '⏸️';
    playHandsFreeStep();
}

function hfPrev() {
    if (handsFreeSession.timer) clearTimeout(handsFreeSession.timer);
    window.speechSynthesis.cancel();
    if (handsFreeSession.currentIndex > 0) {
        handsFreeSession.currentIndex--;
    }
    handsFreeSession.paused = false;
    if ($('hfPlayPauseBtn')) $('hfPlayPauseBtn').textContent = '⏸️';
    playHandsFreeStep();
}

function hfReplay() {
    if (handsFreeSession.timer) clearTimeout(handsFreeSession.timer);
    window.speechSynthesis.cancel();
    handsFreeSession.paused = false;
    if ($('hfPlayPauseBtn')) $('hfPlayPauseBtn').textContent = '⏸️';
    playHandsFreeStep();
}

function hfSetSpeed(rate) {
    handsFreeSession.speed = rate;
    document.querySelectorAll('.hf-speed-btn').forEach(b => {
        b.classList.remove('active');
        b.style.fontWeight = 'normal';
        b.style.borderColor = 'var(--border)';
    });
    const clicked = Array.from(document.querySelectorAll('.hf-speed-btn')).find(b => b.textContent.includes(rate + 'x'));
    if (clicked) {
        clicked.classList.add('active');
        clicked.style.fontWeight = '800';
        clicked.style.borderColor = 'var(--primary)';
    }
}

// ==================== HEATMAP (MAPA DE CALOR) ====================
function renderHeatmap() {
    const grid = $('studyHeatmapGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Agrupa o histórico por YYYY-MM-DD
    const countsByDate = {};
    (appData.history || []).forEach(h => {
        if (!h.date) return;
        const d = new Date(h.date);
        if (isNaN(d.getTime())) return;
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        countsByDate[key] = (countsByDate[key] || 0) + 1;
    });

    // 14 semanas = 98 dias em formato de calendário (linhas de domingo a sábado)
    const totalDays = 14 * 7;
    const dayOfWeek = today.getDay(); // 0: domingo, 6: sábado
    const daysUntilEndOfWeek = 6 - dayOfWeek;
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + daysUntilEndOfWeek);

    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - totalDays + 1);

    let activeDays = 0;
    let totalWindowReviews = 0;

    const monthsNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

    for (let i = 0; i < totalDays; i++) {
        const curDate = new Date(startDate);
        curDate.setDate(startDate.getDate() + i);
        curDate.setHours(0, 0, 0, 0);

        const isFuture = curDate.getTime() > today.getTime();
        const key = curDate.getFullYear() + '-' + String(curDate.getMonth() + 1).padStart(2, '0') + '-' + String(curDate.getDate()).padStart(2, '0');
        const count = isFuture ? 0 : (countsByDate[key] || 0);

        if (!isFuture && count > 0) {
            activeDays++;
            totalWindowReviews += count;
        }

        let heatLevel = 0;
        if (count >= 10) heatLevel = 3;
        else if (count >= 5) heatLevel = 2;
        else if (count >= 1) heatLevel = 1;

        const cell = document.createElement('div');
        cell.className = `heatmap-cell heat-${heatLevel}`;
        if (isFuture) {
            cell.style.opacity = '0.35';
            cell.style.cursor = 'default';
        }

        const formattedDate = `${curDate.getDate()} de ${monthsNames[curDate.getMonth()]}`;
        const tooltip = isFuture ? `${formattedDate} (futuro)` : `${count} revisão(ões) em ${formattedDate}`;
        cell.setAttribute('title', tooltip);

        if (!isFuture) {
            cell.addEventListener('click', () => {
                showHeatmapCellInfo(formattedDate, count);
                document.querySelectorAll('.heatmap-cell').forEach(c => c.style.outline = 'none');
                cell.style.outline = '2px solid var(--primary)';
            });
        }

        grid.appendChild(cell);
    }

    if ($('heatmapActiveDays')) $('heatmapActiveDays').textContent = activeDays;
    if ($('heatmapTotalReviews')) $('heatmapTotalReviews').textContent = totalWindowReviews;
}

function showHeatmapCellInfo(dateStr, count) {
    const info = $('heatmapSelectedInfo');
    if (!info) return;
    if (count === 0) {
        info.innerHTML = `📅 <strong>${dateStr}</strong>: Nenhuma revisão realizada.`;
    } else {
        info.innerHTML = `📅 <strong>${dateStr}</strong>: <span style="color: var(--primary); font-weight: 800;">${count}</span> revisão(ões) completada(s)! ✨`;
    }
}

// ==================== SPEED RUN MODE (5 min) ====================
let isSkippingPhrase = false;

let speedRunSession = {
    active: false,
    timer: null,
    timeLeft: 300,
    score: 0,
    phrasesCompleted: 0,
    combo: 0,
    totalLettersFilled: 0,
    isLastPhrase: false,
    queue: [],
    currentPhrase: null,
    targetLetters: [],
    availableTiles: []
};

function startSpeedRun() {
    let allPhrases = [];
    (appData.lists || []).forEach(l => {
        if (l.phrases && l.phrases.length > 0) allPhrases.push(...l.phrases);
    });

    if (allPhrases.length === 0) {
        window.confirm(
            "Você não tem frases para revisar neste modo no momento. Deseja que eu crie 10 frases gerais automaticamente para você praticar?",
            () => {
                generateAutomaticPhrases(10, 'speedrun');
            },
            "Nenhuma frase para revisar"
        );
        return;
    }

    unlockAudio();

    if (speedRunSession.timer) {
        clearInterval(speedRunSession.timer);
    }

    // Prioriza frases com comprimento razoável para digitação rápida (<= 45 caracteres)
    const shortPhrases = allPhrases.filter(p => p.english && p.english.length <= 45);
    const pool = shortPhrases.length > 0 ? shortPhrases : allPhrases;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);

    isSkippingPhrase = false;
    if ($('srContinueControls')) $('srContinueControls').style.display = 'none';
    if ($('srDefaultControls')) $('srDefaultControls').style.display = 'flex';
    if ($('srTilesPool')) {
        $('srTilesPool').style.display = 'flex';
        $('srTilesPool').style.pointerEvents = 'auto';
        $('srTilesPool').style.opacity = '1';
    }

    speedRunSession = {
        active: true,
        timer: null,
        timeLeft: 300,
        score: 0,
        phrasesCompleted: 0,
        combo: 0,
        totalLettersFilled: 0,
        isLastPhrase: false,
        queue: shuffled,
        currentPhrase: null,
        targetLetters: [],
        availableTiles: []
    };

    showView('speedRunView');
    updateSpeedRunHeader();
    loadNextSpeedRunPhrase();

    speedRunSession.timer = setInterval(speedRunTick, 1000);
}

function exitSpeedRun() {
    if (speedRunSession.timer) {
        clearInterval(speedRunSession.timer);
        speedRunSession.timer = null;
    }
    speedRunSession.active = false;
    speedRunSession.isLastPhrase = false;
    isSkippingPhrase = false;
    if ($('srContinueControls')) $('srContinueControls').style.display = 'none';
    if ($('srDefaultControls')) $('srDefaultControls').style.display = 'flex';
    if ($('srTilesPool')) {
        $('srTilesPool').style.display = 'flex';
        $('srTilesPool').style.pointerEvents = 'auto';
        $('srTilesPool').style.opacity = '1';
    }
    showView('homeView');
}

function speedRunTick() {
    if (!speedRunSession.active) return;
    speedRunSession.timeLeft--;

    if (speedRunSession.timeLeft <= 0) {
        speedRunSession.timeLeft = 0;
        // Para o relógio e permite responder à última pergunta com calma
        if (speedRunSession.timer) {
            clearInterval(speedRunSession.timer);
            speedRunSession.timer = null;
        }
        speedRunSession.isLastPhrase = true;
        updateSpeedRunHeader();
        showSpeedRunBonus("⏱️ Tempo esgotado! Responda a última pergunta!", false);
        return;
    }

    updateSpeedRunHeader();
}

function updateSpeedRunHeader() {
    if ($('srScoreText')) $('srScoreText').textContent = speedRunSession.score;
    if ($('srTimerText')) {
        if (speedRunSession.isLastPhrase) {
            $('srTimerText').textContent = 'Última!';
            $('srTimerText').style.color = '#ef4444';
        } else {
            const mins = Math.floor(speedRunSession.timeLeft / 60);
            const secs = speedRunSession.timeLeft % 60;
            $('srTimerText').textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
            if (speedRunSession.timeLeft <= 20) {
                $('srTimerText').style.color = '#ef4444';
            } else {
                $('srTimerText').style.color = 'var(--primary)';
            }
        }
    }

    const fill = $('srTimerFill');
    if (fill) {
        const pct = Math.max(0, Math.min(100, (speedRunSession.timeLeft / 300) * 100));
        fill.style.width = pct + '%';
        if (speedRunSession.timeLeft <= 20 || speedRunSession.isLastPhrase) {
            fill.classList.add('urgent');
        } else {
            fill.classList.remove('urgent');
        }
    }

    const comboBadge = $('srComboBadge');
    if (comboBadge) {
        if (speedRunSession.combo >= 2) {
            comboBadge.style.display = 'inline-block';
            if ($('srComboCount')) $('srComboCount').textContent = speedRunSession.combo;
        } else {
            comboBadge.style.display = 'none';
        }
    }
}

function loadNextSpeedRunPhrase() {
    if (!speedRunSession.active) return;

    if (!speedRunSession.queue || speedRunSession.queue.length === 0) {
        let phrases = [];
        (appData.lists || []).forEach(l => {
            if (l.phrases && l.phrases.length > 0) phrases.push(...l.phrases);
        });
        const shortPhrases = phrases.filter(p => p.english && p.english.length <= 45);
        const pool = shortPhrases.length > 0 ? shortPhrases : phrases;
        speedRunSession.queue = [...pool].sort(() => Math.random() - 0.5);
    }

    speedRunSession.currentPhrase = speedRunSession.queue.shift();
    if (!speedRunSession.currentPhrase) return;

    // Tradução PT
    const ptEl = $('srPhrasePt');
    if (ptEl) ptEl.textContent = speedRunSession.currentPhrase.portuguese || 'Tradução não disponível';

    // Pronúncia fonética se estiver em cache
    const phonEl = $('srPhonetic');
    if (phonEl) {
        const normKey = speedRunSession.currentPhrase.english.toLowerCase().trim();
        const phon = appData.phoneticCache && appData.phoneticCache[normKey];
        phonEl.textContent = phon ? `[ ${phon} ]` : '';
    }

    const eng = speedRunSession.currentPhrase.english.trim();
    const words = eng.split(/\s+/);

    speedRunSession.targetLetters = [];
    let slotIdCounter = 0;
    const requiredLetters = [];

    const slotsContainer = $('srSlotsContainer');
    if (slotsContainer) slotsContainer.innerHTML = '';

    words.forEach((word) => {
        const wordGroup = document.createElement('div');
        wordGroup.className = 'speedrun-word-group';

        for (let i = 0; i < word.length; i++) {
            const ch = word[i];
            const isLetter = /^[A-Za-z]$/.test(ch);
            const slotId = 'slot_' + (slotIdCounter++);

            const slotObj = {
                id: slotId,
                char: ch.toUpperCase(),
                isLetter: isLetter,
                filledChar: isLetter ? null : ch,
                tileId: null
            };
            speedRunSession.targetLetters.push(slotObj);

            if (isLetter) {
                requiredLetters.push(ch.toUpperCase());
            }

            const slotEl = document.createElement('div');
            slotEl.id = slotId;
            slotEl.dataset.slotId = slotId;
            slotEl.className = 'speedrun-slot' + (isLetter ? '' : ' punct');
            slotEl.textContent = isLetter ? '' : ch;

            if (isLetter) {
                slotEl.addEventListener('click', () => srRemoveSlot(slotId));
            }

            wordGroup.appendChild(slotEl);
        }

        if (slotsContainer) slotsContainer.appendChild(wordGroup);
    });

    // Indicador de pontos e tempo da frase atual: quanto maior a frase, mais pontos e segundos!
    const valueBadge = $('srPhraseValueBadge');
    if (valueBadge) {
        const letterCount = requiredLetters.length;
        let basePts = letterCount * 10;
        if (letterCount >= 20) basePts += 60;
        else if (letterCount >= 12) basePts += 30;

        let baseSecs = 2;
        if (letterCount >= 25) baseSecs = 8;
        else if (letterCount >= 18) baseSecs = 6;
        else if (letterCount >= 10) baseSecs = 4;

        valueBadge.textContent = `+${basePts} pts • +${baseSecs}s ⏱️`;
        valueBadge.title = `Ao acertar: +${basePts} pontos e +${baseSecs} segundos extras!`;
    }

    // Conta quantas vezes cada letra aparece na frase (sem letras repetidas nos blocos)
    const letterCounts = {};
    requiredLetters.forEach(ch => {
        letterCounts[ch] = (letterCounts[ch] || 0) + 1;
    });

    // Letras únicas da frase ordenadas em ordem alfabética para facilitar a busca e o clique
    const uniqueChars = Object.keys(letterCounts).sort((a, b) => a.localeCompare(b));

    speedRunSession.availableTiles = uniqueChars.map((ch, idx) => ({
        id: 'tile_' + idx,
        char: ch,
        totalCount: letterCounts[ch],
        remainingCount: letterCounts[ch],
        used: false
    }));

    const tilesPool = $('srTilesPool');
    if (tilesPool) {
        tilesPool.innerHTML = '';
        speedRunSession.availableTiles.forEach(tile => {
            const tileBtn = document.createElement('button');
            tileBtn.type = 'button';
            tileBtn.id = tile.id;
            tileBtn.dataset.tileId = tile.id;
            tileBtn.className = 'speedrun-letter-tile';
            tileBtn.innerHTML = `<span>${tile.char}</span>` + (tile.totalCount > 1 ? `<span class="speedrun-tile-badge">${tile.totalCount}</span>` : '');
            tileBtn.addEventListener('click', () => srPickTile(tile.id));
            tilesPool.appendChild(tileBtn);
        });
    }
}

function updateTileBadge(tile, tileEl) {
    if (!tileEl) return;
    let badge = tileEl.querySelector('.speedrun-tile-badge');
    if (tile.remainingCount > 1) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'speedrun-tile-badge';
            tileEl.appendChild(badge);
        }
        badge.textContent = tile.remainingCount;
    } else if (badge) {
        badge.remove();
    }
}

function srPickTile(tileId) {
    if (!speedRunSession.active) return;
    const tile = speedRunSession.availableTiles.find(t => t.id === tileId);
    if (!tile || tile.used || tile.remainingCount <= 0) return;

    // Acha o primeiro slot de letra vazio
    const slot = speedRunSession.targetLetters.find(s => s.isLetter && !s.filledChar);
    if (!slot) return;

    // Se a letra escolhida NÃO FOR a correta para este slot:
    if (tile.char !== slot.char) {
        srHandleWrongLetter(tile.id, slot.id);
        return; // Não coloca a letra!
    }

    // Preenche o slot (letra correta)
    slot.filledChar = tile.char;
    slot.tileId = tile.id;
    tile.remainingCount--;

    if (tile.remainingCount <= 0) {
        tile.used = true;
    }

    // Atualiza a tela: slot
    const slotEl = $(slot.id);
    if (slotEl) {
        slotEl.textContent = tile.char;
        slotEl.classList.add('filled');
    }

    // Atualiza a tela: tile (desaparece quando esgota o tanto de vezes na frase)
    const tileEl = $(tile.id);
    if (tileEl) {
        if (tile.used) {
            tileEl.classList.add('used');
        } else {
            updateTileBadge(tile, tileEl);
        }
    }

    // Se todos os slots de letras estiverem preenchidos, valida automaticamente
    const allFilled = speedRunSession.targetLetters.filter(s => s.isLetter).every(s => !!s.filledChar);
    if (allFilled) {
        checkSpeedRunAnswer();
    }
}

function srHandleWrongLetter(tileId, slotId) {
    if (!speedRunSession.active) return;

    // Penalidade ao colocar letra errada: perde 15 pontos (sem ficar negativo)
    const penalty = 15;
    speedRunSession.score = Math.max(0, speedRunSession.score - penalty);
    speedRunSession.combo = 0; // Perde o combo ao errar letra
    updateSpeedRunHeader();

    // Feedback visual flutuante em vermelho
    showSpeedRunBonus(`-${penalty} pts! ❌`, true);

    // Efeito de vibração leve no celular se suportado
    if ('vibrate' in navigator) {
        try { navigator.vibrate(120); } catch (e) {}
    }

    // Animação de erro na letra clicada
    if (tileId) {
        const tileEl = $(tileId);
        if (tileEl) {
            tileEl.classList.add('shake-error');
            setTimeout(() => {
                tileEl.classList.remove('shake-error');
            }, 350);
        }
    }

    // Animação de erro no slot vazio aguardando preenchimento
    if (slotId) {
        const slotEl = $(slotId);
        if (slotEl) {
            slotEl.classList.add('shake-error');
            setTimeout(() => {
                slotEl.classList.remove('shake-error');
            }, 350);
        }
    }
}

function srRemoveSlot(slotId) {
    if (!speedRunSession.active) return;
    const slot = speedRunSession.targetLetters.find(s => s.id === slotId);
    if (!slot || !slot.isLetter || !slot.filledChar) return;

    const tile = speedRunSession.availableTiles.find(t => t.id === slot.tileId);
    if (tile) {
        tile.remainingCount++;
        tile.used = false;
        const tileEl = $(tile.id);
        if (tileEl) {
            tileEl.classList.remove('used');
            updateTileBadge(tile, tileEl);
        }
    }

    slot.filledChar = null;
    slot.tileId = null;

    const slotEl = $(slot.id);
    if (slotEl) {
        slotEl.textContent = '';
        slotEl.classList.remove('filled', 'correct-flash', 'shake-error');
    }
}

function srBackspace() {
    if (!speedRunSession.active) return;
    for (let i = speedRunSession.targetLetters.length - 1; i >= 0; i--) {
        const slot = speedRunSession.targetLetters[i];
        if (slot.isLetter && slot.filledChar) {
            srRemoveSlot(slot.id);
            break;
        }
    }
}

function srClearCurrent() {
    if (!speedRunSession.active) return;
    speedRunSession.targetLetters.forEach(slot => {
        if (slot.isLetter && slot.filledChar) {
            srRemoveSlot(slot.id);
        }
    });
}

function srSkip() {
    if (!speedRunSession.active || isSkippingPhrase) return;
    isSkippingPhrase = true;

    // Pausa imediatamente o cronômetro para o usuário ver a resposta com calma sem perder tempo
    if (speedRunSession.timer) {
        clearInterval(speedRunSession.timer);
        speedRunSession.timer = null;
    }

    // Cada pulo custa 30 segundos
    const skipCost = 30;
    speedRunSession.timeLeft = Math.max(0, speedRunSession.timeLeft - skipCost);
    speedRunSession.combo = 0;
    updateSpeedRunHeader();

    // Feedback visual do custo do pulo
    showSpeedRunBonus(`-${skipCost}s! ⏱️`, true);

    // Revela a resposta correta em todos os slots da frase
    if (speedRunSession.targetLetters) {
        speedRunSession.targetLetters.forEach(slot => {
            const el = $(slot.id);
            if (el && slot.isLetter) {
                el.textContent = slot.char;
                el.classList.add('skipped-reveal');
            }
        });
    }

    // Oculta temporariamente o banco de letras e os botões rápidos de digitação
    const tilesPool = $('srTilesPool');
    if (tilesPool) {
        tilesPool.style.display = 'none';
    }
    const defaultControls = $('srDefaultControls');
    if (defaultControls) {
        defaultControls.style.display = 'none';
    }

    // Exibe o botão de Continuar para prosseguir quando o usuário desejar
    const continueControls = $('srContinueControls');
    const continueBtn = $('srContinueBtn');
    if (continueControls) {
        continueControls.style.display = 'flex';
    }
    if (continueBtn) {
        if (speedRunSession.isLastPhrase || speedRunSession.timeLeft <= 0) {
            continueBtn.textContent = 'Ver Pontuação ➔';
        } else {
            continueBtn.textContent = 'Continuar ➔';
        }
        continueBtn.focus();
    }

    // Pronuncia o áudio da frase correta
    if (speedRunSession.currentPhrase && speedRunSession.currentPhrase.english) {
        playAudio(speedRunSession.currentPhrase.english);
    }
}

function srContinueAfterSkip() {
    if (!speedRunSession.active || !isSkippingPhrase) return;
    isSkippingPhrase = false;

    // Restaura a exibição dos blocos de letras e controles padrão
    const continueControls = $('srContinueControls');
    if (continueControls) {
        continueControls.style.display = 'none';
    }
    const tilesPool = $('srTilesPool');
    if (tilesPool) {
        tilesPool.style.display = 'flex';
        tilesPool.style.pointerEvents = 'auto';
        tilesPool.style.opacity = '1';
    }
    const defaultControls = $('srDefaultControls');
    if (defaultControls) {
        defaultControls.style.display = 'flex';
    }

    // Se o tempo acabou ou era a última pergunta, finaliza e mostra o resultado
    if (speedRunSession.isLastPhrase || speedRunSession.timeLeft <= 0) {
        finishSpeedRun();
        return;
    }

    // Carrega a próxima frase
    loadNextSpeedRunPhrase();

    // Retoma o cronômetro
    if (!speedRunSession.timer) {
        speedRunSession.timer = setInterval(speedRunTick, 1000);
    }
}

function srPlayCurrentAudio() {
    if (speedRunSession.currentPhrase && speedRunSession.currentPhrase.english) {
        playAudio(speedRunSession.currentPhrase.english);
    }
}

function checkSpeedRunAnswer() {
    if (!speedRunSession.active) return;

    const userWord = speedRunSession.targetLetters.filter(s => s.isLetter).map(s => s.filledChar).join('');
    const targetWord = speedRunSession.targetLetters.filter(s => s.isLetter).map(s => s.char).join('');
    const letterSlots = speedRunSession.targetLetters.filter(s => s.isLetter);

    if (userWord === targetWord) {
        letterSlots.forEach(s => {
            const el = $(s.id);
            if (el) el.classList.add('correct-flash');
        });

        const soundCorrect = $('soundCorrect');
        if (soundCorrect) soundCorrect.play().catch(() => {});

        // Reproduz o áudio da frase em inglês no final ao acertar
        if (speedRunSession.currentPhrase && speedRunSession.currentPhrase.english) {
            playAudio(speedRunSession.currentPhrase.english);
        }

        // Quanto maior for a frase, maior a pontuação ganha:
        const letterCount = letterSlots.length;
        let phrasePoints = letterCount * 10;
        if (letterCount >= 20) {
            phrasePoints += 60; // Bônus de frase longa (+60 pts extras)
        } else if (letterCount >= 12) {
            phrasePoints += 30; // Bônus de frase média (+30 pts extras)
        }

        // Bônus de tempo em segundos a cada frase acertada:
        let secondsBonus = 2;
        if (letterCount >= 25) {
            secondsBonus = 8; // Frase muito longa: +8 segundos!
        } else if (letterCount >= 18) {
            secondsBonus = 6; // Frase longa: +6 segundos!
        } else if (letterCount >= 10) {
            secondsBonus = 4; // Frase média: +4 segundos!
        } else {
            secondsBonus = 2; // Frase curta: +2 segundos!
        }

        speedRunSession.combo++;

        // Bônus adicional de Combo: a cada 3 acertos seguidos ganha +1s extra!
        if (speedRunSession.combo > 0 && speedRunSession.combo % 3 === 0) {
            secondsBonus += 1;
        }

        // Soma os segundos conquistados ao relógio (com teto máximo saudável de 360s / 6 minutos)
        if (!speedRunSession.isLastPhrase) {
            speedRunSession.timeLeft = Math.min(360, speedRunSession.timeLeft + secondsBonus);
        }

        // Multiplicador de Combo progressivo: Combo 2x (+10%), Combo 3x (+20%), etc.
        const comboMultiplier = 1 + Math.max(0, speedRunSession.combo - 1) * 0.1;
        const earnedPoints = Math.round(phrasePoints * comboMultiplier);

        speedRunSession.score += earnedPoints;
        speedRunSession.phrasesCompleted = (speedRunSession.phrasesCompleted || 0) + 1;
        speedRunSession.totalLettersFilled += letterCount;

        // Feedback flutuante com os pontos e os segundos ganhos
        let bonusText = `+${earnedPoints} pts! (+${secondsBonus}s ⏱️)`;
        if (speedRunSession.combo >= 2) {
            bonusText = `+${earnedPoints} pts! (+${secondsBonus}s ⏱️ 🔥 Combo ${speedRunSession.combo}x)`;
        }
        showSpeedRunBonus(bonusText);

        updateSpeedRunHeader();

        // Registra revisão nas métricas e mapa de calor
        if (!appData.history) appData.history = [];
        appData.history.push({ date: Date.now(), correct: true });
        appData.totalReviews = (appData.totalReviews || 0) + 1;

        if (speedRunSession.score > (appData.speedRunHighScore || 0)) {
            appData.speedRunHighScore = speedRunSession.score;
        }
        saveData(appData);

        setTimeout(() => {
            // Se o tempo já havia esgotado (era a última pergunta permitida), finaliza e mostra o placar
            if (speedRunSession.isLastPhrase || speedRunSession.timeLeft <= 0) {
                finishSpeedRun();
            } else if (speedRunSession.active) {
                loadNextSpeedRunPhrase();
            }
        }, 400);
    } else {
        letterSlots.forEach(s => {
            const el = $(s.id);
            if (el) el.classList.add('shake-error');
        });

        if ('vibrate' in navigator) {
            try { navigator.vibrate(150); } catch (e) {}
        }

        speedRunSession.combo = 0;
        updateSpeedRunHeader();

        setTimeout(() => {
            letterSlots.forEach(s => {
                const el = $(s.id);
                if (el) el.classList.remove('shake-error');
            });
        }, 400);
    }
}

function showSpeedRunBonus(text, isError = false) {
    const notice = $('srBonusNotice');
    if (!notice) return;
    notice.textContent = text;
    notice.style.color = isError ? '#ef4444' : '#10b981';
    notice.style.display = 'block';
    notice.style.opacity = '1';
    notice.style.transform = 'translateY(0)';
    notice.style.transition = 'all 0.5s ease';

    setTimeout(() => {
        notice.style.opacity = '0';
        notice.style.transform = 'translateY(-10px)';
        setTimeout(() => {
            if (notice.style.opacity === '0') notice.style.display = 'none';
        }, 500);
    }, isError ? 550 : 700);
}

function finishSpeedRun() {
    if (speedRunSession.timer) {
        clearInterval(speedRunSession.timer);
        speedRunSession.timer = null;
    }
    speedRunSession.active = false;
    speedRunSession.isLastPhrase = false;
    isSkippingPhrase = false;
    if ($('srContinueControls')) $('srContinueControls').style.display = 'none';
    if ($('srDefaultControls')) $('srDefaultControls').style.display = 'flex';
    if ($('srTilesPool')) {
        $('srTilesPool').style.display = 'flex';
        $('srTilesPool').style.pointerEvents = 'auto';
        $('srTilesPool').style.opacity = '1';
    }

    const soundFinish = $('soundFinish');
    if (soundFinish) soundFinish.play().catch(() => {});

    // Ganho de XP proporcional aos pontos conquistados na sessão:
    let earnedXP = 0;
    if (speedRunSession.score > 0) {
        earnedXP = Math.max(5, Math.floor(speedRunSession.score / 20));
        if (speedRunSession.score >= 1500) {
            earnedXP += 25; // Super Desempenho
        } else if (speedRunSession.score >= 800) {
            earnedXP += 10; // Ótimo Desempenho
        }

        appData.speedRunXP = (appData.speedRunXP || 0) + earnedXP;
    }

    const isNewRecord = speedRunSession.score > 0 && speedRunSession.score >= (appData.speedRunHighScore || 0);

    if (speedRunSession.score > (appData.speedRunHighScore || 0)) {
        appData.speedRunHighScore = speedRunSession.score;
    }
    saveData(appData);

    if (isNewRecord) {
        if ($('srNewRecordBadge')) $('srNewRecordBadge').style.display = 'block';
        if (typeof confetti === 'function') {
            try {
                confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 } });
            } catch (e) {}
        }
    } else {
        if ($('srNewRecordBadge')) $('srNewRecordBadge').style.display = 'none';
    }

    if ($('srFinalScore')) $('srFinalScore').textContent = speedRunSession.score;
    if ($('srFinalHighScore')) $('srFinalHighScore').textContent = appData.speedRunHighScore || 0;
    if ($('srFinalPhrases')) $('srFinalPhrases').textContent = speedRunSession.phrasesCompleted || 0;
    if ($('srFinalLpm')) $('srFinalLpm').textContent = speedRunSession.totalLettersFilled;
    if ($('srFinalXPBadge')) $('srFinalXPBadge').textContent = `+${earnedXP} XP`;
    if ($('srFinalXPText')) $('srFinalXPText').textContent = earnedXP > 0 ? `+${earnedXP} XP adicionados ao seu Nível!` : 'Nenhum XP ganho';

    // Restaura visualização da tela inicial e abre o modal de resultado
    showView('homeView');
    openModal('speedRunResultModal');

    // Proteção contra cliques acidentais rápidos no botão de Jogar Novamente
    const playAgainBtn = $('srPlayAgainBtn');
    if (playAgainBtn) {
        playAgainBtn.disabled = true;
        playAgainBtn.style.opacity = '0.6';
        playAgainBtn.style.cursor = 'not-allowed';
        setTimeout(() => {
            playAgainBtn.disabled = false;
            playAgainBtn.style.opacity = '1';
            playAgainBtn.style.cursor = 'pointer';
        }, 800);
    }

    renderStats();
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
    const correctWords = correct.split(' ');
    const normCorrectWords = correctWords.map(w => normalizeText(w));

    let html = '';

    userWords.forEach((uWord, i) => {
        if (!uWord) return;

        if (uWord === normCorrectWords[i]) {
            html += `<span style="color: var(--success); font-weight: 700;">${escapeHTML(uWord)}</span> `;
        } else if (normCorrectWords.includes(uWord)) {
            html += `<span style="color: var(--warning); font-weight: 700; text-decoration: underline;">${escapeHTML(uWord)}</span> `;
        } else {
            html += `<span style="color: var(--danger); font-weight: 800; text-decoration: line-through;">${escapeHTML(uWord)}</span> `;
        }
    });

    return html.trim();
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
window.alert = function (msg, title = "Aviso", icon = "ℹ️", onConfirm = null) {
    $('dialogTitle').textContent = title;
    $('dialogMessage').textContent = msg;
    $('dialogIcon').textContent = icon;
    $('dialogCancel').style.display = 'none';
    $('dialogConfirm').onclick = () => {
        closeDialog();
        if (onConfirm) onConfirm();
    };

    openModal('systemDialog');
};

window.confirm = function (msg, onConfirm, title = "Confirmação") {
    $('dialogTitle').textContent = title;
    $('dialogMessage').textContent = msg;
    $('dialogIcon').textContent = "❓";
    $('dialogCancel').style.display = 'block';
    $('dialogCancel').onclick = closeDialog;
    $('dialogConfirm').onclick = () => {
        closeDialog();
        if (onConfirm) onConfirm();
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

function exportAnki(listId = null) {
    let phrasesToExport = [];
    if (listId) {
        const l = appData.lists.find(x => x.id === listId);
        if (l && l.phrases) phrasesToExport = l.phrases;
    } else {
        appData.lists.forEach(l => {
            if (l.phrases) phrasesToExport = phrasesToExport.concat(l.phrases);
        });
    }

    if (phrasesToExport.length === 0) {
        alert("Nenhuma frase disponível para exportação!");
        return;
    }

    // Formato Anki TSV: Frente \t Verso (Português + Fonética)
    let content = "#separator:tab\n#html:true\n";
    phrasesToExport.forEach(p => {
        const eng = p.english.replace(/\t/g, ' ').replace(/\n/g, '<br>');
        const pt = p.portuguese.replace(/\t/g, ' ').replace(/\n/g, '<br>');
        const phon = getPhoneticGuide(p.english);
        const back = `<b>${pt}</b><br><span style="color:#6366f1;font-family:monospace;">[ ${phon} ]</span>`;
        content += `${eng}\t${back}\n`;
    });

    const blob = new Blob([content], { type: 'text/tab-separated-values;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memoenglish_anki_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importAnki(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const text = e.target.result;
            const lines = text.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#'));
            let importedCount = 0;

            let targetList = appData.lists.find(l => l.id === appData.currentListId) || appData.lists[0];
            if (!targetList) {
                targetList = { id: 'list_' + Date.now(), name: 'Importado do Anki', phrases: [] };
                appData.lists.push(targetList);
                appData.currentListId = targetList.id;
            }

            lines.forEach(line => {
                let parts = line.split('\t');
                if (parts.length < 2) parts = line.split(';');
                if (parts.length < 2) parts = line.split(',');

                if (parts.length >= 2) {
                    const eng = parts[0].replace(/<[^>]*>/g, '').trim();
                    const pt = parts[1].replace(/<[^>]*>/g, '').trim();

                    if (eng && pt && !isPhraseDuplicate(eng)) {
                        targetList.phrases.push({
                            id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                            english: eng,
                            portuguese: pt,
                            nextReview: Date.now(),
                            levels: { standard: 0, quiz: 0, write: 0, listen: 0, pronounce: 0, speak: 0 }
                        });
                        importedCount++;
                    }
                }
            });

            saveData(appData);
            updateUI();
            if (appData.currentListId) renderPhrases();
            alert(`✅ ${importedCount} frases importadas com sucesso do Anki!`);
        } catch (err) {
            console.error('Erro ao importar Anki:', err);
            alert('Não foi possível processar o arquivo. Certifique-se de que é um arquivo de texto exportado do Anki.');
        }
    };
    reader.readAsText(file);
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

    const btn = (typeof event !== 'undefined' && event?.target) ? (event.target.closest('button') || event.target) : null;
    const originalText = btn ? btn.textContent : '';
    if (btn) {
        btn.textContent = '⏳';
        btn.disabled = true;
    }

    const res = await translateText(text, sl, tl);
    if (res && res.translated) {
        $(targetId).value = res.translated;
    }

    if (btn) {
        btn.textContent = originalText;
        btn.disabled = false;
    }
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

    ['writeInput', 'listenInput'].forEach(id => {
        const el = $(id);
        const mirror = $(id + 'Mirror');
        if (el) {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                }
            });
            if (mirror) {
                el.addEventListener('scroll', () => {
                    mirror.scrollTop = el.scrollTop;
                    mirror.scrollLeft = el.scrollLeft;
                });
            }
        }
    });

    document.onkeydown = (e) => {
        const isModalOpen = $('modalBg').style.display === 'flex';
        if (isModalOpen && e.key === 'Enter') return; // Let the modal handle Enter

        // Atalhos de teclado no modo Speed Run
        if (typeof speedRunSession !== 'undefined' && speedRunSession.active && !isModalOpen) {
            if (isSkippingPhrase) {
                if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
                    e.preventDefault();
                    srContinueAfterSkip();
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    exitSpeedRun();
                    return;
                }
                return;
            }
            if (e.key === 'Backspace') {
                e.preventDefault();
                srBackspace();
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                exitSpeedRun();
                return;
            }
            if (/^[a-zA-Z]$/.test(e.key)) {
                e.preventDefault();
                const letter = e.key.toUpperCase();
                const slot = speedRunSession.targetLetters.find(s => s.isLetter && !s.filledChar);
                const tile = speedRunSession.availableTiles.find(t => !t.used && t.remainingCount > 0 && t.char === letter);
                if (tile) {
                    srPickTile(tile.id);
                } else if (slot) {
                    srHandleWrongLetter(null, slot.id);
                }
                return;
            }
        }

        // Atalho Global para Ouvir Áudio: Ctrl+Espaço ou Alt+Espaço (exceto no treino de escrita antes de responder)
        if ((e.ctrlKey || e.altKey) && (e.code === 'Space' || e.key === ' ')) {
            e.preventDefault();
            const isAnsweringWrite = session.active && session.mode === 'write' && !$('feedbackBar')?.classList.contains('active');
            if (!isAnsweringWrite && session.active && session.current) {
                playAudio(session.current.english);
            } else if (typeof handsFreeSession !== 'undefined' && handsFreeSession.active && handsFreeSession.current) {
                playAudio(handsFreeSession.current.english);
            }
            return;
        }

        if (e.key === 'Enter') {
            if ($('feedbackBar').classList.contains('active')) {
                e.preventDefault();
                if ($('btnContinue').style.display !== 'none') {
                    continueSession();
                }
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
    checkVersionAndUpdateAutomatically();
    generateCaptcha();

    // Notifica o usuário se uma atualização manual acabou de ser concluída
    if (window.location.search.includes('force_update=')) {
        try {
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (e) {}
        setTimeout(() => {
            alert("O aplicativo foi atualizado com sucesso com os arquivos mais recentes do servidor!");
        }, 400);
    }

    applyDarkMode();
    showView('homeView');

    // Stop mic if user leaves the tab, and check for updates when returning
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopListening();
        } else {
            checkVersionAndUpdateAutomatically();
        }
    });
};


let currentRecognition = null;
let isRecognitionActive = false;
let micStartTimer = null;

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
    if (micStartTimer) {
        clearTimeout(micStartTimer);
        micStartTimer = null;
    }
    if (currentRecognition) {
        try {
            currentRecognition.onresult = null;
            currentRecognition.onerror = null;
            currentRecognition.onend = null;
            currentRecognition.onstart = null;
            currentRecognition.abort();
        } catch (e) { }
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

    // Se o áudio da pronúncia estiver tocando, interrompe na mesma hora para o microfone não captar
    stopAllAudio();

    if (micStartTimer) {
        clearTimeout(micStartTimer);
        micStartTimer = null;
    }

    if (currentRecognition) {
        try {
            currentRecognition.onresult = null;
            currentRecognition.onerror = null;
            currentRecognition.onend = null;
            currentRecognition.onstart = null;
            currentRecognition.abort();
        } catch (e) { }
        currentRecognition = null;
    }

    // Garante que o cronômetro de 20s inicie caso o usuário tenha ativado o microfone antes do áudio terminar
    const isResultVisible = $('feedbackBar')?.classList.contains('active');
    if (session.active && !isResultVisible && (session.mode === 'pronounce' || session.mode === 'speak') && !exerciseTimerInterval) {
        startExerciseTimer(20);
    }

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

    rec.onstart = () => {
        if (currentRecognition === rec && isRecognitionActive) {
            if (btn) btn.classList.add('listening');
            if (status) {
                status.textContent = "🎙️ Microfone Ativo (Gravando...)";
                status.style.color = "var(--danger)";
            }
        }
    };

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
            isRecognitionActive = false;
            currentRecognition = null;
            // Security: Nullify onresult and onend to prevent multiple triggers
            rec.onresult = null;
            rec.onend = null;
            rec.onerror = null;
            try { rec.stop(); } catch (err) { }

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
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        console.error('Speech error:', e.error);
    };

    rec.onend = () => {
        // Only restart if not successful AND still intended to be listening AND session is active
        const isCorrectMode = session.mode === 'speak' || session.mode === 'pronounce';
        const isFeedbackOpen = $('feedbackBar')?.classList.contains('active');
        if (!success && isRecognitionActive && session.active && isCorrectMode && !isFeedbackOpen && currentRecognition === rec) {
            if (micStartTimer) clearTimeout(micStartTimer);
            micStartTimer = setTimeout(() => {
                micStartTimer = null;
                try {
                    if (!success && isRecognitionActive && session.active && currentRecognition === rec) {
                        rec.start();
                    }
                } catch (err) {
                    console.error("Erro ao reiniciar:", err);
                }
            }, 120);
        } else {
            // Ensure visual state is updated if we stop
            if (currentRecognition === rec) stopListening();
        }
    };

    try {
        rec.start();
    } catch (err) {
        if (micStartTimer) clearTimeout(micStartTimer);
        micStartTimer = setTimeout(() => {
            micStartTimer = null;
            try {
                if (isRecognitionActive && session.active && currentRecognition === rec) {
                    rec.start();
                }
            } catch (e) { }
        }, 150);
    }
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

async function generateAutomaticPhrases(count = 10, originalMode = 'standard') {
    const masteredWords = getMasteredWords();
    const topic = 'general';

    // Filtra frases que não são duplicadas e pontua baseado em palavras conhecidas (Comprehensible Input)
    let scoredPool = SENTENCE_POOL.map(s => {
        const words = normalizeText(s.eng).split(' ');
        const knownCount = words.filter(w => masteredWords.has(w)).length;
        const totalWords = words.length;
        const knownRatio = knownCount / totalWords;

        let score = 0;
        if (knownRatio > 0.2 && knownRatio < 0.8) score = 20;
        else if (knownRatio > 0) score = 10;
        else score = 5;

        return { ...s, score: score + Math.random() * 10 };
    });

    scoredPool.sort((a, b) => b.score - a.score);
    const selected = scoredPool.filter(s => !isPhraseDuplicate(s.eng)).slice(0, count);

    if (selected.length === 0) {
        alert("Você já domina todas as frases gerais no nosso banco de dados!");
        return;
    }

    // No modo standard (botão principal), mostramos o alerta de sucesso mas pulamos a confirmação inicial
    const customMessage = `Sucesso! As frases foram criadas e os testes já estão disponíveis. Lembre-se: você pode colocar suas próprias frases indo na aba 'Listas' e criando uma lista (lá você pode usar a tradução automática).`;

    // Passa forceNew=true e a mensagem customizada (ou null), além de um callback para iniciar o teste
    saveGeneratedList(selected, topic, true, customMessage, () => {
        setTimeout(() => {
            if (originalMode === 'speedrun') {
                startSpeedRun();
            } else if (originalMode === 'multi') {
                startMultiModeReview();
            } else {
                startReview(originalMode);
            }
        }, 300);
    });
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

function saveGeneratedList(phrases, topic, forceNew = false, customMessage = null, onComplete = null) {
    const targetId = forceNew ? 'new' : ($('autoListTarget') ? $('autoListTarget').value : 'new');
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
    if (btn) {
        btn.disabled = false;
        btn.textContent = '✨ Gerar Lista';
    }

    renderLists();
    renderPhrases();
    renderStats();

    // Success feedback
    confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
    });

    if (customMessage) {
        alert(customMessage, "Sucesso", "✅", onComplete);
    } else {
        alert(`Sucesso! Foram adicionadas ${phrases.length} frases novas.`, "Sucesso", "✅", onComplete);
    }
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

async function initializeApp() {
    const loadingScreen = $('loadingScreen');
    const appContainer = $('appContainer');
    const loadingStatus = $('loadingStatus');

    // 1. Renderizar Status inicial (offline)
    renderSyncStatus();
    applyDarkMode();

    // Se logado, tentar sincronizar
    if (appData.auth && appData.auth.isLoggedIn) {
        if (navigator.onLine) {
            await syncWithCloud(false, true);
        } else {
            if (loadingStatus) loadingStatus.textContent = "Modo Offline";
            await new Promise(r => setTimeout(r, 1000));
        }
    } else {
        if (loadingStatus) loadingStatus.textContent = "Pronto!";
        await new Promise(r => setTimeout(r, 800));
    }

    // 2. Preparar UI principal
    renderStats();
    startCountdownInterval();

    // Pequeno delay para garantir que o usuário veja o "Concluído" ou "Pronto"
    await new Promise(r => setTimeout(r, 500));

    // 3. Transição: Splash -> App
    if (loadingScreen) loadingScreen.classList.add('fade-out');

    if (appContainer) {
        appContainer.style.display = 'flex';
        setTimeout(() => {
            appContainer.style.opacity = '1';

            // 4. Iniciar Tutorial se for a primeira vez
            if (!appData.settings.tutorialCompleted) {
                setTimeout(startTutorial, 1200);
            }
        }, 50);
    }

    // Remover o splash do DOM após a animação para economizar recursos
    setTimeout(() => {
        if (loadingScreen) loadingScreen.remove();
    }, 1000);
}

// Start the application
initializeApp();

// ==================== TUTORIAL = :D ====================
let tutorialStep = 0;
const TUTORIAL_STEPS = [
    {
        title: "Bem-vindo ao MemoEnglish! 👋",
        text: "Vamos te ensinar a dominar o inglês em 4 passos simples. É rápido e vai mudar sua forma de estudar.",
        view: 'homeView'
    },
    {
        title: "1. Crie sua Primeira Lista 📖",
        text: "O primeiro passo é ter conteúdo. Vá em 'Minhas Listas' e crie uma nova. Você também pode usar nossa I.A. para gerar listas prontas sobre qualquer assunto!",
        view: 'listsView'
    },
    {
        title: "2. Adicione Frases e Traduza ✍️",
        text: "Dentro de uma lista, adicione frases que você quer aprender. Dica: use a **tradução automática** para preencher o português instantaneamente!",
        view: 'listsView'
    },
    {
        title: "3. Hora de Praticar! ⚡",
        text: "Com frases na lista, volte à Home e clique em **'Iniciar'**. O sistema usará Ciência (Repetição Espaçada) para te mostrar as frases no momento ideal para você não esquecer.",
        view: 'homeView'
    },
    {
        title: "4. Evolua suas Habilidades 🎯",
        text: "Além do modo geral, você pode focar apenas em Escrita, Escuta ou Fala. Acerte as frases para subir de nível até dominá-las completamente!",
        view: 'homeView'
    },
    {
        title: "Dica Extra: Sincronize! ☁️",
        text: "Vá em Configurações e crie sua conta. Assim, seu progresso fica salvo na nuvem e você pode estudar em qualquer dispositivo.",
        view: 'settingsView'
    },
    {
        title: "Tudo Pronto! 🎉",
        text: "O segredo do inglês é a constância. Pratique um pouco todos os dias e veja a mágica acontecer. Bons estudos!",
        view: 'homeView'
    }
];

function startTutorial() {
    tutorialStep = 0;
    $('tutorialOverlay').style.display = 'block';
    renderTutorialStep();
}

function renderTutorialStep() {
    const step = TUTORIAL_STEPS[tutorialStep];
    if (!step) return finishTutorial();

    // Change view if needed
    if (step.view && document.getElementById(step.view).style.display === 'none') {
        showView(step.view);
    }

    const highlight = $('tutorialHighlight');
    const tooltip = $('tutorialTooltip');
    const content = $('tutorialContent');
    const prevBtn = $('tutorialPrevBtn');
    const nextBtn = $('tutorialNextBtn');
    const progress = $('tutorialProgress');

    content.innerHTML = `<h3>${step.title}</h3><p>${step.text}</p>`;
    prevBtn.style.display = tutorialStep === 0 ? 'none' : 'block';
    nextBtn.textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? 'Finalizar' : 'Próximo';

    // Update dots
    progress.innerHTML = TUTORIAL_STEPS.map((_, i) =>
        `<div class="tutorial-dot ${i === tutorialStep ? 'active' : ''}"></div>`
    ).join('');

    // Hide highlight as requested by user
    if (highlight) highlight.style.display = 'none';
}

function nextTutorialStep() {
    tutorialStep++;
    if (tutorialStep >= TUTORIAL_STEPS.length) {
        finishTutorial();
    } else {
        renderTutorialStep();
    }
}

function prevTutorialStep() {
    if (tutorialStep > 0) {
        tutorialStep--;
        renderTutorialStep();
    }
}

function skipTutorial() {
    confirm("Deseja pular o tutorial? Você pode acessá-lo novamente nas configurações.", finishTutorial);
}

function finishTutorial() {
    $('tutorialOverlay').style.display = 'none';
    appData.settings.tutorialCompleted = true;
    saveData(appData);
}

// ==================== DONATION ====================
function showDonationModal() {
    openModal('donationModal');
    $('copyBtnText').textContent = "Copiar Chave PIX";
}

function copyPixKey() {
    const pixKey = "systemmemoenglish@gmail.com";
    navigator.clipboard.writeText(pixKey).then(() => {
        const btnText = $('copyBtnText');
        if (btnText) {
            btnText.textContent = "✅ Chave Copiada!";
            setTimeout(() => {
                btnText.textContent = "Copiar Chave PIX";
            }, 3000);
        }
    }).catch(err => {
        console.error('Erro ao copiar:', err);
        alert("Não foi possível copiar automaticamente. A chave é: " + pixKey);
    });
}
