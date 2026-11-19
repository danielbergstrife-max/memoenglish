const APP_VERSION = '5.3.0';
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

    // Proteção contra loops infinitos de recarregamento:
    // Garante no máximo 1 verificação de reload automático a cada 30 segundos
    const lastAutoReload = sessionStorage.getItem('memo_last_auto_reload');
    if (lastAutoReload && (Date.now() - Number(lastAutoReload)) < 30000) {
        return;
    }

    try {
        const res = await fetch(`./sw.js?check=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
            const text = await res.text();
            const match = text.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
            if (match && match[1]) {
                const serverCacheName = match[1];
                const localCacheName = `memoenglish-v${APP_VERSION}`;
                if (serverCacheName !== localCacheName) {
                    console.log(`Nova versão detectada no servidor: ${serverCacheName} (atual: ${localCacheName}). Atualizando app...`);
                    sessionStorage.setItem('memo_last_auto_reload', Date.now().toString());

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

// ==================== DEFINIÇÕES DE BADGES & LIGA SEMANAL ====================
const BADGE_DEFINITIONS = {
    early_bird: {
        id: 'early_bird',
        name: 'Madrugador',
        icon: '🌅',
        description: 'Praticar uma sessão de estudos antes das 08:00 da manhã.',
        baseXP: 40,
        scalingXP: 20,
        type: 'daily'
    },
    night_owl: {
        id: 'night_owl',
        name: 'Coruja Noturna',
        icon: '🦉',
        description: 'Praticar uma sessão de estudos após as 22:00 da noite.',
        baseXP: 40,
        scalingXP: 20,
        type: 'daily'
    },
    speed_runner: {
        id: 'speed_runner',
        name: 'Velocista Relâmpago',
        icon: '⚡',
        description: 'Fazer 500 ou mais pontos em uma partida de Speed Run.',
        baseXP: 60,
        scalingXP: 30,
        type: 'speedrun'
    },
    perfect_streak: {
        id: 'perfect_streak',
        name: 'Precisão Cirúrgica',
        icon: '🎯',
        description: 'Acertar 10 frases seguidas sem nenhum erro em uma sessão.',
        baseXP: 50,
        scalingXP: 25,
        type: 'session'
    },
    master_speaker: {
        id: 'master_speaker',
        name: 'Orador Fluente',
        icon: '🗣️',
        description: 'Acertar 10 frases no modo de Pronúncia ou Fala.',
        baseXP: 50,
        scalingXP: 25,
        type: 'session'
    },
    typing_master: {
        id: 'typing_master',
        name: 'Mestre da Escrita',
        icon: '✍️',
        description: 'Acertar 10 frases no modo de Escrita.',
        baseXP: 50,
        scalingXP: 25,
        type: 'session'
    },
    word_explorer: {
        id: 'word_explorer',
        name: 'Explorador de Vocabulário',
        icon: '🔍',
        description: 'Consultar o significado de 5 palavras no dicionário popover hoje.',
        baseXP: 30,
        scalingXP: 15,
        type: 'daily'
    },
    marathoner: {
        id: 'marathoner',
        name: 'Maratonista Diário',
        icon: '🏃',
        description: 'Completar 30 revisões no mesmo dia.',
        baseXP: 60,
        scalingXP: 30,
        type: 'daily'
    },
    streak_protector: {
        id: 'streak_protector',
        name: 'Guardião de Gelo',
        icon: '🧊',
        description: 'Proteger ou recarregar seu estoque de Gelo e manter a sequência.',
        baseXP: 45,
        scalingXP: 20,
        type: 'daily'
    },
    league_podium: {
        id: 'league_podium',
        name: 'Pódio da Liga',
        icon: '👑',
        description: 'Terminar a semana no Top 3 (Zona de Promoção) da Liga Semanal.',
        baseXP: 100,
        scalingXP: 50,
        type: 'league'
    }
};

const LEAGUE_DIVISIONS = {
    bronze: {
        id: 'bronze',
        name: 'Liga Bronze',
        icon: '🥉',
        color: '#b45309',
        nextDivision: 'prata',
        prevDivision: null,
        baseScoreMin: 20,
        baseScoreMax: 90,
        incMin: 8,
        incMax: 26,
        ruleText: 'Top 3 sobem para a Liga Prata • Sem rebaixamento'
    },
    prata: {
        id: 'prata',
        name: 'Liga Prata',
        icon: '🥈',
        color: '#64748b',
        nextDivision: 'ouro',
        prevDivision: 'bronze',
        baseScoreMin: 70,
        baseScoreMax: 210,
        incMin: 16,
        incMax: 48,
        ruleText: 'Top 3 sobem para a Liga Ouro • Últimos 4 caem para Bronze'
    },
    ouro: {
        id: 'ouro',
        name: 'Liga Ouro',
        icon: '🥇',
        color: '#d97706',
        nextDivision: 'safira',
        prevDivision: 'prata',
        baseScoreMin: 180,
        baseScoreMax: 450,
        incMin: 28,
        incMax: 80,
        ruleText: 'Top 3 sobem para a Liga Safira • Últimos 4 caem para Prata'
    },
    safira: {
        id: 'safira',
        name: 'Liga Safira',
        icon: '💎',
        color: '#0284c7',
        nextDivision: 'diamante',
        prevDivision: 'ouro',
        baseScoreMin: 400,
        baseScoreMax: 900,
        incMin: 45,
        incMax: 120,
        ruleText: 'Top 3 sobem para a Liga Diamante • Últimos 4 caem para Ouro'
    },
    diamante: {
        id: 'diamante',
        name: 'Liga Diamante',
        icon: '👑',
        color: '#9333ea',
        nextDivision: null,
        prevDivision: 'safira',
        baseScoreMin: 800,
        baseScoreMax: 1800,
        incMin: 65,
        incMax: 180,
        ruleText: 'Top 3 conquistam a Glória dos Campeões • Últimos 4 caem para Safira'
    }
};

const BOT_PERSONAS = [
    { name: "Mariana Costa", avatar: "💻" },
    { name: "Gabriel Lima", avatar: "⚡" },
    { name: "Sofia Ramos", avatar: "📚" },
    { name: "Lucas Gomes", avatar: "🎧" },
    { name: "Beatriz Moreira", avatar: "🔬" },
    { name: "Rafael Silveira", avatar: "🚀" },
    { name: "Larissa Fernandes", avatar: "🎨" },
    { name: "Thiago Ribeiro", avatar: "🎓" },
    { name: "Camila Duarte", avatar: "✨" },
    { name: "Felipe Almeida", avatar: "🌟" },
    { name: "Matheus Vieira", avatar: "🦁" },
    { name: "Juliana Prado", avatar: "🐱" },
    { name: "Bruno Kramer", avatar: "☕" },
    { name: "Amanda Nogueira", avatar: "🎯" },
    { name: "Rodrigo Mendes", avatar: "🧭" },
    { name: "Letícia Lima", avatar: "🌺" },
    { name: "Marcos Vinícius", avatar: "🏄" },
    { name: "Juliana Rocha", avatar: "🌿" },
    { name: "Pedro Henrique", avatar: "⚽" },
    { name: "Carolina Meireles", avatar: "🎵" },
    { name: "Gustavo Santos", avatar: "🕹️" },
    { name: "Fernanda Dias", avatar: "🥋" },
    { name: "Diego Carvalho", avatar: "🎸" },
    { name: "Larissa Becker", avatar: "📸" },
    { name: "Leonardo Barbosa", avatar: "🚴" },
    { name: "Bruna Martins", avatar: "🏖️" },
    { name: "Vanessa Araújo", avatar: "🌻" },
    { name: "Felipe Duarte", avatar: "🏹" },
    { name: "Lucas Zanetti", avatar: "🦅" },
    { name: "Aline Farias", avatar: "🧁" },
    { name: "Renan Castro", avatar: "⚡" },
    { name: "Bianca Silveira", avatar: "💎" },
    { name: "Marcelo Guimarães", avatar: "🐺" },
    { name: "Patrícia Souza", avatar: "🪐" },
    { name: "André Tavares", avatar: "⛵" },
    { name: "Rebeca Morais", avatar: "🔮" },
    { name: "Igor Pires", avatar: "🛹" },
    { name: "Bruno Teixeira", avatar: "🧩" },
    { name: "Daniela Lopes", avatar: "🎯" },
    { name: "Otávio Ferreira", avatar: "🏔️" },
    { name: "Isabela Ramos", avatar: "🦋" },
    { name: "Victor Hugo", avatar: "🎭" },
    { name: "Caio Mendonça", avatar: "🔭" },
    { name: "Débora Peixoto", avatar: "🎻" },
    { name: "Enzo Silveira", avatar: "🏓" },
    { name: "Flávia Toledo", avatar: "🌇" },
    { name: "Guilherme Castro", avatar: "🧗" },
    { name: "Helena Paiva", avatar: "🦚" },
    { name: "Ícaro Santana", avatar: "🏄" },
    { name: "Jéssica Antunes", avatar: "🎡" },
    { name: "Kevin Albuquerque", avatar: "🎙️" },
    { name: "Luana Siqueira", avatar: "🌸" },
    { name: "Murilo Vasconcelos", avatar: "♟️" },
    { name: "Natália Rezende", avatar: "🦄" },
    { name: "Paula Bittencourt", avatar: "🐬" },
    { name: "Samuel Furtado", avatar: "⛵" },
    { name: "Tatiana Lins", avatar: "🌠" },
    { name: "Vinícius Portela", avatar: "🏀" },
    { name: "Yasmin Guimarães", avatar: "🍯" },
    { name: "Arthur Valente", avatar: "🐯" },
    { name: "Cecília Brandão", avatar: "🍓" },
    { name: "Danilo Muniz", avatar: "🛩️" },
    { name: "Eduardo Quintana", avatar: "⚓" },
    { name: "Fabrício Dorneles", avatar: "🏹" },
    { name: "Gabriela Neves", avatar: "🍁" },
    { name: "Henrique Bicalho", avatar: "🏂" },
    { name: "Ingrid Padilha", avatar: "🎠" },
    { name: "Jonas Medeiros", avatar: "🛸" },
    { name: "Lorena Fontes", avatar: "🕊️" },
    { name: "Mayara Trindade", avatar: "🧶" },
    { name: "Nicolas Barreto", avatar: "🦊" },
    { name: "Olívia Fagundes", avatar: "🌷" },
    { name: "Pablo Esteves", avatar: "🌴" },
    { name: "Priscila Vianna", avatar: "💎" },
    { name: "Renato Lacerda", avatar: "🥊" },
    { name: "Sabrina Furtado", avatar: "🎀" },
    { name: "Talita Albuquerque", avatar: "🥑" },
    { name: "Vicente Bueno", avatar: "🍇" },
    { name: "Wesley Sampaio", avatar: "⚡" },
    { name: "Zilda Figueiredo", avatar: "🕊️" }
];

function getCurrentWeekId() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNo = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-W${weekNo < 10 ? '0' + weekNo : weekNo}`;
}

function generateBotsForDivision(divKey, difficulty = 1.0, excludedNames = []) {
    const conf = LEAGUE_DIVISIONS[divKey] || LEAGUE_DIVISIONS.bronze;
    const diff = (difficulty != null) ? difficulty : 1.0;
    const excludedSet = new Set(excludedNames || []);

    const available = BOT_PERSONAS.filter(p => !excludedSet.has(p.name));
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const pool = shuffled.length >= 14 ? shuffled : [...BOT_PERSONAS].sort(() => Math.random() - 0.5);

    return pool.slice(0, 14).map((p, idx) => {
        const pace = 0.85 + Math.random() * 0.4;
        const baseScore = conf.baseScoreMin + (Math.random() * (conf.baseScoreMax - conf.baseScoreMin));
        const score = Math.round(baseScore * diff);
        return {
            id: 'bot_' + idx + '_' + Math.floor(Math.random() * 10000),
            name: p.name,
            avatar: p.avatar,
            score: score,
            pace: pace,
            prevRank: idx + 1
        };
    });
}

// Simula de forma realista a rotação semanal: quem sobe, quem desce e novos entrantes
function generateNextWeekBots(oldBots, userRank, oldDivKey, nextDivKey, difficulty = 1.0) {
    const conf = LEAGUE_DIVISIONS[nextDivKey] || LEAGUE_DIVISIONS.bronze;
    const diff = (difficulty != null) ? difficulty : 1.0;

    // Se não há bots anteriores, gera novo grupo completo
    if (!oldBots || oldBots.length === 0) {
        return generateBotsForDivision(nextDivKey, diff);
    }

    // 1. Reconstrói o ranking final da semana anterior (1 a 15)
    const sortedLastWeek = [
        { isUser: true, name: (appData.auth?.username || 'Você'), score: (appData.league?.userXP || 0) },
        ...(oldBots || [])
    ].sort((a, b) => b.score - a.score);

    // 2. Classifica quem foi promovido (1-3), quem ficou (4-11) e quem foi rebaixado (12-15)
    const promotedBots = sortedLastWeek.slice(0, 3).filter(c => !c.isUser); // Top 3
    const safeZoneBots = sortedLastWeek.slice(3, 11).filter(c => !c.isUser); // 4 a 11
    const demotedBots = sortedLastWeek.slice(11, 15).filter(c => !c.isUser); // 12 a 15

    let retainedBots = [];

    if (nextDivKey !== oldDivKey) {
        const isPromotion = userRank <= 3;
        if (isPromotion) {
            // Caso A: Usuário foi PROMOVIDO para uma liga superior!
            // Apenas os outros competidores que também ficaram no Top 3 sobem junto como rivais promovidos.
            // Os concorrentes do 4º ao 15º lugar FICAM na divisão anterior e NÃO sobem!
            retainedBots = [...promotedBots];
        } else {
            // Caso B: Usuário foi REBAIXADO para uma liga inferior!
            // Os competidores que também caíram descem junto. Os do topo NÃO descem!
            retainedBots = [...demotedBots.slice(0, 2)];
        }
    } else {
        // Caso C: Usuário PERMANECEU na mesma divisão!
        if (oldDivKey === 'diamante' && userRank <= 3) {
            // Na Liga Diamante (ápice), quem fica no pódio permanece na Diamante como campeão.
            // Retemos 1 a 2 rivais do pódio para manter a rivalidade de elite, mais 2 da zona segura.
            const shuffledPodium = [...promotedBots].sort(() => Math.random() - 0.5);
            const shuffledSafe = [...safeZoneBots].sort(() => Math.random() - 0.5);
            retainedBots = [...shuffledPodium.slice(0, 2), ...shuffledSafe.slice(0, 2)];
        } else {
            // Nas divisões comuns:
            // Os 3 primeiros foram promovidos e SAÍRAM da divisão!
            // Os 4 últimos foram rebaixados e SAÍRAM da divisão!
            // Colegas da zona segura (4º ao 11º) continuam na sala (3 a 4 colegas),
            // e novos competidores chegam para preencher as vagas!
            const shuffledSafe = [...safeZoneBots].sort(() => Math.random() - 0.5);
            retainedBots = shuffledSafe.slice(0, 4);
        }
    }

    // Nomes já utilizados para evitar duplicações na sala
    const usedNames = new Set(retainedBots.map(b => b.name));
    if (appData.auth?.username) usedNames.add(appData.auth.username);

    // Quantos novos bots precisamos para completar os 14 adversários?
    const needed = Math.max(0, 14 - retainedBots.length);
    const availablePersonas = BOT_PERSONAS.filter(p => !usedNames.has(p.name));
    const shuffledPersonas = [...availablePersonas].sort(() => Math.random() - 0.5);
    const newPersonas = shuffledPersonas.slice(0, needed);

    // Monta o novo roster com pontuações iniciais frescas da nova divisão
    const combinedList = [];

    // Adiciona os bots retidos com novos scores iniciais da rodada
    retainedBots.forEach((b, idx) => {
        const pace = 0.85 + Math.random() * 0.4;
        const baseScore = conf.baseScoreMin + (Math.random() * (conf.baseScoreMax - conf.baseScoreMin));
        const score = Math.round(baseScore * diff);
        combinedList.push({
            id: 'bot_ret_' + idx + '_' + Math.floor(Math.random() * 10000),
            name: b.name,
            avatar: b.avatar,
            score: score,
            pace: pace,
            prevRank: idx + 1
        });
    });

    // Adiciona os novos competidores que entraram na liga
    newPersonas.forEach((p, idx) => {
        const pace = 0.85 + Math.random() * 0.4;
        const baseScore = conf.baseScoreMin + (Math.random() * (conf.baseScoreMax - conf.baseScoreMin));
        const score = Math.round(baseScore * diff);
        combinedList.push({
            id: 'bot_new_' + idx + '_' + Math.floor(Math.random() * 10000),
            name: p.name,
            avatar: p.avatar,
            score: score,
            pace: pace,
            prevRank: combinedList.length + 1
        });
    });

    // Embaralha para que os competidores comecem a nova semana de forma variada
    return combinedList.sort(() => Math.random() - 0.5).slice(0, 14);
}

function initLeagueData(division = 'bronze', difficulty = 1.0) {
    const currentWeek = getCurrentWeekId();
    const diff = (difficulty != null) ? difficulty : 1.0;
    return {
        division: division,
        weekId: currentWeek,
        userXP: 0,
        bots: generateBotsForDivision(division, diff),
        botDifficulty: diff,
        lastFinishedRank: null,
        lastVisitTime: Date.now()
    };
}

// ==================== DEFINIÇÕES DE MISSÕES DIÁRIAS & SEMANAIS ====================

function getCurrentDayId() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getMissionSeedRandom(seedStr) {
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
        hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
        hash |= 0;
    }
    return function() {
        hash = (hash * 9301 + 49297) % 233280;
        return (hash < 0 ? hash + 233280 : hash) / 233280;
    };
}

// Bônus temporário de XP (Poções)
function isXPBoostActive() {
    if (!appData || !appData.activeXPBoost || !appData.activeXPBoost.expiresAt) return false;
    return Date.now() < appData.activeXPBoost.expiresAt;
}

function getXPBoostMultiplier() {
    if (!isXPBoostActive()) return 1.0;
    return appData.activeXPBoost.multiplier || 1.5;
}

function getXPBoostRemainingMs() {
    if (!isXPBoostActive()) return 0;
    return Math.max(0, appData.activeXPBoost.expiresAt - Date.now());
}

function activateXPBooster(type) {
    if (!appData.inventory) appData.inventory = { xpBoosters50: 0, xpBoosters100: 0 };
    const duration24h = 24 * 60 * 60 * 1000;

    if (type === '50') {
        if ((appData.inventory.xpBoosters50 || 0) <= 0) {
            alert("Você não possui Poções de XP +50% no momento. Complete todas as missões diárias para ganhar uma!");
            return;
        }
        appData.inventory.xpBoosters50 = Math.max(0, appData.inventory.xpBoosters50 - 1);
        const currentRemaining = isXPBoostActive() ? Math.max(0, appData.activeXPBoost.expiresAt - Date.now()) : 0;
        appData.activeXPBoost = {
            multiplier: 1.5,
            type: '50',
            expiresAt: Date.now() + currentRemaining + duration24h
        };
        saveData(appData);
        if (typeof confetti === 'function') confetti({ particleCount: 110, spread: 75, origin: { y: 0.6 } });
        const sound = document.getElementById('soundFinish');
        if (sound) sound.play().catch(() => {});
        showMissionToast("🧪 Poção +50% XP Ativada!", "Todas as frases e testes valem +50% de XP por 24 horas!", "🧪");
    } else if (type === '100') {
        if ((appData.inventory.xpBoosters100 || 0) <= 0) {
            alert("Você não possui Poções de XP +100% no momento. Complete as missões semanais para conquistar uma!");
            return;
        }
        appData.inventory.xpBoosters100 = Math.max(0, appData.inventory.xpBoosters100 - 1);
        const currentRemaining = isXPBoostActive() ? Math.max(0, appData.activeXPBoost.expiresAt - Date.now()) : 0;
        appData.activeXPBoost = {
            multiplier: 2.0,
            type: '100',
            expiresAt: Date.now() + currentRemaining + duration24h
        };
        saveData(appData);
        if (typeof confetti === 'function') confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 } });
        const sound = document.getElementById('soundFinish');
        if (sound) sound.play().catch(() => {});
        showMissionToast("⚡ Poção +100% XP Ativada!", "Todas as frases e testes valem XP em DOBRO (2x) por 24 horas!", "⚡");
    }

    renderStats();
    renderMissionsUI();
}

// POOL DE MISSÕES DIÁRIAS (100 XP CADA - Foco em Treinos e Mecânicas Únicas)
const DAILY_MISSION_POOLS = {
    // Slot 1: Dificuldades, Treino Híbrido & Evolução
    slot1: [
        {
            id: 'd_troublesome_5',
            title: 'Caçador de Erros',
            desc: 'Acertar 5 frases no Treino de Dificuldades',
            icon: '🎯',
            target: 5,
            xpReward: 100,
            type: 'troublesome',
            action: 'troublesome'
        },
        {
            id: 'd_multimode_15',
            title: 'Mestre Multimodal',
            desc: 'Completar 15 frases no Treino Combinado',
            icon: '🔄',
            target: 15,
            xpReward: 100,
            type: 'multi',
            action: 'multi'
        },
        {
            id: 'd_master_3',
            title: 'Elevação Cognitiva',
            desc: 'Avançar o nível de memorização de 3 frases hoje',
            icon: '⭐',
            target: 3,
            xpReward: 100,
            type: 'phrase_leveled',
            action: 'review'
        },
        {
            id: 'd_two_lists',
            title: 'Conexão Cruzada',
            desc: 'Praticar frases de pelo menos 2 listas diferentes',
            icon: '📚',
            target: 2,
            xpReward: 100,
            type: 'distinct_lists',
            action: 'review'
        }
    ],
    // Slot 2: Habilidades Específicas de Idioma
    slot2: [
        {
            id: 'd_blind_listen_15',
            title: 'Percepção Auditiva',
            desc: 'Acertar 15 frases no modo Escuta',
            icon: '👂',
            target: 15,
            xpReward: 100,
            type: 'mode',
            mode: 'listen',
            action: 'listen'
        },
        {
            id: 'd_speech_clarity_12',
            title: 'Expressão Verbal',
            desc: 'Acertar 12 frases no modo Fala ou Pronúncia',
            icon: '🎙️',
            target: 12,
            xpReward: 100,
            type: 'mode_audio',
            action: 'speak'
        },
        {
            id: 'd_quick_quiz_15',
            title: 'Reflexo de Compreensão',
            desc: 'Acertar 15 frases no modo Quiz',
            icon: '🧩',
            target: 15,
            xpReward: 100,
            type: 'mode',
            mode: 'quiz',
            action: 'quiz'
        },
        {
            id: 'd_accurate_writing_12',
            title: 'Soletrador Preciso',
            desc: 'Acertar 12 frases no modo Escrita',
            icon: '✍️',
            target: 12,
            xpReward: 100,
            type: 'mode',
            mode: 'write',
            action: 'write'
        }
    ],
    // Slot 3: Ritmo & Performance Diária
    slot3: [
        {
            id: 'd_clean_run_15',
            title: 'Fluxo Perfeito',
            desc: 'Acertar 15 frases seguidas sem nenhum erro',
            icon: '⚡',
            target: 15,
            xpReward: 100,
            type: 'streak',
            action: 'review'
        },
        {
            id: 'd_speedrun_burst_350',
            title: 'Impulso Relâmpago',
            desc: 'Fazer 350+ pontos em uma partida de Speed Run',
            icon: '⏱️',
            target: 350,
            xpReward: 100,
            type: 'speedrun',
            action: 'speedrun'
        },
        {
            id: 'd_extra_reviews_40',
            title: 'Ritmo Acelerado',
            desc: 'Completar 40 revisões no dia de hoje',
            icon: '🔥',
            target: 40,
            xpReward: 100,
            type: 'reviews',
            action: 'review'
        }
    ]
};

// POOL DE MISSÕES SEMANAIS (1.000 XP CADA - Muito Difíceis & Vários Dias de Dedicação)
const WEEKLY_MISSION_POOLS = {
    // Slot 1: Consistência ao Longo de 5 a 6 Dias da Semana
    slot1: [
        {
            id: 'w_six_days_streak',
            title: 'Disciplina Implacável',
            desc: 'Estudar e bater a meta diária em 6 dias diferentes da semana',
            icon: '📅',
            target: 6,
            xpReward: 1000,
            type: 'w_goal_days',
            action: 'review'
        },
        {
            id: 'w_reviews_450',
            title: 'Maratona de Ferro',
            desc: 'Completar 450 revisões ao longo da semana',
            icon: '🏃',
            target: 450,
            xpReward: 1000,
            type: 'w_reviews',
            action: 'review'
        },
        {
            id: 'w_five_days_intense',
            title: 'Constância Absoluta',
            desc: 'Fazer ao menos 40 revisões por dia em 5 dias diferentes',
            icon: '🛡️',
            target: 5,
            xpReward: 1000,
            type: 'w_intense_days',
            action: 'review'
        }
    ],
    // Slot 2: Domínio Vocabular & Dificuldades
    slot2: [
        {
            id: 'w_master_phrases_25',
            title: 'Fixação Definitiva',
            desc: 'Elevar 25 frases para o nível 5 (Totalmente Memorizadas) na semana',
            icon: '👑',
            target: 25,
            xpReward: 1000,
            type: 'w_master',
            action: 'review'
        },
        {
            id: 'w_clear_troublesome_40',
            title: 'Exterminador de Erros',
            desc: 'Acertar 40 frases no Treino de Dificuldades ao longo da semana',
            icon: '⚠️',
            target: 40,
            xpReward: 1000,
            type: 'w_troublesome',
            action: 'troublesome'
        },
        {
            id: 'w_skills_audio_150',
            title: 'Imersão Sonora Total',
            desc: 'Acertar 150 desafios somando Escuta, Pronúncia e Fala na semana',
            icon: '🎧',
            target: 150,
            xpReward: 1000,
            type: 'w_audio_total',
            action: 'listen'
        }
    ],
    // Slot 3: Competição & Arcade de Alto Nível
    slot3: [
        {
            id: 'w_speedrun_3500',
            title: 'Lenda do SpeedRun',
            desc: 'Acumular 3.500 pontos no Speed Run ao longo da semana',
            icon: '⚡',
            target: 3500,
            xpReward: 1000,
            type: 'w_speedrun',
            action: 'speedrun'
        },
        {
            id: 'w_combos_12',
            title: 'Precisão Extrema',
            desc: 'Alcançar 12 combos perfeitos de 10 acertos seguidos na semana',
            icon: '🎯',
            target: 12,
            xpReward: 1000,
            type: 'w_combos',
            action: 'review'
        },
        {
            id: 'w_league_xp_1500',
            title: 'Conquistador da Liga',
            desc: 'Conquistar 1.500 XP na Liga Semanal nesta semana',
            icon: '🏆',
            target: 1500,
            xpReward: 1000,
            type: 'w_league_xp',
            action: 'league'
        }
    ]
};

let currentMissionsTab = 'daily';

function switchMissionsTab(tab) {
    currentMissionsTab = tab;
    const dailyBtn = document.getElementById('tabDailyMissions');
    const weeklyBtn = document.getElementById('tabWeeklyMissions');
    const dailyCont = document.getElementById('dailyMissionsContainer');
    const weeklyCont = document.getElementById('weeklyMissionsContainer');

    if (tab === 'daily') {
        if (dailyBtn) dailyBtn.classList.add('active');
        if (weeklyBtn) weeklyBtn.classList.remove('active');
        if (dailyCont) dailyCont.style.display = 'block';
        if (weeklyCont) weeklyCont.style.display = 'none';
    } else {
        if (dailyBtn) dailyBtn.classList.remove('active');
        if (weeklyBtn) weeklyBtn.classList.add('active');
        if (dailyCont) dailyCont.style.display = 'none';
        if (weeklyCont) weeklyCont.style.display = 'block';
    }
    updateMissionsCountdown();
}

function generateMissionsList(pools, seedStr, type = 'daily') {
    const rng = getMissionSeedRandom(seedStr);
    const slots = ['slot1', 'slot2', 'slot3'];
    const fixedReward = type === 'daily' ? 100 : 1000;
    return slots.map(slotKey => {
        const pool = pools[slotKey];
        const idx = Math.floor(rng() * pool.length);
        const template = pool[idx];
        return {
            id: template.id,
            slot: slotKey,
            title: template.title,
            desc: template.desc,
            icon: template.icon,
            target: template.target,
            xpReward: fixedReward,
            type: template.type,
            mode: template.mode || null,
            action: template.action || 'review',
            current: 0,
            completed: false,
            claimed: false
        };
    });
}

function initMissionsData() {
    const today = getCurrentDayId();
    const weekId = getCurrentWeekId();
    return {
        dailyDate: today,
        daily: generateMissionsList(DAILY_MISSION_POOLS, today, 'daily'),
        dailyAllClaimed: false,
        weeklyId: weekId,
        weekly: generateMissionsList(WEEKLY_MISSION_POOLS, weekId, 'weekly'),
        weeklyAllClaimed: false,
        bonusXP: 0,
        // Diários
        todayReviewsCount: 0,
        todayTroublesomeCount: 0,
        todayMultiCount: 0,
        todayLeveledCount: 0,
        todayListenCount: 0,
        todaySpeakCount: 0,
        todayQuizCount: 0,
        todayWriteCount: 0,
        todaySpeedRunMax: 0,
        todayCleanStreakMax: 0,
        todayLists: [],
        // Semanais
        weeklyGoalDays: [],
        weeklyIntenseDays: [],
        weeklyReviewsCount: 0,
        weeklyMasterCount: 0,
        weeklyTroublesomeCount: 0,
        weeklyAudioCount: 0,
        weeklySpeedRunScore: 0,
        weeklyCombosCount: 0,
        weeklyLeagueXP: 0
    };
}

function checkAndRollMissions() {
    if (!appData) return;
    if (!appData.missions) {
        appData.missions = initMissionsData();
        return;
    }

    const today = getCurrentDayId();
    const currentWeek = getCurrentWeekId();

    // Rola Diárias se virou o dia
    if (appData.missions.dailyDate !== today) {
        appData.missions.dailyDate = today;
        appData.missions.dailyAllClaimed = false;
        appData.missions.todayReviewsCount = 0;
        appData.missions.todayTroublesomeCount = 0;
        appData.missions.todayMultiCount = 0;
        appData.missions.todayLeveledCount = 0;
        appData.missions.todayListenCount = 0;
        appData.missions.todaySpeakCount = 0;
        appData.missions.todayQuizCount = 0;
        appData.missions.todayWriteCount = 0;
        appData.missions.todaySpeedRunMax = 0;
        appData.missions.todayCleanStreakMax = 0;
        appData.missions.todayLists = [];
        appData.missions.daily = generateMissionsList(DAILY_MISSION_POOLS, today, 'daily');
    }

    // Rola Semanais se virou a semana
    if (appData.missions.weeklyId !== currentWeek) {
        appData.missions.weeklyId = currentWeek;
        appData.missions.weeklyAllClaimed = false;
        appData.missions.weeklyGoalDays = [];
        appData.missions.weeklyIntenseDays = [];
        appData.missions.weeklyReviewsCount = 0;
        appData.missions.weeklyMasterCount = 0;
        appData.missions.weeklyTroublesomeCount = 0;
        appData.missions.weeklyAudioCount = 0;
        appData.missions.weeklySpeedRunScore = 0;
        appData.missions.weeklyCombosCount = 0;
        appData.missions.weeklyLeagueXP = 0;
        appData.missions.weekly = generateMissionsList(WEEKLY_MISSION_POOLS, currentWeek, 'weekly');
    }
}

function recordMissionProgress(eventType, value = 1, extra = {}) {
    if (!appData) return;
    checkAndRollMissions();
    if (!appData.missions) return;

    let hasChanges = false;
    const today = getCurrentDayId();

    // 1. Rastreadores Diários
    if (eventType === 'reviews' && value > 0) {
        appData.missions.todayReviewsCount = (appData.missions.todayReviewsCount || 0) + value;
        appData.missions.weeklyReviewsCount = (appData.missions.weeklyReviewsCount || 0) + value;
        hasChanges = true;
    }

    if (eventType === 'troublesome_correct' && value > 0) {
        appData.missions.todayTroublesomeCount = (appData.missions.todayTroublesomeCount || 0) + value;
        appData.missions.weeklyTroublesomeCount = (appData.missions.weeklyTroublesomeCount || 0) + value;
        hasChanges = true;
    }

    if (eventType === 'multimode_complete' && value > 0) {
        appData.missions.todayMultiCount = (appData.missions.todayMultiCount || 0) + value;
        hasChanges = true;
    }

    if (eventType === 'phrase_leveled' && value > 0) {
        appData.missions.todayLeveledCount = (appData.missions.todayLeveledCount || 0) + value;
        hasChanges = true;
    }

    if (eventType === 'phrase_mastered' && value > 0) {
        appData.missions.weeklyMasterCount = (appData.missions.weeklyMasterCount || 0) + value;
        hasChanges = true;
    }

    if (eventType === 'mode_correct' && value > 0) {
        const m = extra.mode;
        if (m === 'listen') {
            appData.missions.todayListenCount = (appData.missions.todayListenCount || 0) + value;
            appData.missions.weeklyAudioCount = (appData.missions.weeklyAudioCount || 0) + value;
        } else if (m === 'speak' || m === 'pronounce') {
            appData.missions.todaySpeakCount = (appData.missions.todaySpeakCount || 0) + value;
            appData.missions.weeklyAudioCount = (appData.missions.weeklyAudioCount || 0) + value;
        } else if (m === 'quiz') {
            appData.missions.todayQuizCount = (appData.missions.todayQuizCount || 0) + value;
        } else if (m === 'write') {
            appData.missions.todayWriteCount = (appData.missions.todayWriteCount || 0) + value;
        }
        hasChanges = true;
    }

    if (eventType === 'list_reviewed' && extra.listId) {
        appData.missions.todayLists = appData.missions.todayLists || [];
        if (!appData.missions.todayLists.includes(extra.listId)) {
            appData.missions.todayLists.push(extra.listId);
            hasChanges = true;
        }
    }

    if (eventType === 'speedrun_score' && value > 0) {
        appData.missions.todaySpeedRunMax = Math.max(appData.missions.todaySpeedRunMax || 0, value);
        appData.missions.weeklySpeedRunScore = (appData.missions.weeklySpeedRunScore || 0) + value;
        hasChanges = true;
    }

    if (eventType === 'perfect_combo' && value > 0) {
        appData.missions.weeklyCombosCount = (appData.missions.weeklyCombosCount || 0) + value;
        hasChanges = true;
    }

    if (eventType === 'clean_streak' && value > 0) {
        appData.missions.todayCleanStreakMax = Math.max(appData.missions.todayCleanStreakMax || 0, value);
        hasChanges = true;
    }

    if (eventType === 'league_xp' && value > 0) {
        appData.missions.weeklyLeagueXP = (appData.missions.weeklyLeagueXP || 0) + value;
        hasChanges = true;
    }

    if (eventType === 'daily_goal_met') {
        appData.missions.weeklyGoalDays = appData.missions.weeklyGoalDays || [];
        if (!appData.missions.weeklyGoalDays.includes(today)) {
            appData.missions.weeklyGoalDays.push(today);
            hasChanges = true;
        }
    }

    // Dias com ao menos 40 revisões para missão semanal w_five_days_intense
    if (eventType === 'reviews' && (appData.missions.todayReviewsCount || 0) >= 40) {
        appData.missions.weeklyIntenseDays = appData.missions.weeklyIntenseDays || [];
        if (!appData.missions.weeklyIntenseDays.includes(today)) {
            appData.missions.weeklyIntenseDays.push(today);
            hasChanges = true;
        }
    }

    // 2. Atualizar Progresso nas Missões Diárias
    (appData.missions.daily || []).forEach(m => {
        if (m.completed) return;
        let currentVal = 0;
        if (m.type === 'troublesome') currentVal = appData.missions.todayTroublesomeCount || 0;
        else if (m.type === 'multi') currentVal = appData.missions.todayMultiCount || 0;
        else if (m.type === 'phrase_leveled') currentVal = appData.missions.todayLeveledCount || 0;
        else if (m.type === 'distinct_lists') currentVal = (appData.missions.todayLists || []).length;
        else if (m.type === 'mode' && m.mode === 'listen') currentVal = appData.missions.todayListenCount || 0;
        else if (m.type === 'mode' && m.mode === 'quiz') currentVal = appData.missions.todayQuizCount || 0;
        else if (m.type === 'mode' && m.mode === 'write') currentVal = appData.missions.todayWriteCount || 0;
        else if (m.type === 'mode_audio') currentVal = (appData.missions.todaySpeakCount || 0) + (appData.missions.todayListenCount || 0);
        else if (m.type === 'streak') currentVal = appData.missions.todayCleanStreakMax || 0;
        else if (m.type === 'speedrun') currentVal = appData.missions.todaySpeedRunMax || 0;
        else if (m.type === 'reviews') currentVal = appData.missions.todayReviewsCount || 0;

        m.current = Math.min(m.target, currentVal);
        if (m.current >= m.target) {
            m.completed = true;
            hasChanges = true;
            showMissionToast("🎯 Missão Diária Concluída!", `${m.title} (+100 XP)`, m.icon);
        }
    });

    // 3. Atualizar Progresso nas Missões Semanais
    (appData.missions.weekly || []).forEach(m => {
        if (m.completed) return;
        let currentVal = 0;
        if (m.type === 'w_goal_days') currentVal = (appData.missions.weeklyGoalDays || []).length;
        else if (m.type === 'w_reviews') currentVal = appData.missions.weeklyReviewsCount || 0;
        else if (m.type === 'w_intense_days') currentVal = (appData.missions.weeklyIntenseDays || []).length;
        else if (m.type === 'w_master') currentVal = appData.missions.weeklyMasterCount || 0;
        else if (m.type === 'w_troublesome') currentVal = appData.missions.weeklyTroublesomeCount || 0;
        else if (m.type === 'w_audio_total') currentVal = appData.missions.weeklyAudioCount || 0;
        else if (m.type === 'w_speedrun') currentVal = appData.missions.weeklySpeedRunScore || 0;
        else if (m.type === 'w_combos') currentVal = appData.missions.weeklyCombosCount || 0;
        else if (m.type === 'w_league_xp') currentVal = appData.missions.weeklyLeagueXP || 0;

        m.current = Math.min(m.target, currentVal);
        if (m.current >= m.target) {
            m.completed = true;
            hasChanges = true;
            showMissionToast("👑 Missão Semanal Concluída!", `${m.title} (+1.000 XP)`, m.icon);
        }
    });

    if (hasChanges) {
        saveData(appData);
        renderMissionsUI();
    }
}

function claimMission(type, slotIndex) {
    checkAndRollMissions();
    const list = type === 'daily' ? appData.missions.daily : appData.missions.weekly;
    if (!list || !list[slotIndex]) return;

    const mission = list[slotIndex];
    if (!mission.completed || mission.claimed) return;

    mission.claimed = true;
    const reward = type === 'daily' ? 100 : 1000;

    appData.missions.bonusXP = (appData.missions.bonusXP || 0) + reward;
    addLeagueXP(reward, true);
    updateGlobalLevel();
    saveData(appData);

    const sound = document.getElementById('soundFinish');
    if (sound) sound.play().catch(() => {});
    if (typeof confetti === 'function') {
        confetti({ particleCount: type === 'weekly' ? 150 : 80, spread: 70, origin: { y: 0.65 } });
    }

    renderMissionsUI();
}

function claimMissionsChest(type) {
    checkAndRollMissions();

    if (type === 'daily') {
        const allClaimed = (appData.missions.daily || []).every(m => m.completed && m.claimed);
        if (!allClaimed || appData.missions.dailyAllClaimed) return;

        appData.missions.dailyAllClaimed = true;
        if (!appData.inventory) appData.inventory = { xpBoosters50: 0, xpBoosters100: 0 };
        appData.inventory.xpBoosters50 = (appData.inventory.xpBoosters50 || 0) + 1;

        saveData(appData);

        openCelebrationModal('missionChestModal', () => {
            const titleEl = document.getElementById('missionChestTitle');
            const subEl = document.getElementById('missionChestSubtitle');
            const itemEl = document.getElementById('missionChestItemText');
            const boostEl = document.getElementById('missionChestBoosterText');
            if (titleEl) titleEl.textContent = 'Baú Diário Coletado!';
            if (subEl) subEl.textContent = 'Sensacional! Você cumpriu todas as missões diárias com maestria!';
            if (boostEl) {
                boostEl.style.display = 'block';
                boostEl.textContent = '🧪 +1 Poção de XP +50% (24 Horas) adicionada ao seu inventário!';
            }
            if (itemEl) itemEl.style.display = 'none';

            if (typeof confetti === 'function') confetti({ particleCount: 160, spread: 85, origin: { y: 0.55 } });
            const s = document.getElementById('soundFinish');
            if (s) s.play().catch(() => {});
        });
    } else {
        const allClaimed = (appData.missions.weekly || []).every(m => m.completed && m.claimed);
        if (!allClaimed || appData.missions.weeklyAllClaimed) return;

        appData.missions.weeklyAllClaimed = true;
        if (!appData.inventory) appData.inventory = { xpBoosters50: 0, xpBoosters100: 0 };
        appData.inventory.xpBoosters100 = (appData.inventory.xpBoosters100 || 0) + 1;
        appData.streakFreezes = (appData.streakFreezes || 0) + 1;

        saveData(appData);

        openCelebrationModal('missionChestModal', () => {
            const titleEl = document.getElementById('missionChestTitle');
            const subEl = document.getElementById('missionChestSubtitle');
            const itemEl = document.getElementById('missionChestItemText');
            const boostEl = document.getElementById('missionChestBoosterText');
            if (titleEl) titleEl.textContent = 'Baú Semanal Lendário!';
            if (subEl) subEl.textContent = 'Conquista Épica! Você venceu desafios de altíssima exigência nesta semana!';
            if (boostEl) {
                boostEl.style.display = 'block';
                boostEl.textContent = '⚡ +1 Poção de XP +100% (24h de XP Dobrado!) adicionada!';
            }
            if (itemEl) {
                itemEl.style.display = 'block';
                itemEl.textContent = '🧊 +1 Gelo Protetor de Ofensiva adicionado!';
            }

            if (typeof confetti === 'function') confetti({ particleCount: 220, spread: 100, origin: { y: 0.5 } });
            const s = document.getElementById('soundFinish');
            if (s) s.play().catch(() => {});
        });
    }

    renderMissionsUI();
}

function getMissionActionLabel(action, mode) {
    if (action === 'troublesome') return 'Dificuldades ⚠️';
    if (action === 'speedrun') return 'Speed Run ⚡';
    if (action === 'multi') return 'Treino Combinado 🔄';
    if (action === 'listen' || mode === 'listen') return 'Ouvir 🎧';
    if (action === 'speak' || mode === 'speak') return 'Falar 🎙️';
    if (action === 'pronounce' || mode === 'pronounce') return 'Pronunciar 🗣️';
    if (action === 'quiz' || mode === 'quiz') return 'Quiz 🧩';
    if (action === 'write' || mode === 'write') return 'Escrever ✍️';
    return 'Praticar 🚀';
}

function executeMissionAction(action, mode) {
    if (action === 'troublesome') {
        startTroublesomeReview();
    } else if (action === 'speedrun') {
        startSpeedRun();
    } else if (action === 'multi') {
        startMultiModeReview();
    } else if (action === 'listen' || mode === 'listen') {
        startReview('listen');
    } else if (action === 'speak' || mode === 'speak') {
        startReview('speak');
    } else if (action === 'pronounce' || mode === 'pronounce') {
        startReview('pronounce');
    } else if (action === 'quiz' || mode === 'quiz') {
        startReview('quiz');
    } else if (action === 'write' || mode === 'write') {
        startReview('write');
    } else {
        startReview('standard');
    }
}

function showMissionToast(title, desc, icon = '🎯') {
    const toast = document.getElementById('missionToast');
    if (!toast) return;
    const titleEl = document.getElementById('missionToastTitle');
    const descEl = document.getElementById('missionToastDesc');
    const iconEl = document.getElementById('missionToastIcon');
    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;
    if (iconEl) iconEl.textContent = icon;

    toast.classList.add('show');
    if (window._missionToastTimer) clearTimeout(window._missionToastTimer);
    window._missionToastTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

function updateMissionsCountdown() {
    const timerEl = document.getElementById('missionsTimerText');
    if (!timerEl) return;

    const now = new Date();
    if (currentMissionsTab === 'daily') {
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        const diffMs = midnight - now;
        const hours = Math.floor(diffMs / 3600000);
        const min = Math.floor((diffMs % 3600000) / 60000);
        timerEl.textContent = `⏳ Reinicia em: ${hours}h ${String(min).padStart(2, '0')}m`;
    } else {
        const d = new Date(now);
        const dayOfWeek = (d.getDay() + 6) % 7; // Seg:0 ... Dom:6
        const daysLeft = 6 - dayOfWeek;
        const sundayMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysLeft + 1, 0, 0, 0);
        const diffMs = sundayMidnight - now;
        const hours = Math.floor((diffMs % 86400000) / 3600000);
        const min = Math.floor((diffMs % 3600000) / 60000);
        timerEl.textContent = `⏳ Termina em: ${daysLeft}d ${hours}h ${String(min).padStart(2, '0')}m`;
    }
}

function renderMissionItemHTML(m, type, idx) {
    const pct = Math.min(100, Math.round(((m.current || 0) / m.target) * 100));
    const isCompleted = m.completed || (m.current >= m.target);
    const rewardXP = type === 'daily' ? 100 : 1000;
    const rewardFormatted = type === 'daily' ? '100' : '1.000';

    let itemClass = 'mission-item';
    if (m.claimed) itemClass += ' claimed';
    else if (isCompleted) itemClass += ' completed';

    let actionBtnHtml = '';
    if (m.claimed) {
        actionBtnHtml = `<span class="mission-claimed-tag">✓ Resgatado (+${rewardFormatted} XP)</span>`;
    } else if (isCompleted) {
        actionBtnHtml = `<button class="btn-mission-claim" onclick="claimMission('${type}', ${idx})">🎁 Resgatar +${rewardFormatted} XP</button>`;
    } else {
        const actionLabel = getMissionActionLabel(m.action, m.mode);
        actionBtnHtml = `<button class="btn-mission-action" onclick="executeMissionAction('${m.action}', '${m.mode || ''}')">${actionLabel}</button>`;
    }

    return `
        <div class="${itemClass}">
            <div class="mission-icon-box">
                <span>${m.icon}</span>
            </div>
            <div class="mission-content">
                <div class="mission-item-header">
                    <span class="mission-item-title">${escapeHTML(m.title)}</span>
                    <span class="mission-reward-badge">⚡ +${rewardFormatted} XP</span>
                </div>
                <div class="mission-item-desc">${escapeHTML(m.desc)}</div>
                <div class="mission-progress-container">
                    <div class="mission-progress-bar">
                        <div class="mission-progress-fill" style="width: ${pct}%"></div>
                    </div>
                    <span class="mission-progress-text">${m.current || 0}/${m.target}</span>
                </div>
            </div>
            <div class="mission-actions">
                ${actionBtnHtml}
            </div>
        </div>
    `;
}

function renderMissionsBoosterBanner() {
    const banner = document.getElementById('missionsBoosterBanner');
    if (!banner) return;

    const isActive = isXPBoostActive();
    const inv50 = (appData.inventory && appData.inventory.xpBoosters50) || 0;
    const inv100 = (appData.inventory && appData.inventory.xpBoosters100) || 0;

    if (!isActive && inv50 <= 0 && inv100 <= 0) {
        banner.style.display = 'none';
        banner.innerHTML = '';
        return;
    }

    banner.style.display = 'flex';
    if (isActive) {
        banner.className = 'xp-booster-banner active';
        const mult = appData.activeXPBoost.multiplier || 1.5;
        const pctLabel = mult >= 2.0 ? 'XP EM DOBRO (+100%)' : '+50% DE XP';
        const icon = mult >= 2.0 ? '⚡' : '🧪';
        const remMs = getXPBoostRemainingMs();
        const remHours = Math.floor(remMs / 3600000);
        const remMin = Math.floor((remMs % 3600000) / 60000);
        const remSec = Math.floor((remMs % 60000) / 1000);
        const timeStr = `${remHours}h ${String(remMin).padStart(2, '0')}m ${String(remSec).padStart(2, '0')}s`;

        let invBtns = '';
        if (inv50 > 0 || inv100 > 0) {
            invBtns = `<span style="font-size: 0.78rem; opacity: 0.85;">(Inventário: ${inv50 > 0 ? '🧪 ' + inv50 + 'x (+50%) ' : ''}${inv100 > 0 ? '⚡ ' + inv100 + 'x (+100%)' : ''})</span>`;
        }

        banner.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <span class="xp-boost-badge">${icon} ${pctLabel}</span>
                <span style="font-size: 0.88rem; font-weight: 700;">Restam: ${timeStr}</span>
                ${invBtns}
            </div>
            <div style="font-size: 0.78rem; opacity: 0.9;">Multiplicador aplicado automaticamente a revisões e SpeedRun!</div>
        `;
    } else {
        banner.className = 'xp-booster-banner ready';
        let buttons = [];
        if (inv50 > 0) {
            buttons.push(`<button type="button" class="btn-activate-boost" onclick="activateXPBooster('50')">🧪 Ativar +50% XP (${inv50} disponível${inv50 > 1 ? 's' : ''})</button>`);
        }
        if (inv100 > 0) {
            buttons.push(`<button type="button" class="btn-activate-boost boost-100" onclick="activateXPBooster('100')">⚡ Ativar +100% XP (${inv100} disponível${inv100 > 1 ? 's' : ''})</button>`);
        }
        banner.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <span style="font-size: 0.95rem; font-weight: 800;">🎒 Poções Disponíveis no Inventário:</span>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${buttons.join('')}
                </div>
            </div>
        `;
    }
}

function renderMissionsUI() {
    checkAndRollMissions();
    if (!appData.missions) return;

    renderMissionsBoosterBanner();

    const daily = appData.missions.daily || [];
    const weekly = appData.missions.weekly || [];

    const dailyCompleted = daily.filter(m => m.completed).length;
    const weeklyCompleted = weekly.filter(m => m.completed).length;

    const summaryEl = document.getElementById('missionsSummaryCount');
    if (summaryEl) {
        summaryEl.textContent = currentMissionsTab === 'daily'
            ? `${dailyCompleted}/3 Concluídas`
            : `${weeklyCompleted}/3 Concluídas`;
    }

    // Renderizar Lista Diária
    const dailyContainer = document.getElementById('dailyMissionsList');
    if (dailyContainer) {
        dailyContainer.innerHTML = daily.map((m, idx) => renderMissionItemHTML(m, 'daily', idx)).join('');
    }

    // Renderizar Baú Diário
    const dailyChest = document.getElementById('dailyChestCard');
    if (dailyChest) {
        const allClaimed = daily.every(m => m.completed && m.claimed);
        if (appData.missions.dailyAllClaimed) {
            dailyChest.className = 'mission-chest-card claimed';
            dailyChest.innerHTML = `
                <div class="mission-chest-info">
                    <span class="mission-chest-icon">🎁</span>
                    <div>
                        <div class="mission-chest-title">Baú Diário Coletado!</div>
                        <div class="mission-chest-desc">Você já garantiu sua Poção de XP +50% (24h) de hoje. Volte amanhã para novos desafios!</div>
                    </div>
                </div>
                <span class="mission-claimed-tag">✓ Resgatado</span>
            `;
        } else if (allClaimed) {
            dailyChest.className = 'mission-chest-card unlocked';
            dailyChest.innerHTML = `
                <div class="mission-chest-info">
                    <span class="mission-chest-icon">✨🎁</span>
                    <div>
                        <div class="mission-chest-title">Baú Diário Pronto!</div>
                        <div class="mission-chest-desc">Todas as missões diárias cumpridas! Abra para receber sua Poção de XP +50%!</div>
                    </div>
                </div>
                <button class="mission-chest-btn" onclick="claimMissionsChest('daily')">Abrir Baú (🧪 Poção +50% XP) 🚀</button>
            `;
        } else {
            dailyChest.className = 'mission-chest-card';
            dailyChest.innerHTML = `
                <div class="mission-chest-info">
                    <span class="mission-chest-icon">🔒🎁</span>
                    <div>
                        <div class="mission-chest-title">Baú Bônus Diário (Recompensa: 🧪 Poção +50% XP)</div>
                        <div class="mission-chest-desc">Complete e resgate as 3 missões do dia para abrir o baú dourado.</div>
                    </div>
                </div>
                <span style="font-size: 0.82rem; font-weight: 700; color: var(--text-muted);">${dailyCompleted}/3 Concluídas</span>
            `;
        }
    }

    // Renderizar Lista Semanal
    const weeklyContainer = document.getElementById('weeklyMissionsList');
    if (weeklyContainer) {
        weeklyContainer.innerHTML = weekly.map((m, idx) => renderMissionItemHTML(m, 'weekly', idx)).join('');
    }

    // Renderizar Baú Semanal
    const weeklyChest = document.getElementById('weeklyChestCard');
    if (weeklyChest) {
        const allClaimed = weekly.every(m => m.completed && m.claimed);
        if (appData.missions.weeklyAllClaimed) {
            weeklyChest.className = 'mission-chest-card claimed';
            weeklyChest.innerHTML = `
                <div class="mission-chest-info">
                    <span class="mission-chest-icon">🏆</span>
                    <div>
                        <div class="mission-chest-title">Baú Semanal Coletado!</div>
                        <div class="mission-chest-desc">Você conquistou sua Poção de XP +100% (24h) e 1 Gelo Protetor desta semana!</div>
                    </div>
                </div>
                <span class="mission-claimed-tag">✓ Resgatado</span>
            `;
        } else if (allClaimed) {
            weeklyChest.className = 'mission-chest-card unlocked';
            weeklyChest.innerHTML = `
                <div class="mission-chest-info">
                    <span class="mission-chest-icon">💎🎁</span>
                    <div>
                        <div class="mission-chest-title">Baú Semanal Pronto!</div>
                        <div class="mission-chest-desc">Desafios semanais de alto nível superados! Resgate seu prêmio lendário!</div>
                    </div>
                </div>
                <button class="mission-chest-btn" onclick="claimMissionsChest('weekly')">Abrir Baú (⚡ Poção +100% XP + 🧊 1 Gelo) 🚀</button>
            `;
        } else {
            weeklyChest.className = 'mission-chest-card';
            weeklyChest.innerHTML = `
                <div class="mission-chest-info">
                    <span class="mission-chest-icon">🔒💎</span>
                    <div>
                        <div class="mission-chest-title">Baú Lendário Semanal (Recompensa: ⚡ Poção +100% XP + 🧊 1 Gelo)</div>
                        <div class="mission-chest-desc">Complete as 3 missões desafiadoras da semana para abrir o baú supremo.</div>
                    </div>
                </div>
                <span style="font-size: 0.82rem; font-weight: 700; color: var(--text-muted);">${weeklyCompleted}/3 Concluídas</span>
            `;
        }
    }

    updateMissionsCountdown();
}

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
        trophies: { iron: 0, bronze: 0, silver: 0, gold: 0 },
        streakMilestoneProgress: 0,
        streakBonusXP: 0,
        lastMilestoneGoalDate: null,
        lastDailyGoalCelebratedDate: null,
        badges: {}, // { [badgeId]: { count: 0, lastEarned: 0, lastEarnedDate: '' } }
        badgeBonusXP: 0,
        archivedPhraseXP: 0, // Preserva permanentemente o XP de frases/listas arquivadas ou excluídas
        dictLookupsCount: 0,
        dictLookupsToday: 0,
        lastDictLookupDate: null,
        league: null, // Inicializado dinamicamente por initLeagueData()
        missions: null,
        inventory: {
            xpBoosters50: 0,
            xpBoosters100: 0
        },
        activeXPBoost: {
            multiplier: 1.0,
            type: null,
            expiresAt: null
        },
        phoneticCache: {},
        settings: {
            expandContractions: true,
            slowAudio: false,
            autoAdvanceSpeech: false,
            darkMode: false,
            notifications: true,
            dailyGoal: 50,
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
    if (!data.trophies) {
        data.trophies = { iron: 0, bronze: 0, silver: 0, gold: 0 };
        modified = true;
    } else {
        ['iron', 'bronze', 'silver', 'gold'].forEach(k => {
            if (data.trophies[k] === undefined) {
                data.trophies[k] = 0;
                modified = true;
            }
        });
    }
    if (data.streakMilestoneProgress === undefined) {
        data.streakMilestoneProgress = 0;
        modified = true;
    }
    if (data.streakBonusXP === undefined) {
        data.streakBonusXP = 0;
        modified = true;
    }
    if (data.lastMilestoneGoalDate === undefined) {
        data.lastMilestoneGoalDate = null;
        modified = true;
    }
    if (data.lastDailyGoalCelebratedDate === undefined) {
        data.lastDailyGoalCelebratedDate = null;
        modified = true;
    }
    if (!data.badges) {
        data.badges = {};
        modified = true;
    }
    if (data.badgeBonusXP === undefined) {
        data.badgeBonusXP = 0;
        modified = true;
    }
    if (data.archivedPhraseXP === undefined) {
        data.archivedPhraseXP = 0;
        modified = true;
    }
    if (data.dictLookupsCount === undefined) {
        data.dictLookupsCount = 0;
        modified = true;
    }
    if (data.dictLookupsToday === undefined) {
        data.dictLookupsToday = 0;
        modified = true;
    }
    if (data.lastDictLookupDate === undefined) {
        data.lastDictLookupDate = null;
        modified = true;
    }
    if (!data.league) {
        data.league = initLeagueData('bronze');
        modified = true;
    } else if (data.league && Array.isArray(data.league.bots)) {
        const emojiFixes = {
            '🧑‍🎓': '🎓',
            '👩‍💻': '💻',
            '👩‍🔬': '🔬',
            '👨‍🎓': '🎓',
            '👨‍💻': '💻',
            '👨‍🔬': '🔬'
        };
        data.league.bots.forEach(bot => {
            if (emojiFixes[bot.avatar]) {
                bot.avatar = emojiFixes[bot.avatar];
                modified = true;
            }
        });
        if (data.league.botDifficulty == null) {
            data.league.botDifficulty = 1.0;
            modified = true;
        }

        // Garante que não haja competidores com nomes duplicados ou iguais ao usuário
        const seenNames = new Set();
        if (data.auth?.username) seenNames.add(data.auth.username.trim().toLowerCase());
        const pool = BOT_PERSONAS.filter(p => !seenNames.has(p.name.toLowerCase()));
        data.league.bots.forEach(bot => {
            const botKey = (bot.name || '').trim().toLowerCase();
            if (seenNames.has(botKey) || !bot.name) {
                const replacement = pool.pop();
                if (replacement) {
                    bot.name = replacement.name;
                    bot.avatar = replacement.avatar;
                    modified = true;
                }
            }
            if (bot.name) seenNames.add(bot.name.trim().toLowerCase());
        });
    }
    if (data.lastCelebratedLevel === undefined) {
        const totalXP = calculateTotalProgress(data);
        const baseL = (1 + Math.sqrt(1 + 4 * totalXP / 25)) / 2;
        data.lastCelebratedLevel = Math.max(1, Math.floor(baseL));
        modified = true;
    }
    if (data.settings) {
        if (data.settings.dailyGoal === undefined || data.settings.dailyGoal === 20) {
            data.settings.dailyGoal = 50;
            modified = true;
        }
    }
    if (!data.missions) {
        data.missions = initMissionsData();
        modified = true;
    }
    if (!data.inventory) {
        data.inventory = { xpBoosters50: 0, xpBoosters100: 0 };
        modified = true;
    }
    if (data.inventory.xpBoosters50 === undefined) {
        data.inventory.xpBoosters50 = 0;
        modified = true;
    }
    if (data.inventory.xpBoosters100 === undefined) {
        data.inventory.xpBoosters100 = 0;
        modified = true;
    }
    if (!data.activeXPBoost) {
        data.activeXPBoost = { multiplier: 1.0, type: null, expiresAt: null };
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
    if (modified) saveData(data, { touch: false });
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

let debouncedCloudSyncTimer = null;

function scheduleDebouncedCloudSync(delayMs = 4000) {
    if (debouncedCloudSyncTimer) {
        clearTimeout(debouncedCloudSyncTimer);
    }
    debouncedCloudSyncTimer = setTimeout(() => {
        debouncedCloudSyncTimer = null;
        if (appData.auth && appData.auth.isLoggedIn && navigator.onLine) {
            syncWithCloud(false);
        }
    }, delayMs);
}

// Quando a página for fechada ou ocultada, envia sincronização pendente imediatamente
window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && debouncedCloudSyncTimer) {
        clearTimeout(debouncedCloudSyncTimer);
        debouncedCloudSyncTimer = null;
        if (appData.auth && appData.auth.isLoggedIn && navigator.onLine) {
            syncWithCloud(false);
        }
    }
});

function saveData(data, options = {}) {
    // touch=false: salvamento de fundo (caches de fonética/tradução/definição, migrações).
    // Não altera a data de modificação (lastUpdated) nem dispara envio para a nuvem,
    // para que a data represente apenas alterações reais feitas pelo usuário.
    const touch = options.touch !== false;
    if (touch) data.lastUpdated = Date.now();

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('Erro ao salvar no localStorage (possível limite de cota atingido):', e);
        // Em caso de limite de cota do navegador (5MB), limpa caches secundários e tenta novamente
        try {
            if (data.definitionCache && Object.keys(data.definitionCache).length > 200) {
                data.definitionCache = {};
            }
            if (data.translationCache && Object.keys(data.translationCache).length > 200) {
                data.translationCache = {};
            }
            if (data.history && data.history.length > 5000) {
                data.history = data.history.slice(-3000);
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (retryErr) {
            console.error('Falha crítica ao persistir dados após descarte de cache:', retryErr);
        }
    }

    // Trigger debounced background sync if possible
    if (touch && data.auth && data.auth.isLoggedIn && navigator.onLine) {
        if (options.immediateSync) {
            if (debouncedCloudSyncTimer) {
                clearTimeout(debouncedCloudSyncTimer);
                debouncedCloudSyncTimer = null;
            }
            syncWithCloud(false);
        } else {
            scheduleDebouncedCloudSync(4000);
        }
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

        if (typeof updateMissionsCountdown === 'function') {
            updateMissionsCountdown();
        }
        if (typeof renderMissionsBoosterBanner === 'function' && typeof isXPBoostActive === 'function' && isXPBoostActive()) {
            renderMissionsBoosterBanner();
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
    trainingMode: 'standard', // 'standard', 'quiz', 'write', 'listen', 'pronounce', 'speak'
    correctStreak: 0,
    speakCorrect: 0,
    writeCorrect: 0
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
        saveData(appData, { touch: false });
        // If user is currently studying, refresh UI implicitly by next word rendering.
    }
}


// ==================== XP & PROGRESS CALCULATIONS ====================

function getPhraseWordCount(english) {
    if (!english) return 1;
    const clean = english.trim().replace(/[.,!?;:"]/g, '');
    const tokens = clean.split(/\s+/).filter(w => w.length > 0);
    return Math.max(1, tokens.length);
}

function calculatePhraseXP(p) {
    if (!p || !p.levels) return 0;
    const wordsCount = getPhraseWordCount(p.english);
    // Multiplicador pelo tamanho da frase: +10% por palavra adicional acima de 1 (máx 2.5x)
    const wordMultiplier = 1 + Math.min(1.5, (wordsCount - 1) * 0.10);

    // Configuração dos tipos de testes: pesos base e multiplicadores por nível
    const modes = [
        { key: 'quiz', base: 5, mult: 1 },
        { key: 'write', base: 10, mult: 2 },
        { key: 'listen', base: 12, mult: 2.5 },
        { key: 'pronounce', base: 15, mult: 3 },
        { key: 'speak', base: 20, mult: 4 }
    ];

    let phraseXP = 0;
    for (const m of modes) {
        const lvl = p.levels[m.key] || 0;
        if (lvl > 0) {
            // Fórmula base: Base*L + Mult*(L*(L+1)/2)
            let modeXP = (m.base * lvl) + (m.mult * (lvl * (lvl + 1) / 2));

            // Bônus de Palavra Nova no nível 1: +25% de bônus por transformar uma palavra/frase nova em aprendida
            const newWordBonus = Math.round(m.base * 0.25);
            modeXP += newWordBonus;

            phraseXP += Math.round(modeXP * wordMultiplier);
        }
    }
    return phraseXP;
}

// ==================== SYNC LAYER ====================

function calculateTotalProgress(data) {
    if (!data || !data.lists) return 0;
    let totalXP = (data.speedRunXP || 0) + (data.streakBonusXP || 0) + (data.badgeBonusXP || 0) + (data.archivedPhraseXP || 0) + ((data.missions && data.missions.bonusXP) || 0);
    data.lists.forEach(l => {
        (l.phrases || []).forEach(p => {
            totalXP += calculatePhraseXP(p);
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
    const xp = calculateTotalProgress(data);
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
    merged.streakBonusXP = Math.max(remote.streakBonusXP || 0, local.streakBonusXP || 0);
    merged.badgeBonusXP = Math.max(remote.badgeBonusXP || 0, local.badgeBonusXP || 0);
    merged.archivedPhraseXP = Math.max(remote.archivedPhraseXP || 0, local.archivedPhraseXP || 0);
    merged.dictLookupsCount = Math.max(remote.dictLookupsCount || 0, local.dictLookupsCount || 0);
    merged.dictLookupsToday = (remote.lastDictLookupDate === local.lastDictLookupDate)
        ? Math.max(remote.dictLookupsToday || 0, local.dictLookupsToday || 0)
        : (local.dictLookupsToday || 0);
    merged.lastDictLookupDate = remote.lastDictLookupDate || local.lastDictLookupDate || null;
    merged.streakMilestoneProgress = Math.max(remote.streakMilestoneProgress || 0, local.streakMilestoneProgress || 0);
    merged.trophies = {
        iron: Math.max((remote.trophies && remote.trophies.iron) || 0, (local.trophies && local.trophies.iron) || 0),
        bronze: Math.max((remote.trophies && remote.trophies.bronze) || 0, (local.trophies && local.trophies.bronze) || 0),
        silver: Math.max((remote.trophies && remote.trophies.silver) || 0, (local.trophies && local.trophies.silver) || 0),
        gold: Math.max((remote.trophies && remote.trophies.gold) || 0, (local.trophies && local.trophies.gold) || 0)
    };
    merged.lastDailyGoalCelebratedDate = remote.lastDailyGoalCelebratedDate || local.lastDailyGoalCelebratedDate || null;
    merged.lastMilestoneGoalDate = remote.lastMilestoneGoalDate || local.lastMilestoneGoalDate || null;
    merged.lastStreakFreezeRewardDate = remote.lastStreakFreezeRewardDate || local.lastStreakFreezeRewardDate || null;

    // Mesclagem de badges preservando o maior nível / contagem
    merged.badges = { ...(local.badges || {}) };
    if (remote.badges) {
        for (const k in remote.badges) {
            const locCount = (merged.badges[k] && merged.badges[k].count) || 0;
            const remCount = (remote.badges[k] && remote.badges[k].count) || 0;
            if (!merged.badges[k] || remCount > locCount) {
                merged.badges[k] = remote.badges[k];
            }
        }
    }

    // Mesclagem de liga semanal
    merged.league = local.league || remote.league;
    if (remote.league && local.league && remote.league.weekId === local.league.weekId) {
        merged.league.userXP = Math.max(remote.league.userXP || 0, local.league.userXP || 0);
    }

    // Mesclagem de histórico de revisões sem duplicatas
    const historyMap = new Map();
    (remote.history || []).forEach(h => { if (h && h.date) historyMap.set(h.date, h); });
    (local.history || []).forEach(h => { if (h && h.date && !historyMap.has(h.date)) historyMap.set(h.date, h); });
    merged.history = Array.from(historyMap.values()).sort((a, b) => a.date - b.date);

    // Mescla caches auxiliares
    merged.phoneticCache = { ...(remote.phoneticCache || {}), ...(local.phoneticCache || {}) };
    merged.translationCache = { ...(remote.translationCache || {}), ...(local.translationCache || {}) };
    merged.definitionCache = { ...(remote.definitionCache || {}), ...(local.definitionCache || {}) };

    // Mescla inventário de poções de XP
    merged.inventory = {
        xpBoosters50: Math.max((remote.inventory && remote.inventory.xpBoosters50) || 0, (local.inventory && local.inventory.xpBoosters50) || 0),
        xpBoosters100: Math.max((remote.inventory && remote.inventory.xpBoosters100) || 0, (local.inventory && local.inventory.xpBoosters100) || 0)
    };

    // Mescla poção ativa (preserva a que tiver maior tempo restante válido)
    const localActive = (local.activeXPBoost && local.activeXPBoost.expiresAt && local.activeXPBoost.expiresAt > Date.now()) ? local.activeXPBoost : null;
    const remoteActive = (remote.activeXPBoost && remote.activeXPBoost.expiresAt && remote.activeXPBoost.expiresAt > Date.now()) ? remote.activeXPBoost : null;
    if (localActive && remoteActive) {
        merged.activeXPBoost = (localActive.expiresAt >= remoteActive.expiresAt) ? localActive : remoteActive;
    } else {
        merged.activeXPBoost = localActive || remoteActive || { multiplier: 1.0, type: null, expiresAt: null };
    }

    // Mescla missões diárias e semanais
    if (remote.missions && local.missions) {
        merged.missions = (remote.missions.dailyDate === local.missions.dailyDate)
            ? (((remote.missions.bonusXP || 0) >= (local.missions.bonusXP || 0)) ? remote.missions : local.missions)
            : (local.missions || remote.missions);
        merged.missions.bonusXP = Math.max(remote.missions.bonusXP || 0, local.missions.bonusXP || 0);
    } else {
        merged.missions = local.missions || remote.missions || initMissionsData();
    }

    merged.lastUpdated = Math.max(remote.lastUpdated || 0, local.lastUpdated || 0, Date.now());
    return merged;
}

function refreshMainUI() {
    renderSyncStatus();
    renderStats();
    renderLists();
    if (appData.currentListId) renderPhrases();
    renderMetrics();
    renderLeagueCardHome();
    if (typeof renderLeague === 'function') renderLeague();
    if (typeof renderFluencyPyramid === 'function') renderFluencyPyramid();
    if (typeof renderBadgesUI === 'function') renderBadgesUI();
    if (typeof renderMissionsUI === 'function') renderMissionsUI();
}

let isSyncInProgress = false;
// Indica se, nesta sessão, já comparamos a data dos dados locais com a da nuvem.
// Enquanto for false, nenhum envio automático pode sobrescrever a nuvem sem antes checar a data.
let cloudCheckedThisSession = false;
const CLOUD_BACKUP_KEY = 'memoenglish_backup_before_cloud_load';

function getDataTimestamp(data) {
    const t = Number(data && data.lastUpdated);
    return Number.isFinite(t) && t > 0 ? t : 0;
}

function countPhrasesInData(data) {
    return ((data && data.lists) || []).reduce((acc, l) => acc + (l.phrases ? l.phrases.length : 0), 0);
}

// Compara a data da última modificação (lastUpdated) dos dados locais com a da nuvem.
// Retorna: 'cloud' (nuvem mais recente -> carregar), 'local' (local mais recente -> enviar) ou 'equal'.
function compareCloudFreshness(local, remote) {
    const localPhrases = countPhrasesInData(local);
    const remotePhrases = countPhrasesInData(remote);

    // Proteção: dispositivo sem frases nunca sobrescreve uma nuvem que tem frases
    if (localPhrases === 0 && remotePhrases > 0) return 'cloud';
    if (remotePhrases === 0 && localPhrases > 0) return 'local';

    const localTime = getDataTimestamp(local);
    const remoteTime = getDataTimestamp(remote);

    if (localTime && remoteTime) {
        if (remoteTime > localTime) return 'cloud';
        if (localTime > remoteTime) return 'local';
        return 'equal';
    }

    // Sem data em um dos lados (dados antigos): usa o progresso como critério de desempate
    const cloudScore = calculateDataScore(remote);
    const localScore = calculateDataScore(local);
    if (cloudScore > localScore) return 'cloud';
    if (localScore > cloudScore) return 'local';
    return 'equal';
}

// Substitui os dados locais pelos da nuvem (mantendo login e configurações de sync deste aparelho).
// Mantém a data da nuvem como data local e guarda um backup dos dados locais antes de sobrescrever.
function adoptCloudData(remotePayload) {
    try {
        localStorage.setItem(CLOUD_BACKUP_KEY, JSON.stringify(appData));
    } catch (e) {
        console.warn('Não foi possível criar o backup local antes de carregar a nuvem:', e);
    }

    const def = getDefaultData();
    const savedAuth = { ...appData.auth, lastSync: Date.now() };
    const savedSyncSettings = appData.syncSettings;

    const next = { ...def, ...remotePayload };
    next.settings = { ...def.settings, ...(remotePayload.settings || {}) };
    next.auth = savedAuth;
    next.syncSettings = savedSyncSettings;
    next.lastUpdated = getDataTimestamp(remotePayload);

    appData = migrateData(next);
    saveData(appData, { touch: false });
    applyDarkMode();
    refreshMainUI();
}

async function pushLocalToCloud() {
    const res = await callGas({
        action: 'save',
        username: appData.auth.username,
        password: appData.auth.password,
        payload: appData
    });
    if (res && res.success) {
        appData.auth.lastSync = Date.now();
        saveData(appData, { touch: false });
        return true;
    }
    return false;
}

// Baixa os dados da nuvem e decide pela DATA o que fazer: carregar (nuvem mais nova),
// enviar (local mais novo) ou nada (iguais).
async function reconcileWithCloud(isManual, loadingStatus) {
    const remoteData = await callGas({
        action: 'load',
        username: appData.auth.username,
        password: appData.auth.password
    });

    if (!remoteData || !remoteData.success) {
        if (isManual) alert("Não foi possível acessar a nuvem agora. Tente novamente mais tarde.");
        return false;
    }

    const remotePayload = parseRemotePayload(remoteData.payload);

    if (!remotePayload || !remotePayload.lists || remotePayload.lists.length === 0) {
        // Nuvem ainda vazia: envia dados locais (se houver algo para enviar)
        cloudCheckedThisSession = true;
        if (countPhrasesInData(appData) > 0 || (appData.history && appData.history.length > 0)) {
            const ok = await pushLocalToCloud();
            if (ok && isManual) alert("Dados enviados para a nuvem com sucesso!");
        }
        return true;
    }

    const verdict = compareCloudFreshness(appData, remotePayload);
    cloudCheckedThisSession = true;

    if (verdict === 'cloud') {
        if (loadingStatus) loadingStatus.textContent = "Baixando dados mais recentes da nuvem...";
        adoptCloudData(remotePayload);
        if (isManual) alert("Os dados da nuvem eram mais recentes e foram carregados com sucesso!");
    } else if (verdict === 'local') {
        if (loadingStatus) loadingStatus.textContent = "Enviando dados mais recentes para a nuvem...";
        const ok = await pushLocalToCloud();
        if (ok && isManual) alert("Seus dados locais eram mais recentes e foram enviados para a nuvem!");
    } else {
        appData.auth.lastSync = Date.now();
        saveData(appData, { touch: false });
        if (isManual) alert("Seus dados já estão sincronizados!");
    }
    return true;
}

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
            // MODO PULL-ONLY: Carrega da nuvem somente se ela for mais recente (pela data)
            const remoteData = await callGas({
                action: 'load',
                username: appData.auth.username,
                password: appData.auth.password
            });

            if (remoteData && remoteData.success) {
                const remotePayload = parseRemotePayload(remoteData.payload);
                if (remotePayload && remotePayload.lists && remotePayload.lists.length > 0) {
                    if (compareCloudFreshness(appData, remotePayload) === 'cloud') {
                        if (isInitialSync && loadingStatus) loadingStatus.textContent = "Baixando dados da nuvem...";
                        adoptCloudData(remotePayload);
                    } else {
                        appData.auth.lastSync = Date.now();
                        saveData(appData, { touch: false });
                    }
                    cloudCheckedThisSession = true;
                } else {
                    appData.auth.lastSync = Date.now();
                    saveData(appData, { touch: false });
                }
            }
            if (isInitialSync && loadingStatus) loadingStatus.textContent = "Sincronização concluída!";
        } else if (isInitialSync || isManual || !cloudCheckedThisSession) {
            // Ao abrir o app, em sincronização manual ou antes do primeiro envio da sessão:
            // compara as datas e decide se carrega da nuvem ou envia para ela.
            await reconcileWithCloud(isManual, isInitialSync ? loadingStatus : null);
            if (isInitialSync && loadingStatus) loadingStatus.textContent = "Sincronização concluída!";
        } else {
            // MODO SEGURO: a data já foi conferida nesta sessão; apenas envia as alterações locais
            if (countPhrasesInData(appData) > 0 || (appData.history && appData.history.length > 0)) {
                await pushLocalToCloud();
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
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

        const res = await fetch(GAS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8'
            },
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

                    // Decide pela DATA: nuvem mais recente -> carrega da nuvem; local mais recente -> mantém o local
                    const verdict = compareCloudFreshness(appData, remotePayload);
                    if (verdict === 'cloud') {
                        try {
                            localStorage.setItem(CLOUD_BACKUP_KEY, JSON.stringify(appData));
                        } catch (e) { }
                        const def = getDefaultData();
                        const localSyncSettings = appData.syncSettings;
                        appData = { ...def, ...remotePayload };
                        appData.settings = { ...def.settings, ...(remotePayload.settings || {}) };
                        appData.syncSettings = localSyncSettings || def.syncSettings;
                        appData.lastUpdated = getDataTimestamp(remotePayload);
                    }
                } else if (remotePayload) {
                    appData = { ...remotePayload, ...(appData.lists?.length ? { lists: appData.lists } : {}) };
                }

                appData.auth = authInfo;
                appData = migrateData(appData);
                saveData(appData, { touch: false });
                cloudCheckedThisSession = true;
                refreshMainUI();

                // Atualiza a nuvem somente se os dados locais forem os mais recentes (ou a nuvem estiver vazia)
                if (!remotePayload || !remotePayload.lists || remotePayload.lists.length === 0 || compareCloudFreshness(appData, remotePayload) === 'local') {
                    await callGas({
                        action: 'save',
                        username: user,
                        password: pass,
                        payload: appData
                    });
                }

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

    if (appData.auth && appData.auth.isLoggedIn) {
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
    if ($(viewId)) $(viewId).style.display = 'block';

    // BUG FIX: Hide feedback bar when switching views
    if ($('feedbackBar')) $('feedbackBar').classList.remove('active');

    // Update Sidebar links
    document.querySelectorAll('.nav-link').forEach(l => {
        l.classList.toggle('active', l.dataset.view === viewId);
    });

    // Update Bottom Nav
    document.querySelectorAll('.mobile-nav-item').forEach(l => {
        l.classList.toggle('active', l.dataset.view === viewId);
    });

    if (viewId === 'listsView') renderLists();
    if (viewId === 'homeView') {
        renderStats();
        renderLeagueCardHome();
        if (typeof renderMissionsUI === 'function') renderMissionsUI();
    }
    if (viewId === 'metricsView') {
        renderMetrics();
        renderFluencyPyramid();
        renderBadgesUI();
    }
    if (viewId === 'leagueView') {
        updateBotScoresOnAppEntry(true);
        renderLeague();
    }
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
    if ($('settingsAppVersionDisplay')) {
        $('settingsAppVersionDisplay').innerHTML = `MemoEnglish Premium v${APP_VERSION}<br>© 2026 Todos os direitos reservados.`;
    }
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

function getTodayReviewsCount(history) {
    if (!history || history.length === 0) return 0;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTimestamp = startOfDay.getTime();
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        const item = history[i];
        if (!item || !item.date) continue;
        if (item.date >= startTimestamp) {
            count++;
        } else {
            break;
        }
    }
    return count;
}

function updateUI() {
    renderStats();
    renderLists();
    updateTroublesomeCount();
    updateGlobalLevel();
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

    if ($('statWords')) $('statWords').textContent = studiedWordsSet.size;
    if ($('statMemorized')) $('statMemorized').textContent = memorizedCount;

    // Daily Goal & Gamification
    const today = new Date().toDateString();
    const reviewsToday = getTodayReviewsCount(appData.history);
    const goal = (appData.settings && appData.settings.dailyGoal) ? parseInt(appData.settings.dailyGoal) : 50;
    const pct = Math.min(Math.round((reviewsToday / goal) * 100), 100);

    if ($('goalPct')) $('goalPct').textContent = pct + '%';
    if ($('goalCircle')) $('goalCircle').style.strokeDasharray = `${pct}, 100`;
    if ($('goalTargetText')) $('goalTargetText').textContent = goal;
    if ($('settingDailyGoal')) $('settingDailyGoal').value = goal.toString();

    // Streak Freeze display
    const freezes = appData.streakFreezes !== undefined ? appData.streakFreezes : 1;
    if ($('freezeCountSpan')) $('freezeCountSpan').textContent = freezes;
    if ($('freezeCountSpanSettings')) $('freezeCountSpanSettings').textContent = freezes;

    // Reset diário da contagem de consultas de dicionário se o dia virou
    if (appData.lastDictLookupDate !== today) {
        appData.lastDictLookupDate = today;
        appData.dictLookupsToday = 0;
    }

    // Daily Goal Reward: bater a meta concede 1 Streak Freeze (máx 2)
    if (reviewsToday >= goal) {
        if (appData.lastStreakFreezeRewardDate !== today && freezes < 2) {
            appData.streakFreezes = freezes + 1;
            appData.lastStreakFreezeRewardDate = today;
            saveData(appData);
            if ($('freezeCountSpan')) $('freezeCountSpan').textContent = appData.streakFreezes;
            if ($('freezeCountSpanSettings')) $('freezeCountSpanSettings').textContent = appData.streakFreezes;
            checkAndAwardBadge('streak_protector');
        } else if (freezes >= 2) {
            // Estoque de gelo já no máximo de 2: protegeu a sequência com escudo intacto e ganha/renova o badge!
            checkAndAwardBadge('streak_protector');
        }
    }

    // Marcos de Sequência & Troféus (Bronze, Prata, Ouro)
    checkStreakMilestones(reviewsToday, goal, today);
    renderTrophiesUI();

    // Resumo da Liga Semanal na Home
    renderLeagueCardHome();
    if (typeof renderMissionsUI === 'function') renderMissionsUI();

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
    appData.settings.dailyGoal = parseInt(val) || 50;
    saveData(appData);
    updateUI();
}

// ==================== MARCOS DE SEQUÊNCIA & TROFÉUS ====================

function checkStreakMilestones(reviewsToday, goal, today) {
    if (!appData.trophies) {
        appData.trophies = { iron: 0, bronze: 0, silver: 0, gold: 0 };
    }
    if (appData.trophies.iron === undefined) appData.trophies.iron = 0;
    if (appData.streakMilestoneProgress === undefined) {
        appData.streakMilestoneProgress = 0;
    }
    if (appData.streakBonusXP === undefined) {
        appData.streakBonusXP = 0;
    }

    // O marco só conta se conquistar a meta diária
    if (reviewsToday < goal) return;

    // Se já foi registrado o marco para a meta de hoje, não incrementa novamente hoje
    if (appData.lastMilestoneGoalDate === today) return;

    appData.lastMilestoneGoalDate = today;
    appData.streakMilestoneProgress = (appData.streakMilestoneProgress || 0) + 1;

    // Bônus diário percentual permanente por troféus acumulados na estante:
    // 🛡️ Ferro: +0,2% (0.002) | 🥉 Bronze: +0,3% (0.003) | 🥈 Prata: +0,5% (0.005) | 🥇 Ouro: +1,0% (0.01)
    const ironCount = appData.trophies.iron || 0;
    const bronzeCount = appData.trophies.bronze || 0;
    const silverCount = appData.trophies.silver || 0;
    const goldCount = appData.trophies.gold || 0;

    const totalPct = (ironCount * 0.002) + (bronzeCount * 0.003) + (silverCount * 0.005) + (goldCount * 0.01);
    if (totalPct > 0) {
        const currentXP = calculateTotalProgress(appData);
        // Base de cálculo sobre o progresso real de estudo (evita juros compostos exponenciais)
        const baseXP = Math.max(100, currentXP - (appData.streakBonusXP || 0));
        const minBonus = ironCount + bronzeCount + silverCount + goldCount;
        let dailyBooster = Math.round(baseXP * totalPct);
        if (dailyBooster < minBonus) dailyBooster = minBonus;
        const maxDailyCap = 150 + (goldCount * 50);
        dailyBooster = Math.min(dailyBooster, maxDailyCap);
        appData.streakBonusXP += dailyBooster;
    }

    const progress = appData.streakMilestoneProgress;
    let earnedTrophy = null;
    let milestoneXP = 0;

    // Ciclo de marcos em sequência com meta batida:
    // 1. Ferro: 3 dias
    // 2. Bronze: 7 dias
    // 3. Prata: 14 dias
    // 4. Ouro: 30 dias (completa o ciclo e recomeça a partir do Ferro)
    if (progress === 3) {
        earnedTrophy = 'iron';
        appData.trophies.iron = (appData.trophies.iron || 0) + 1;
        // Bônus: 15 XP base + 3 XP por troféu de ferro acumulado
        milestoneXP = 15 + (3 * (appData.trophies.iron - 1));
        appData.streakBonusXP += milestoneXP;
    } else if (progress === 7) {
        earnedTrophy = 'bronze';
        appData.trophies.bronze = (appData.trophies.bronze || 0) + 1;
        // Bônus: 30 XP base + 5 XP por troféu de bronze acumulado
        milestoneXP = 30 + (5 * (appData.trophies.bronze - 1));
        appData.streakBonusXP += milestoneXP;
    } else if (progress === 14) {
        earnedTrophy = 'silver';
        appData.trophies.silver = (appData.trophies.silver || 0) + 1;
        // Bônus: 60 XP base + 10 XP por troféu de prata acumulado
        milestoneXP = 60 + (10 * (appData.trophies.silver - 1));
        appData.streakBonusXP += milestoneXP;
    } else if (progress >= 30) {
        earnedTrophy = 'gold';
        appData.trophies.gold = (appData.trophies.gold || 0) + 1;
        // Bônus: 120 XP base + 20 XP por troféu de ouro acumulado
        milestoneXP = 120 + (20 * (appData.trophies.gold - 1));
        appData.streakBonusXP += milestoneXP;
        // Ao ganhar o troféu de ouro, recomeça o caminho a partir do de ferro!
        appData.streakMilestoneProgress = 0;
    }

    saveData(appData);

    // 1. Exibe a janela de celebração do Troféu conquistado em primeiro lugar
    if (earnedTrophy) {
        showTrophyCelebrationModal(earnedTrophy, milestoneXP);
    }

    // 2. Credita o XP na liga semanal (se houver ultrapassagem, a celebração é enfileirada)
    if (milestoneXP > 0) {
        addLeagueXP(milestoneXP);
    }

    // 3. Atualiza o nível global (se houver subida de nível, o Level Up é enfileirado)
    updateGlobalLevel();
}

function renderTrophiesUI() {
    if (!appData.trophies) {
        appData.trophies = { iron: 0, bronze: 0, silver: 0, gold: 0 };
    }
    if (appData.trophies.iron === undefined) appData.trophies.iron = 0;
    const i = appData.trophies.iron || 0;
    const b = appData.trophies.bronze || 0;
    const s = appData.trophies.silver || 0;
    const g = appData.trophies.gold || 0;
    const progress = appData.streakMilestoneProgress || 0;

    // Atualiza contadores na Home
    if ($('trophyIronCount')) $('trophyIronCount').textContent = i;
    if ($('trophyBronzeCount')) $('trophyBronzeCount').textContent = b;
    if ($('trophySilverCount')) $('trophySilverCount').textContent = s;
    if ($('trophyGoldCount')) $('trophyGoldCount').textContent = g;

    // Determina o próximo troféu do ciclo
    let nextTitle = "Próximo: 🛡️ Troféu de Ferro";
    let targetDays = 3;
    let barColor = "linear-gradient(90deg, #64748b, #475569)";

    if (progress < 3) {
        nextTitle = "Próximo: 🛡️ Troféu de Ferro";
        targetDays = 3;
        barColor = "linear-gradient(90deg, #64748b, #475569)";
    } else if (progress < 7) {
        nextTitle = "Próximo: 🥉 Troféu de Bronze";
        targetDays = 7;
        barColor = "linear-gradient(90deg, #d97706, #b45309)";
    } else if (progress < 14) {
        nextTitle = "Próximo: 🥈 Troféu de Prata";
        targetDays = 14;
        barColor = "linear-gradient(90deg, #94a3b8, #64748b)";
    } else {
        nextTitle = "Próximo: 🥇 Troféu de Ouro";
        targetDays = 30;
        barColor = "linear-gradient(90deg, #f59e0b, #eab308)";
    }

    const pct = Math.min(Math.round((progress / targetDays) * 100), 100);

    if ($('nextTrophyTitle')) {
        const shortNext = nextTitle.replace("Próximo: ", "").replace("Troféu de ", "");
        $('nextTrophyTitle').innerHTML = `<span class="desktop-text">${nextTitle}</span><span class="mobile-text">Próximo: ${shortNext}</span>`;
    }
    if ($('nextTrophyProgressText')) $('nextTrophyProgressText').textContent = `${progress}/${targetDays} dias`;
    if ($('nextTrophyProgressBar')) {
        $('nextTrophyProgressBar').style.width = `${pct}%`;
        $('nextTrophyProgressBar').style.background = barColor;
    }

    // Status da meta diária hoje
    const today = new Date().toDateString();
    const reviewsToday = getTodayReviewsCount(appData.history);
    const goal = (appData.settings && appData.settings.dailyGoal) ? parseInt(appData.settings.dailyGoal) : 50;

    if ($('trophyGoalHint')) {
        if (reviewsToday >= goal) {
            $('trophyGoalHint').innerHTML = "✅ <span style='color: var(--success); font-weight: 700;'><span class=\"desktop-text\">Meta diária de hoje conquistada! (+1 dia na sequência)</span><span class=\"mobile-text\">Meta de hoje batida! 🎯</span></span>";
        } else {
            const remaining = goal - reviewsToday;
            $('trophyGoalHint').innerHTML = `<span class="desktop-text">Faltam ${remaining} frase${remaining > 1 ? 's' : ''} hoje para validar o dia (${reviewsToday}/${goal}).</span><span class="mobile-text">🎯 ${reviewsToday}/${goal} hoje (-${remaining})</span>`;
        }
    }

    const totalPctNum = (i * 0.2) + (b * 0.3) + (s * 0.5) + (g * 1.0);
    const totalPctFormatted = (Math.round(totalPctNum * 10) / 10).toFixed(1).replace(/\.0$/, '');

    if ($('trophyBonusActiveText')) {
        if (totalPctNum > 0) {
            const currentXP = calculateTotalProgress(appData);
            const minBonus = i + b + s + g;
            let estBonus = Math.round(currentXP * (totalPctNum / 100));
            if (estBonus < minBonus) estBonus = minBonus;
            $('trophyBonusActiveText').innerHTML = `⚡ <span class="desktop-text">Bônus Ativo: </span>+${totalPctFormatted}% <span class="desktop-text">(+${estBonus} XP na meta)</span><span class="mobile-text">(+${estBonus} XP)</span>`;
        } else {
            $('trophyBonusActiveText').innerHTML = `⚡ <span class="desktop-text">Bônus Ativo: +0% XP/meta diária</span><span class="mobile-text">+0% XP</span>`;
        }
    }

    // Elementos da tela de Métricas
    if ($('metricsTrophyIron')) $('metricsTrophyIron').textContent = i;
    if ($('metricsTrophyBronze')) $('metricsTrophyBronze').textContent = b;
    if ($('metricsTrophySilver')) $('metricsTrophySilver').textContent = s;
    if ($('metricsTrophyGold')) $('metricsTrophyGold').textContent = g;
    if ($('metricsTrophyTotalXP')) $('metricsTrophyTotalXP').textContent = appData.streakBonusXP || 0;
}

function showTrophyCelebrationModal(type, xpEarned) {
    const iconMap = { iron: '🛡️', bronze: '🥉', silver: '🥈', gold: '🥇' };
    const titleMap = {
        iron: 'Novo Troféu de Ferro! 🛡️',
        bronze: 'Novo Troféu de Bronze! 🥉',
        silver: 'Novo Troféu de Prata! 🥈',
        gold: 'Novo Troféu de Ouro! 🥇'
    };
    const boostMap = {
        iron: '+0,2% de Bônus Diário Permanente 🚀',
        bronze: '+0,3% de Bônus Diário Permanente 🚀',
        silver: '+0,5% de Bônus Diário Permanente 🚀',
        gold: '+1,0% de Bônus Diário Permanente 🚀'
    };
    const subMap = {
        iron: 'Muito bem! Você completou 3 dias seguidos batendo sua meta diária!',
        bronze: 'Incrível! Você completou 7 dias seguidos batendo sua meta diária!',
        silver: 'Sensacional! Você atingiu 14 dias seguidos batendo sua meta diária!',
        gold: 'Extraordinário! 30 dias seguidos com meta batida! Você completou o ciclo e agora recomeça a jornada a partir do Ferro!'
    };
    const glowClassMap = {
        iron: 'celebration-glow trophy-glow-iron',
        bronze: 'celebration-glow trophy-glow-bronze',
        silver: 'celebration-glow trophy-glow-silver',
        gold: 'celebration-glow trophy-glow-gold'
    };

    if ($('trophyModalGlow')) $('trophyModalGlow').className = glowClassMap[type] || 'celebration-glow trophy-glow-bronze';
    if ($('trophyModalIcon')) $('trophyModalIcon').textContent = iconMap[type] || '🏆';
    if ($('trophyModalTitle')) $('trophyModalTitle').textContent = titleMap[type] || 'Novo Troféu Conquistado!';
    if ($('trophyModalSubtitle')) $('trophyModalSubtitle').textContent = subMap[type] || '';
    if ($('trophyModalXPText')) $('trophyModalXPText').textContent = `+${xpEarned} XP Bônus ⚡`;
    if ($('trophyModalBoostText')) $('trophyModalBoostText').textContent = boostMap[type] || '+0,3% de Bônus Diário Permanente 🚀';
    if ($('trophyModalCollectionText')) {
        const i = appData.trophies?.iron || 0;
        const b = appData.trophies?.bronze || 0;
        const s = appData.trophies?.silver || 0;
        const g = appData.trophies?.gold || 0;
        $('trophyModalCollectionText').textContent = `Sua coleção: ${i} 🛡️ Ferro | ${b} 🥉 Bronze | ${s} 🥈 Prata | ${g} 🥇 Ouro`;
    }

    openCelebrationModal('trophyCelebrationModal', () => {
        try {
            confetti({ particleCount: 180, spread: 90, origin: { y: 0.5 } });
        } catch (e) { }
        const soundFinish = $('soundFinish');
        if (soundFinish) soundFinish.play().catch(() => {});
    });
}

// ==================== PIRÂMIDE DE FLUÊNCIA VOCABULAR ====================

function renderFluencyPyramid() {
    let allPhrases = [];
    (appData.lists || []).forEach(l => {
        if (l.phrases && Array.isArray(l.phrases)) {
            allPhrases = allPhrases.concat(l.phrases);
        }
    });

    const wordMasteryMap = new Map(); // word -> max level found
    let masteredPhrasesCount = 0;
    let fixingPhrasesCount = 0;
    let newPhrasesCount = 0;

    allPhrases.forEach(p => {
        const lv = p.levels || {};
        const maxLevel = Math.max(
            lv.quiz || 0,
            lv.write || 0,
            lv.listen || 0,
            lv.pronounce || 0,
            lv.speak || 0,
            lv.standard || 0
        );

        if (maxLevel >= 4) {
            masteredPhrasesCount++;
        } else if (maxLevel >= 2) {
            fixingPhrasesCount++;
        } else {
            newPhrasesCount++;
        }

        // Extrai palavras únicas da frase em inglês
        const text = (p.english || '').toLowerCase();
        const rawWords = text
            .replace(/[^a-z0-9'\s-]/g, ' ')
            .split(/\s+/)
            .map(w => w.replace(/^['-]+|['-]+$/g, ''))
            .filter(w => w.length > 1 && !/^\d+$/.test(w));

        rawWords.forEach(w => {
            const current = wordMasteryMap.get(w) || 0;
            if (maxLevel > current) {
                wordMasteryMap.set(w, maxLevel);
            } else if (!wordMasteryMap.has(w)) {
                wordMasteryMap.set(w, maxLevel);
            }
        });
    });

    const totalWords = wordMasteryMap.size;
    let masteredWords = 0;
    let fixingWords = 0;
    let newWords = 0;

    wordMasteryMap.forEach((level) => {
        if (level >= 4) masteredWords++;
        else if (level >= 2) fixingWords++;
        else newWords++;
    });

    const masteredPct = totalWords > 0 ? Math.round((masteredWords / totalWords) * 100) : 0;
    const fixingPct = totalWords > 0 ? Math.round((fixingWords / totalWords) * 100) : 0;
    const newPct = totalWords > 0 ? Math.round((newWords / totalWords) * 100) : 0;

    if ($('totalActiveWordsCount')) $('totalActiveWordsCount').textContent = totalWords;

    if ($('pyramidMasteredStat')) $('pyramidMasteredStat').innerHTML = `<span class="desktop-text">${masteredWords} palavras (${masteredPct}%)</span><span class="mobile-text">${masteredWords} (${masteredPct}%)</span>`;
    if ($('pyramidMasteredPhrases')) $('pyramidMasteredPhrases').textContent = masteredPhrasesCount;

    if ($('pyramidFixingStat')) $('pyramidFixingStat').innerHTML = `<span class="desktop-text">${fixingWords} palavras (${fixingPct}%)</span><span class="mobile-text">${fixingWords} (${fixingPct}%)</span>`;
    if ($('pyramidFixingPhrases')) $('pyramidFixingPhrases').textContent = fixingPhrasesCount;

    if ($('pyramidNewStat')) $('pyramidNewStat').innerHTML = `<span class="desktop-text">${newWords} palavras (${newPct}%)</span><span class="mobile-text">${newWords} (${newPct}%)</span>`;
    if ($('pyramidNewPhrases')) $('pyramidNewPhrases').textContent = newPhrasesCount;

    // Estimativa de Nível CEFR com base no vocabulário ativo
    let cefrTitle = "Iniciante A1";
    let cefrDesc = "(Construindo vocabulário base de sobrevivência)";
    if (totalWords >= 2500) {
        cefrTitle = "Avançado C1 / Fluente";
        cefrDesc = "(Vocabulário amplo e natural em qualquer contexto)";
    } else if (totalWords >= 1500) {
        cefrTitle = "Independente B2";
        cefrDesc = "(Excelente fluência e autonomia para debates e mídias)";
    } else if (totalWords >= 800) {
        cefrTitle = "Intermediário B1";
        cefrDesc = "(Boa capacidade para compreender diálogos e narrativas)";
    } else if (totalWords >= 300) {
        cefrTitle = "Básico A2";
        cefrDesc = "(Compreensão de situações cotidianas e rotineiras)";
    }

    if ($('pyramidCefrLevel')) $('pyramidCefrLevel').textContent = cefrTitle;
    if ($('pyramidCefrDesc')) $('pyramidCefrDesc').textContent = cefrDesc;
}

// ==================== BADGES & MEDALHAS REPETÍVEIS COM XP PROGRESSIVO ====================

function checkBadgeExpirations(notify = false) {
    if (!appData.badges) return [];
    const today = new Date().toDateString();
    const currDate = new Date(today);
    let modified = false;
    const lostBadges = [];

    const badgeIds = Object.keys(BADGE_DEFINITIONS);
    badgeIds.forEach(id => {
        const def = BADGE_DEFINITIONS[id];
        // O badge de liga semanal é avaliado no encerramento da semana da liga, não diariamente
        if (def.type === 'league') return;

        const b = appData.badges[id];
        if (!b || !b.count || b.count <= 0) return;

        if (!b.lastEarnedDate) {
            b.count = 0;
            b.lastEarnedDate = '';
            modified = true;
            lostBadges.push(def.name);
            return;
        }

        const lastDate = new Date(b.lastEarnedDate);
        if (isNaN(lastDate.getTime())) {
            b.count = 0;
            b.lastEarnedDate = '';
            modified = true;
            lostBadges.push(def.name);
            return;
        }

        // Calcula a diferença em dias corridos
        const diffTime = currDate.getTime() - lastDate.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        // Se passaram 2 ou mais dias desde a última conquista, significa que ontem o badge NÃO foi feito.
        // O usuário não conseguiu fazer no dia e o badge é perdido (bloqueado novamente)!
        if (diffDays >= 2) {
            b.count = 0;
            b.lastEarnedDate = '';
            modified = true;
            lostBadges.push(def.name);
        }
    });

    if (modified) {
        saveData(appData, { touch: false });
        if (typeof renderBadgesUI === 'function') {
            renderBadgesUI();
        }
    }

    if (notify && lostBadges.length > 0) {
        const listNames = lostBadges.join(', ');
        setTimeout(() => {
            alert(
                `Você não realizou os seguintes badges no dia anterior e eles foram perdidos: ${listNames}. Pratique hoje para conquistá-los novamente!`,
                "Badges Expirados",
                "⚠️"
            );
        }, 800);
    }

    return lostBadges;
}

function checkAndAwardBadge(badgeId) {
    if (!BADGE_DEFINITIONS || !BADGE_DEFINITIONS[badgeId]) return;
    const def = BADGE_DEFINITIONS[badgeId];
    if (!appData.badges) appData.badges = {};
    if (!appData.badges[badgeId]) {
        appData.badges[badgeId] = { count: 0, lastEarned: 0, lastEarnedDate: '' };
    }
    const b = appData.badges[badgeId];
    const today = new Date().toDateString();

    // Limite diário estrito: no máximo 1 conquista de cada tipo de badge/medalha por dia
    if (b.lastEarnedDate === today) return;

    // Incrementa contagem de conquistas (Nível do Badge)
    b.count = (b.count || 0) + 1;
    b.lastEarned = Date.now();
    b.lastEarnedDate = today;

    const level = b.count;
    // Recompensa com escala progressiva em XP: quanto maior o nível, maior o prêmio
    const xpReward = def.baseXP + ((level - 1) * def.scalingXP);

    appData.badgeBonusXP = (appData.badgeBonusXP || 0) + xpReward;

    saveData(appData);

    // 1. Exibe a janela de celebração do Badge conquistado em primeiro lugar
    showBadgeCelebrationModal(def, level, xpReward);

    // 2. Credita o XP na liga semanal (se houver ultrapassagem, a janela é enfileirada para logo após o badge)
    addLeagueXP(xpReward);

    // 3. Atualiza o nível global (se houver subida de nível, o Level Up é enfileirado)
    updateGlobalLevel();
    renderBadgesUI();
}

function showBadgeCelebrationModal(badgeDef, level, xpReward) {
    if ($('badgeModalIcon')) $('badgeModalIcon').textContent = badgeDef.icon;
    if ($('badgeModalLevelBadge')) $('badgeModalLevelBadge').textContent = `⭐ NÍVEL ${level} (${level}ª conquista)`;
    if ($('badgeModalTitle')) $('badgeModalTitle').textContent = `${badgeDef.name} Conquistado!`;
    if ($('badgeModalDesc')) $('badgeModalDesc').textContent = badgeDef.description;
    if ($('badgeModalXPText')) $('badgeModalXPText').textContent = `+${xpReward} XP Bônus ⚡`;
    const nextReward = badgeDef.baseXP + (level * badgeDef.scalingXP);
    if ($('badgeModalNextReward')) $('badgeModalNextReward').textContent = `Limite diário atingido! Próximo nível (+${nextReward} XP) disponível amanhã (faça diariamente para não perder)`;

    openCelebrationModal('badgeCelebrationModal', () => {
        if (typeof confetti === 'function') {
            try {
                confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 } });
            } catch (e) { }
        }
        const soundCorrect = $('soundCorrect');
        if (soundCorrect) soundCorrect.play().catch(() => {});
    });
}

function showLevelUpModal(newLevel, oldLevel, totalXP, xpForNext) {
    if ($('levelUpNumberBadge')) $('levelUpNumberBadge').textContent = newLevel;
    if ($('levelUpTitle')) $('levelUpTitle').textContent = `Nível ${newLevel} Alcançado!`;
    if ($('levelUpSubtitle')) $('levelUpSubtitle').textContent = `Sensacional! Você avançou do Nível ${oldLevel} para o Nível ${newLevel}!`;
    if ($('levelUpXPText')) $('levelUpXPText').textContent = `${Math.floor(totalXP).toLocaleString()} Total XP ⚡`;
    if ($('levelUpNextStepText')) $('levelUpNextStepText').textContent = `Próximo nível em ${xpForNext} XP`;

    openCelebrationModal('levelUpModal', () => {
        if (typeof confetti === 'function') {
            try {
                confetti({ particleCount: 160, spread: 85, origin: { y: 0.5 } });
            } catch (e) { }
        }
        const soundFinish = $('soundFinish');
        if (soundFinish) soundFinish.play().catch(() => {});
    });
}

function showDailyGoalCelebrationModal(goal, reviewsToday, freezeAwarded) {
    if ($('dailyGoalModalTitle')) $('dailyGoalModalTitle').textContent = `Meta de ${goal} Frases Conquistada!`;
    if ($('dailyGoalModalSubtitle')) {
        $('dailyGoalModalSubtitle').textContent = `Sensacional! Você completou ${reviewsToday} revisões hoje e manteve sua sequência firme!`;
    }
    if ($('dailyGoalStreakText')) {
        const streak = appData.streak || 1;
        $('dailyGoalStreakText').textContent = `🔥 Sequência Ativa: ${streak} dia${streak > 1 ? 's' : ''}!`;
    }
    if ($('dailyGoalFreezeRewardText')) {
        if (freezeAwarded) {
            $('dailyGoalFreezeRewardText').style.display = 'block';
            $('dailyGoalFreezeRewardText').textContent = '🧊 +1 Gelo Protetor adicionado!';
        } else {
            const freezes = appData.streakFreezes !== undefined ? appData.streakFreezes : 1;
            $('dailyGoalFreezeRewardText').style.display = 'block';
            $('dailyGoalFreezeRewardText').textContent = `🧊 Seus Gelos Protetores: ${freezes} de reserva`;
        }
    }

    openCelebrationModal('dailyGoalCelebrationModal', () => {
        if (typeof confetti === 'function') {
            try {
                confetti({ particleCount: 150, spread: 80, origin: { y: 0.55 } });
            } catch (e) { }
        }
        const soundFinish = $('soundFinish');
        if (soundFinish) soundFinish.play().catch(() => {});
    });
}

function showLeagueOvertakeModal(data) {
    const { overtakenBots, prevRank, newRank } = data;
    if (!overtakenBots || overtakenBots.length === 0) return;

    const topBot = overtakenBots[0];
    const totalPassed = overtakenBots.length;

    if ($('overtakeBotAvatar')) $('overtakeBotAvatar').textContent = topBot.avatar || '🎓';
    if ($('overtakeBotName')) $('overtakeBotName').textContent = (topBot.name || 'Competidor').split(' ')[0];
    if ($('overtakeBotRank')) $('overtakeBotRank').textContent = `#${newRank + totalPassed - 1}`;

    const userName = (appData.auth && appData.auth.username) ? appData.auth.username.split(' ')[0] : 'Você';
    if ($('overtakeUserAvatar')) $('overtakeUserAvatar').textContent = '👤';
    if ($('overtakeUserName')) $('overtakeUserName').textContent = userName;
    if ($('overtakeUserRank')) $('overtakeUserRank').textContent = `#${newRank}`;

    if ($('overtakeOldRankDisplay')) $('overtakeOldRankDisplay').textContent = `#${prevRank}`;
    if ($('overtakeNewRankDisplay')) $('overtakeNewRankDisplay').textContent = `#${newRank} ⬆️`;

    if ($('overtakeTitle')) {
        $('overtakeTitle').textContent = totalPassed > 1
            ? `Subiu ${totalPassed} posições na Liga! 🚀`
            : `Você ultrapassou ${topBot.name.split(' ')[0]}! ⚡`;
    }

    if ($('overtakeSubtitle')) {
        if (totalPassed > 1) {
            $('overtakeSubtitle').innerHTML = `Incrível arrancada! Você ultrapassou <strong>${escapeHTML(topBot.name)}</strong> e mais ${totalPassed - 1} competidor(es), subindo para a <strong>#${newRank}ª posição</strong>!`;
        } else {
            $('overtakeSubtitle').innerHTML = `Ritmo forte! Você ultrapassou <strong>${escapeHTML(topBot.name)}</strong> e assumiu a <strong>#${newRank}ª posição</strong> da liga semanal!`;
        }
    }

    openCelebrationModal('leagueOvertakeModal', () => {
        if (typeof confetti === 'function') {
            try {
                confetti({ particleCount: 140, spread: 80, origin: { y: 0.55 } });
            } catch (e) { }
        }
        const soundFinish = $('soundFinish');
        if (soundFinish) soundFinish.play().catch(() => {});
    });
}

let pendingLeagueDropData = null;

function showLeagueDropModal(data) {
    const { overtakingBots, prevRank, newRank } = data;
    if (!overtakingBots || overtakingBots.length === 0) return;

    const lostCount = newRank - prevRank;
    const topBot = overtakingBots[0];

    if ($('dropBotAvatar')) $('dropBotAvatar').textContent = topBot.avatar || '🎓';
    if ($('dropBotName')) $('dropBotName').textContent = (topBot.name || 'Competidor').split(' ')[0];
    if ($('dropBotRank')) $('dropBotRank').textContent = `#${topBot.newRank || (newRank - 1)}`;

    const userName = (appData.auth && appData.auth.username) ? appData.auth.username.split(' ')[0] : 'Você';
    if ($('dropUserAvatar')) $('dropUserAvatar').textContent = '👤';
    if ($('dropUserName')) $('dropUserName').textContent = userName;
    if ($('dropUserRank')) $('dropUserRank').textContent = `#${newRank} 🔻`;

    if ($('dropOldRankDisplay')) $('dropOldRankDisplay').textContent = `#${prevRank}`;
    if ($('dropNewRankDisplay')) $('dropNewRankDisplay').textContent = `#${newRank} 🔻`;

    if ($('dropTitle')) {
        $('dropTitle').textContent = lostCount > 1
            ? `Você perdeu ${lostCount} posições! ⚠️`
            : `Você perdeu 1 posição! ⚠️`;
    }

    if ($('dropSubtitle')) {
        const botName = escapeHTML(topBot.name);
        if (lostCount > 1) {
            $('dropSubtitle').innerHTML = `A disputa na liga está fervendo! <strong>${botName}</strong> e mais ${lostCount - 1} competidor(es) pontuaram enquanto você esteve fora e ultrapassaram você.`;
        } else {
            $('dropSubtitle').innerHTML = `A disputa na liga está fervendo! <strong>${botName}</strong> pontuou enquanto você esteve fora e assumiu a <strong>#${topBot.newRank || (newRank - 1)}ª posição</strong>.`;
        }
    }

    openCelebrationModal('leagueDropModal', () => {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            try { document.activeElement.blur(); } catch (e) { }
        }
    });
}

function renderBadgesUI() {
    checkBadgeExpirations(false);
    if (!appData.badges) appData.badges = {};
    const grid = $('badgesGrid');
    if (!grid) return;

    let totalConquests = 0;
    const badgeIds = Object.keys(BADGE_DEFINITIONS);
    const today = new Date().toDateString();

    const cardsHtml = badgeIds.map(id => {
        const def = BADGE_DEFINITIONS[id];
        const record = appData.badges[id] || { count: 0, lastEarned: 0 };
        const count = record.count || 0;
        totalConquests += count;

        const isUnlocked = count > 0;
        const currentLevel = count;
        const nextLevel = count + 1;
        const nextXP = def.baseXP + ((nextLevel - 1) * def.scalingXP);
        const totalXPEarnedFromThis = count > 0
            ? ((count * def.baseXP) + (def.scalingXP * (count * (count - 1) / 2)))
            : 0;

        const earnedToday = record.lastEarnedDate === today;

        return `
            <div class="badge-item-card ${isUnlocked ? 'badge-unlocked' : 'badge-locked'}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div class="badge-icon-wrap" style="font-size: 2.4rem;">
                        ${def.icon}
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                        ${isUnlocked
                            ? `<span class="badge-level-pill"><span class="desktop-text">⭐ NÍVEL </span><span class="mobile-text">⭐ Lvl </span>${currentLevel}</span>`
                            : `<span class="badge-locked-pill">🔒 Bloqueado</span>`
                        }
                        ${earnedToday
                            ? `<span style="font-size: 0.7rem; color: var(--success); font-weight: 800; background: rgba(16, 185, 129, 0.12); padding: 2px 7px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.25);">✓ Mantido Hoje (1/1)</span>`
                            : (isUnlocked
                                ? `<span style="font-size: 0.7rem; color: #d97706; font-weight: 800; background: rgba(245, 158, 11, 0.12); padding: 2px 7px; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.3);">⚠️ Pendente Hoje (Faça para não perder!)</span>`
                                : `<span style="font-size: 0.7rem; color: var(--primary); font-weight: 700; background: var(--primary-soft); padding: 2px 7px; border-radius: 6px;">⚡ Disponível Hoje</span>`
                            )
                        }
                        <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">
                            <span class="desktop-text">${count === 1 ? '1 conquista' : `${count} conquistas`}</span><span class="mobile-text">x${count}</span>
                        </span>
                    </div>
                </div>
                <div style="font-weight: 800; font-size: 1.05rem; margin-bottom: 4px; color: var(--text);">
                    ${def.name}
                </div>
                <p class="badge-card-desc" style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.35; margin-bottom: 12px; min-height: 34px;">
                    ${def.description}
                </p>
                <div class="badge-reward-footer">
                    <div style="font-size: 0.75rem; color: var(--primary); font-weight: 800;">
                        ${earnedToday
                            ? `⏳ <span class="desktop-text">Próximo Nível: </span>+${nextXP} XP amanhã`
                            : (isUnlocked
                                ? `⚠️ <span class="desktop-text">Faça hoje para manter nível: </span>+${nextXP} XP`
                                : `⚡ <span class="desktop-text">Próximo Nível: </span>+${nextXP} XP`
                            )
                        }
                    </div>
                    ${totalXPEarnedFromThis > 0
                        ? `<div style="font-size: 0.7rem; color: var(--success); font-weight: 700;">+${totalXPEarnedFromThis} <span class="desktop-text">XP acumulados</span><span class="mobile-text">XP</span></div>`
                        : ''
                    }
                </div>
            </div>
        `;
    }).join('');

    grid.innerHTML = cardsHtml;
    if ($('badgesTotalConquests')) $('badgesTotalConquests').textContent = totalConquests;
    if ($('badgesTotalBonusXP')) $('badgesTotalBonusXP').textContent = appData.badgeBonusXP || 0;
}

// ==================== LIGA SEMANAL DE ALUNOS (BOTS) ====================

function addLeagueXP(amount, isFromMissionClaim = false) {
    if (!amount || amount <= 0) return;
    if (!appData.league) {
        appData.league = initLeagueData('bronze');
    }
    const league = appData.league;
    const prevXP = league.userXP || 0;

    // Calcula ranking antes do XP ser creditado
    const preSort = [
        { isUser: true, score: prevXP },
        ...(league.bots || [])
    ].sort((a, b) => b.score - a.score);
    const prevRank = preSort.findIndex(c => c.isUser) + 1;

    // Atualiza pontuação do usuário
    const newXP = prevXP + amount;
    league.userXP = newXP;

    if (!isFromMissionClaim && typeof recordMissionProgress === 'function') {
        recordMissionProgress('league_xp', amount);
    }

    // Calcula ranking depois do XP creditado
    const postSort = [
        { isUser: true, score: newXP },
        ...(league.bots || [])
    ].sort((a, b) => b.score - a.score);
    const newRank = postSort.findIndex(c => c.isUser) + 1;

    // Verifica se houve ultrapassagem (subiu de posição na liga)
    if (newRank < prevRank) {
        const overtakenBots = preSort.filter(c => !c.isUser && c.score >= prevXP && c.score < newXP);
        if (overtakenBots.length > 0) {
            showLeagueOvertakeModal({
                overtakenBots,
                prevRank,
                newRank
            });
        }
    }

    renderLeagueCardHome();
    if ($('leagueView') && $('leagueView').style.display !== 'none') {
        renderLeague();
    }
}

let lastBotSimExecutionTime = 0;

function updateBotScoresOnAppEntry(isManualOrSystemEntry = false) {
    if (!appData.league) {
        appData.league = initLeagueData('bronze');
    }
    // Verifica primeiro se a semana virou
    checkLeagueWeekTransition();

    const now = Date.now();
    // Previne disparo repetido em rajada (ex: visibilitychange e focus disparando simultaneamente no mesmo segundo)
    if (now - lastBotSimExecutionTime < 2000) {
        renderLeagueCardHome();
        if ($('leagueView') && $('leagueView').style.display !== 'none') renderLeague();
        return;
    }
    lastBotSimExecutionTime = now;

    const league = appData.league;
    const conf = LEAGUE_DIVISIONS[league.division] || LEAGUE_DIVISIONS.bronze;
    const lastVisit = league.lastVisitTime || now;
    league.lastVisitTime = now;

    if (!Array.isArray(league.bots)) return;

    // Sanitiza avatares salvos anteriormente que possam ter emojis compostos (ZWJ)
    const emojiFixes = {
        '🧑‍🎓': '🎓',
        '👩‍💻': '💻',
        '👩‍🔬': '🔬',
        '👨‍🎓': '🎓',
        '👨‍💻': '💻',
        '👨‍🔬': '🔬'
    };
    let avatarFixed = false;
    league.bots.forEach(bot => {
        if (emojiFixes[bot.avatar]) {
            bot.avatar = emojiFixes[bot.avatar];
            avatarFixed = true;
        }
    });
    if (avatarFixed) {
        saveData(appData, { touch: false });
    }

    const elapsedMs = now - lastVisit;
    const minutesElapsed = Math.floor(elapsedMs / (1000 * 60));

    // Se menos de 3 segundos se passaram e não for entrada direta no app/aba, evita reprocessamento desnecessário
    if (elapsedMs < 3000 && !isManualOrSystemEntry) {
        renderLeagueCardHome();
        if ($('leagueView') && $('leagueView').style.display !== 'none') renderLeague();
        return;
    }

    // 1. Grava as posições anteriores antes de atualizar pontos (para mostrar quem subiu/caiu)
    const preSort = [
        { isUser: true, score: league.userXP || 0 },
        ...league.bots
    ].sort((a, b) => b.score - a.score);

    const prevUserRank = preSort.findIndex(item => item.isUser) + 1;

    preSort.forEach((item, idx) => {
        if (item.isUser) {
            league.userPrevRank = idx + 1;
        } else {
            item.prevRank = idx + 1;
        }
    });

    // 2. Simula o avanço do tempo:
    // Em minutos reais decorridos (1 bloco por minuto até 48h = 2880 passos)
    let steps = Math.min(minutesElapsed, 2880);

    // Se o usuário entrou no sistema (abriu o app / recarregou / voltou da aba) ou na aba da liga,
    // garante pelo menos 1 rodada de simulação de disputa
    if (steps <= 0 && isManualOrSystemEntry) {
        steps = 1;
    }

    if (steps <= 0) {
        renderLeagueCardHome();
        if ($('leagueView') && $('leagueView').style.display !== 'none') renderLeague();
        return;
    }

    let changed = false;
    const stepMinutes = 1;
    const botDifficulty = (league.botDifficulty != null) ? league.botDifficulty : 1.0;

    league.bots.forEach(bot => {
        const pace = bot.pace || 1.0;
        let gainedXP = 0;

        // Otimização de CPU: para períodos longos, agrupa em blocos de tempo maiores
        // garantindo execução imediata (< 2ms) sem congelar a tela de abertura
        const stepSize = steps > 180 ? 30 : (steps > 60 ? 10 : 1);
        const iterations = Math.ceil(steps / stepSize);

        for (let i = 0; i < iterations; i++) {
            const simulatedMinute = i * stepSize;

            // Decaimento suave com piso firme ajustado pelo tamanho do bloco:
            const baseChance = 0.20 * pace;
            const floorChance = 0.045 * pace;
            const unitChance = floorChance + (baseChance - floorChance) * Math.exp(-simulatedMinute / 300);
            const blockChance = Math.min(0.95, unitChance * stepSize);

            if (Math.random() < blockChance) {
                let sessionMultiplier = 0.7 + (Math.random() * 0.7);

                // 12% de chance de "Maratona de Estudo" (o bot estuda muito e disputa posições)
                if (Math.random() < 0.12) {
                    sessionMultiplier *= (1.7 + Math.random() * 0.8);
                }

                const blockFactor = stepSize > 1 ? (0.75 + Math.random() * 0.5) * Math.min(stepSize, 4) : 1;
                const baseInc = conf.incMin + (Math.random() * (conf.incMax - conf.incMin));
                const add = Math.max(3, Math.round(baseInc * sessionMultiplier * botDifficulty * blockFactor));
                gainedXP += add;
            }
        }

        if (gainedXP > 0) {
            bot.score = (bot.score || 0) + gainedXP;
            changed = true;
        }
    });

    if (changed) {
        // Verifica se o usuário perdeu posições para competidores
        const postSort = [
            { isUser: true, score: league.userXP || 0 },
            ...league.bots
        ].sort((a, b) => b.score - a.score);

        const newUserRank = postSort.findIndex(item => item.isUser) + 1;

        if (newUserRank > prevUserRank) {
            const overtakingBots = [];
            postSort.forEach((item, newIdx) => {
                if (!item.isUser) {
                    const newBotRank = newIdx + 1;
                    if (newBotRank < newUserRank) {
                        const oldIdx = preSort.findIndex(p => !p.isUser && p.id === item.id);
                        const oldBotRank = oldIdx + 1;
                        if (oldBotRank >= prevUserRank) {
                            overtakingBots.push({
                                ...item,
                                newRank: newBotRank,
                                oldRank: oldBotRank
                            });
                        }
                    }
                }
            });

            if (overtakingBots.length > 0) {
                const dropData = {
                    overtakingBots,
                    prevRank: prevUserRank,
                    newRank: newUserRank
                };

                const loadingScreen = $('loadingScreen');
                if (loadingScreen && !loadingScreen.classList.contains('fade-out')) {
                    pendingLeagueDropData = dropData;
                } else {
                    showLeagueDropModal(dropData);
                }
            }
        }

        saveData(appData);
    }
    renderLeagueCardHome();
    if ($('leagueView') && $('leagueView').style.display !== 'none') {
        renderLeague();
    }
}

function calculateBotDifficultyShift(userRank) {
    const shiftTable = {
        1: 0.25,  // Campeão (#1): +25% de XP para os bots
        2: 0.20,  // Vice (#2): +20%
        3: 0.15,  // Top 3 (#3): +15%
        4: 0.10,  // #4: +10%
        5: 0.07,  // #5: +7%
        6: 0.05,  // #6: +5%
        7: 0.02,  // #7: +2%
        8: 0.00,  // Exato meio da tabela (#8): 0% (mantém ritmo da última vez)
        9: -0.02, // #9: -2%
        10: -0.05,// #10: -5%
        11: -0.08,// #11: -8%
        12: -0.12,// #12 (rebaixamento): -12%
        13: -0.16,// #13 (rebaixamento): -16%
        14: -0.20,// #14 (rebaixamento): -20%
        15: -0.25 // #15 (lanterna): -25% de XP para os bots
    };
    if (shiftTable[userRank] !== undefined) return shiftTable[userRank];
    return Math.round(((8 - userRank) * 0.035) * 100) / 100;
}

function checkLeagueWeekTransition() {
    if (!appData.league) {
        appData.league = initLeagueData('bronze');
        return;
    }
    const currentWeek = getCurrentWeekId();
    if (appData.league.weekId === currentWeek) {
        return; // Mesma semana
    }

    // Virada de semana: avalia ranking final
    const divKey = appData.league.division || 'bronze';
    const conf = LEAGUE_DIVISIONS[divKey] || LEAGUE_DIVISIONS.bronze;
    const userXP = appData.league.userXP || 0;

    const competitors = [
        { isUser: true, name: (appData.auth?.username || 'Você'), score: userXP },
        ...(appData.league.bots || [])
    ].sort((a, b) => b.score - a.score);

    const userRank = competitors.findIndex(c => c.isUser) + 1; // 1 a 15

    let nextDivision = divKey;
    let transitionType = 'stay';

    if (userRank <= 3) {
        checkAndAwardBadge('league_podium');
        if (conf.nextDivision) {
            nextDivision = conf.nextDivision;
            transitionType = 'promoted';
        } else {
            // Liga Diamante: permanência no ápice como campeão supremo do pódio
            nextDivision = divKey;
            transitionType = 'champion';
        }
    } else {
        // Se terminou a semana fora da zona do pódio (top 3), perde o badge Pódio da Liga!
        if (appData.badges && appData.badges['league_podium'] && appData.badges['league_podium'].count > 0) {
            appData.badges['league_podium'].count = 0;
            appData.badges['league_podium'].lastEarnedDate = '';
        }
        if (userRank >= 12 && conf.prevDivision) {
            nextDivision = conf.prevDivision;
            transitionType = 'demoted';
        }
    }

    // Ajuste dinâmico da dificuldade dos competidores para a nova semana
    // Baseado na posição em que o usuário terminou em relação ao que os competidores ganhavam na última vez
    const prevDifficulty = (appData.league.botDifficulty != null) ? appData.league.botDifficulty : 1.0;
    const diffShift = calculateBotDifficultyShift(userRank);
    let newDifficulty = Math.round((prevDifficulty + diffShift) * 100) / 100;
    newDifficulty = Math.max(0.40, newDifficulty); // Sem limite máximo, apenas limite mínimo

    // Inicia a nova semana preservando o novo nível de dificuldade e simulando rotação realista de competidores
    const oldBots = (appData.league && Array.isArray(appData.league.bots)) ? appData.league.bots : [];
    appData.league = {
        division: nextDivision,
        weekId: currentWeek,
        userXP: 0,
        bots: generateNextWeekBots(oldBots, userRank, divKey, nextDivision, newDifficulty),
        botDifficulty: newDifficulty,
        lastFinishedRank: userRank,
        lastVisitTime: Date.now()
    };
    saveData(appData);

    // Exibe celebração ou notificação de virada de semana com a mudança de dificuldade
    setTimeout(() => {
        showLeagueTransitionModal(transitionType, userRank, divKey, nextDivision, userXP, newDifficulty, prevDifficulty);
    }, 1000);
}

function showLeagueTransitionModal(type, rank, oldDiv, newDiv, userXP, newDiff, prevDiff) {
    const oldConf = LEAGUE_DIVISIONS[oldDiv] || LEAGUE_DIVISIONS.bronze;
    const newConf = LEAGUE_DIVISIONS[newDiv] || LEAGUE_DIVISIONS.bronze;

    if (type === 'champion') {
        if ($('leagueTransIcon')) $('leagueTransIcon').textContent = '👑';
        if ($('leagueTransTitle')) $('leagueTransTitle').textContent = 'Glória dos Campeões! 🏆';
        if ($('leagueTransDesc')) $('leagueTransDesc').textContent = `Sensacional! Você terminou a temporada em #${rank}º lugar com ${userXP} XP e conquistou o Pódio da Liga Diamante!`;
        if ($('leagueTransDivisionName')) $('leagueTransDivisionName').textContent = `${newConf.icon} ${newConf.name} • Campeão Supremo`;
        if ($('leagueTransSub')) $('leagueTransSub').textContent = 'Você está no ápice absoluto do MemoEnglish! Mantenha a coroa!';
        if (typeof confetti === 'function') {
            try { confetti({ particleCount: 180, spread: 90, origin: { y: 0.5 } }); } catch (e) { }
        }
    } else if (type === 'promoted') {
        if ($('leagueTransIcon')) $('leagueTransIcon').textContent = '🎉';
        if ($('leagueTransTitle')) $('leagueTransTitle').textContent = 'Promoção Conquistada! 🚀';
        if ($('leagueTransDesc')) $('leagueTransDesc').textContent = `Você terminou a semana em #${rank}º lugar com ${userXP} XP e subiu para a divisão superior!`;
        if ($('leagueTransDivisionName')) $('leagueTransDivisionName').textContent = `${newConf.icon} ${newConf.name}`;
        if ($('leagueTransSub')) $('leagueTransSub').textContent = 'Excelente desempenho! Novos competidores esperam por você!';
        if (typeof confetti === 'function') {
            try { confetti({ particleCount: 150, spread: 80, origin: { y: 0.5 } }); } catch (e) { }
        }
    } else if (type === 'demoted') {
        if ($('leagueTransIcon')) $('leagueTransIcon').textContent = '⚠️';
        if ($('leagueTransTitle')) $('leagueTransTitle').textContent = 'Zona de Rebaixamento';
        if ($('leagueTransDesc')) $('leagueTransDesc').textContent = `Você terminou em #${rank}º lugar com ${userXP} XP e caiu para a ${newConf.name}. Pratique forte nesta nova semana para subir de volta!`;
        if ($('leagueTransDivisionName')) $('leagueTransDivisionName').textContent = `${newConf.icon} ${newConf.name}`;
        if ($('leagueTransSub')) $('leagueTransSub').textContent = 'Não desanime! Toda semana é uma nova chance!';
    } else {
        if ($('leagueTransIcon')) $('leagueTransIcon').textContent = '🛡️';
        if ($('leagueTransTitle')) $('leagueTransTitle').textContent = 'Permanência na Liga!';
        if ($('leagueTransDesc')) $('leagueTransDesc').textContent = `Você terminou em #${rank}º lugar com ${userXP} XP e manteve seu lugar na ${newConf.name}!`;
        if ($('leagueTransDivisionName')) $('leagueTransDivisionName').textContent = `${newConf.icon} ${newConf.name}`;
        if ($('leagueTransSub')) $('leagueTransSub').textContent = 'Bora buscar o Top 3 nesta semana!';
    }

    const diffInfo = $('leagueTransDifficultyInfo');
    if (diffInfo && newDiff != null && prevDiff != null) {
        diffInfo.style.display = 'block';
        const changePct = Math.round((newDiff - prevDiff) * 100);
        const totalPct = Math.round(newDiff * 100);
        if (changePct > 0) {
            diffInfo.style.background = 'rgba(239, 68, 68, 0.12)';
            diffInfo.style.color = '#ef4444';
            diffInfo.style.border = '1px solid rgba(239, 68, 68, 0.25)';
            diffInfo.innerHTML = `⚔️ Intensidade da Liga: +${changePct}% (${totalPct}% do padrão)<br><span style="font-size: 0.8rem; font-weight: 600;">Como você terminou em #${rank}º, a disputa nesta semana estará mais intensa e acelerada!</span>`;
        } else if (changePct < 0) {
            diffInfo.style.background = 'rgba(16, 185, 129, 0.12)';
            diffInfo.style.color = '#10b981';
            diffInfo.style.border = '1px solid rgba(16, 185, 129, 0.25)';
            diffInfo.innerHTML = `🛡️ Intensidade da Liga: ${changePct}% (${totalPct}% do padrão)<br><span style="font-size: 0.8rem; font-weight: 600;">Como você terminou em #${rank}º, o ritmo da rodada será mais brando para você recuperar posições!</span>`;
        } else {
            diffInfo.style.background = 'var(--surface)';
            diffInfo.style.color = 'var(--text-muted)';
            diffInfo.style.border = '1px solid var(--border)';
            diffInfo.innerHTML = `⚖️ Intensidade da Liga: Mantida em ${totalPct}% (Ritmo equilibrado)`;
        }
    } else if (diffInfo) {
        diffInfo.style.display = 'none';
    }

    openCelebrationModal('leagueTransitionModal');
}

function getLeagueCountdown() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Domingo
    const daysUntilSunday = (7 - dayOfWeek) % 7;
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + daysUntilSunday);
    endOfWeek.setHours(23, 59, 59, 999);

    const diff = endOfWeek.getTime() - now.getTime();
    if (diff <= 0) return "Fechando rodada...";
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
        return `Termina em ${days}d ${hours}h`;
    } else {
        return `Termina em ${hours}h ${mins}m`;
    }
}

function renderLeagueCardHome() {
    if (!appData.league) {
        appData.league = initLeagueData('bronze');
    }
    const league = appData.league;
    const conf = LEAGUE_DIVISIONS[league.division] || LEAGUE_DIVISIONS.bronze;
    const userXP = league.userXP || 0;

    const competitors = [
        { isUser: true, score: userXP },
        ...(league.bots || [])
    ].sort((a, b) => b.score - a.score);

    const userRank = competitors.findIndex(c => c.isUser) + 1;

    if ($('homeLeagueIcon')) $('homeLeagueIcon').textContent = conf.icon;
    if ($('homeLeagueTitle')) $('homeLeagueTitle').textContent = conf.name;
    if ($('homeLeagueRankText')) $('homeLeagueRankText').innerHTML = `<span class="desktop-text">#${userRank} de 15</span><span class="mobile-text">#${userRank}/15</span>`;
    if ($('homeLeagueXPText')) $('homeLeagueXPText').innerHTML = `${userXP} XP <span class="desktop-text">esta semana</span>`;

    const badgeEl = $('homeLeagueZoneBadge');
    if (badgeEl) {
        if (userRank <= 3) {
            badgeEl.className = 'zone-tag zone-tag-promo';
            if (conf.nextDivision) {
                badgeEl.style.background = '';
                badgeEl.style.color = '';
                badgeEl.style.border = '';
                badgeEl.innerHTML = '⬆️ <span class="desktop-text">Zona de Promoção</span><span class="mobile-text">Promoção</span>';
            } else {
                badgeEl.style.background = 'rgba(234, 179, 8, 0.15)';
                badgeEl.style.color = '#eab308';
                badgeEl.style.border = '1px solid rgba(234, 179, 8, 0.3)';
                badgeEl.innerHTML = '👑 <span class="desktop-text">Zona dos Campeões</span><span class="mobile-text">Campeões</span>';
            }
        } else if (userRank >= 12 && conf.prevDivision) {
            badgeEl.className = 'zone-tag zone-tag-demo';
            badgeEl.style.background = '';
            badgeEl.style.color = '';
            badgeEl.style.border = '';
            badgeEl.innerHTML = '⬇️ <span class="desktop-text">Zona de Rebaixamento</span><span class="mobile-text">Rebaixamento</span>';
        } else {
            badgeEl.className = 'zone-tag';
            badgeEl.style.background = 'var(--border)';
            badgeEl.style.color = 'var(--text-muted)';
            badgeEl.style.border = '';
            badgeEl.innerHTML = '🛡️ <span class="desktop-text">Zona Segura</span><span class="mobile-text">Segura</span>';
        }
    }
}

function renderLeague() {
    if (!appData.league) {
        appData.league = initLeagueData('bronze');
    }
    const league = appData.league;
    const conf = LEAGUE_DIVISIONS[league.division] || LEAGUE_DIVISIONS.bronze;
    const userXP = league.userXP || 0;
    const userName = (appData.auth && appData.auth.username) ? appData.auth.username : 'Você';

    const competitors = [
        { id: 'user_self', name: userName, avatar: '👤', score: userXP, isUser: true },
        ...(league.bots || [])
    ].sort((a, b) => b.score - a.score);

    const userRank = competitors.findIndex(c => c.isUser) + 1;

    // Cabeçalho da Liga
    if ($('leagueHeaderIcon')) $('leagueHeaderIcon').textContent = conf.icon;
    if ($('leagueHeaderTitle')) $('leagueHeaderTitle').textContent = conf.name;
    if ($('leagueCountdownText')) $('leagueCountdownText').textContent = getLeagueCountdown();

    // Banner da Divisão
    if ($('leagueDivisionBadgeIcon')) $('leagueDivisionBadgeIcon').textContent = conf.icon;
    if ($('leagueDivisionName')) $('leagueDivisionName').textContent = conf.name;
    if ($('leagueDivisionRule')) $('leagueDivisionRule').textContent = conf.ruleText;
    if ($('leagueUserWeeklyXPDisplay')) $('leagueUserWeeklyXPDisplay').textContent = `${userXP} XP`;
    if ($('leagueUserRankBadge')) $('leagueUserRankBadge').innerHTML = `<span class="desktop-text">Sua Posição: </span>#${userRank} de 15`;

    // Indicador dinâmico de ritmo/intensidade da liga
    const diff = (league.botDifficulty != null) ? league.botDifficulty : 1.0;
    const diffBadge = $('leagueDifficultyBadge');
    if (diffBadge) {
        const pct = Math.round(diff * 100);
        if (diff > 1.04) {
            diffBadge.style.background = 'rgba(239, 68, 68, 0.12)';
            diffBadge.style.color = '#ef4444';
            diffBadge.style.border = '1px solid rgba(239, 68, 68, 0.25)';
            diffBadge.innerHTML = `⚔️ Ritmo da Liga: ${pct}% (Disputa Intensa)`;
            diffBadge.title = 'A disputa está mais acirrada devido ao seu ótimo desempenho anterior!';
        } else if (diff < 0.96) {
            diffBadge.style.background = 'rgba(16, 185, 129, 0.12)';
            diffBadge.style.color = '#10b981';
            diffBadge.style.border = '1px solid rgba(16, 185, 129, 0.25)';
            diffBadge.innerHTML = `🛡️ Ritmo da Liga: ${pct}% (Disputa Moderada)`;
            diffBadge.title = 'O ritmo da rodada está mais brando para você recuperar posições com tranquilidade!';
        } else {
            diffBadge.style.background = 'var(--primary-soft)';
            diffBadge.style.color = 'var(--text-muted)';
            diffBadge.style.border = '1px solid var(--border)';
            diffBadge.innerHTML = `⚖️ Ritmo da Liga: 100% (Equilibrada)`;
            diffBadge.title = 'Ritmo padrão da rodada semanal.';
        }
    }

    // Lista de Competidores
    const listContainer = $('leagueLeaderboardList');
    if (!listContainer) return;

    listContainer.innerHTML = competitors.map((c, index) => {
        const rank = index + 1;
        const isUser = !!c.isUser;
        const prevRank = isUser ? (league.userPrevRank || rank) : (c.prevRank || rank);

        let rankShiftHtml = '';
        if (prevRank > rank) {
            const diff = prevRank - rank;
            rankShiftHtml = `<span class="rank-shift-up" title="Subiu ${diff} posições">▲${diff}</span>`;
        } else if (prevRank < rank) {
            const diff = rank - prevRank;
            rankShiftHtml = `<span class="rank-shift-down" title="Caiu ${diff} posições">▼${diff}</span>`;
        } else {
            rankShiftHtml = `<span class="rank-shift-same">•</span>`;
        }

        let rankBadgeClass = 'rank-badge';
        let rankContent = rank;
        if (rank === 1) { rankBadgeClass += ' rank-top-1'; rankContent = '🥇'; }
        else if (rank === 2) { rankBadgeClass += ' rank-top-2'; rankContent = '🥈'; }
        else if (rank === 3) { rankBadgeClass += ' rank-top-3'; rankContent = '🥉'; }

        let rowClass = 'league-row';
        if (isUser) rowClass += ' current-user';
        if (rank <= 3) rowClass += ' zone-promotion';
        else if (rank >= 12 && conf.prevDivision) rowClass += ' zone-demotion';

        let zonePill = '';
        if (rank <= 3) {
            if (conf.nextDivision) {
                zonePill = `<span class="zone-tag zone-tag-promo" style="flex-shrink: 0; display: inline-flex; align-items: center; gap: 3px; white-space: nowrap;">⬆️<span class="desktop-text"> Promoção</span></span>`;
            } else {
                zonePill = `<span class="zone-tag zone-tag-promo" style="background: rgba(234, 179, 8, 0.15); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3); flex-shrink: 0; display: inline-flex; align-items: center; gap: 3px; white-space: nowrap;">👑<span class="desktop-text"> Pódio</span></span>`;
            }
        } else if (rank >= 12 && conf.prevDivision) {
            zonePill = `<span class="zone-tag zone-tag-demo" style="flex-shrink: 0; display: inline-flex; align-items: center; gap: 3px; white-space: nowrap;">⬇️<span class="desktop-text"> Rebaixamento</span></span>`;
        }

        return `
            <div class="${rowClass}">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 32px; flex-shrink: 0;">
                        <div class="${rankBadgeClass}">${rankContent}</div>
                        <div style="line-height: 1; margin-top: 2px;">${rankShiftHtml}</div>
                    </div>
                    <div class="league-avatar-badge">${c.avatar || '👤'}</div>
                    <div style="min-width: 0; flex: 1; display: flex; align-items: center; gap: 6px;">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 0 1 auto; font-weight: ${isUser ? '800' : '700'}; font-size: 0.95rem; color: var(--text);">
                            ${escapeHTML(c.name)}
                        </span>
                        ${isUser ? `<span class="badge" style="background: var(--primary); color: white; font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; flex-shrink: 0;">VOCÊ</span>` : ''}
                        ${zonePill}
                    </div>
                </div>
                <div style="font-weight: 800; font-size: 1rem; color: ${isUser ? 'var(--primary)' : 'var(--text)'}; flex-shrink: 0; white-space: nowrap; text-align: right; margin-left: 8px;">
                    ${(c.score || 0).toLocaleString()} XP
                </div>
            </div>
        `;
    }).join('');
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
    let totalXP = calculateTotalProgress(appData);

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

    // Checagem de Subida de Nível (Level Up)
    if (!appData.lastCelebratedLevel) {
        appData.lastCelebratedLevel = globalLevel;
    } else if (globalLevel > appData.lastCelebratedLevel) {
        const oldLvl = appData.lastCelebratedLevel;
        appData.lastCelebratedLevel = globalLevel;
        saveData(appData, { touch: false });
        showLevelUpModal(globalLevel, oldLvl, totalXP, xpStep);
    }
}

function renderLists() {
    const container = $('listsContainer');
    if (!container) return;
    if (appData.lists.length === 0) {
        container.innerHTML = '<div class="card" style="grid-column: 1/-1; text-align:center;">Você ainda não tem listas. Crie uma para começar!</div>';
        return;
    }

    const listsHtml = appData.lists.map(l => {
        const dueCount = (l.phrases || []).filter(p => isPhraseDue(p)).length;
        return `
            <div class="card" style="display: flex; flex-direction: column; gap: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                    <div style="flex: 1; min-width: 0;">
                        <h3 style="cursor: pointer; margin-bottom: 4px; overflow-wrap: break-word; line-height: 1.3;" onclick="selectList('${l.id}')">${escapeHTML(l.name)}</h3>
                        <div style="color: var(--text-muted); font-size: 0.85rem; font-weight: 600;">${l.phrases ? l.phrases.length : 0} frases • <span style="color: var(--danger)">${dueCount} revisões</span></div>
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
    }).join('');
    container.innerHTML = listsHtml;
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

    // Se estiver no Speed Run e clicou em uma palavra para ver o significado, pausa o avanço automático:
    if (typeof isSpeedRunSuccessActive !== 'undefined' && isSpeedRunSuccessActive) {
        srSuccessPausedByLookup = true;
        cancelSpeedRunSuccessAutoAdvance();
        const notice = $('srSuccessTimerNotice');
        if (notice) {
            notice.textContent = "⏸️ Pausado para você ver o significado com calma. Toque em 'Continuar ➔' quando terminar.";
            notice.style.color = "var(--warning)";
        }
    }
    const cleanWord = rawWord.replace(/[^a-zA-Z'\-]/g, '').trim();
    if (!cleanWord || cleanWord.length < 2) return;

    // Rastreamento para Badge "Explorador de Vocabulário" (5 consultas no dia)
    const today = new Date().toDateString();
    if (appData.lastDictLookupDate !== today) {
        appData.lastDictLookupDate = today;
        appData.dictLookupsToday = 0;
    }
    appData.dictLookupsToday = (appData.dictLookupsToday || 0) + 1;
    appData.dictLookupsCount = (appData.dictLookupsCount || 0) + 1;
    const qualifiesForExplorer = appData.dictLookupsToday >= 5;

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

    // Se atingiu o requisito de 5 consultas no dia, dispara o badge (será enfileirado e exibido com confetes assim que fechar a consulta da palavra)
    if (qualifiesForExplorer) {
        checkAndAwardBadge('word_explorer');
    }

    // Tradução com cache
    if (appData.translationCache && appData.translationCache[cleanWord.toLowerCase()]) {
        if ($('lookupWordTranslation')) $('lookupWordTranslation').textContent = appData.translationCache[cleanWord.toLowerCase()];
    } else {
        const res = await translateText(cleanWord, 'en', 'pt');
        if (res && res.translated) {
            if ($('lookupWordTranslation')) $('lookupWordTranslation').textContent = res.translated;
            if (!appData.translationCache) appData.translationCache = {};
            appData.translationCache[cleanWord.toLowerCase()] = res.translated;
            saveData(appData, { touch: false });
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

    if ($('currentListTitle')) $('currentListTitle').textContent = list.name;
    const container = $('phrasesContainer');
    if (!container) return;

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
    const cardsHtml = phrasesToRender.map(p => {
        const diff = (p.nextReview || 0) - now;
        const dueText = diff <= 0 ? 'Agora' : formatRelativeTime(diff);
        const dueClass = diff <= 0 ? 'color: var(--danger); font-weight: 800;' : 'color: var(--text-muted); font-size: 0.8rem;';

        return `
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
                        <button class="btn btn-outline btn-sm" onclick="showEditPhraseModal('${p.id}')" title="Editar Frase">✏️</button>
                        <button class="btn btn-outline btn-sm" onclick="showMovePhraseModal('${p.id}')" title="Mover">📁</button>
                        <button class="btn btn-outline btn-sm" style="color: var(--danger); border-color: transparent;" onclick="deletePhrase('${p.id}')">🗑️</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    container.innerHTML = cardsHtml;
}

let globalSearchDebounceTimer = null;

function handleGlobalSearch(query) {
    if (globalSearchDebounceTimer) {
        clearTimeout(globalSearchDebounceTimer);
    }
    const q = (query || '').toLowerCase().trim();
    const resultsContainer = $('searchResultsContainer');
    const resultsList = $('searchResultsList');
    const clearBtn = $('clearGlobalSearch');

    if (!q) {
        if (resultsContainer) resultsContainer.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
        renderLists(); // Refresh lists to show all
        return;
    }

    if (clearBtn) clearBtn.style.display = 'block';
    if (resultsContainer) resultsContainer.style.display = 'block';

    globalSearchDebounceTimer = setTimeout(() => {
        globalSearchDebounceTimer = null;
        executeGlobalSearch(q);
    }, 180);
}

function executeGlobalSearch(q) {
    const resultsList = $('searchResultsList');
    if (!resultsList) return;

    let foundAny = false;
    const now = Date.now();
    const matchesHtml = [];

    // Search phrases in all lists
    appData.lists.forEach(l => {
        const matches = (l.phrases || []).filter(p =>
            p.english.toLowerCase().includes(q) ||
            p.portuguese.toLowerCase().includes(q)
        );

        matches.forEach(p => {
            foundAny = true;
            const diff = (p.nextReview || 0) - now;
            const dueText = diff <= 0 ? 'Agora' : formatRelativeTime(diff);
            const dueClass = diff <= 0 ? 'color: var(--danger); font-weight: 800;' : 'color: var(--text-muted); font-size: 0.8rem;';

            matchesHtml.push(`
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
            `);
        });
    });

    if (!foundAny) {
        resultsList.innerHTML = '<div class="card" style="text-align:center; color:var(--text-muted);">Nenhuma frase encontrada em nenhuma lista.</div>';
    } else {
        resultsList.innerHTML = matchesHtml.join('');
    }

    // Also filter lists by name
    const listCards = $('listsContainer')?.children || [];
    Array.from(listCards).forEach(card => {
        const title = card.querySelector('h3')?.textContent.toLowerCase() || '';
        if (title.includes(q)) {
            card.style.display = 'flex';
        } else if (foundAny) {
            // If we found phrases, we hide lists that don't match the name to focus on results
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

    // Atualiza estatísticas da Galeria de Troféus, Pirâmide de Fluência e Badges
    renderTrophiesUI();
    renderFluencyPyramid();
    renderBadgesUI();

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
                saveData(appData, { touch: false });
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
                    saveData(appData, { touch: false });
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
            saveData(appData, { touch: false });
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
                saveData(appData, { touch: false });
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
                saveData(appData, { touch: false });
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
            saveData(appData, { touch: false });
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

    // Se não há frases com revisão geral vencida, mas o usuário escolheu um treino combinado:
    // Prioriza as próprias frases existentes do usuário que ainda não foram dominadas em pelo menos um dos modos selecionados
    if (allDue.length === 0 && Array.isArray(selectedMultiModes) && selectedMultiModes.length > 0) {
        const unmasteredPhrases = [];
        appData.lists.forEach(l => {
            if (!l.phrases) return;
            l.phrases.forEach(p => {
                const needsWork = selectedMultiModes.some(m => ((p.levels && p.levels[m] !== undefined) ? p.levels[m] : 0) < 5);
                if (needsWork) unmasteredPhrases.push(p);
            });
        });
        if (unmasteredPhrases.length > 0) {
            allDue = unmasteredPhrases;
        }
    }

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

    // Se não há frases com revisão geral vencida, mas o usuário escolheu um treino focado (Fala, Escrita, Escuta, Quiz):
    // Prioriza as próprias frases existentes do usuário que ainda não foram dominadas nessa habilidade
    if (allDue.length === 0 && mode !== 'standard') {
        const unmasteredPhrases = [];
        appData.lists.forEach(l => {
            if (!l.phrases) return;
            l.phrases.forEach(p => {
                const lvl = (p.levels && p.levels[mode] !== undefined) ? p.levels[mode] : 0;
                if (lvl < 5) unmasteredPhrases.push(p);
            });
        });
        if (unmasteredPhrases.length > 0) {
            allDue = unmasteredPhrases;
        }
    }

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

    // Se houver qualquer modal aberto ou celebrações na fila, não agenda avanço automático
    const modalBg = $('modalBg');
    const isModalOpen = modalBg && modalBg.style.display === 'flex';
    if (isModalOpen || (typeof celebrationQueue !== 'undefined' && celebrationQueue.length > 0)) {
        return;
    }

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

function getExerciseTimeForPhrase(phrase, mode) {
    const isWriteOrListen = mode === 'write' || mode === 'listen';
    const minSeconds = isWriteOrListen ? 30 : 20;

    const text = (phrase && phrase.english ? phrase.english : '').trim();
    if (!text) return minSeconds;

    const words = text.split(/\s+/).filter(Boolean).length;
    const chars = text.length;

    // Acrescenta em degraus de +5s (sempre múltiplo de 5)
    const extraByWords = Math.max(0, words - 5) * 5;
    const extraByChars = Math.max(0, Math.ceil((chars - 25) / 5)) * 5;
    const extraSeconds = Math.max(extraByWords, extraByChars);

    const total = Math.max(minSeconds, minSeconds + extraSeconds);
    return Math.ceil(total / 5) * 5;
}

function startExerciseTimer(seconds) {
    clearExerciseTimer();
    const minAllowed = (session.mode === 'write' || session.mode === 'listen') ? 30 : 20;
    const computedSeconds = typeof seconds === 'number' && seconds > 0
        ? Math.max(minAllowed, seconds)
        : getExerciseTimeForPhrase(session.current, session.mode);
    exerciseTotalTime = computedSeconds;
    exerciseTimeRemaining = computedSeconds;

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

function hideTimeUpNotice() {
    session.timedOut = false;
    const notice = $('timeUpNotice');
    if (notice) notice.style.display = 'none';
}

function handleExerciseTimeout() {
    if (!session.active || $('feedbackBar')?.classList.contains('active')) return;
    if (session.mode !== 'write' && session.mode !== 'listen' && session.mode !== 'pronounce' && session.mode !== 'speak') return;

    // O teste continua: apenas avisa que o tempo acabou e libera o botão "Não lembro".
    // Qualquer resposta dada daqui em diante conta como falha (perde XP e desce um nível).
    session.timedOut = true;
    const textEl = $('exerciseTimerText');
    if (textEl) textEl.textContent = '⏰ Tempo esgotado';
    const notice = $('timeUpNotice');
    if (notice) notice.style.display = 'flex';
}

function handleTimeUpDontRemember() {
    if (!session.current || !session.active) return;
    if ($('feedbackBar')?.classList.contains('active')) return;
    stopListening();
    processAnswer(false, 'Não lembro');
}

function nextPhrase() {
    // Reset mic state, audio, timers and feedback for the new phrase
    isRecognitionActive = false;
    stopListening();
    stopAllAudio();
    clearExerciseTimer();
    clearAutoAdvanceTimer();
    if ($('feedbackXPBadge')) $('feedbackXPBadge').style.display = 'none';

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
    hideTimeUpNotice();
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
        startExerciseTimer(getExerciseTimeForPhrase(p, 'write'));
        setTimeout(() => {
            $('writeInput').value = '';
            if (!$('modalBg') || $('modalBg').style.display !== 'flex') {
                $('writeInput').focus();
            }
        }, 100);
    } else if (session.mode === 'listen') {
        $('listenArea').style.display = 'block';
        $('listenInput').value = '';
        $('listenInputMirror').innerHTML = '';
        startExerciseTimer(getExerciseTimeForPhrase(p, 'listen'));
        setTimeout(() => playAudio(p.english), 500); // Play audio automatically
        setTimeout(() => {
            $('listenInput').value = '';
            if (!$('modalBg') || $('modalBg').style.display !== 'flex') {
                $('listenInput').focus();
            }
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
                if (!exerciseTimerInterval && !session.timedOut) startExerciseTimer(getExerciseTimeForPhrase(p, 'pronounce'));
                if (!isRecognitionActive) startListening();
            }
        });
    } else if (session.mode === 'speak') {
        $('speakArea').style.display = 'block';
        renderSpeechInitialState();
        startExerciseTimer(getExerciseTimeForPhrase(p, 'speak'));
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

        // Special handling for contractions being typed (like "don't" -> "do not")
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

        // Special handling for contractions being typed (like "don't" -> "do not")
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

    // Se o tempo já acabou, qualquer resposta (mesmo correta) conta como falha
    const wasTimedOut = !!session.timedOut;
    if (wasTimedOut && isCorrect) {
        isCorrect = false;
        userVal = '⏰ Tempo esgotado';
    }
    hideTimeUpNotice();

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

    // Snapshot para cálculo preciso de XP ganho/perdido de acordo com nível, tipo de teste, palavras e se é nova
    const prevPhraseXP = calculatePhraseXP(session.current);
    const prevStandardLevel = session.current.levels ? (session.current.levels.standard || 0) : 0;
    const wasNewWord = (!session.current.levels.quiz && !session.current.levels.write && !session.current.levels.listen && !session.current.levels.pronounce && !session.current.levels.speak);
    const wordsCount = getPhraseWordCount(session.current.english);

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
                session.current.levels[subMode] = Math.min(10, (session.current.levels[subMode] || 0) + 1);
            }
        } else {
            // Update level for the specific mode (teto de maestria no nível 10)
            session.current.levels[mode] = Math.min(10, (session.current.levels[mode] || 0) + 1);

            // If in standard mode, also update the specific sub-mode performed to ensure XP is gained
            if (mode === 'standard') {
                const subMode = session.mode; // e.g., 'quiz', 'write', 'speak'
                if (session.current.levels[subMode] !== undefined) {
                    session.current.levels[subMode] = Math.min(10, (session.current.levels[subMode] || 0) + 1);
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
        const isTimeout = wasTimedOut || (typeof userVal === 'string' && userVal.startsWith('⏰'));
        const isSkipped = userVal === 'Não lembro' || userVal === 'Não consigo pronunciar';
        const isVoiceMode = session.mode === 'speak' || session.mode === 'pronounce';
        const hasTypedAnswer = typeof userVal === 'string' && userVal.trim().length > 0 && !userVal.startsWith('⏰') && !isSkipped;

        let accuracy = 0;
        if (isVoiceMode) {
            const targetWords = session.current.english.split(' ');
            const correctCount = Object.values(session.wordStatus || {}).filter(v => v === 'correct' || v === 'imprecise').length;
            accuracy = Math.round((correctCount / targetWords.length) * 100);
        } else if (hasTypedAnswer) {
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
        } else if (hasTypedAnswer) {
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
            if (!$('modalBg') || $('modalBg').style.display !== 'flex') {
                $('correctionInput').focus();
            }

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

    // Atualização visual do XP ganho ou perdido no teste (levando em conta nível, tipo de teste, palavras e novidade)
    const newPhraseXP = calculatePhraseXP(session.current);
    let xpDelta = newPhraseXP - prevPhraseXP;
    if (xpDelta > 0) {
        if (typeof isXPBoostActive === 'function' && isXPBoostActive()) {
            const mult = getXPBoostMultiplier();
            const boostedDelta = Math.round(xpDelta * mult);
            const extraXP = boostedDelta - xpDelta;
            if (extraXP > 0) {
                if (!appData.missions) appData.missions = initMissionsData();
                appData.missions.bonusXP = (appData.missions.bonusXP || 0) + extraXP;
            }
            xpDelta = boostedDelta;
        }
        addLeagueXP(xpDelta);
    }

    // Registro de progresso nas Missões Diárias e Semanais
    if (typeof recordMissionProgress === 'function') {
        recordMissionProgress('reviews', 1);
        if (appData.currentListId) {
            recordMissionProgress('list_reviewed', 1, { listId: appData.currentListId });
        }
        if (isCorrect) {
            const newStandardLevel = session.current.levels ? (session.current.levels.standard || 0) : 0;
            if (newStandardLevel > prevStandardLevel) {
                recordMissionProgress('phrase_leveled', 1);
                if (newStandardLevel >= 5 && prevStandardLevel < 5) {
                    recordMissionProgress('phrase_mastered', 1);
                }
            }
            if (session.trainingMode === 'troublesome') {
                recordMissionProgress('troublesome_correct', 1);
            }
            if (session.trainingMode === 'multi') {
                recordMissionProgress('multimode_complete', 1);
            }
            if (session.mode) {
                recordMissionProgress('mode_correct', 1, { mode: session.mode });
            }
            if (session.correctStreak > 0) {
                recordMissionProgress('clean_streak', session.correctStreak);
                if (session.correctStreak >= 10 && session.correctStreak % 10 === 0) {
                    recordMissionProgress('perfect_combo', 1);
                }
            }
        }
    }

    // Rastreamento para Badges em tempo real
    if (isCorrect) {
        session.correctStreak = (session.correctStreak || 0) + 1;
        if (session.correctStreak > 0 && session.correctStreak % 10 === 0) {
            checkAndAwardBadge('perfect_streak');
        }
        if (session.mode === 'speak' || session.mode === 'pronounce') {
            session.speakCorrect = (session.speakCorrect || 0) + 1;
            if (session.speakCorrect > 0 && session.speakCorrect % 10 === 0) {
                checkAndAwardBadge('master_speaker');
            }
        }
        if (session.mode === 'write') {
            session.writeCorrect = (session.writeCorrect || 0) + 1;
            if (session.writeCorrect > 0 && session.writeCorrect % 10 === 0) {
                checkAndAwardBadge('typing_master');
            }
        }
    } else {
        session.correctStreak = 0;
    }

    // Checagem de Badges de Horário (Madrugador / Coruja Noturna) e Maratonista
    const currentHour = new Date().getHours();
    if (currentHour < 8) {
        checkAndAwardBadge('early_bird');
    } else if (currentHour >= 22) {
        checkAndAwardBadge('night_owl');
    }

    const today = new Date().toDateString();
    const todayReviews = getTodayReviewsCount(appData.history);
    if (todayReviews >= 30) {
        checkAndAwardBadge('marathoner');
    }

    const goal = (appData.settings && appData.settings.dailyGoal) ? parseInt(appData.settings.dailyGoal) : 50;

    // Checagem de Meta Diária batida em tempo real durante o teste
    if (todayReviews >= goal && appData.lastDailyGoalCelebratedDate !== today) {
        appData.lastDailyGoalCelebratedDate = today;
        if (typeof recordMissionProgress === 'function') {
            recordMissionProgress('daily_goal_met', 1);
        }
        let freezeAwarded = false;
        const freezes = appData.streakFreezes !== undefined ? appData.streakFreezes : 1;
        if (appData.lastStreakFreezeRewardDate !== today && freezes < 2) {
            appData.streakFreezes = freezes + 1;
            appData.lastStreakFreezeRewardDate = today;
            freezeAwarded = true;
            if ($('freezeCountSpan')) $('freezeCountSpan').textContent = appData.streakFreezes;
            if ($('freezeCountSpanSettings')) $('freezeCountSpanSettings').textContent = appData.streakFreezes;
            checkAndAwardBadge('streak_protector');
        } else if (freezes >= 2) {
            // Estoque de gelo já no máximo de 2: protegeu a sequência com escudo intacto e ganha/renova o badge!
            checkAndAwardBadge('streak_protector');
        }
        saveData(appData);
        showDailyGoalCelebrationModal(goal, todayReviews, freezeAwarded);
    }

    // Checagem de Marcos de Sequência & Troféus em tempo real durante o teste (Ferro, Bronze, Prata, Ouro)
    checkStreakMilestones(todayReviews, goal, today);

    const xpBadge = $('feedbackXPBadge');
    if (xpBadge) {
        xpBadge.style.display = 'inline-flex';
        const wordLabel = wordsCount === 1 ? '1 palavra' : `${wordsCount} palavras`;
        if (xpDelta > 0) {
            xpBadge.className = 'feedback-xp-badge gain';
            const newTag = wasNewWord ? '🌟 Palavra Nova • ' : '';
            const boostTag = (typeof isXPBoostActive === 'function' && isXPBoostActive()) ? ` ⚡x${getXPBoostMultiplier()}` : '';
            xpBadge.textContent = `+${xpDelta} XP (${newTag}${wordLabel}${boostTag})`;
        } else if (xpDelta < 0) {
            xpBadge.className = 'feedback-xp-badge loss';
            xpBadge.textContent = `${xpDelta} XP (${wordLabel})`;
        } else {
            xpBadge.className = 'feedback-xp-badge neutral';
            xpBadge.textContent = `0 XP (${wordLabel} • Nível 0)`;
        }
    }
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
        const lastDate = new Date(appData.lastReviewDate);
        const currDate = new Date(today);
        const diffDays = Math.round((currDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays <= 1) {
            // Estudo no dia seguinte consecutivo
            appData.streak++;
        } else {
            const daysMissed = diffDays - 1; // Quantidade de dias consecutivos sem estudar

            if (daysMissed > 0 && appData.streakFreezes && appData.streakFreezes >= daysMissed) {
                // Possui gelos suficientes para cobrir todos os dias em que não praticou
                appData.streakFreezes -= daysMissed;
                // O gelo protegeu os dias perdidos, então a prática de hoje soma à sequência!
                appData.streak++;
                saveData(appData);
                if ($('freezeCountSpan')) $('freezeCountSpan').textContent = appData.streakFreezes;
                if ($('freezeCountSpanSettings')) $('freezeCountSpanSettings').textContent = appData.streakFreezes;
                const freezeText = daysMissed === 1 ? "1 Gelo Protetor foi utilizado" : `${daysMissed} Gelos Protetores foram utilizados`;
                setTimeout(() => {
                    alert(`🧊 Ufa! Seu ${freezeText} para proteger sua sequência de ${appData.streak} dias de estudo!`);
                }, 600);
            } else {
                // Dias perdidos excederam os gelos disponíveis (reinicia sequência e ciclo de troféu atual)
                appData.streak = 1;
                appData.streakMilestoneProgress = 0;
            }
        }
    } else {
        appData.streak = 1;
        appData.streakMilestoneProgress = 0;
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
        if (typeof confetti === 'function') {
            try {
                confetti({
                    particleCount: 150,
                    spread: 70,
                    origin: { y: 0.6 },
                    colors: ['#6366f1', '#ec4899', '#10b981']
                });
            } catch (e) { }
        }
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
    "y'all": "you all", "ma'am": "madam", "ne'er": "never", "o'er": "over",
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

    // Standardize quotes and apostrophes first
    text = text.replace(/[’‘`]/g, "'");

    // Separate numbers from attached am/pm (e.g., "9am" -> "9 am", "9:00pm" -> "9:00 pm")
    text = text.replace(/(\d+)\s*(am|pm|a\.m\.|p\.m\.)\b/gi, '$1 $2');

    // Standardize all forms of o'clock attached to numbers or free-standing (e.g., "9o'clock" -> "9 oclock", "o'clock" -> "oclock", "o clock" -> "oclock")
    text = text.replace(/\bo['’`]?\s*clock\b/gi, 'oclock');
    text = text.replace(/(\d+)\s*oclock\b/gi, '$1 oclock');

    // Always expand contractions for comparison (ignores the setting for internal logic)
    text = expandContractions(text);

    // Convert times (H:MM or HH:MM) to words first
    text = text.replace(/(\d{1,2}):(\d{2})/g, (match, hours, minutes) => {
        const hourWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
            'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
            'twenty one', 'twenty two', 'twenty three', 'twenty four'];
        const onesWords = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
        const teenWords = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
        const tensWords = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];

        const h = parseInt(hours);
        const m = parseInt(minutes);
        let result = hourWords[h] || hours;

        if (m === 0) {
            // "9:00" spoken / transcribed as "nine o'clock" or "nine"
            result += ' oclock';
        } else if (m < 10) {
            // "9:05" -> "nine o five"
            result += ' o ' + onesWords[m];
        } else if (m < 20) {
            // "9:15" -> "nine fifteen", "9:10" -> "nine ten"
            result += ' ' + teenWords[m - 10];
        } else {
            // "9:30" -> "nine thirty", "9:45" -> "nine forty five", "9:25" -> "nine twenty five"
            const tens = tensWords[Math.floor(m / 10)] || '';
            const ones = m % 10 > 0 ? ' ' + onesWords[m % 10] : '';
            result += ' ' + tens + ones;
        }
        return result;
    });

    // Clean up duplicate 'oclock' (e.g. from "9:00 o'clock" -> "nine oclock oclock" -> "nine oclock")
    text = text.replace(/\boclock\s+oclock\b/g, 'oclock');

    // Convert digits to words for better matching (e.g., "10" -> "ten")
    const numMap = {
        '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
        '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten',
        '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen', '15': 'fifteen',
        '16': 'sixteen', '17': 'seventeen', '18': 'eighteen', '19': 'nineteen', '20': 'twenty',
        '30': 'thirty', '40': 'forty', '50': 'fifty', '60': 'sixty', '70': 'seventy', '80': 'eighty', '90': 'ninety', '100': 'one hundred'
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
function escapeJS(s) {
    if (!s) return '';
    return String(s)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/\n/g, ' ')
        .replace(/\r/g, '');
}

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
            if (!exerciseTimerInterval && !session.timedOut) startExerciseTimer(getExerciseTimeForPhrase(session.current, session.mode));
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
    const fragment = document.createDocumentFragment();

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

        fragment.appendChild(cell);
    }

    grid.appendChild(fragment);

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
let isSpeedRunSuccessActive = false;
let srSuccessTimer = null;
let srSuccessPausedByLookup = false;

function cancelSpeedRunSuccessAutoAdvance() {
    if (srSuccessTimer) {
        clearTimeout(srSuccessTimer);
        srSuccessTimer = null;
    }
}

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
    isSpeedRunSuccessActive = false;
    srSuccessPausedByLookup = false;
    cancelSpeedRunSuccessAutoAdvance();

    if ($('srSuccessArea')) $('srSuccessArea').style.display = 'none';
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
    cancelSpeedRunSuccessAutoAdvance();
    isSpeedRunSuccessActive = false;
    srSuccessPausedByLookup = false;

    if (speedRunSession.timer) {
        clearInterval(speedRunSession.timer);
        speedRunSession.timer = null;
    }
    speedRunSession.active = false;
    speedRunSession.isLastPhrase = false;
    isSkippingPhrase = false;
    if ($('srSuccessArea')) $('srSuccessArea').style.display = 'none';
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

    cancelSpeedRunSuccessAutoAdvance();
    isSpeedRunSuccessActive = false;
    isSkippingPhrase = false;
    srSuccessPausedByLookup = false;

    if ($('srSuccessArea')) $('srSuccessArea').style.display = 'none';
    if ($('srPhrasePt')) $('srPhrasePt').style.display = 'inline-block';
    if ($('srPhraseValueBadge')) $('srPhraseValueBadge').style.display = 'inline-block';
    if ($('srPhonetic')) $('srPhonetic').style.display = 'block';
    if ($('srSlotsContainer')) $('srSlotsContainer').style.display = 'flex';
    if ($('srTilesPool')) {
        $('srTilesPool').style.display = 'flex';
        $('srTilesPool').style.pointerEvents = 'auto';
        $('srTilesPool').style.opacity = '1';
    }
    if ($('srDefaultControls')) $('srDefaultControls').style.display = 'flex';
    if ($('srContinueControls')) $('srContinueControls').style.display = 'none';

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
            tileBtn.innerHTML = `<span>${tile.char}</span><span class="speedrun-tile-badge">${tile.totalCount}</span>`;
            tileBtn.addEventListener('click', () => srPickTile(tile.id));
            tilesPool.appendChild(tileBtn);
        });
    }
}

function updateTileBadge(tile, tileEl) {
    if (!tileEl) return;
    let badge = tileEl.querySelector('.speedrun-tile-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'speedrun-tile-badge';
        tileEl.appendChild(badge);
    }
    const count = Math.max(0, tile.remainingCount);
    badge.textContent = count;
    if (count === 0) {
        badge.classList.add('empty');
    } else {
        badge.classList.remove('empty');
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

    // Atualiza a tela: tile (NÃO desaparece mais, apenas fica esgotada com contador 0)
    const tileEl = $(tile.id);
    if (tileEl) {
        updateTileBadge(tile, tileEl);
        if (tile.used) {
            tileEl.classList.add('used');
        } else {
            tileEl.classList.remove('used');
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

function showSpeedRunSuccessScreen(bonusText) {
    isSpeedRunSuccessActive = true;
    srSuccessPausedByLookup = false;

    // Pausa imediatamente o cronômetro do jogo para não gastar tempo na tela de sucesso
    if (speedRunSession.timer) {
        clearInterval(speedRunSession.timer);
        speedRunSession.timer = null;
    }

    // Oculta área de digitação e controles normais
    if ($('srSlotsContainer')) $('srSlotsContainer').style.display = 'none';
    if ($('srTilesPool')) $('srTilesPool').style.display = 'none';
    if ($('srDefaultControls')) $('srDefaultControls').style.display = 'none';
    if ($('srContinueControls')) $('srContinueControls').style.display = 'none';
    if ($('srPhrasePt')) $('srPhrasePt').style.display = 'none';
    if ($('srPhraseValueBadge')) $('srPhraseValueBadge').style.display = 'none';
    if ($('srPhonetic')) $('srPhonetic').style.display = 'none';

    // Exibe tela de sucesso
    const successArea = $('srSuccessArea');
    if (successArea) {
        successArea.style.display = 'flex';
    }

    const phrase = speedRunSession.currentPhrase;
    if (phrase) {
        if ($('srSuccessEng')) $('srSuccessEng').innerHTML = makeWordsClickable(phrase.english);
        if ($('srSuccessPt')) $('srSuccessPt').textContent = phrase.portuguese || '';
        if ($('srSuccessPhonetic')) {
            const phon = getPhoneticGuide(phrase.english);
            $('srSuccessPhonetic').textContent = phon ? `🗣️ [ ${phon} ]` : '';
        }
    }

    if ($('srSuccessRewards')) {
        $('srSuccessRewards').innerHTML = bonusText || '🎉 Excelente!';
    }

    const timerNotice = $('srSuccessTimerNotice');
    if (timerNotice) {
        timerNotice.textContent = "Avançando para a próxima frase... (toque em uma palavra para ver significado com calma)";
        timerNotice.style.color = "var(--text-muted)";
    }

    const contBtn = $('srSuccessContinueBtn');
    if (contBtn) {
        if (speedRunSession.isLastPhrase || speedRunSession.timeLeft <= 0) {
            contBtn.textContent = 'Ver Pontuação ➔';
        } else {
            contBtn.textContent = 'Continuar ➔';
        }
        contBtn.focus();
    }
}

function srContinueAfterSuccess() {
    if (!speedRunSession.active || !isSpeedRunSuccessActive) return;
    isSpeedRunSuccessActive = false;
    srSuccessPausedByLookup = false;
    cancelSpeedRunSuccessAutoAdvance();

    if ($('srSuccessArea')) $('srSuccessArea').style.display = 'none';

    // Se o tempo acabou ou era a última pergunta, finaliza e mostra o resultado
    if (speedRunSession.isLastPhrase || speedRunSession.timeLeft <= 0) {
        finishSpeedRun();
        return;
    }

    loadNextSpeedRunPhrase();

    // Retoma o cronômetro do jogo
    if (!speedRunSession.timer) {
        speedRunSession.timer = setInterval(speedRunTick, 1000);
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
        saveData(appData);

        // Exibe tela de sucesso e toca o áudio da frase com calma
        showSpeedRunSuccessScreen(bonusText);

        if (speedRunSession.currentPhrase && speedRunSession.currentPhrase.english) {
            playAudio(speedRunSession.currentPhrase.english, 'en-US', () => {
                // Ao terminar o áudio, aguarda 1.8 segundos antes de ir para a próxima (se não pausado por consulta de vocabulário)
                if (isSpeedRunSuccessActive && !srSuccessPausedByLookup) {
                    cancelSpeedRunSuccessAutoAdvance();
                    srSuccessTimer = setTimeout(() => {
                        if (isSpeedRunSuccessActive && !srSuccessPausedByLookup) {
                            srContinueAfterSuccess();
                        }
                    }, 1800);
                }
            });
        }

        // Temporizador de avanço automático seguro caso o áudio não dispare
        cancelSpeedRunSuccessAutoAdvance();
        srSuccessTimer = setTimeout(() => {
            if (isSpeedRunSuccessActive && !srSuccessPausedByLookup) {
                srContinueAfterSuccess();
            }
        }, 5000);
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
    cancelSpeedRunSuccessAutoAdvance();
    isSpeedRunSuccessActive = false;
    srSuccessPausedByLookup = false;
    if ($('srSuccessArea')) $('srSuccessArea').style.display = 'none';

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

        if (typeof isXPBoostActive === 'function' && isXPBoostActive()) {
            earnedXP = Math.round(earnedXP * getXPBoostMultiplier());
        }

        appData.speedRunXP = (appData.speedRunXP || 0) + earnedXP;
        addLeagueXP(earnedXP);
    }

    if (typeof recordMissionProgress === 'function') {
        recordMissionProgress('speedrun_score', speedRunSession.score || 0);
    }

    const prevHighScore = appData.speedRunHighScore || 0;
    const isNewRecord = speedRunSession.score > 0 && speedRunSession.score > prevHighScore;

    if (isNewRecord) {
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

    // Rastreamento para Badges no fim do Speed Run (enfileiradas de forma limpa para celebrar após o resultado)
    if (speedRunSession.score >= 500) {
        checkAndAwardBadge('speed_runner');
    }
    const currentHour = new Date().getHours();
    if (currentHour < 8) {
        checkAndAwardBadge('early_bird');
    } else if (currentHour >= 22) {
        checkAndAwardBadge('night_owl');
    }

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

let pendingSpeedRunRestart = false;

function handleSpeedRunPlayAgain() {
    if (typeof celebrationQueue !== 'undefined' && celebrationQueue.length > 0) {
        pendingSpeedRunRestart = true;
        closeModal();
    } else {
        closeModal();
        startSpeedRun();
    }
}

function isPhraseDuplicate(english, ignorePhraseId = null) {
    const norm = normalizeText(english);
    for (const list of appData.lists) {
        if (list.phrases.some(p => p.id !== ignorePhraseId && normalizeText(p.english) === norm)) return true;
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

// Centralized Modal Management & Celebration Queue
let celebrationQueue = [];
let isExerciseTimerPaused = false;
let isSpeedRunPaused = false;

function pauseExerciseTimer() {
    if (typeof exerciseTimerInterval !== 'undefined' && exerciseTimerInterval) {
        clearInterval(exerciseTimerInterval);
        exerciseTimerInterval = null;
        isExerciseTimerPaused = true;
    }
}

function resumeExerciseTimer() {
    if (isExerciseTimerPaused && typeof exerciseTimeRemaining === 'number' && exerciseTimeRemaining > 0 && typeof session !== 'undefined' && session.active && !$('feedbackBar')?.classList.contains('active')) {
        isExerciseTimerPaused = false;
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
    } else {
        isExerciseTimerPaused = false;
    }
}

function pauseSpeedRunTimer() {
    if (typeof speedRunSession !== 'undefined' && speedRunSession.active && speedRunSession.timer) {
        clearInterval(speedRunSession.timer);
        speedRunSession.timer = null;
        isSpeedRunPaused = true;
    }
}

function resumeSpeedRunTimer() {
    if (isSpeedRunPaused && typeof speedRunSession !== 'undefined' && speedRunSession.active && speedRunSession.timeLeft > 0) {
        isSpeedRunPaused = false;
        if (typeof startSpeedRunTimer === 'function') {
            startSpeedRunTimer();
        }
    } else {
        isSpeedRunPaused = false;
    }
}

function openCelebrationModal(modalId, setupFn) {
    const modalBg = $('modalBg');
    const isModalVisible = modalBg && modalBg.style.display === 'flex';

    if (isModalVisible || (typeof speedRunSession !== 'undefined' && speedRunSession.active)) {
        celebrationQueue.push({ modalId, setupFn });
        return;
    }

    if (setupFn) {
        try { setupFn(); } catch (e) { console.error('Erro ao configurar modal de celebração:', e); }
    }
    openModal(modalId);
}

function openModal(modalId) {
    // 1. Fecha teclado imediatamente no celular (remove foco de qualquer input ativo)
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        try { document.activeElement.blur(); } catch (e) { }
    }

    // 2. Cancela qualquer auto-avanço agendado para não pular de frase debaixo do modal
    if (typeof clearAutoAdvanceTimer === 'function') clearAutoAdvanceTimer();
    if (typeof cancelSpeedRunSuccessAutoAdvance === 'function') cancelSpeedRunSuccessAutoAdvance();

    // 3. Pausa microfone se estiver ouvindo
    if (typeof isRecognitionActive !== 'undefined' && isRecognitionActive) {
        isRecognitionActive = false;
        if (typeof stopListening === 'function') stopListening();
    }

    // 4. Pausa cronômetros dos testes
    pauseExerciseTimer();
    pauseSpeedRunTimer();

    const modalBg = $('modalBg');
    if (!modalBg) return;
    // Hide all children of modalBg
    const modals = modalBg.children;
    for (let m of modals) {
        m.style.display = 'none';
    }
    // Show background and the specific modal
    modalBg.style.display = 'flex';
    if ($(modalId)) $(modalId).style.display = 'block';

    // Scroll Lock
    document.body.classList.add('modal-open');

    // Autofocus suave no primeiro input visível do modal aberto (desktop)
    setTimeout(() => {
        const modal = $(modalId);
        if (modal) {
            const firstInput = modal.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])');
            if (firstInput && typeof firstInput.focus === 'function' && window.innerWidth > 600) {
                firstInput.focus();
            }
        }
    }, 60);
}

function closeModal() {
    // Garante que o teclado fique fechado
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        try { document.activeElement.blur(); } catch (e) { }
    }

    // Verifica se há outra celebração na fila (ex: Badge ganho + Level Up + Ultrapassagem na Liga)
    if (celebrationQueue.length > 0) {
        const next = celebrationQueue.shift();
        if (next.setupFn) {
            try { next.setupFn(); } catch (e) { console.error(e); }
        }
        openModal(next.modalId);
        return;
    }

    if ($('modalBg')) $('modalBg').style.display = 'none';
    document.body.classList.remove('modal-open');

    // Retoma cronômetros apenas se todos os modais forem fechados
    resumeExerciseTimer();
    resumeSpeedRunTimer();

    // Se havia um reinício do Speed Run agendado para após os modais de celebração:
    if (typeof pendingSpeedRunRestart !== 'undefined' && pendingSpeedRunRestart) {
        pendingSpeedRunRestart = false;
        startSpeedRun();
        return;
    }

    // Se o usuário estava no meio de uma pergunta ativa (sem feedback ativo na tela):
    if (typeof session !== 'undefined' && session.active && !$('feedbackBar')?.classList.contains('active')) {
        const isVoiceMode = session.mode === 'speak' || session.mode === 'pronounce';
        if (isVoiceMode && !isRecognitionActive && typeof startListening === 'function') {
            startListening();
        } else if (session.mode === 'write') {
            const writeInput = $('writeInput');
            if (writeInput && typeof writeInput.focus === 'function') {
                setTimeout(() => writeInput.focus(), 60);
            }
        }
    }
}

// Override default alert/confirm with premium system dialog
window.alert = function (msg, title = "Aviso", icon = "ℹ️", onConfirm = null) {
    if ($('dialogTitle')) $('dialogTitle').textContent = title;
    if ($('dialogMessage')) $('dialogMessage').textContent = msg;
    if ($('dialogIcon')) $('dialogIcon').textContent = icon;
    if ($('dialogCancel')) $('dialogCancel').style.display = 'none';
    if ($('dialogConfirm')) {
        $('dialogConfirm').onclick = () => {
            closeDialog();
            if (onConfirm) onConfirm();
        };
    }

    openModal('systemDialog');
};

window.confirm = function (msg, onConfirm, title = "Confirmação") {
    if ($('dialogTitle')) $('dialogTitle').textContent = title;
    if ($('dialogMessage')) $('dialogMessage').textContent = msg;
    if ($('dialogIcon')) $('dialogIcon').textContent = "❓";
    if ($('dialogCancel')) {
        $('dialogCancel').style.display = 'block';
        $('dialogCancel').onclick = closeDialog;
    }
    if ($('dialogConfirm')) {
        $('dialogConfirm').onclick = () => {
            closeDialog();
            if (onConfirm) onConfirm();
        };
    }

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
                    updateUI();
                    renderTrophiesUI();
                    renderBadgesUI();
                    renderLeagueCardHome();
                    if (typeof renderMissionsUI === 'function') renderMissionsUI();
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

function splitIntoSentences(line) {
    if (!line) return [];
    // Separa por ., ! ou ? preservando abreviações comuns (Mr., Mrs., Dr., a.m., p.m., etc.) e números decimais (3.5)
    const matches = line.match(/(?:Mr\.|Mrs\.|Ms\.|Dr\.|St\.|Prof\.|a\.m\.|p\.m\.|A\.M\.|P\.M\.|\d+\.\d+|[^.!?])+[.!?]*\s*/gi);
    if (!matches) return [line.trim()].filter(Boolean);
    return matches.map(s => s.trim()).filter(Boolean);
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

    const lines = rawInput.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    const hasSemicolonLines = lines.some(l => l.includes(';'));

    // Helper para traduzir e adicionar uma frase em um único idioma (EN ou PT)
    const translateAndAddSinglePhrase = async (phrase) => {
        const cleanPhrase = phrase.trim();
        if (!cleanPhrase) return;
        const res = await translateText(cleanPhrase, 'auto', 'pt');
        if (res) {
            let eng = '', pt = '';
            const likelyPt = res.detected === 'pt' || isProbablyPortuguese(cleanPhrase) || (res.translated === cleanPhrase && /[áàãâéêíóôúçÁÀÃÂÉÊÍÓÔÚÇ]/.test(cleanPhrase));

            if (likelyPt) {
                const resEng = await translateText(cleanPhrase, 'pt', 'en');
                eng = resEng ? resEng.translated : '';
                pt = cleanPhrase;
            } else {
                eng = cleanPhrase;
                pt = res.translated;
            }

            if (eng && pt) {
                if (isPhraseDuplicate(eng)) {
                    duplicateCount++;
                    return;
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
    };

    if (hasSemicolonLines) {
        // Processa linha por linha preservando pontos finais antes/depois do ponto e vírgula (Inglês; Português)
        for (let line of lines) {
            if (line.includes(';')) {
                const [rawPart1, ...rest] = line.split(';');
                const part1 = rawPart1 ? rawPart1.trim() : '';
                const part2 = rest.join(';').trim();

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
                } else if (part1 && autoTranslate) {
                    const sentences = splitIntoSentences(part1);
                    for (let s of sentences) {
                        await translateAndAddSinglePhrase(s);
                    }
                }
            } else if (autoTranslate) {
                const sentences = splitIntoSentences(line);
                for (let s of sentences) {
                    await translateAndAddSinglePhrase(s);
                }
            }
        }
    } else {
        // Separa todas as linhas em frases individuais (por ., !, ? e quebras de linha)
        let allSentences = [];
        for (let line of lines) {
            allSentences.push(...splitIntoSentences(line));
        }

        // Verifica se o texto parece ser apenas em um idioma (ex.: texto todo em inglês)
        const hasAnyPt = allSentences.some(s => isProbablyPortuguese(s));
        const shouldAutoTranslate = autoTranslate || !hasAnyPt || allSentences.length === 1;

        if (shouldAutoTranslate) {
            for (let phrase of allSentences) {
                await translateAndAddSinglePhrase(phrase);
            }
        } else if (allSentences.length >= 2) {
            // MODO MANUAL SEM ';': pareamento de frases (frase 1 = eng, frase 2 = pt, etc.)
            for (let i = 0; i < allSentences.length; i += 2) {
                const eng = allSentences[i];
                const pt = allSentences[i + 1];
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
        if (isModalOpen && e.key === 'Escape') {
            e.preventDefault();
            closeModal();
            return;
        }
        if (isModalOpen && (e.key === 'Enter' || e.key === ' ' || e.code === 'Space')) {
            // Se for um modal sem campos de texto (ex: celebração de badges, troféus, subida de nível), Enter ou Espaço avança/fecha suavemente
            const activeCard = $('modalBg').querySelector('.card:not([style*="display: none"])');
            const hasInput = activeCard && activeCard.querySelector('input:not([type="hidden"]), textarea');
            if (activeCard && !hasInput) {
                e.preventDefault();
                closeModal();
                return;
            }
            if (e.key === 'Enter') return; // Deixa o modal com input tratar o Enter
        }

        // Atalhos de teclado no modo Speed Run
        if (typeof speedRunSession !== 'undefined' && speedRunSession.active && !isModalOpen) {
            if (isSkippingPhrase || (typeof isSpeedRunSuccessActive !== 'undefined' && isSpeedRunSuccessActive)) {
                if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
                    e.preventDefault();
                    if (isSkippingPhrase) {
                        srContinueAfterSkip();
                    } else if (isSpeedRunSuccessActive) {
                        srContinueAfterSuccess();
                    }
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

    checkBadgeExpirations(true);
    applyDarkMode();
    showView('homeView');

    // Stop mic if user leaves the tab, and check for updates and league when returning
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopListening();
        } else {
            checkVersionAndUpdateAutomatically();
            updateBotScoresOnAppEntry(true);
            checkBadgeExpirations(true);
        }
    });

    window.addEventListener('focus', () => {
        updateBotScoresOnAppEntry(true);
        checkBadgeExpirations(true);
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

    // Garante que o cronômetro proporcional inicie caso o usuário tenha ativado o microfone antes do áudio terminar
    const isResultVisible = $('feedbackBar')?.classList.contains('active');
    if (session.active && !isResultVisible && (session.mode === 'pronounce' || session.mode === 'speak') && !exerciseTimerInterval && !session.timedOut) {
        startExerciseTimer(getExerciseTimeForPhrase(session.current, session.mode));
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

            // Special matching for time-related target words:
            // a) If target word is "oclock" (from "o'clock"), accept if heard contains "oclock" or "clock"
            if (ntw === 'oclock' && /\b(oclock|clock)\b/i.test(heard)) {
                session.wordStatus[targetIdx] = 'correct';
                return;
            }

            // b) If target word is a composite time ending in " oclock" (e.g. target was "9:00" -> "nine oclock")
            // accept if heard contains the hour part (e.g. "nine")
            if (ntw.endsWith(' oclock')) {
                const hourOnly = ntw.replace(/\s+oclock$/, '');
                if (new RegExp(`\\b${hourOnly}\\b`, 'i').test(heard)) {
                    session.wordStatus[targetIdx] = 'correct';
                    return;
                }
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
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
            isRecognitionActive = false;
            if (btn) btn.classList.remove('listening');
            if (status) {
                status.textContent = "⚠️ Microfone bloqueado ou sem permissão";
                status.style.color = "var(--danger)";
            }
        }
        console.warn('Speech error:', e.error);
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
            } else if (recentAttempt[idx] === ntw || (ntw === 'oclock' && (recentAttempt[idx] === 'clock' || recentAttempt[idx] === 'oclock'))) {
                displayedHTML += `<span style="color: var(--success); font-weight: 700;">${targetWords[idx]}</span> `;
            } else if (heardWords.includes(ntw) || (ntw === 'oclock' && (heardWords.includes('clock') || heardWords.includes('oclock')))) {
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
        let deletedXP = 0;
        appData.lists.forEach(l => {
            if (!l.phrases) return;
            const target = l.phrases.find(p => p.id === id);
            if (target) {
                deletedXP += calculatePhraseXP(target);
            }
            l.phrases = l.phrases.filter(p => p.id !== id);
        });
        // Preserva o XP conquistado para o usuário não regredir de nível
        if (deletedXP > 0) {
            appData.archivedPhraseXP = (appData.archivedPhraseXP || 0) + deletedXP;
        }
        saveData(appData);
        renderPhrases();
        renderStats();
    });
}

function deleteList(id) {
    confirm("Tem certeza que deseja apagar esta lista e todas as suas frases?", () => {
        const listToDelete = appData.lists.find(l => l.id === id);
        if (listToDelete && listToDelete.phrases) {
            let deletedXP = 0;
            listToDelete.phrases.forEach(p => {
                deletedXP += calculatePhraseXP(p);
            });
            if (deletedXP > 0) {
                appData.archivedPhraseXP = (appData.archivedPhraseXP || 0) + deletedXP;
            }
        }
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
    if (targetSelect) {
        const optionsHtml = ['<option value="new">✨ Criar Nova Lista</option>'];
        (appData.lists || []).forEach(l => {
            optionsHtml.push(`<option value="${l.id}">📁 Adicionar em: ${escapeHTML(l.name)}</option>`);
        });
        targetSelect.innerHTML = optionsHtml.join('');
    }

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
    if (typeof confetti === 'function') {
        try {
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 }
            });
        } catch (e) { }
    }

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

function findPhraseById(phraseId) {
    for (const list of appData.lists) {
        const phrase = list.phrases.find(p => p.id === phraseId);
        if (phrase) return { phrase, list };
    }
    return null;
}

function showEditPhraseModal(phraseId) {
    const item = findPhraseById(phraseId);
    if (!item) return;
    const { phrase } = item;

    $('editPhraseId').value = phrase.id;
    $('editPhraseEng').value = phrase.english;
    $('editPhrasePt').value = phrase.portuguese;

    openModal('editPhraseModal');
    setTimeout(() => {
        const input = $('editPhraseEng');
        if (input) {
            input.focus();
            input.select();
        }
    }, 150);
}

function saveEditedPhrase() {
    const phraseId = $('editPhraseId').value;
    const eng = $('editPhraseEng').value.trim();
    const pt = $('editPhrasePt').value.trim();

    if (!eng || !pt) {
        alert("Preencha os campos em inglês e português.", "Campos Obrigatórios", "⚠️");
        return;
    }

    if (isPhraseDuplicate(eng, phraseId)) {
        alert("Esta frase em inglês já existe em uma de suas listas!", "Frase Duplicada", "⚠️");
        return;
    }

    const item = findPhraseById(phraseId);
    if (!item) return;
    const { phrase } = item;

    phrase.english = eng;
    phrase.portuguese = pt;

    if (session.current && session.current.id === phraseId) {
        session.current.english = eng;
        session.current.portuguese = pt;
    }

    saveData(appData);
    prefetchMissingPhonetics();
    renderPhrases($('phraseSearchInput')?.value || '');
    renderStats();
    closeModal();

    setTimeout(() => {
        const el = $(`phrase-${phraseId}`);
        if (el) {
            el.style.border = '2px solid var(--primary)';
            el.style.boxShadow = '0 0 25px var(--primary-soft)';
            setTimeout(() => {
                el.style.border = '';
                el.style.boxShadow = '';
            }, 1800);
        }
    }, 100);
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

    let isDismissed = false;
    const dismissLoadingScreen = () => {
        if (isDismissed) return;
        isDismissed = true;

        try {
            updateBotScoresOnAppEntry(true);
            renderStats();
            renderLeagueCardHome();
            if (typeof renderMissionsUI === 'function') renderMissionsUI();
            startCountdownInterval();
        } catch (uiErr) {
            console.error("Erro ao inicializar stats na UI:", uiErr);
        }

        if (loadingScreen) {
            loadingScreen.classList.add('fade-out');
        }

        if (appContainer) {
            appContainer.style.display = 'flex';
            setTimeout(() => {
                appContainer.style.opacity = '1';

                // Se houver aviso pendente de queda de posição na liga semanal, exibe logo na entrada
                if (pendingLeagueDropData) {
                    showLeagueDropModal(pendingLeagueDropData);
                    pendingLeagueDropData = null;
                }

                // Iniciar Tutorial se for a primeira vez
                if (appData.settings && !appData.settings.tutorialCompleted) {
                    setTimeout(startTutorial, 1200);
                }
            }, 300);
        }

        // Remover o splash do DOM após a animação para liberar recursos
        setTimeout(() => {
            if (loadingScreen && loadingScreen.parentNode) {
                loadingScreen.remove();
            }
        }, 1000);
    };

    // Watchdog de segurança absoluto: NUNCA deixa a tela de splash travada
    // Garante que o aplicativo abra em no máximo 2.5s mesmo em caso de erro, lentidão ou queda de conexão
    const watchdogTimer = setTimeout(() => {
        console.warn("Watchdog acionado: transição forçada para a tela principal.");
        dismissLoadingScreen();
    }, 2500);

    try {
        // 1. Renderizar Status inicial (offline) e tema
        renderSyncStatus();
        applyDarkMode();

        // 2. Se logado, tentar sincronizar com timeout protetor de 2s para não atrasar a abertura
        if (appData.auth && appData.auth.isLoggedIn) {
            if (navigator.onLine) {
                if (loadingStatus) loadingStatus.textContent = "Sincronizando com a nuvem...";
                await Promise.race([
                    syncWithCloud(false, true),
                    new Promise(r => setTimeout(r, 2000))
                ]);
            } else {
                if (loadingStatus) loadingStatus.textContent = "Modo Offline";
                await new Promise(r => setTimeout(r, 600));
            }
        } else {
            if (loadingStatus) loadingStatus.textContent = "Pronto!";
            await new Promise(r => setTimeout(r, 400));
        }
    } catch (e) {
        console.warn("Aviso na inicialização do app:", e);
    } finally {
        clearTimeout(watchdogTimer);
        dismissLoadingScreen();
    }
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
