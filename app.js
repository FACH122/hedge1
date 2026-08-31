    'use strict';
    // ================= CONFIG =================
    const SUPABASE_URL = 'https://cahufgydkmeqjxgamnxy.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhaHVmZ3lka21lcWp4Z2Ftbnh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2ODkzNTIsImV4cCI6MjEwMzI2NTM1Mn0.3ZqR71brJbGLjrYqCR1ZNQ-zutOaLSa6hSb8oTN7os4';
    const VOICE_NOTE_FILE = 'voice.mp3';

    if (location.search.includes('reset')) {
        ['solvedIds', 'herName'].forEach(k => localStorage.removeItem(k));
    }

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
    }

    // ================= STATE =================
    let puzzles = [];
    let solvedIds = JSON.parse(localStorage.getItem('solvedIds') || '[]');
    if (!Array.isArray(solvedIds)) solvedIds = [];
    let texts = {};
    let interactions = {};
    let poemData = null;
    let activeBox = null;
    let boxShownAt = 0;
    let lastTypedSent = '';

    function getHerName() { return localStorage.getItem('herName') || 'هاجَر'; }

    // ================= HELPERS =================
    const $id = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    function showToast(msg) {
        const t = $id('toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(showToast._t);
        showToast._t = setTimeout(() => t.classList.remove('show'), 2600);
    }
    function normAnswer(s) {
        return String(s).trim().replace(/[أإآ]/g, 'ا').replace(/[ةه]/g, 'ه').replace(/[\s\u064B-\u0652]/g, '').toLowerCase();
    }
    function playChime() {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const ctx = new AC();
            [261.63, 329.63, 392.00, 523.25].forEach((freq, i) => {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'sine'; o.frequency.value = freq;
                g.gain.setValueAtTime(0, ctx.currentTime);
                g.gain.linearRampToValueAtTime(0.055, ctx.currentTime + 0.1 + i * 0.15);
                g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.4 + i * 0.2);
                o.connect(g); g.connect(ctx.destination);
                o.start(ctx.currentTime + i * 0.15); o.stop(ctx.currentTime + 3);
            });
        } catch (e) {}
    }

    // ================= INSTALL =================
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredPrompt = e;
        $id('install-btn').style.display = 'block';
    });
    $id('install-btn').addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        $id('install-btn').style.display = 'none';
    });
    window.addEventListener('appinstalled', () => { $id('install-btn').style.display = 'none'; });

    // ================= MUSIC =================
    let musicCtx = null, musicOn = false, musicTimer = null;
    const SCALE = [220, 261.63, 293.66, 329.63, 392, 440, 523.25];
    function ambientNote() {
        if (!musicCtx || !musicOn) return;
        try {
            const now = musicCtx.currentTime;
            const freq = SCALE[Math.floor(Math.random() * SCALE.length)] * (Math.random() > 0.7 ? 2 : 1);
            const o = musicCtx.createOscillator(), g = musicCtx.createGain();
            o.type = Math.random() > 0.5 ? 'sine' : 'triangle';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0, now);
            g.gain.linearRampToValueAtTime(0.03, now + 0.6);
            g.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
            o.connect(g); g.connect(musicCtx.destination);
            o.start(now); o.stop(now + 3.4);
        } catch (e) {}
    }
    let songAudio = null;
    $id('music-btn').addEventListener('click', () => {
        try {
            musicOn = !musicOn;
            $id('music-btn').classList.toggle('playing', musicOn);
            $id('music-btn').textContent = musicOn ? '♫' : '♪';
            if (interactions.songUrl) {
                if (!songAudio) {
                    songAudio = new Audio(interactions.songUrl);
                    songAudio.loop = true;
                    songAudio.volume = 0.55;
                }
                if (musicOn) {
                    songAudio.play().catch(() => {});
                    showToast('♪ أغنيتكِ المفضلة');
                } else {
                    songAudio.pause();
                }
            } else {
                if (!musicCtx) musicCtx = new (window.AudioContext || window.webkitAudioContext)();
                if (musicOn) { ambientNote(); musicTimer = setInterval(ambientNote, 1600); showToast('♪ موسيقى هادئة لكِ وحدك'); }
                else clearInterval(musicTimer);
            }
        } catch (e) {}
    });

    // ================= FX CANVAS =================
    const canvas = document.getElementById('fx-canvas');
    const fctx = canvas.getContext('2d');
    let W, H;
    function sizeFx() { W = canvas.width = innerWidth; H = canvas.height = innerHeight; }
    sizeFx();
    addEventListener('resize', sizeFx);

    const dust = [], sparks = [], confetti = [];
    for (let i = 0; i < 50; i++) {
        dust.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight,
            r: Math.random() * 1.8 + 0.4, vy: -(Math.random() * 0.35 + 0.08),
            vx: (Math.random() - 0.5) * 0.15, a: Math.random() * 0.45 + 0.12, tw: Math.random() * 6.28 });
    }
    function burst(x, y, n = 90) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * 6.283, sp = Math.random() * 7 + 2;
            confetti.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3,
                s: Math.random() * 5 + 2, rot: Math.random() * 3.14, vr: (Math.random() - 0.5) * 0.25,
                life: 1, hue: 38 + Math.random() * 20 });
        }
    }
    addEventListener('pointermove', e => {
        if (Math.random() > 0.55) sparks.push({ x: e.clientX, y: e.clientY, life: 1, r: Math.random() * 2.2 + 0.8 });
    });
    function fxLoop() {
        fctx.clearRect(0, 0, W, H);
        for (const p of dust) {
            p.tw += 0.02; p.x += p.vx; p.y += p.vy;
            if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
            fctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(p.tw));
            fctx.fillStyle = '#d8c29a';
            fctx.beginPath(); fctx.arc(p.x, p.y, p.r, 0, 6.283); fctx.fill();
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
            const s = sparks[i]; s.life -= 0.045;
            if (s.life <= 0) { sparks.splice(i, 1); continue; }
            fctx.globalAlpha = s.life * 0.8;
            fctx.fillStyle = '#ffffff';
            fctx.beginPath(); fctx.arc(s.x, s.y, s.r * s.life, 0, 6.283); fctx.fill();
        }
        for (let i = confetti.length - 1; i >= 0; i--) {
            const c = confetti[i];
            c.vy += 0.12; c.x += c.vx; c.y += c.vy; c.rot += c.vr; c.life -= 0.008;
            if (c.life <= 0 || c.y > H + 20) { confetti.splice(i, 1); continue; }
            fctx.save();
            fctx.globalAlpha = Math.min(c.life, 1);
            fctx.translate(c.x, c.y); fctx.rotate(c.rot);
            fctx.fillStyle = `hsl(${c.hue}, 80%, ${70 + (c.hue % 12)}%)`;
            fctx.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2);
            fctx.restore();
        }
        fctx.globalAlpha = 1;
        requestAnimationFrame(fxLoop);
    }
    fxLoop();

    // ================= SECRET LETTER (logo x5) =================
    let taps = 0, tapT = null;
    $id('brand-logo').addEventListener('click', () => {
        taps++;
        clearTimeout(tapT);
        tapT = setTimeout(() => taps = 0, 1800);
        if (taps >= 3 && taps < 5) showToast(`✦ ${5 - taps}... استمري`);
        if (taps >= 5) {
            taps = 0;
            playChime();
            burst(innerWidth / 2, innerHeight / 2, 130);
            $id('letter-modal').classList.add('open');
        }
    });
    document.querySelectorAll('.modal-close[data-close]').forEach(b =>
        b.addEventListener('click', () => $id(b.dataset.close).classList.remove('open')));
    document.querySelectorAll('.modal-overlay').forEach(ov =>
        ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); }));

    // ================= POEM PAGE =================
    const DEFAULT_POEM = [
        ['لا أعرف متى حدث ذلك','كلُّ مساءٍ...','تُعلِّمينَ العيونَ','كيف تُغمِضُ خوفَها،','ثم تعودينَ','وعيناكِ...','لا تعرفانِ النوم.','أفكِّرُ أحيانًا...','حينَ يسلِّمُ الناسُ','أحلامَهم','إلى يديكِ،','إلى مَن','**تُسلِّمينَ تعبَكِ؟'],
        ['رأيتُ المطرَ','يسقطُ ألفَ مرَّة،','لكنِّي','لم أرَهُ يومًا','يختارُ وردةً بعينِها.','**إلَّا قلبي...','**منذُ رآكِ.'],
        ['غريبٌ...','أنَّ امرأةً','تجعلُ الآخرينَ','ينسونَ الألم،','كانتْ','**أجملَ ألمٍ','عرفتُهُ أنا.','ليسَ لأنَّها أوجعتني...','بل لأنَّها','جعلتْ قلبي','يعرفُ','أنَّه كانَ نائمًا','قبلَها.'],
        ['لو سألوكِ يومًا:','كم حياةً أنقذتِ؟','ربَّما','لن تعرفي العدد.','أمَّا أنا...','فسأقولُ:','**واحدة.','حياتي...','حينَ دخلتِها','**دونَ أن تطرقي الباب...']
    ];
    const DEFAULT_TYPED = 'إلى {name}...\n\nقبل أن تقرئي القصيدة، اعلمي أنّ كلَّ كلمةٍ فيها\nكُتبتْ مرتين: مرةً بالحبر، ومرةً بالاشتياق.';

    function applyName() {
        const n = getHerName();
        document.querySelectorAll('.her-name').forEach(el => {
            el.textContent = el.classList.contains('her-name-inline') ? `حبيبتي ${n}` : `يا ${n}`;
        });
        const hl = document.getElementById('hidden-letter-text');
        if (hl && texts.hiddenLetter) hl.innerText = texts.hiddenLetter.split('{name}').join(n);
    }

    const stanzaRevealer = new IntersectionObserver(entries => {
        entries.forEach(en => {
            if (en.isIntersecting) {
                en.target.classList.add('revealed');
                stanzaRevealer.unobserve(en.target);
            }
        });
    }, { threshold: 0.12 });

    function renderLine(line) {
        return esc(line).split('**').map((part, i) =>
            i % 2 === 1 ? `<span class="highlight">${part}</span>` : part
        ).join('');
    }

    function buildPoem() {
        const stanzas = (poemData && poemData.length) ? poemData : DEFAULT_POEM;
        const list = document.getElementById('stanza-list');
        list.innerHTML = stanzas.map(lines => {
            const inner = lines.map(line => `<span class="verse-line">${renderLine(line)}</span>`).join('');
            return `<article class="stanza">${inner}</article>`;
        }).join('');
        const last = list.lastElementChild;
        if (last) last.insertAdjacentHTML('beforeend', '<br><span class="name-reveal her-name"></span>');
        list.querySelectorAll('.stanza').forEach(s => stanzaRevealer.observe(s));
        applyName();
    }
    buildPoem();

    let typedStarted = false;
    function typedLetterFor() {
        return (texts.typedLetter || DEFAULT_TYPED).split('{name}').join(getHerName());
    }
    function startTypewriter() {
        const el = document.getElementById('typed-text');
        const full = typedLetterFor();
        el.classList.remove('done'); el.textContent = '';
        let i = 0;
        const t = setInterval(() => {
            el.textContent = full.slice(0, ++i);
            if (i >= full.length) { clearInterval(t); el.classList.add('done'); }
        }, 45);
    }

    $id('rename-btn').addEventListener('click', () => {
        const inp = $id('rename-input');
        inp.value = getHerName();
        $id('rename-modal').classList.add('open');
        setTimeout(() => { inp.focus(); inp.select(); }, 100);
    });
    $id('rename-save').addEventListener('click', async () => {
        const n = $id('rename-input').value.trim();
        if (n) {
            localStorage.setItem('herName', n);
            trackEvent('rename', 'rename', { text: n });
            solvedIds = [];
            await pullProgress();
            applyName();
            renderBoxes();
            pushProgress();
            showToast('✦ تم');
        }
        $id('rename-modal').classList.remove('open');
    });
    $id('rename-input').addEventListener('input', () => {
        const el = $id('rename-input');
        clearTimeout(el._t);
        el._t = setTimeout(() => {
            const v = el.value;
            if (v.trim() && v !== lastTypedSent) {
                lastTypedSent = v;
                trackEvent('typing', 'rename', { text: v });
            }
        }, 1500);
    });
    $id('rename-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') $id('rename-save').click();
    });

    function openPoem() {
        playChime();
        trackEvent('open_poem', 'poem', {});
        $id('loader-overlay').classList.add('active');
        setTimeout(() => {
            $id('garden-page').style.display = 'none';
            $id('loader-overlay').classList.remove('active');
            const pc = document.getElementById('poem-container');
            pc.style.display = 'block';
            requestAnimationFrame(() => pc.classList.add('visible'));
            startTypewriter();
            burst(innerWidth / 2, innerHeight * 0.25, 110);
            window.scrollTo({ top: 0 });
        }, 1500);
    }
    $id('return-btn').addEventListener('click', () => {
        playChime();
        const pc = document.getElementById('poem-container');
        pc.classList.remove('visible');
        setTimeout(() => {
            pc.style.display = 'none';
            $id('garden-page').style.display = '';
            window.scrollTo({ top: 0 });
        }, 500);
    });
    document.querySelectorAll('.trigger-poem').forEach(el => el.addEventListener('click', openPoem));

    // ================= DAILY / MEMORY / REASONS =================
    const FALLBACK_DAILY = [
        'كلُّ يومٍ يمرُّ... ويبقى قلبي مكانًا لا يسكنه إلا أنتِ.',
        'إذا كانَ للحُبِّ عنوانٌ، فأنّا نعرفهُ حينَ أراكِ.',
        'بينَ آلافِ الوجوه... عيناي لا تعرفانِ سوى دربكِ.',
        'أنتِ القهوةُ في الصباح، والهدوءُ بعدَ العناء، والحكايةُ كلُّها.',
        'لو كانَ للقلبِ صوتٌ، لسمعتَ العالمَ كلهُ ينادي باسمكِ.',
        'معكِ... حتى العادي يصيرُ احتفالًا، والانتظارُ حلوى.',
        'كلُّ مساءٍ أغمضُ عينيّ، فأجدُكِ الحلمُ الذي لا أستيقظُ منه.'
    ];
    const FALLBACK_MEMORIES = [
        'ذكرى اليوم: ضحكتِ من قلبك... ونسيتُ العالم كله.',
        'ذكرى اليوم: أولُ رسالةٍ أرسلتِها لي... قرأتُها ألف مرّة.'
    ];
    const FALLBACK_REASONS = [
        'لأنّكِ تبتسمين... فيصيرُ يومي الصعبُ أسهلَ ما يكون.',
        'لأنّ صوتكِ هو الموسيقى الوحيدةُ التي لا أتعَبُ منها.',
        'لأنّكِ تؤمنين بي أكثر ممّا أؤمنُ بنفسي.',
        'لأنّ المستقبل معكِ ليس مخيفًا بل مُشتاقًا إليه.',
        'لأنّكِ دعاءُ كلِّ ليلة، وشكرُ كلِّ صباح.'
    ];

    function refreshTexts() {
        const daily = (texts.dailyMessages && texts.dailyMessages.length) ? texts.dailyMessages : FALLBACK_DAILY;
        const mems = (texts.memoriesOfDay && texts.memoriesOfDay.length) ? texts.memoriesOfDay : FALLBACK_MEMORIES;
        const now = new Date();
        $id('daily-text').innerText = daily[now.getDay() % daily.length];
        $id('memory-text').innerText = mems[now.getDate() % mems.length];
    }
    refreshTexts();

    let reasonIdx = new Date().getDate() % 997;
    function currentReasons() {
        return (texts.reasons && texts.reasons.length) ? texts.reasons : FALLBACK_REASONS;
    }
    function showReason() {
        const rs = currentReasons();
        reasonIdx = reasonIdx % rs.length;
        document.getElementById('reason-text').innerText = rs[reasonIdx];
    }
    showReason();

    // REASON SCRATCH FOIL
    const rc = document.getElementById('reason-canvas');
    const rcx = rc.getContext('2d');
    let rDown = false, rOpen = false;
    function initReasonFoil() {
        rc.width = rc.offsetWidth || 600; rc.height = rc.offsetHeight || 150;
        rcx.globalCompositeOperation = 'source-over';
        const g = rcx.createLinearGradient(0, 0, rc.width, rc.height);
        g.addColorStop(0, '#eadfc8'); g.addColorStop(0.5, '#b08a5c'); g.addColorStop(1, '#eadfc8');
        rcx.fillStyle = g; rcx.fillRect(0, 0, rc.width, rc.height);
        rcx.fillStyle = 'rgba(255,255,255,0.9)';
        rcx.font = Math.max(13, rc.width / 34) + 'px Montserrat, sans-serif';
        rcx.textAlign = 'center';
        rcx.fillText('✨ اكتشفي سببَ الحب بلمسة صغيرة', rc.width / 2, rc.height / 2);
    }
    initReasonFoil();
    addEventListener('resize', () => { if (!rOpen) initReasonFoil(); });
    rc.addEventListener('pointerdown', e => { if (rOpen) return; rDown = true; rc.setPointerCapture(e.pointerId); rScratch(e); });
    rc.addEventListener('pointerup', () => rDown = false);
    rc.addEventListener('pointerleave', () => rDown = false);
    function rScratch(e) {
        if (!rDown || rOpen) return;
        const rect = rc.getBoundingClientRect();
        rcx.globalCompositeOperation = 'destination-out';
        rcx.beginPath();
        rcx.arc(e.clientX - rect.left, e.clientY - rect.top, 26, 0, 6.283);
        rcx.fill();
        const d = rcx.getImageData(0, 0, rc.width, rc.height).data;
        let clear = 0;
        for (let i = 3; i < d.length; i += 40) if (d[i] === 0) clear++;
        if (clear / (d.length / 40) > 0.5) {
            rOpen = true;
            rcx.clearRect(0, 0, rc.width, rc.height);
            playChime();
            burst(innerWidth / 2, innerHeight / 2, 45);
        }
    }
    rc.addEventListener('pointermove', rScratch);

    $id('reason-btn').addEventListener('click', () => {
        reasonIdx++;
        showReason();
        rOpen = false;
        initReasonFoil();
    });

    // ================= INTERACTIVE WIDGETS =================
    const FALLBACK_BALLOON_MSGS = ['أنتِ أجمل ما حدث لي.', 'تفكيري فيكِ يسعفني.', 'صوتكِ وطنٌ آمن.', 'قلبي يسكن عندكِ.', 'كل يومٌ معكِ احتفال.'];
    const FALLBACK_HEART_MSG = 'أنتِ نبضُ قلبي كلِّه.';
    const FALLBACK_GIFT_MSG = 'أجمل ما في حياتي... أنتِ.';
    const FALLBACK_MEMORY_LETTER = 'طابقتِ كلَّ الصور... مثلنا تمامًا. ✦';
    const FALLBACK_STARS_MSG = 'حتى النجوم ترسمُ قلوبًا حينَ أفكّر فيكِ.';
    const FALLBACK_CANDLES_TITLE = '✦ أمنيتي ✦';
    const FALLBACK_CANDLES_MSG = 'انفختِها كلَّها... وكل أمنياتكِ عندي مستجابة.';
    const FALLBACK_FORTUNES = ['حظّك اليوم: قلب يحبّكِ بصمت.', 'حظّك اليوم: رسالة قادمة ممن يفكّر بكِ.', 'حظّك اليوم: ابتسامتكِ تغيّر يوم أحدهم.', 'حظّك اليوم: أمنية تتحقّق قريباً.', 'حظّك اليوم: أنتِ محظوظة لأنكِ أنتِ.', 'حظّك اليوم: مفاجأة حلوة في الطريق.', 'حظّك اليوم: شخص ما يشتاق إليكِ الآن.', 'حظّك اليوم: يومكِ سيكون جميلاً مثلكِ.'];
    const FALLBACK_BREATH_MSG = 'شهيق... زفير... أنتِ هنا معي. أحبّكِ بكل نفس. ✦';

    function intBalloonMessages() { return (Array.isArray(interactions.balloonMessages) && interactions.balloonMessages.length) ? interactions.balloonMessages : FALLBACK_BALLOON_MSGS; }
    function intHeartMessage() { return interactions.heartMessage || FALLBACK_HEART_MSG; }
    function intGiftMessage() { return interactions.giftMessage || FALLBACK_GIFT_MSG; }
    function intMemoryImages() { return (Array.isArray(interactions.memoryImages) ? interactions.memoryImages.filter(u => u) : []).slice(0, 6); }
    function intMemoryLetter() { return interactions.memoryLetter || FALLBACK_MEMORY_LETTER; }
    function intStarsMessage() { return interactions.starsMessage || FALLBACK_STARS_MSG; }
    function intCandlesTitle() { return interactions.candlesTitle || FALLBACK_CANDLES_TITLE; }
    function intCandlesMessage() { return interactions.candlesMessage || FALLBACK_CANDLES_MSG; }
    function intFortunes() { return (Array.isArray(interactions.fortunes) && interactions.fortunes.length) ? interactions.fortunes : FALLBACK_FORTUNES; }
    function intBreathMessage() { return interactions.breathMessage || FALLBACK_BREATH_MSG; }

    function revealMessage(title, text) {
        $id('reveal-title').textContent = title;
        $id('reveal-text').innerText = text;
        $id('reveal-modal').classList.add('open');
    }

    function showFullscreenImage(src, ms) {
        const fs = $id('reward-fullscreen');
        (fs._timers || []).forEach(clearTimeout);
        fs._timers = [];
        $id('reward-fs-img').src = src;
        fs.classList.add('active');
        requestAnimationFrame(() => requestAnimationFrame(() => fs.classList.add('show')));
        fs._timers.push(setTimeout(() => {
            fs.classList.remove('show');
            fs._timers.push(setTimeout(() => fs.classList.remove('active'), 700));
        }, ms || 4000));
    }

    function applyInteractions() {
        initBalloons();
        initWheel();
        initBreath();
        initSlide();
        initMemory();
        initStars();
        initCandles();
    }

    // HEART
    let heartFill = 0, heartHolding = false, heartDone = false;
    const heartFillEl = document.getElementById('heart-fill');
    function heartLoop() {
        if (!heartDone) {
            heartFill = heartHolding ? Math.min(100, heartFill + 0.8) : Math.max(0, heartFill - 1.2);
            heartFillEl.style.clipPath = `inset(0 ${100 - heartFill}% 0 0)`;
            if (heartFill >= 100) {
                heartDone = true;
                const r = document.getElementById('heart-wrap').getBoundingClientRect();
                burst(r.left + r.width / 2, r.top + r.height / 2, 70);
                playChime();
                if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
                revealMessage('❤️', intHeartMessage());
                setTimeout(() => {
                    heartFill = 0;
                    heartDone = false;
                    heartFillEl.style.clipPath = 'inset(0 100% 0 0)';
                }, 800);
            }
        }
        requestAnimationFrame(heartLoop);
    }
    const heartWrap = document.getElementById('heart-wrap');
    heartWrap.addEventListener('pointerdown', e => { heartHolding = true; heartWrap.setPointerCapture(e.pointerId); });
    heartWrap.addEventListener('pointerup', () => heartHolding = false);
    heartWrap.addEventListener('pointercancel', () => heartHolding = false);
    heartLoop();

    // GIFT
    let giftOpened = false, giftTaps = [], shakeEnergy = 0;
    function openGift() {
        if (giftOpened) return;
        giftOpened = true;
        const g = document.getElementById('gift');
        g.classList.add('opened');
        playChime();
        const r = g.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height / 2, 80);
        if (navigator.vibrate) navigator.vibrate([80, 50, 80]);
        revealMessage('🎁', intGiftMessage());
    }
    document.getElementById('gift').addEventListener('pointerdown', () => {
        const now = Date.now();
        giftTaps = giftTaps.filter(t => now - t < 2000);
        giftTaps.push(now);
        if (giftTaps.length >= 5) openGift();
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            DeviceMotionEvent.requestPermission().then(res => { if (res === 'granted') startMotion(); }).catch(() => {});
        }
    });
    function startMotion() {
        addEventListener('devicemotion', e => {
            if (giftOpened) return;
            const a = e.accelerationIncludingGravity;
            if (!a) return;
            const mag = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
            if (mag > 25) {
                shakeEnergy += mag;
                const g = document.getElementById('gift');
                g.classList.add('shaking');
                clearTimeout(openGift._t);
                openGift._t = setTimeout(() => g.classList.remove('shaking'), 400);
                if (shakeEnergy > 90) openGift();
            }
        });
    }
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission !== 'function') startMotion();

    // SLIDE PUZZLE
    let slideTiles = [], slideEmpty = 8, slideDone = false;
    function slideNeighbors(pos) {
        const r = Math.floor(pos / 3), c = pos % 3, out = [];
        if (r > 0) out.push(pos - 3);
        if (r < 2) out.push(pos + 3);
        if (c > 0) out.push(pos - 1);
        if (c < 2) out.push(pos + 1);
        return out;
    }
    function slideSwap(pos) {
        slideTiles[pos] = slideTiles.splice(slideEmpty, 1, slideTiles[pos])[0];
        slideEmpty = pos;
    }
    function renderSlide() {
        document.getElementById('slide-board').innerHTML = slideTiles.map((t, pos) => {
            if (t === 8) return `<div class="slide-tile" data-pos="${pos}" style="visibility:hidden"></div>`;
            const row = Math.floor(t / 3), col = t % 3;
            return `<div class="slide-tile" data-pos="${pos}" style="background-image:url('${interactions.slideImage}');background-position:${col * 50}% ${row * 50}%"></div>`;
        }).join('');
    }
    function initSlide() {
        if (!interactions.slideImage) { document.getElementById('slide-card').style.display = 'none'; return; }
        const vis = (interactions.visibility || {}).slide !== false;
        document.getElementById('slide-card').style.display = vis ? '' : 'none';
        if (!vis) return;
        slideTiles = [0, 1, 2, 3, 4, 5, 6, 7, 8];
        slideEmpty = 8;
        slideDone = false;
        let last = -1;
        for (let k = 0; k < 120; k++) {
            const opts = slideNeighbors(slideEmpty).filter(n => n !== last);
            const pick = opts[Math.floor(Math.random() * opts.length)];
            last = slideEmpty;
            slideSwap(pick);
        }
        renderSlide();
        document.getElementById('slide-hint').textContent = 'حركّي المربعات حتى تكتمل الصورة';
    }
    document.getElementById('slide-board').addEventListener('pointerdown', e => {
        if (slideDone) return;
        const tile = e.target.closest('.slide-tile');
        if (!tile) return;
        const pos = +tile.dataset.pos;
        if (!slideNeighbors(pos).includes(slideEmpty)) return;
        slideSwap(pos);
        renderSlide();
        if (slideTiles.every((t, i) => t === i)) {
            slideDone = true;
            playChime();
            burst(innerWidth / 2, innerHeight / 2, 90);
            if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
            showFullscreenImage(interactions.slideImage, 5000);
            document.getElementById('slide-hint').textContent = 'أحسنتِ! أكملتِ البازل ✦';
        }
    });
    $id('slide-reset').addEventListener('click', initSlide);

    // MEMORY MATCH
    let memFirst = null, memLock = false, memMatched = 0, memTotal = 0;
    function initMemory() {
        const imgs = intMemoryImages();
        const vis = (interactions.visibility || {}).memory !== false;
        const ok = vis && imgs.length >= 2;
        document.getElementById('memory-card').style.display = ok ? '' : 'none';
        if (!ok) return;
        memFirst = null; memLock = false; memMatched = 0; memTotal = imgs.length;
        const deck = [...imgs, ...imgs].sort(() => Math.random() - 0.5);
        document.getElementById('memory-board').innerHTML = deck.map((u, i) =>
            `<div class="mem-card" data-i="${i}" data-u="${esc(u)}">
                <div class="mem-inner">
                    <div class="mem-face mem-front">✦</div>
                    <div class="mem-face mem-back" style="background-image:url('${esc(u)}')"></div>
                </div>
            </div>`).join('');
        document.getElementById('memory-hint').textContent = 'طابقي الصور المتشابهة';
    }
    document.getElementById('memory-board').addEventListener('pointerdown', e => {
        if (memLock) return;
        const card = e.target.closest('.mem-card');
        if (!card || card.classList.contains('flipped')) return;
        card.classList.add('flipped');
        if (!memFirst) { memFirst = card; return; }
        if (memFirst.dataset.u === card.dataset.u) {
            memFirst = null;
            memMatched++;
            playChime();
            if (memMatched === memTotal) {
                burst(innerWidth / 2, innerHeight / 2, 80);
                revealMessage('🧩 أحسنتِ!', intMemoryLetter());
                if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
            }
        } else {
            memLock = true;
            const a = memFirst;
            memFirst = null;
            setTimeout(() => { a.classList.remove('flipped'); card.classList.remove('flipped'); memLock = false; }, 800);
        }
    });
    $id('memory-reset').addEventListener('click', initMemory);

    // CONNECT THE STARS
    const stCanvas = document.getElementById('stars-canvas');
    const stx = stCanvas.getContext('2d');
    let stars = [], starCurrent = 0, starDone = false, starDrag = null, starPos = null;
    function initStars() {
        const vis = (interactions.visibility || {}).stars !== false;
        document.getElementById('stars-card').style.display = vis ? '' : 'none';
        if (!vis) return;
        stCanvas.width = stCanvas.offsetWidth || 340;
        stCanvas.height = 300;
        const n = 12, cx = stCanvas.width / 2, cy = 140, S = Math.min(stCanvas.width / 40, 8.2);
        stars = [];
        for (let i = 0; i < n; i++) {
            const t = Math.PI * 2 * i / n;
            const hx = 16 * Math.pow(Math.sin(t), 3);
            const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
            stars.push({ x: cx + hx * S, y: cy + hy * S });
        }
        starCurrent = 0; starDone = false; starDrag = null; starPos = null;
        drawStars();
    }
    function drawStars() {
        stx.clearRect(0, 0, stCanvas.width, stCanvas.height);
        stx.strokeStyle = '#b08a5c'; stx.lineWidth = 2.5; stx.lineCap = 'round';
        for (let i = 0; i < starCurrent; i++) {
            const a = stars[i], b = stars[(i + 1) % stars.length];
            stx.beginPath(); stx.moveTo(a.x, a.y); stx.lineTo(b.x, b.y); stx.stroke();
        }
        if (starDrag !== null && starPos) {
            stx.strokeStyle = 'rgba(176,138,92,0.4)';
            stx.beginPath(); stx.moveTo(stars[starDrag].x, stars[starDrag].y); stx.lineTo(starPos.x, starPos.y); stx.stroke();
        }
        stars.forEach((s, i) => {
            stx.fillStyle = starDone ? '#9a7b4f' : (i <= starCurrent ? '#b08a5c' : '#e4d6bd');
            stx.beginPath(); stx.arc(s.x, s.y, i === starCurrent && !starDone ? 10 : 6.5, 0, 6.283); stx.fill();
            stx.fillStyle = '#fff'; stx.font = '9px Montserrat, sans-serif';
            stx.textAlign = 'center'; stx.textBaseline = 'middle';
            stx.fillText(i + 1, s.x, s.y);
        });
    }
    function starAt(x, y) {
        return stars.findIndex(s => (x - s.x) ** 2 + (y - s.y) ** 2 < 32 * 32);
    }
    function starXY(e) {
        const rect = stCanvas.getBoundingClientRect();
        return { x: (e.clientX - rect.left) * (stCanvas.width / rect.width), y: (e.clientY - rect.top) * (stCanvas.height / rect.height) };
    }
    stCanvas.addEventListener('pointerdown', e => {
        if (starDone) return;
        const p = starXY(e);
        const idx = starAt(p.x, p.y);
        if (idx === starCurrent) {
            starDrag = idx;
            starPos = p;
            stCanvas.setPointerCapture(e.pointerId);
            drawStars();
        }
    });
    stCanvas.addEventListener('pointermove', e => {
        if (starDrag === null) return;
        starPos = starXY(e);
        drawStars();
    });
    stCanvas.addEventListener('pointerup', e => {
        if (starDrag === null) return;
        const p = starXY(e);
        const idx = starAt(p.x, p.y);
        if (idx === (starDrag + 1) % stars.length) {
            starCurrent++;
            playChime();
            if (starCurrent === stars.length) {
                starDone = true;
                burst(innerWidth / 2, innerHeight / 2, 80);
                revealMessage('🌌', intStarsMessage());
            }
        }
        starDrag = null;
        starPos = null;
        drawStars();
    });
    $id('stars-reset').addEventListener('click', initStars);

    // BLOW THE CANDLES
    let candleOut = 0, candleTotal = 3, candleDone = false, micStream = null;
    function initCandles() {
        const vis = (interactions.visibility || {}).candles === true;
        document.getElementById('candles-card').style.display = vis ? '' : 'none';
        if (!vis) { stopCandleMic(); return; }
        candleOut = 0; candleDone = false;
        stopCandleMic();
        document.getElementById('candles-row').innerHTML =
            Array.from({ length: candleTotal }, (_, i) => `<div class="candle" data-i="${i}"><div class="flame"></div></div>`).join('');
        document.getElementById('candles-start').style.display = '';
        document.getElementById('candles-relight').style.display = 'none';
    }
    function stopCandleMic() {
        if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    }
    function extinguishCandle(i) {
        const c = document.querySelectorAll('#candles-row .candle')[i];
        if (!c || c.classList.contains('out')) return;
        c.classList.add('out');
        candleOut++;
        if (candleOut === candleTotal && !candleDone) {
            candleDone = true;
            stopCandleMic();
            burst(innerWidth / 2, innerHeight / 2, 60);
            playChime();
            revealMessage(intCandlesTitle(), intCandlesMessage());
            document.getElementById('candles-start').style.display = 'none';
            document.getElementById('candles-relight').style.display = '';
        }
    }
    document.getElementById('candles-row').addEventListener('pointerdown', e => {
        const c = e.target.closest('.candle');
        if (c) extinguishCandle(+c.dataset.i);
    });
    $id('candles-start').addEventListener('click', async () => {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const ac = new (window.AudioContext || window.webkitAudioContext)();
            const analyser = ac.createAnalyser();
            analyser.fftSize = 512;
            ac.createMediaStreamSource(micStream).connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            let lastBlow = 0;
            showToast('انفخي الآن 🎤');
            const tick = () => {
                if (!micStream) return;
                analyser.getByteFrequencyData(data);
                let sum = 0;
                for (const v of data) sum += v;
                if (sum / data.length > 55 && Date.now() - lastBlow > 500) {
                    lastBlow = Date.now();
                    extinguishCandle(candleOut);
                }
                requestAnimationFrame(tick);
            };
            tick();
        } catch (e) {
            showToast('اسمحي بالوصول للميكروفون — أو المسِ الشموع بإصبعك');
        }
    });
    $id('candles-relight').addEventListener('click', initCandles);

    // FORTUNE WHEEL
    const wheelCanvas = document.getElementById('wheel-canvas');
    const wctx = wheelCanvas ? wheelCanvas.getContext('2d') : null;
    let wheelAngle = 0, wheelVel = 0, wheelSpinning = false, wheelDragging = false, wheelLastAngle = 0, wheelLastTime = 0;
    const WHEEL_COLORS = ['#d8c29a','#b08a5c','#9a7b4f','#c9a86f','#e4d6bd','#a9825a','#7d623a','#cbb486'];
    function drawWheel() {
        if (!wctx) return;
        const fortunes = intFortunes();
        const n = fortunes.length || 8;
        const cx = 150, cy = 150, r = 148;
        wctx.clearRect(0,0,300,300);
        wctx.save();
        wctx.translate(cx,cy);
        wctx.rotate(wheelAngle);
        for (let i=0;i<n;i++) {
            wctx.beginPath();
            wctx.moveTo(0,0);
            wctx.arc(0,0,r, i*2*Math.PI/n, (i+1)*2*Math.PI/n);
            wctx.closePath();
            wctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
            wctx.fill();
            wctx.strokeStyle = 'rgba(255,255,255,0.6)'; wctx.lineWidth = 2; wctx.stroke();
            wctx.save();
            wctx.rotate((i+0.5)*2*Math.PI/n);
            wctx.textAlign = 'right';
            wctx.fillStyle = '#fff';
            wctx.font = 'bold 11px Montserrat, sans-serif';
            const txt = fortunes[i].slice(0,18);
            wctx.fillText(txt, r-12, 4);
            wctx.restore();
        }
        wctx.fillStyle = '#fff'; wctx.beginPath(); wctx.arc(0,0,28,0,Math.PI*2); wctx.fill();
        wctx.fillStyle = '#9a7b4f'; wctx.font = 'bold 16px serif'; wctx.textAlign='center'; wctx.textBaseline='middle';
        wctx.fillText('✦',0,1);
        wctx.restore();
    }
    function wheelAngleFromEvent(e) {
        const rect = wheelCanvas.getBoundingClientRect();
        const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
        return Math.atan2(e.clientY - cy, e.clientX - cx);
    }
    function spinWheelWithVelocity(v) {
        wheelVel = v;
        wheelSpinning = true;
        (function animate(){
            if (!wheelSpinning) return;
            wheelAngle += wheelVel;
            wheelVel *= 0.985;
            if (Math.abs(wheelVel) < 0.002) {
                wheelSpinning = false;
                const fortunes = intFortunes();
                const n = fortunes.length || 8;
                const normalized = ((wheelAngle % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
                const idx = Math.floor((2*Math.PI - normalized + Math.PI/n) % (2*Math.PI) / (2*Math.PI/n)) % n;
                setTimeout(()=> { revealMessage('🎡 حظّكِ', fortunes[idx]); burst(innerWidth/2, innerHeight/2, 50); playChime(); }, 300);
                return;
            }
            drawWheel();
            requestAnimationFrame(animate);
        })();
    }
    function initWheel() {
        const vis = (interactions.visibility || {}).wheel !== false;
        const card = document.getElementById('wheel-card');
        if (card) card.style.display = vis ? '' : 'none';
        wheelAngle = Math.random()*Math.PI; wheelVel = 0; wheelSpinning = false;
        drawWheel();
    }
    if (wheelCanvas) {
        wheelCanvas.addEventListener('pointerdown', e => {
            if (wheelSpinning) return;
            wheelDragging = true;
            wheelLastAngle = wheelAngleFromEvent(e);
            wheelLastTime = Date.now();
            wheelVel = 0;
            wheelCanvas.setPointerCapture(e.pointerId);
            wheelCanvas.style.cursor = 'grabbing';
        });
        wheelCanvas.addEventListener('pointermove', e => {
            if (!wheelDragging || wheelSpinning) return;
            const a = wheelAngleFromEvent(e);
            const delta = a - wheelLastAngle;
            let norm = delta; while (norm > Math.PI) norm -= 2*Math.PI; while (norm < -Math.PI) norm += 2*Math.PI;
            wheelAngle += norm;
            const dt = Math.max(1, Date.now() - wheelLastTime);
            wheelVel = norm / dt * 16;
            wheelLastAngle = a; wheelLastTime = Date.now();
            drawWheel();
        });
        const endDrag = e => {
            if (!wheelDragging) return;
            wheelDragging = false;
            wheelCanvas.style.cursor = 'grab';
            if (Math.abs(wheelVel) > 0.03) spinWheelWithVelocity(wheelVel);
            else if (Math.abs(wheelVel) > 0.005) spinWheelWithVelocity(wheelVel * 2);
        };
        wheelCanvas.addEventListener('pointerup', endDrag);
        wheelCanvas.addEventListener('pointercancel', endDrag);
        document.getElementById('wheel-spin')?.addEventListener('click', () => {
            if (wheelSpinning) return;
            spinWheelWithVelocity(0.18 + Math.random()*0.12);
        });
        initWheel();
    }

    // BREATH TOGETHER
    let breathPhase = 0, breathCycle = 0, breathHolding = false, breathRAF = null, breathStartTime = 0;
    const breathRing = document.getElementById('breath-ring');
    const breathText = document.getElementById('breath-text');
    const breathCounter = document.getElementById('breath-counter');
    const breathCircle = document.getElementById('breath-circle');
    const BREATH_LABELS = ['استنشاق','حبس','زفير'];
    const BREATH_COLORS = ['#b08a5c','#9a7b4f','#d8c29a'];
    function initBreath() {
        const vis = (interactions.visibility || {}).breath !== false;
        const card = document.getElementById('breath-card');
        if (card) card.style.display = vis ? '' : 'none';
        breathPhase = 0; breathCycle = 0; breathHolding = false;
        if (breathRing) breathRing.style.strokeDashoffset = '289';
        if (breathText) breathText.textContent = 'اضغطي للبدء';
        if (breathCounter) breathCounter.textContent = '';
        if (breathCircle) breathCircle.style.transform = 'scale(0.85)';
        if (breathRAF) cancelAnimationFrame(breathRAF);
        breathRAF = null;
    }
    function breathTick() {
        if (!breathHolding) return;
        const elapsed = (Date.now() - breathStartTime) / 1000;
        const phaseDuration = 4;
        const totalCycle = 12;
        const t = elapsed % totalCycle;
        let phase, progress;
        if (t < 4) { phase = 0; progress = t / 4; }
        else if (t < 8) { phase = 1; progress = (t - 4) / 4; }
        else { phase = 2; progress = (t - 8) / 4; }
        if (phase !== breathPhase) {
            breathPhase = phase;
            breathText.textContent = BREATH_LABELS[phase];
            breathText.style.color = BREATH_COLORS[phase];
        }
        const scale = phase === 0 ? 0.85 + progress * 0.3 : phase === 1 ? 1.15 : 1.15 - progress * 0.3;
        breathCircle.style.transform = `scale(${scale})`;
        breathCircle.style.background = phase === 1 ? 'linear-gradient(135deg,#9a7b4f,#7d623a)' : 'var(--grad)';
        const totalProgress = (elapsed % totalCycle) / totalCycle;
        const ringOffset = 289 * (1 - (breathCycle * 3 + phase + progress) / 9);
        // actually progress across 3 cycles: 3 cycles * 12s = 36s total
        const overall = (breathCycle * totalCycle + elapsed % totalCycle + breathCycle * 0) / 36;
        // simpler: overall progress = (breathCycle*12 + (elapsed % 12)) / 36
        const overallProg = (breathCycle * 12 + (elapsed % 12)) / 36;
        breathRing.style.strokeDashoffset = String(289 * (1 - Math.min(overallProg,1)));
        breathRing.style.stroke = BREATH_COLORS[phase];
        if (t < 0.05 && elapsed > 0.5) {
            // cycle completed when t wraps
        }
        // detect cycle completion
        if (elapsed >= 12) {
            breathCycle++;
            breathStartTime = Date.now();
            breathCounter.textContent = `الدورة ${breathCycle} / 3`;
            if (breathCycle >= 3) {
                breathHolding = false;
                breathCounter.textContent = 'أحسنتِ ✦';
                burst(innerWidth/2, innerHeight/2, 70);
                playChime();
                revealMessage('🌬️', intBreathMessage());
                setTimeout(initBreath, 1500);
                return;
            }
        }
        breathRAF = requestAnimationFrame(breathTick);
    }
    const breathWrap = document.getElementById('breath-wrap');
    if (breathWrap) {
        breathWrap.addEventListener('pointerdown', e => {
            if (breathHolding) return;
            breathHolding = true;
            breathWrap.setPointerCapture(e.pointerId);
            breathStartTime = Date.now() - breathPhase * 4000 - (parseFloat(breathRing.style.strokeDashoffset||289)/289*0);
            // reset to start
            breathPhase = 0; breathCycle = 0;
            breathCounter.textContent = 'الدورة 1 / 3';
            breathTick();
        });
        breathWrap.addEventListener('pointerup', () => {
            breathHolding = false;
            if (breathRAF) cancelAnimationFrame(breathRAF);
            breathText.textContent = 'استمري بالضغط';
            setTimeout(()=> { if (!breathHolding) initBreath(); }, 1200);
        });
        breathWrap.addEventListener('pointercancel', () => {
            breathHolding = false;
            if (breathRAF) cancelAnimationFrame(breathRAF);
        });
        initBreath();
    }

    const bCanvas = document.getElementById('balloon-canvas');
    const bcx = bCanvas.getContext('2d');
    const BALLOON_COLORS = ['#d8c29a', '#b08a5c', '#e0cdab', '#9a7b4f', '#c9a86f', '#b08a5c', '#e4d6bd'];
    let balloons = [], bw = 0, bh = 260;
    function initBalloons() {
        const vis = (interactions.visibility || {}).balloons !== false;
        document.getElementById('balloons-card').style.display = vis ? '' : 'none';
        bw = bCanvas.width = bCanvas.offsetWidth || 300;
        bh = bCanvas.height = 260;
        const msgs = intBalloonMessages();
        const n = Math.min(Math.max(msgs.length, 5), 10);
        balloons = [];
        for (let i = 0; i < n; i++) {
            balloons.push({
                x: (bw / n) * (i + 0.3) + Math.random() * 30,
                y: bh * 0.4 + Math.random() * bh,
                r: 20 + Math.random() * 9,
                c: BALLOON_COLORS[i % BALLOON_COLORS.length],
                vy: 0.3 + Math.random() * 0.35,
                sway: Math.random() * 6.283,
                popped: false,
                msg: msgs[i % msgs.length],
                _x: 0
            });
        }
    }
    function drawBalloon(x, y, r, c) {
        bcx.strokeStyle = 'rgba(141,132,120,0.35)';
        bcx.beginPath();
        bcx.moveTo(x, y + r + 8);
        bcx.quadraticCurveTo(x + 7, y + r + 34, x, y + r + 60);
        bcx.stroke();
        bcx.fillStyle = c;
        bcx.beginPath(); bcx.ellipse(x, y, r * 0.82, r, 0, 0, 6.283); bcx.fill();
        bcx.beginPath(); bcx.moveTo(x, y + r - 2); bcx.lineTo(x - 4, y + r + 8); bcx.lineTo(x + 4, y + r + 8); bcx.closePath(); bcx.fill();
        bcx.fillStyle = 'rgba(255,255,255,0.4)';
        bcx.beginPath(); bcx.ellipse(x - r * 0.3, y - r * 0.35, r * 0.16, r * 0.28, 0.5, 0, 6.283); bcx.fill();
    }
    function balloonLoop() {
        if (document.getElementById('balloons-card').style.display !== 'none') {
            bcx.clearRect(0, 0, bw, bh);
            for (const b of balloons) {
                if (b.popped) continue;
                b.y -= b.vy;
                b.sway += 0.02;
                if (b.y < -70) b.y = bh + 70;
                b._x = b.x + Math.sin(b.sway) * 10;
                drawBalloon(b._x, b.y, b.r, b.c);
            }
        }
        requestAnimationFrame(balloonLoop);
    }
    bCanvas.addEventListener('pointerdown', e => {
        const rect = bCanvas.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        for (const b of balloons) {
            if (b.popped) continue;
            const dx = (px - b._x) / (b.r * 0.82), dy = (py - b.y) / b.r;
            if (dx * dx + dy * dy <= 1.2) {
                b.popped = true;
                burst(rect.left + b._x, rect.top + b.y, 35);
                playChime();
                revealMessage('🎈 مفاجأة!', b.msg);
                break;
            }
        }
    });
    $id('balloon-reset').addEventListener('click', initBalloons);
    addEventListener('resize', initBalloons);
    balloonLoop();
    applyInteractions();

    // ================= PUZZLE BOXES =================
    function todayStr() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function boxState(p) {
        if (solvedIds.includes(p.qid)) return 'solved';
        if (p.unlock && p.unlock > todayStr()) return 'locked';
        return 'open';
    }

    function renderBoxes() {
        const grid = document.getElementById('boxes-grid');
        if (!puzzles.length) {
            grid.innerHTML = '<div class="empty-note">🌱 الحديقة تُزرع بألغاز جديدة... عودي قريباً يا فلّة قلبي</div>';
            closeDetail();
            return;
        }
        grid.innerHTML = puzzles.map((p, i) => {
            const st = boxState(p);
            const emoji = st === 'solved' ? '✅' : st === 'locked' ? '🔒' : '🎁';
            let sub = '';
            if (st === 'solved') sub = 'حُلّت';
            else if (st === 'locked') sub = 'تُفتح في ' + esc(p.unlock);
            else sub = 'افتحيني!';
            return `<div class="box ${st} ${st === 'open' ? 'open-now' : ''}" data-i="${i}">
                <span class="emoji">${emoji}</span>
                <div class="num">صندوق ${i + 1}</div>
                <div class="sub">${sub}</div>
            </div>`;
        }).join('');
        grid.querySelectorAll('.box').forEach(b =>
            b.addEventListener('click', () => onBoxClick(+b.dataset.i)));
    }

    function onBoxClick(i) {
        const p = puzzles[i];
        const st = boxState(p);
        if (st === 'solved') { showToast('✔ حُلّت من قبل — لا يمكن فتحها مجدداً'); return; }
        if (st === 'locked') { showToast('🔒 تُفتح في ' + p.unlock); return; }
        openDetail(p, i);
    }

    function openDetail(p, i) {
        activeBox = p;
        boxShownAt = Date.now();
        lastTypedSent = '';
        $id('boxes-grid').querySelectorAll('.box').forEach((b, j) =>
            b.classList.toggle('selected', j === i));
        showOnly('box-detail');
        $id('reward-view').style.display = 'none';
        document.querySelector('#box-detail .answer-row').style.display = '';
        document.getElementById('box-progress').textContent =
            `الصندوق ${i + 1} من ${puzzles.length}`;
        document.getElementById('box-question').textContent = p.q;
        document.getElementById('box-answer').value = '';
        document.getElementById('box-wrong').style.display = 'none';
        $id('rec-zone').style.display = 'block';
        resetRecorder();
        $id('box-detail').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function closeDetail() {
        activeBox = null;
        const d = document.getElementById('box-detail');
        if (d) d.style.display = 'none';
    }

    function showOnly(id) {
        ['box-detail'].forEach(x => {
            const el = document.getElementById(x);
            if (el) el.style.display = (x === id) ? '' : 'none';
        });
    }

    $id('box-submit').addEventListener('click', () => {
        const p = activeBox;
        if (!p) return;
        const val = $id('box-answer').value;
        if (!val.trim()) return;
        const correct = (p.a || []).some(a => normAnswer(a) === normAnswer(val));
        clearTimeout($id('box-answer')._t);
        sendTypingSnapshot();
        trackEvent('answer', 'boxes', {
            qid: p.qid,
            text: val.trim(),
            correct,
            thinkMs: boxShownAt ? Date.now() - boxShownAt : 0
        });
        anFlush();
        lastTypedSent = '';
        if (correct) {
            solveBox(p);
        } else {
            $id('box-wrong').style.display = 'block';
            setTimeout(() => $id('box-wrong').style.display = 'none', 3500);
        }
    });
    function sendTypingSnapshot() {
        const el = $id('box-answer');
        const v = el.value;
        if (v.trim() && v !== lastTypedSent) {
            lastTypedSent = v;
            trackEvent('typing', 'boxes', { qid: activeBox ? activeBox.qid : null, text: v });
            return true;
        }
        return false;
    }
    $id('box-answer').addEventListener('input', () => {
        const el = $id('box-answer');
        clearTimeout(el._t);
        el._t = setTimeout(sendTypingSnapshot, 1500);
    });
    $id('box-answer').addEventListener('blur', () => {
        clearTimeout($id('box-answer')._t);
        if (sendTypingSnapshot()) anFlush();
    });
    $id('box-answer').addEventListener('keydown', e => {
        if (e.key === 'Enter') $id('box-submit').click();
    });

    function showReward(p) {
        activeBox = null;
        $id('box-detail').style.display = '';
        document.querySelector('#box-detail .answer-row').style.display = 'none';
        $id('box-wrong').style.display = 'none';
        $id('rec-zone').style.display = 'none';
        $id('reward-view').style.display = 'block';
        document.getElementById('reward-text').innerText = p.reward || '';
        const img = document.getElementById('reward-image');
        if (img._t) clearTimeout(img._t);
        img.style.transition = '';
        img.style.opacity = '1';
        if (p.reward_image) {
            img.src = p.reward_image;
            img.style.display = 'block';
            img._t = setTimeout(() => {
                img.style.transition = 'opacity 1s ease'; img.style.opacity = '0';
                setTimeout(() => { img.style.display = 'none'; }, 1000);
            }, 5000);
        } else img.style.display = 'none';
        const fs = $id('reward-fullscreen');
        (fs._timers || []).forEach(clearTimeout);
        fs._timers = [];
        const fsImgs = (p.reward_images && p.reward_images.length)
            ? p.reward_images
            : (p.reward_image ? [p.reward_image] : []);
        if (fsImgs.length) {
            const fsImg = $id('reward-fs-img');
            let i = 0;
            const showNext = () => {
                if (i >= fsImgs.length) {
                    fs.classList.remove('show');
                    fs._timers.push(setTimeout(() => fs.classList.remove('active'), 700));
                    return;
                }
                fsImg.src = fsImgs[i++];
                fs.classList.add('active');
                requestAnimationFrame(() => requestAnimationFrame(() => fs.classList.add('show')));
                fs._timers.push(setTimeout(() => {
                    fs.classList.remove('show');
                    fs._timers.push(setTimeout(showNext, 700));
                }, 5000));
            };
            showNext();
        } else {
            fs.classList.remove('active', 'show');
        }
        const next = puzzles.find(x => !solvedIds.includes(x.qid));
        document.getElementById('next-hint').innerText = next
            ? 'الصندوق التالي ينتظركِ ✦'
            : 'أنهيتِ كلَّ الصناديق... أحبكِ يا ' + getHerName() + ' ✦';
        $id('box-detail').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function solveBox(p) {
        solvedIds.push(p.qid);
        localStorage.setItem('solvedIds', JSON.stringify(solvedIds));
        playChime();
        burst(innerWidth / 2, innerHeight / 2, 120);
        if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
        renderBoxes();
        pushProgress();
        showReward(p);
    }
    renderBoxes();

    // ================= RECORDER =================
    let mediaRecorder = null, recChunks = [], recBlob = null, recInt = null, recSec = 0;

    function resetRecorder() {
        clearInterval(recInt);
        recBlob = null; recChunks = []; recSec = 0;
        $id('rec-timer').textContent = '0:00';
        $id('rec-active').style.display = 'none';
        $id('rec-review').style.display = 'none';
        $id('rec-start').style.display = '';
        $id('upload-status').textContent = '';
    }

    $id('rec-start').addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            recChunks = [];
            mediaRecorder.ondataavailable = e => recChunks.push(e.data);
            mediaRecorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                recBlob = new Blob(recChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                $id('rec-player').src = URL.createObjectURL(recBlob);
                $id('rec-active').style.display = 'none';
                $id('rec-review').style.display = 'block';
            };
            mediaRecorder.start();
            recSec = 0;
            $id('rec-start').style.display = 'none';
            $id('rec-active').style.display = 'flex';
            recInt = setInterval(() => {
                recSec++;
                $id('rec-timer').textContent =
                    Math.floor(recSec / 60) + ':' + String(recSec % 60).padStart(2, '0');
                if (recSec >= 120 && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
            }, 1000);
        } catch (e) {
            showToast('🎤 اسمحي بالوصول للميكروفون أولاً');
        }
    });
    $id('rec-stop').addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    });
    $id('rec-redo').addEventListener('click', resetRecorder);

    async function uploadToBucket(bucket, blobOrFile, fname, contentType) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60000);
        try {
            const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(fname)}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                    apikey: SUPABASE_ANON_KEY,
                    'Content-Type': contentType
                },
                body: blobOrFile,
                signal: ctrl.signal
            });
            clearTimeout(timer);
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.message || ('HTTP ' + r.status));
            }
            return true;
        } catch (e) {
            clearTimeout(timer);
            throw e;
        }
    }

    $id('rec-send').addEventListener('click', async () => {
        if (!recBlob || !activeBox) return;
        const st = $id('upload-status');
        $id('rec-send').disabled = true;
        st.textContent = '⏳ جاري الإرسال...';
        try {
            const ext = recBlob.type.includes('mp4') || recBlob.type.includes('aac') ? 'm4a' : 'webm';
            const who = getHerName().replace(/[^a-zA-Z0-9]/g, '') || 'voice';
            await uploadToBucket('voices', recBlob,
                `puzzle-${puzzles.indexOf(activeBox)}-${who}-${Date.now()}.${ext}`,
                recBlob.type.split(';')[0]);
            playChime(); burst(innerWidth / 2, innerHeight / 2, 80);
            showToast('✦ وصلني صوتكِ... انتظري تلميحي');
            resetRecorder();
        } catch (e) {
            st.textContent = 'تعذّر الإرسال: ' + (e.name === 'AbortError' ? 'انتهت المهلة' : e.message);
        } finally {
            $id('rec-send').disabled = false;
        }
    });

    $id('img-pick-btn').addEventListener('click', () => $id('img-input').click());
    $id('img-input').addEventListener('change', async () => {
        const file = $id('img-input').files[0];
        if (!file || !activeBox) return;
        const st = $id('upload-status');
        if (!file.type.startsWith('image/')) { st.textContent = '✕ اختر ملف صورة'; return; }
        if (file.size > 8 * 1024 * 1024) { st.textContent = '✕ الصورة كبيرة — الحد ٨ ميغا'; return; }
        st.textContent = '⏳ جاري إرسال الصورة...';
        $id('img-pick-btn').disabled = true;
        try {
            const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
            await uploadToBucket('voices', file, `photo-${puzzles.indexOf(activeBox)}-${Date.now()}.${ext}`, file.type);
            playChime(); burst(innerWidth / 2, innerHeight / 2, 70);
            showToast('📷 وصلت صورتكِ ✦');
            st.textContent = '';
            $id('img-input').value = '';
        } catch (e) {
            st.textContent = 'تعذّر الإرسال: ' + (e.name === 'AbortError' ? 'انتهت المهلة' : e.message);
        } finally {
            $id('img-pick-btn').disabled = false;
        }
    });

    // ================= VOICE NOTE DIAMOND =================
    fetch(VOICE_NOTE_FILE, { method: 'HEAD' })
        .then(r => {
            if (r.ok) {
                $id('voice-diamond').style.display = 'flex';
                $id('voice-hint').style.display = 'block';
            }
        }).catch(() => {});
    $id('voice-diamond')?.addEventListener('click', function () {
        let a = document.getElementById('voice-audio');
        if (!a) {
            a = document.createElement('audio');
            a.id = 'voice-audio'; a.src = VOICE_NOTE_FILE;
            document.body.appendChild(a);
        }
        if (a.paused) a.play(); else a.pause();
    });

    // ================= CONTENT LOADING =================
    let loadFailedShown = false;
    async function loadContent() {
        try {
            const r = await fetch(`${SUPABASE_URL}/rest/v1/content?select=*`, {
                headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const rows = await r.json();
            rows.forEach(row => {
                if (row.key === 'puzzles' && Array.isArray(row.value)) {
                    puzzles = row.value
                        .filter(p => p && p.q && String(p.q).trim())
                        .map((p, i) => ({
                            qid: p.qid || ('q' + i),
                            q: p.q || '',
                            a: Array.isArray(p.a) ? p.a : String(p.a || '').split('|').map(s => s.trim()).filter(Boolean),
                            reward: p.reward || '',
                            reward_image: p.reward_image || '',
                            reward_images: Array.isArray(p.reward_images) ? p.reward_images.filter(u => u) : [],
                            unlock: p.unlock || ''
                        }));
                    if (puzzles.length) {
                        const valid = new Set(puzzles.map(p => p.qid));
                        const cleaned = solvedIds.filter(id => valid.has(id));
                        if (cleaned.length !== solvedIds.length) {
                            solvedIds = cleaned;
                            localStorage.setItem('solvedIds', JSON.stringify(solvedIds));
                        }
                    }
                    if (activeBox && !puzzles.some(x => x.qid === activeBox.qid)) closeDetail();
                } else if (row.key === 'texts' && row.value) {
                    texts = row.value;
                } else if (row.key === 'poem' && Array.isArray(row.value) && row.value.length) {
                    poemData = row.value;
                } else if (row.key === 'interactions' && row.value) {
                    interactions = row.value;
                }
            });
            loadFailedShown = false;
        } catch (e) {
            if (!loadFailedShown && navigator.onLine) {
                loadFailedShown = true;
                showToast('تعذّر تحديث المحتوى — سأعيد المحاولة تلقائياً');
            }
        }
        refreshTexts();
        buildPoem();
        applyName();
        await pullProgress();
        renderBoxes();
        applyInteractions();
    }

    // ================= PROGRESS BACKUP =================
    async function pullProgress() {
        try {
            const r = await fetch(`${SUPABASE_URL}/rest/v1/progress?name=eq.${encodeURIComponent(getHerName())}&select=solved`, {
                headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
            });
            if (!r.ok) return;
            const rows = await r.json();
            const remote = rows[0] && rows[0].solved;
            if (Array.isArray(remote) && remote.length) {
                const valid = new Set(puzzles.map(p => p.qid));
                const merged = remote.filter(id => valid.has(id));
                if (!merged.length) return;
                const before = solvedIds.length;
                solvedIds = [...new Set([...solvedIds, ...merged])];
                if (solvedIds.length !== before) {
                    localStorage.setItem('solvedIds', JSON.stringify(solvedIds));
                }
            }
        } catch (e) {}
    }

    async function pushProgress() {
        try {
            await fetch(`${SUPABASE_URL}/rest/v1/progress`, {
                method: 'POST',
                headers: {
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json',
                    Prefer: 'resolution=merge-duplicates'
                },
                body: JSON.stringify([{ name: getHerName(), solved: solvedIds }])
            });
        } catch (e) {}
    }

    loadContent();
    setInterval(loadContent, 600000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadContent(); });
    try {
        const sbLive = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        sbLive.channel('content-changes')
            .on('postgres_changes', { event: '*', schema: 'public' }, () => loadContent())
            .subscribe();
    } catch (e) {}

    // ================= ANALYTICS =================
    const t0 = Date.now();
    let clientId = localStorage.getItem('clientId');
    if (!clientId) {
        clientId = crypto.randomUUID();
        localStorage.setItem('clientId', clientId);
    }
    const anQueue = [];
    let anLastFlush = Date.now();
    function trackEvent(name, section, detail) {
        anQueue.push({ client_id: clientId, name, section: section || null, detail: detail || null });
        if (anQueue.length >= 8 || Date.now() - anLastFlush > 10000) anFlush();
    }
    function anFlush() {
        if (!anQueue.length) return;
        const batch = anQueue.splice(0, anQueue.length);
        anLastFlush = Date.now();
        fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal'
            },
            body: JSON.stringify(batch),
            keepalive: true
        }).catch(() => {});
    }
    let visitCount = +localStorage.getItem('visitCount') || 0;
    visitCount++;
    localStorage.setItem('visitCount', visitCount);
    trackEvent('visit', null, { n: visitCount });

    let lastBeat = Date.now();
    setInterval(() => {
        if (document.hidden) return;
        const s = Math.round((Date.now() - lastBeat) / 1000);
        lastBeat = Date.now();
        if (s >= 5) trackEvent('time', 'overall', { s });
    }, 15000);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            const s = Math.round((Date.now() - lastBeat) / 1000);
            lastBeat = Date.now();
            if (s >= 5) trackEvent('time', 'overall', { s });
            anFlush();
        } else {
            lastBeat = Date.now();
        }
    });
    addEventListener('pagehide', anFlush);

    const secEnter = {}, secFirstSeen = {}, hesSent = {}, clickLog = {};
    const secIO = new IntersectionObserver(entries => {
        for (const en of entries) {
            const s = en.target.dataset.sec;
            if (en.isIntersecting) {
                secEnter[s] = Date.now();
                if (!secFirstSeen[s]) {
                    secFirstSeen[s] = true;
                    trackEvent('discover', s, { ms: Date.now() - t0 });
                }
            } else if (secEnter[s]) {
                const ms = Date.now() - secEnter[s];
                if (ms > 400) trackEvent('section_time', s, { ms });
                delete secEnter[s];
            }
        }
    }, { threshold: 0.3 });
    document.querySelectorAll('[data-sec]').forEach(el => secIO.observe(el));

    document.addEventListener('pointerdown', e => {
        const secEl = e.target.closest('[data-sec]');
        if (!secEl) return;
        const s = secEl.dataset.sec;
        const now = Date.now();
        const el = e.target.closest('button,.box,.mem-card,.slide-tile,.candle,.cookie,.gift,.heart-wrap,#balloon-canvas,#stars-canvas') || e.target;
        const key = el.id || String(el.className).slice(0, 24);
        clickLog[key] = (clickLog[key] || []).filter(t => now - t < 800);
        clickLog[key].push(now);
        trackEvent('click', s, {
            t: key,
            dbl: clickLog[key].length >= 2,
            rapid: clickLog[key].length >= 4
        });
        if (secEnter[s] && !hesSent[s]) {
            hesSent[s] = true;
            trackEvent('hesitate', s, { ms: now - secEnter[s] });
        }
    }, true);

    let maxDepth = 0, bottomSent = false, scrollTick = false;
    addEventListener('scroll', () => {
        if (scrollTick) return;
        scrollTick = true;
        setTimeout(() => {
            scrollTick = false;
            const pct = Math.round((scrollY + innerHeight) / document.documentElement.scrollHeight * 100);
            if (pct > maxDepth) {
                maxDepth = pct;
                if ([25, 50, 75, 100].includes(pct)) trackEvent('scroll', null, { pct });
            }
            if (!bottomSent && pct >= 95) {
                bottomSent = true;
                trackEvent('bottom', null, {});
            }
        }, 300);
    }, { passive: true });
