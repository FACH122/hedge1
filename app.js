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
    let poemData = null;
    let activeBox = null;

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
    $id('music-btn').addEventListener('click', () => {
        try {
            if (!musicCtx) musicCtx = new (window.AudioContext || window.webkitAudioContext)();
            musicOn = !musicOn;
            $id('music-btn').classList.toggle('playing', musicOn);
            $id('music-btn').textContent = musicOn ? '♫' : '♪';
            if (musicOn) { ambientNote(); musicTimer = setInterval(ambientNote, 1600); showToast('♪ موسيقى هادئة لكِ وحدك'); }
            else clearInterval(musicTimer);
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
                life: 1, hue: 320 + Math.random() * 30 });
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
            fctx.fillStyle = '#f48fbf';
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
            solvedIds = [];
            await pullProgress();
            applyName();
            renderBoxes();
            pushProgress();
            showToast('✦ تم');
        }
        $id('rename-modal').classList.remove('open');
    });
    $id('rename-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') $id('rename-save').click();
    });

    function openPoem() {
        playChime();
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
        g.addColorStop(0, '#f9cfe3'); g.addColorStop(0.5, '#e78ab5'); g.addColorStop(1, '#f9cfe3');
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
        if ((p.a || []).some(a => normAnswer(a) === normAnswer(val))) {
            solveBox(p);
        } else {
            $id('box-wrong').style.display = 'block';
            setTimeout(() => $id('box-wrong').style.display = 'none', 3500);
        }
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
